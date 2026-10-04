import { getSiteInfo, parseNameList, DEFAULT_NAMES_JSON } from "./email-generator.js";
import { createSettingsForm } from "./settings-form.js";
import { getActiveSite } from "./site-context.js";
import { createPopupNavigation } from "./popup-navigation.js";
import { createHistoryView } from "./popup-history.js";
import { runDiagnostics } from "./popup-diagnostics.js";
import { createTab, getExtensionApi, sendNativeMessage, sendRuntimeMessage } from "./extension-api.js";
import { createHistoryEntry, DEFAULT_SETTINGS, exportHistoryAsCsv, getState, getActiveEntry, importHistoryFromCsv, STORAGE_KEY } from "./shared-state.js";

const find = (id) => document.querySelector(`#${id}`);
const extensionApi = getExtensionApi();
const historyView = createHistoryView();
let appState = { history: [], settings: { ...DEFAULT_SETTINGS } };
let currentTab = null;
let currentSiteInfo = null;
let siteReason = "no-tab";
let settingsForm;
let settingsReady = false;
let pendingSettingsWrites = 0;
let settingsRevision = 0;
let diagnosing = false;
let statusTimer;
let statusDebugOnly = false;
let saveFailed = false;

const navigation = createPopupNavigation({
    onDebugOpen: () => { if (!find("debug-output").dataset.loaded) void diagnose(); },
    onDebugDisable: () => {
        if (statusDebugOnly) clearStatus();
        find("debug-output").textContent = "No diagnostics run yet.";
        delete find("debug-output").dataset.loaded;
    },
});

function clearStatus() {
    clearTimeout(statusTimer);
    find("status-message").hidden = true;
    find("status-message").textContent = "";
}

function setStatus(message, isError = false, debugOnly = false) {
    if (debugOnly && !navigation.debugEnabled) return;
    clearTimeout(statusTimer);
    statusDebugOnly = debugOnly;
    const status = find("status-message");
    status.textContent = message;
    status.hidden = !message;
    status.style.color = isError ? "var(--danger)" : "var(--brand-strong)";
    if (isError) navigation.showSettings();
    else statusTimer = setTimeout(clearStatus, 2800);
}

function hasMailDomain() {
    return /^[^\s/@]+(?:\.[^\s/@]+)+$/.test(appState.settings.mailDomain.trim());
}

function updateView() {
    historyView.render(appState.history, currentSiteInfo);
    const entry = getActiveEntry(appState.history, currentSiteInfo?.siteKey);
    // Never display an unsaved random preview as if it were an existing address.
    find("current-email").value = entry?.email ?? "";
    find("current-email").title = entry?.email ?? "";
    find("copy-current-email").disabled = !entry;
    find("address-hint").textContent = entry ? "Stored for this website." : !hasMailDomain() ? "Enter a mail domain first." : "Your address for this website.";
    find("show-inline-button").disabled = !settingsReady;
    const invalidDomain = !hasMailDomain();
    find("mail-domain").setAttribute("aria-invalid", String(invalidDomain));
    find("domain-hint").textContent = invalidDomain && appState.settings.mailDomain.trim()
        ? "Enter a domain only, e.g. example.com (without @ or https://)."
        : "Everything after @. Catch-All must be configured with your email provider.";
}

async function refreshWebsite() {
    const context = await getActiveSite();
    currentTab = context.tab;
    currentSiteInfo = context.siteInfo;
    siteReason = context.reason;
    find("current-site-label").textContent = currentSiteInfo?.siteKey
        ?? (currentTab?.url || currentTab?.pendingUrl ? "This browser page does not support website addresses" : "No website detected");
    updateView();
    await ensureWebsiteAddress();
}

async function ensureWebsiteAddress() {
    if (!settingsReady || !currentSiteInfo || !hasMailDomain()) return;
    if (appState.history.some((entry) => entry.siteKey === currentSiteInfo.siteKey)) return;
    // The background serializes creation and reuses existing aliases across popups/tabs.
    try {
        await sendRuntimeMessage({ type: "GET_OR_CREATE_EMAIL", tabId: currentTab.id });
        const saved = await sendRuntimeMessage({ type: "GET_STATE" });
        appState.history = saved.history;
        updateView();
    } catch (error) {
        setStatus(`Address creation failed: ${error.message}`, true);
    }
}

function updateNamesStatus() {
    const parsed = parseNameList(find("names-json").value);
    find("names-status").textContent = parsed
        ? `${parsed.firstNames.length} first names and ${parsed.lastNames.length} last names.`
        : "Invalid or empty list. The default list will be used.";
    find("names-status").style.color = parsed ? "var(--muted)" : "var(--danger)";
}

async function persistSettings(patch = settingsForm.read()) {
    if (!settingsReady) return false;
    appState.settings = settingsForm.read();
    const revision = ++settingsRevision;
    pendingSettingsWrites += 1;
    try {
        const saved = await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: patch });
        if (revision === settingsRevision) {
            appState.settings = saved.settings;
            appState.history = saved.history;
            if (saveFailed) clearStatus();
            saveFailed = false;
            setStatus("Settings saved.", false, true);
            updateView();
            await ensureWebsiteAddress();
        }
        return true;
    } catch (error) {
        console.error("AliasForge save failed", error);
        saveFailed = true;
        setStatus(`Save failed: ${error.message}`, true);
        return false;
    } finally {
        pendingSettingsWrites -= 1;
    }
}

// Storage notifications may arrive before write acknowledgements. Preserve newer typing.
extensionApi.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !settingsReady || !changes[STORAGE_KEY]?.newValue) return;
    const revision = settingsRevision;
    void (async () => {
        const fresh = await getState();
        appState.history = fresh.history;
        if (pendingSettingsWrites === 0 && revision === settingsRevision) {
            appState.settings = fresh.settings;
            settingsForm.fill(fresh.settings);
            updateNamesStatus();
            if (!hasMailDomain()) navigation.showSettings("mail");
        }
        updateView();
    })().catch((error) => setStatus(`Loading failed: ${error.message}`, true));
});

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus("Email copied.");
    } catch {
        // Safari can deny WebKit clipboard access; retain its existing native fallback.
        try {
            if (!extensionApi.runtime.getURL("").startsWith("safari-web-extension:")) throw new Error("No native host");
            const result = await sendNativeMessage({ text, type: "WRITE_CLIPBOARD" });
            if (result?.success) { setStatus("Email copied."); return; }
        } catch { /* The visible error below also covers an unavailable native host. */ }
        setStatus("Copying failed. You can select the address above manually.", true);
    }
}

async function downloadCsv() {
    const extensionUrl = extensionApi.runtime.getURL("");
    if (/^(safari-web-extension|webkit-extension):/.test(extensionUrl)) {
        // Safari needs a persistent page and a direct user click for this download.
        await createTab({ url: extensionApi.runtime.getURL("export.html") });
        return;
    }
    const url = URL.createObjectURL(new Blob([exportHistoryAsCsv(appState.history)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "AliasForge-KeePassXC.csv";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function handleManualEntry() {
    const value = find("manual-website").value.trim();
    const siteInfo = getSiteInfo(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const email = find("manual-email").value.trim();
    if (!siteInfo || !email) throw new Error("Please enter a valid website and email address.");
    const entry = createHistoryEntry(siteInfo, email, { notes: find("manual-notes").value.trim() });
    appState.history = (await sendRuntimeMessage({ type: "UPSERT_HISTORY", entry })).history;
    find("manual-entry-form").reset();
    find("manual-entry-form").hidden = true;
    updateView();
    setStatus("Entry added.");
}

async function handleHistoryAction(event) {
    const button = event.target.closest("[data-copy-entry], [data-delete-entry], [data-activate-entry]");
    if (!button) return;
    const id = button.dataset.copyEntry ?? button.dataset.deleteEntry ?? button.dataset.activateEntry;
    const entry = appState.history.find((item) => item.id === id);
    if (!entry) return;
    if (button.dataset.copyEntry) return copyText(entry.email);
    if (button.dataset.activateEntry) {
        appState.history = (await sendRuntimeMessage({ type: "SET_ACTIVE_EMAIL", id })).history;
        updateView();
        setStatus("Active address updated.");
        return;
    }
    appState.history = (await sendRuntimeMessage({ type: "DELETE_HISTORY", id })).history;
    updateView();
    setStatus("Address deleted from history.");
}

async function handleCsvImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
        const entries = importHistoryFromCsv(await file.text());
        appState.history = (await sendRuntimeMessage({ type: "IMPORT_HISTORY", entries })).history;
        updateView();
        setStatus(`${entries.length} entries imported. Duplicate addresses were merged.`);
    } finally { find("import-history").value = ""; }
}

async function diagnose() {
    if (diagnosing || !navigation.debugEnabled) return;
    diagnosing = true;
    find("debug-run").disabled = true;
    find("debug-output").textContent = "Diagnostics running …";
    try {
        const result = await runDiagnostics({ tab: currentTab, siteInfo: currentSiteInfo, siteReason, settings: appState.settings });
        if (navigation.debugEnabled) {
            find("debug-output").textContent = result;
            find("debug-output").dataset.loaded = "true";
        }
    } finally {
        diagnosing = false;
        find("debug-run").disabled = false;
    }
}

function bindAction(id, eventName, action) {
    find(id).addEventListener(eventName, (event) => {
        Promise.resolve().then(() => action(event)).catch((error) => setStatus(error.message, true));
    });
}

function bindEvents() {
    bindAction("copy-current-email", "click", async () => {
        await refreshWebsite();
        const entry = getActiveEntry(appState.history, currentSiteInfo?.siteKey);
        if (entry) await copyText(entry.email);
    });
    bindAction("reset-names", "click", async () => {
        find("names-json").value = DEFAULT_NAMES_JSON;
        updateNamesStatus();
        await persistSettings({ namesJson: DEFAULT_NAMES_JSON });
    });
    bindAction("export-history", "click", downloadCsv);
    bindAction("import-history", "change", handleCsvImport);
    for (const id of ["history-list", "site-history-list"]) bindAction(id, "click", handleHistoryAction);
    find("history-search").addEventListener("input", () => historyView.render(appState.history, currentSiteInfo));
    find("history-more").addEventListener("click", () => {
        const actions = find("history-actions");
        actions.hidden = !actions.hidden;
        find("history-more").setAttribute("aria-expanded", String(!actions.hidden));
        if (actions.hidden) find("manual-entry-form").hidden = true;
    });
    find("show-manual-entry").addEventListener("click", () => {
        find("manual-entry-form").hidden = false;
        find("clear-confirmation").close();
        find("manual-website").focus();
    });
    find("cancel-manual-entry").addEventListener("click", () => { find("manual-entry-form").hidden = true; });
    find("manual-entry-form").addEventListener("submit", (event) => {
        event.preventDefault();
        void handleManualEntry().catch((error) => setStatus(error.message, true));
    });
    find("clear-history").addEventListener("click", () => {
        find("clear-confirmation").showModal();
        find("manual-entry-form").hidden = true;
        find("cancel-clear-history").focus();
    });
    find("cancel-clear-history").addEventListener("click", () => {
        find("clear-confirmation").close();
        find("clear-history").focus();
    });
    bindAction("confirm-clear-history", "click", async () => {
        // Dismiss first so any storage failure remains visible in the popup.
        find("clear-confirmation").close();
        appState.history = (await sendRuntimeMessage({ type: "CLEAR_HISTORY" })).history;
        updateView();
        setStatus("History deleted. Your settings were kept.");
    });
    bindAction("debug-run", "click", diagnose);
    settingsForm.bind((patch) => {
        if (!settingsReady) return;
        appState.settings = settingsForm.read();
        updateView();
        if (Object.hasOwn(patch, "namesJson")) updateNamesStatus();
        // Submit each patch now; closing the popup must not cancel a debounce timer.
        void persistSettings(patch);
    });
}

async function initialize() {
    try {
        settingsForm = createSettingsForm();
        settingsForm.setDisabled(true);
        bindEvents();
        appState = await sendRuntimeMessage({ type: "GET_STATE" });
        settingsForm.fill(appState.settings);
        updateNamesStatus();
        settingsReady = true;
        settingsForm.setDisabled(false);
        if (!hasMailDomain()) navigation.showSettings("mail");
        updateView();
    } catch (error) {
        console.error("AliasForge initialization failed", error);
        setStatus(`Settings could not be loaded: ${error.message}`, true);
    }
    await refreshWebsite().catch((error) => setStatus(`Website detection failed: ${error.message}`, true));
}

void initialize();
