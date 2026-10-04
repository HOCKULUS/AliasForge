import { sendRuntimeMessage } from "./extension-api.js";
import { exportHistoryAsCsv } from "./shared-state.js";

const find = (id) => document.getElementById(id);
let downloadUrl;

async function initialize() {
    try {
        const state = await sendRuntimeMessage({ type: "GET_STATE" });
        if (!state.history.length) {
            find("export-status").textContent = "No saved addresses to export.";
            return;
        }
        const csv = exportHistoryAsCsv(state.history);
        downloadUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = find("download-csv");
        link.href = downloadUrl;
        link.download = "AliasForge-KeePassXC.csv";
        link.hidden = false;
        find("csv-content").value = csv;
        find("export-fallback").hidden = false;
        find("export-status").textContent = `${state.history.length} saved addresses ready. Click Download CSV to save the file.`;
    } catch (error) {
        find("export-status").textContent = `Export failed: ${error.message}`;
    }
}

find("copy-csv").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(find("csv-content").value);
        find("copy-status").textContent = "CSV copied.";
    } catch {
        find("csv-content").focus();
        find("csv-content").select();
        find("copy-status").textContent = "CSV selected. Press Command+C or use Copy in the context menu.";
    }
});

// Keep the file URL alive for the lifetime of this page, not the popup.
window.addEventListener("pagehide", (event) => {
    if (!event.persisted && downloadUrl) URL.revokeObjectURL(downloadUrl);
});

void initialize();
