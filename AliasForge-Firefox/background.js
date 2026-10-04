import { getExtensionApi } from "./extension-api.js";
import { getActiveSite, resolveTabSite, siteForMessage } from "./site-context.js";
import { createStateService } from "./state-service.js";

const extensionApi = getExtensionApi();
const updateState = createStateService();
const stateActions = new Set([
    "GET_STATE", "GET_SETTINGS", "SAVE_SETTINGS", "UPSERT_HISTORY", "DELETE_HISTORY", "CLEAR_HISTORY", "IMPORT_HISTORY", "SET_ACTIVE_EMAIL",
]);
const emailActions = new Set(["GET_OR_CREATE_EMAIL"]);

async function ensureAutomaticAddress(tabId) {
    const context = Number.isInteger(tabId)
        ? await resolveTabSite({ id: tabId })
        : await getActiveSite();
    if (!context.siteInfo) return;
    const settings = await updateState({ type: "GET_SETTINGS" });
    if (!/^[^\s/@]+(?:\.[^\s/@]+)+$/.test(settings.mailDomain.trim())) return;
    // Use the same serialized service as manual insertion: repeated navigation
    // events and simultaneous popup requests must reuse one persisted address.
    await updateState({ type: "GET_OR_CREATE_EMAIL" }, context.siteInfo);
}

function scheduleAutomaticAddress(tabId) {
    return ensureAutomaticAddress(tabId).catch((error) => {
        console.error("AliasForge automatic address creation failed", error);
    });
}

function registerAutomaticAddresses() {
    extensionApi.tabs.onActivated?.addListener(({ tabId }) => scheduleAutomaticAddress(tabId));
    extensionApi.tabs.onUpdated?.addListener((tabId, change) => {
        if (change.url || change.status === "complete") return scheduleAutomaticAddress(tabId);
    });
    // Also cover the current website when the extension is loaded or restarted.
    void scheduleAutomaticAddress();
}

function registerContextMenu() {
    const contextMenus = extensionApi.contextMenus;
    if (!contextMenus?.create || !contextMenus?.onClicked?.addListener) return;
    // The editable context limits the menu to form controls; content.js fills
    // the last focused text field with the alias for the current website.
    const create = () => contextMenus.create({
        id: "aliasforge-fill-email",
        title: "Insert AliasForge email",
        contexts: ["editable"],
    });
    if (contextMenus.removeAll) {
        Promise.resolve(contextMenus.removeAll()).catch(() => {}).finally(create);
    } else {
        create();
    }
    contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId !== "aliasforge-fill-email" || !tab?.id) return;
        try {
            const result = extensionApi.tabs.sendMessage(tab.id, { type: "FILL_ACTIVE_FIELD" });
            result?.catch?.(() => {});
        } catch {
            // Protected browser pages cannot receive content-script messages.
        }
    });
}

function handleMessage(request, sender) {
    if (request?.type === "SAVE_SETTINGS") {
        return updateState(request).then(async () => {
            // Keep this work in the background even if the settings popup closes.
            await scheduleAutomaticAddress();
            return updateState({ type: "GET_STATE" });
        });
    }
    if (stateActions.has(request?.type)) return updateState(request);
    if (emailActions.has(request?.type)) {
        return siteForMessage(request, sender).then((siteInfo) => updateState(request, siteInfo));
    }
    return undefined;
}

extensionApi.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const responsePromise = handleMessage(request, sender);

    if (!responsePromise) {
        return undefined;
    }

    const guardedPromise = responsePromise.catch((error) => ({ error: "request-failed", message: error.message }));

    // Firefox (browser.*) liefert die Antwort, indem der Listener ein Promise zurueckgibt.
    if (globalThis.browser) {
        return guardedPromise;
    }

    // Callback-only hosts keep the channel open until the background has saved locally.
    guardedPromise.then(sendResponse);
    return true;
});

registerContextMenu();
registerAutomaticAddresses();
