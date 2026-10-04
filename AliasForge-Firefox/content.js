// Content scripts cannot load ES modules, so this file stays self-contained
// and wraps the required API calls locally.
const extensionApi = globalThis.browser ?? globalThis.chrome;

function sendRuntimeMessage(message) {
    if (globalThis.browser) {
        // Firefox's Promise API must not receive a callback in the options position.
        return extensionApi.runtime.sendMessage(message).then(checkResponse);
    }
    return new Promise((resolve, reject) => {
        try {
            extensionApi.runtime.sendMessage(message, (result) => {
                const error = extensionApi.runtime.lastError;
                if (error) {
                    reject(new Error(error.message));
                    return;
                }

                try { resolve(checkResponse(result)); } catch (error) { reject(error); }
            });
        } catch (error) {
            reject(error);
        }
    });
}

function checkResponse(response) {
    if (response?.error) throw new Error(response.message || response.error);
    if (!response) throw new Error("The background process did not respond.");
    return response;
}

// Idea reference: KeePassXC-Browser 1.10.4 content/keepassxc-browser.js:siteIgnored
// (GPL-3.0). Independent implementation.
// https://github.com/keepassxreboot/keepassxc-browser
// Report this document directly. The background uses sender.tab to identify the top-level site.
extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type === "GET_PAGE_CONTEXT") {
        const response = { pageUrl: window.location.href };
        if (globalThis.browser) return Promise.resolve(response);
        sendResponse(response);
        return undefined;
    }
    if (["FILL_ACTIVE_EMAIL", "FILL_ACTIVE_FIELD"].includes(request?.type) && focusedEditableField?.isConnected) {
        return fillField(focusedEditableField).catch((error) => {
            console.warn("AliasForge:", error.message);
            return { error: error.message };
        });
    }
    return undefined;
});

const BUTTON_CLASS_NAME = "aliasforge-inline-button";
const FIELD_MARKER = "data-aliasforge-bound";

let cachedSettings = null;
let cachedEmailPromise = null;
let cachedPageUrl = "";
let activeButton = null;
let activeButtonCleanup = null;
let focusedEditableField = null;

function isVisible(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function isEligibleEmailField(element) {
    if (!(element instanceof HTMLInputElement)) {
        return false;
    }

    const inputType = (element.getAttribute("type") || "text").toLowerCase();
    const inputName = `${element.name} ${element.id} ${element.placeholder} ${element.autocomplete}`.toLowerCase();

    return !element.disabled && !element.readOnly
        && (inputType === "email" || (["text", "search"].includes(inputType) && inputName.includes("mail")));
}

function isEditableTextField(element) {
    if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
    if (element instanceof HTMLInputElement) {
        const inputType = (element.getAttribute("type") || "text").toLowerCase();
        return !element.disabled && !element.readOnly
            && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(inputType);
    }
    return element instanceof HTMLElement && element.isContentEditable;
}

async function getSettings() {
    cachedSettings = await sendRuntimeMessage({ type: "GET_SETTINGS" });
    return cachedSettings;
}

async function getOrCreateEmail() {
    if (cachedPageUrl !== window.location.href) {
        cachedPageUrl = window.location.href;
        cachedEmailPromise = null;
    }
    if (!cachedEmailPromise) {
        cachedEmailPromise = sendRuntimeMessage({
            type: "GET_OR_CREATE_EMAIL",
        }).catch((error) => {
            cachedEmailPromise = null;
            throw error;
        });
    }

    return cachedEmailPromise;
}

function dispatchFieldEvents(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function fillField(input) {
    const response = await getOrCreateEmail();
    if (!response?.email) {
        return;
    }

    // Recheck after waiting: the user may have started typing while the alias was generated.
    if (!input.isConnected || !isEditableTextField(input)) return;
    if (input.value === response.email) return;
    if (input instanceof HTMLInputElement) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, response.email);
    } else if (input instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, response.email);
    } else {
        input.textContent = response.email;
    }
    dispatchFieldEvents(input);
}

function rectanglesOverlap(left, right, gap = 0) {
    return left.left < right.right + gap && left.right > right.left - gap
        && left.top < right.bottom + gap && left.bottom > right.top - gap;
}

function existingControlRects(input, button) {
    const selector = "button, [role='button'], [aria-label], [data-autofill], [data-extension], [class*='autofill'], [id*='autofill'], [class*='password'], [id*='password']";
    return Array.from(document.querySelectorAll(selector))
        .filter((element) => element !== input && element !== button && element !== activeButton && isVisible(element))
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width >= 12 && rect.height >= 12 && rect.width <= 80 && rect.height <= 80);
}

function positionButton(button, input) {
    const rect = input.getBoundingClientRect();
    const size = 28;
    const gap = 6;
    const candidates = [
        { placement: "right", left: rect.right + gap, top: rect.top + (rect.height - size) / 2 },
        { placement: "left", left: rect.left - size - gap, top: rect.top + (rect.height - size) / 2 },
        { placement: "bottom", left: rect.left + Math.max(0, (rect.width - size) / 2), top: rect.bottom + gap },
        { placement: "top", left: rect.left + Math.max(0, (rect.width - size) / 2), top: rect.top - size - gap },
    ];
    const occupied = existingControlRects(input, button);
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const selected = candidates.find((candidate) => {
        const candidateRect = { ...candidate, right: candidate.left + size, bottom: candidate.top + size };
        return candidateRect.left >= 0 && candidateRect.top >= 0
            && candidateRect.right <= viewport.right && candidateRect.bottom <= viewport.bottom
            && !occupied.some((other) => rectanglesOverlap(candidateRect, other, 2));
    }) ?? candidates[0];

    button.dataset.placement = selected.placement;
    button.style.top = `${window.scrollY + selected.top}px`;
    button.style.left = `${window.scrollX + selected.left}px`;
}

function removeActiveButton() {
    if (activeButtonCleanup) {
        activeButtonCleanup();
        activeButtonCleanup = null;
    }

    if (activeButton) {
        activeButton.remove();
        activeButton = null;
    }
}

function createInlineButton(input) {
    removeActiveButton();

    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS_NAME;
    const icon = document.createElement("img");
    icon.src = extensionApi.runtime.getURL("images/icon-64.png");
    icon.alt = "";
    icon.width = 28;
    icon.height = 28;
    button.append(icon);
    button.title = "Insert AliasForge email";
    button.setAttribute("aria-label", button.title);

    button.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });

    button.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
            await fillField(input);
        } catch (error) {
            button.title = error.message;
            console.warn("AliasForge:", error.message);
        }
    });

    document.body.append(button);
    positionButton(button, input);
    activeButton = button;

    const reposition = () => {
        if (!document.body.contains(input) || !document.body.contains(button)) {
            removeActiveButton();
            return;
        }
        positionButton(button, input);
    };

    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    activeButtonCleanup = () => {
        window.removeEventListener("scroll", reposition, true);
        window.removeEventListener("resize", reposition);
    };
}

function bindEmailField(input) {
    if (input.getAttribute(FIELD_MARKER) === "true") {
        return;
    }

    input.setAttribute(FIELD_MARKER, "true");

    input.addEventListener("focus", async () => {
        const settings = cachedSettings ?? await getSettings();
        focusedEditableField = input;
        if (!settings.showInlineButton || (settings.hideInlineButtonWhenFilled && input.value.trim()) || !isVisible(input) || document.activeElement !== input) {
            removeActiveButton();
            return;
        }

        // Show the button only on focus so forms remain visually calm.
        createInlineButton(input);
    });

    input.addEventListener("input", () => {
        if (cachedSettings?.hideInlineButtonWhenFilled && input.value.trim()) removeActiveButton();
    });

    input.addEventListener("blur", () => {
        window.setTimeout(() => {
            const focusedElement = document.activeElement;
            if (focusedElement !== activeButton) {
                removeActiveButton();
            }
        }, 100);
    });
}

function injectStyles() {
    if (document.getElementById("aliasforge-style")) {
        return;
    }

    const style = document.createElement("style");
    style.id = "aliasforge-style";
    style.textContent = `
        /* A distinct family name avoids collisions with fonts on the host website. */
        @font-face {
            font-family: "AliasForge Outfit";
            src: url("${extensionApi.runtime.getURL("Outfit-VariableFont_wght.ttf")}") format("truetype");
            font-weight: 100 900;
            font-style: normal;
            font-display: swap;
        }
        .${BUTTON_CLASS_NAME} {
            position: absolute;
            z-index: 2147483647;
            width: 28px;
            height: 28px;
            border: 0;
            border-radius: 999px;
            padding: 0;
            background: transparent;
            color: inherit;
            box-shadow: 0 10px 20px rgba(2, 6, 23, 0.28);
            cursor: pointer;
        }
        .${BUTTON_CLASS_NAME} img { display: block; width: 28px; height: 28px; border-radius: 8px; }
    `;

    document.documentElement.append(style);
}

function discoverFields() {
    const inputs = Array.from(document.querySelectorAll("input")).filter(isEligibleEmailField);
    inputs.forEach(bindEmailField);
}

async function initialize() {
    injectStyles();
    cachedSettings = await getSettings();
    document.addEventListener("focusin", (event) => {
        if (isEditableTextField(event.target)) focusedEditableField = event.target;
    });
    discoverFields();

    const observer = new MutationObserver(scheduleScan);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["type", "name", "id", "autocomplete", "disabled", "readonly"],
    });
}

let scanTimer = null;
function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
        discoverFields();
    }, 100);
}

extensionApi.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || (!changes.aliasForgeState && !changes.spamTrapState && !changes.catchAllMailGenState)) {
        return;
    }

    if (changes.aliasForgeState || changes.spamTrapState || changes.catchAllMailGenState) {
        cachedSettings = (changes.aliasForgeState ?? changes.spamTrapState ?? changes.catchAllMailGenState).newValue?.settings ?? null;
        cachedEmailPromise = null;
        if (!cachedSettings?.showInlineButton || cachedSettings?.hideInlineButtonWhenFilled) removeActiveButton();
        scheduleScan();
    }
});

void initialize().catch((error) => console.warn("AliasForge:", error.message));
