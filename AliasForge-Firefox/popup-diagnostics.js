import { permissionsContains, permissionsSupported, sendRuntimeMessage, storageGet, storageSet, storageRemove } from "./extension-api.js";
import { STORAGE_KEY } from "./shared-state.js";

export async function checkHostPermissions(origin) {
    if (!permissionsSupported()) return { supported: false, granted: null };
    try {
        return { supported: true, granted: await permissionsContains({ origins: [origin ? origin + "/*" : "<all_urls>"] }) };
    } catch {
        return { supported: true, granted: null };
    }
}

function withTimeout(promise) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("No response after 3000 ms")), 3000);
        promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

// Diagnostics are invoked only on demand, never while the normal popup starts.
export async function runDiagnostics({ tab, siteInfo, siteReason, settings }) {
    const lines = [];
    async function check(name, action) {
        try { lines.push(`OK  ${name}\n    ${await withTimeout(action())}`); }
        catch (error) { lines.push(`XX  ${name}\n    ${error.message}`); }
    }
    await check("Local storage", async () => {
        const state = (await storageGet(STORAGE_KEY))?.[STORAGE_KEY];
        return `${state?.history?.length ?? 0} addresses stored`;
    });
    await check("Write test", async () => {
        const key = `debugProbe-${crypto.randomUUID()}`;
        try {
            await storageSet({ [key]: "probe" });
            if ((await storageGet(key))?.[key] !== "probe") throw new Error("Write test failed");
            return "Write and read succeeded";
        } finally { await storageRemove(key); }
    });
    await check("Background script", async () => {
        const result = await sendRuntimeMessage({ type: "GET_SETTINGS" });
        return `Mail domain: ${result.mailDomain || "not set"}`;
    });
    await check("Address creation and persistence", async () => {
        if (!siteInfo || !Number.isInteger(tab?.id)) throw new Error("No supported website detected.");
        // Use the real background path and verify persistence, not just connectivity.
        // Existing aliases are reused; this never forces a replacement address.
        const result = await sendRuntimeMessage({ type: "GET_OR_CREATE_EMAIL", tabId: tab.id });
        const state = await sendRuntimeMessage({ type: "GET_STATE" });
        const saved = state.history.find((entry) =>
            entry.siteKey === result.siteInfo?.siteKey && entry.email === result.email);
        if (!result.email || !saved) throw new Error("The background did not return a persisted address.");
        return `${result.source === "history" ? "Reused" : "Created"} and saved: ${result.email}`;
    });
    // Host access controls inline insertion, not generation or copying in the popup.
    // A per-site grant is sufficient; requiring access to all websites was misleading.
    const access = await checkHostPermissions(siteInfo?.origin);
    lines.push(`${access.granted ? "OK" : "INFO"}  Website access (inline insertion only)\n    ${access.granted
        ? "Granted for this website."
        : access.granted === false
            ? "Not granted for this website. Address generation and copying do not require this permission. Allow website access in your browser's extension settings to use the inline button."
            : "Could not be checked. This does not block address generation or copying."}`);
    lines.push(`Active tab\n${tab?.url || tab?.pendingUrl || "No website URL"}`);
    lines.push(`Website detection: ${siteReason}\n${JSON.stringify(siteInfo, null, 2)}`);
    lines.push(`Settings\n${JSON.stringify(settings, null, 2)}`);
    return lines.join("\n\n");
}
