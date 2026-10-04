import { buildEmailAddress } from "./email-generator.js";
import {
    DEFAULT_SETTINGS, getState, saveState, createHistoryEntry, addOrUpdateHistoryEntry, getActiveEntry,
} from "./shared-state.js";

// Architecture reference: KeePassXC-Browser 1.10.4 background/event.js:onSaveSettings
// (upstream GPL-3.0): send edits to the background, then persist in storage.local.
// https://github.com/keepassxreboot/keepassxc-browser/blob/develop/keepassxc-browser/background/event.js
// Independently written; the serialized read/modify/write queue is specific to this add-on.
export function createStateService() {
    let pending = Promise.resolve();

    async function execute(request, siteInfo) {
        const state = await getState();
        switch (request.type) {
            case "GET_STATE": return state;
            case "GET_SETTINGS": return state.settings;
            case "SAVE_SETTINGS": {
                const patch = request.settings ?? {};
                for (const key of Object.keys(DEFAULT_SETTINGS)) {
                    if (Object.hasOwn(patch, key)) state.settings[key] = patch[key];
                }
                return saveState(state, { settingsChanged: true });
            }
            case "UPSERT_HISTORY":
                state.history = addOrUpdateHistoryEntry(state.history, request.entry);
                break;
            case "DELETE_HISTORY":
                state.history = state.history.filter((entry) => entry.id !== request.id);
                break;
            case "SET_ACTIVE_EMAIL": {
                const selected = state.history.find((entry) => entry.id === request.id);
                if (!selected) throw new Error("This address no longer exists.");
                state.history = state.history.map((entry) => entry.siteKey === selected.siteKey
                    ? { ...entry, active: entry.id === selected.id } : entry);
                break;
            }
            case "CLEAR_HISTORY":
                state.history = [];
                break;
            case "IMPORT_HISTORY":
                for (const entry of request.entries ?? []) {
                    state.history = addOrUpdateHistoryEntry(state.history, entry);
                }
                break;
            case "GET_OR_CREATE_EMAIL": {
                if (!siteInfo) throw new Error("No supported website was found in the selected tab.");
                const entry = getActiveEntry(state.history, siteInfo.siteKey);
                if (entry) {
                    return { email: entry.email, siteInfo, source: "history" };
                }
                if (!state.settings.mailDomain.trim()) throw new Error("Please enter a mail domain first.");
                const email = buildEmailAddress(state.settings, siteInfo);
                state.history = addOrUpdateHistoryEntry(state.history, createHistoryEntry(siteInfo, email));
                await saveState(state);
                return { email, siteInfo, source: "generated" };
            }
            default: throw new Error(`Unknown action: ${request.type}`);
        }
        return saveState(state);
    }

    return (request, siteInfo = null) => {
        // Two tabs must not generate different aliases or overwrite one another's edits.
        const result = pending.then(() => execute(request, siteInfo));
        pending = result.catch(() => {});
        return result;
    };
}
