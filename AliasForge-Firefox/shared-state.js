import {
    storageGet,
    storageSet,
    storageSyncAvailable,
    storageSyncGet,
    storageSyncSet,
} from "./extension-api.js";
import { DEFAULT_NAMES_JSON, getSiteInfo } from "./email-generator.js";

export const STORAGE_KEY = "aliasForgeState";
const LEGACY_STORAGE_KEYS = ["spamTrapState", "catchAllMailGenState"];

export const DEFAULT_SETTINGS = Object.freeze({
    autofillEnabled: false,
    forceLowercase: true,
    hideInlineButtonWhenFilled: false,
    includeDatePart: true,
    includeNamePart: false,
    includeSecureString: true,
    includeUrlPart: true,
    includeUrlSuffix: false,
    mailDomain: "",
    namesJson: DEFAULT_NAMES_JSON,
    onlyFillEmptyFields: true,
    orderDate: 40,
    orderName: 20,
    orderPrefix: 10,
    orderRandom: 50,
    orderUrl: 30,
    prefix: "",
    randomStringCharset: "abcdefghijklmnopqrstuvwxyz0123456789",
    randomStringLength: 4,
    separator: "-",
    showInlineButton: true,
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

const ORDER_MIN = 0;
const ORDER_MAX = 999;
const RANDOM_LENGTH_MIN = 1;
const RANDOM_LENGTH_MAX = 64;

function normalizeOrder(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(ORDER_MAX, Math.max(ORDER_MIN, parsed));
}

function normalizeSettings(settings = {}) {
    settings = settings && typeof settings === "object" ? settings : {};
    return {
        ...DEFAULT_SETTINGS,
        ...settings,
        // Automatic filling is intentionally disabled until the feature is reintroduced.
        autofillEnabled: false,
        // Lowercase is now part of the generator behavior, not a user setting.
        forceLowercase: true,
        updatedAt: typeof settings.updatedAt === "string" ? settings.updatedAt : "",
        mailDomain: String(settings.mailDomain ?? DEFAULT_SETTINGS.mailDomain).trim(),
        namesJson: String(settings.namesJson ?? DEFAULT_SETTINGS.namesJson),
        orderDate: normalizeOrder(settings.orderDate, DEFAULT_SETTINGS.orderDate),
        orderName: normalizeOrder(settings.orderName, DEFAULT_SETTINGS.orderName),
        orderPrefix: normalizeOrder(settings.orderPrefix, DEFAULT_SETTINGS.orderPrefix),
        orderRandom: normalizeOrder(settings.orderRandom, DEFAULT_SETTINGS.orderRandom),
        orderUrl: normalizeOrder(settings.orderUrl, DEFAULT_SETTINGS.orderUrl),
        prefix: String(settings.prefix ?? DEFAULT_SETTINGS.prefix),
        randomStringCharset: String(settings.randomStringCharset ?? DEFAULT_SETTINGS.randomStringCharset),
        randomStringLength: Math.min(
            RANDOM_LENGTH_MAX,
            Math.max(RANDOM_LENGTH_MIN, Number.parseInt(settings.randomStringLength, 10) || DEFAULT_SETTINGS.randomStringLength),
        ),
        separator: String(settings.separator ?? DEFAULT_SETTINGS.separator ?? "-").slice(0, 1),
    };
}

function normalizeHistoryEntry(entry, index) {
    const email = String(entry?.email ?? "").trim();
    const website = getSiteInfo(entry?.pageUrl)
        ?? getSiteInfo(`https://${entry?.hostname || entry?.siteKey || ""}`);
    const siteKey = website?.siteKey ?? String(entry?.siteKey ?? "").trim().toLowerCase();

    if (!email || !siteKey) {
        return null;
    }

    return {
        createdAt: String(entry?.createdAt || new Date().toISOString()),
        active: entry?.active === true,
        email,
        hostname: String(entry?.hostname ?? siteKey).trim().toLowerCase(),
        id: String(entry?.id ?? `history-${index}-${siteKey}`),
        notes: String(entry?.notes ?? "").trim(),
        pageUrl: String(entry?.pageUrl ?? "").trim(),
        siteKey,
        updatedAt: String(entry?.updatedAt || new Date().toISOString()),
    };
}

function normalizeHistory(history = []) {
    const sorted = (Array.isArray(history) ? history : [])
        .map(normalizeHistoryEntry)
        .filter(Boolean)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    // Keep every distinct alias, not just one per site. Repair IDs from older CSV imports.
    const seen = new Set();
    const ids = new Set();
    const unique = sorted.filter((entry) => {
        const key = JSON.stringify([entry.siteKey, entry.email]);
        if (seen.has(key)) return false;
        seen.add(key);
        while (ids.has(entry.id)) entry.id += "-duplicate";
        ids.add(entry.id);
        return true;
    });
    // Keep one selected alias per site. Legacy data and deleted selections fall
    // back to the newest remaining entry without changing its timestamps.
    const selected = new Map();
    for (const entry of unique) {
        if (!selected.has(entry.siteKey) || (entry.active && !selected.get(entry.siteKey).active)) {
            selected.set(entry.siteKey, entry);
        }
    }
    return unique.map((entry) => ({ ...entry, active: selected.get(entry.siteKey) === entry }));
}

export function getActiveEntry(history, siteKey) {
    return history.find((entry) => entry.siteKey === siteKey && entry.active)
        ?? history.find((entry) => entry.siteKey === siteKey);
}

const SYNC_TIMEOUT_MS = 1500;

// storage.sync can hang in some environments (for example Firefox without a
// Sync account or unavailable iCloud). Every sync access has a timeout so the
// popup and background never block; the local state wins after the timeout.
function withTimeout(promise, ms = SYNC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("storage.sync timeout")), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

export async function getState() {
    const storedValue = await storageGet(STORAGE_KEY);
    let state = storedValue?.[STORAGE_KEY] ?? {};

    // Migrate the previous product key lazily without discarding existing data.
    if (!state.settings && !state.history) {
        for (const legacyKey of LEGACY_STORAGE_KEYS) {
            const legacyValue = await storageGet(legacyKey);
            const legacyState = legacyValue?.[legacyKey];
            if (!legacyState) continue;
            state = legacyState;
            break;
        }
    }

    // Local storage is authoritative. Sync only recovers settings on a new install;
    // a remote timestamp must never replace an edit just saved on this device.
    if (!state.settings && storageSyncAvailable()) {
        try {
            const syncedValue = await withTimeout(storageSyncGet(STORAGE_KEY));
            const syncedSettings = syncedValue[STORAGE_KEY]?.settings;

            if (syncedSettings) state.settings = syncedSettings;
        } catch {
            // iCloud or Firefox Sync can fail or hang; keep the local state in that case.
        }
    }

    return {
        history: normalizeHistory(state.history),
        settings: normalizeSettings(state.settings),
    };
}

let syncTimer = null;
let syncWrite = Promise.resolve();

function scheduleSyncBackup(settings) {
    if (!storageSyncAvailable()) return;
    clearTimeout(syncTimer);
    // Only the background writes state. Debounce its optional backup, never the local save.
    syncTimer = setTimeout(() => {
        syncWrite = syncWrite.catch(() => {}).then(() => withTimeout(storageSyncSet({
            [STORAGE_KEY]: { settings },
        }))).catch(() => {});
    }, 1000);
}

// Called exclusively by the background state service; popup edits send small patches.
export async function saveState(state, { settingsChanged = false } = {}) {
    const normalizedState = {
        history: normalizeHistory(state.history),
        settings: normalizeSettings(state.settings),
    };
    if (settingsChanged) normalizedState.settings.updatedAt = new Date().toISOString();

    await storageSet({
        [STORAGE_KEY]: normalizedState,
    });

    if (settingsChanged) scheduleSyncBackup(normalizedState.settings);

    return clone(normalizedState);
}

export function createHistoryEntry(siteInfo, email, extras = {}) {
    const timestamp = new Date().toISOString();

    return {
        createdAt: extras.createdAt ?? timestamp,
        email,
        hostname: extras.hostname ?? siteInfo.hostname,
        id: extras.id ?? crypto.randomUUID(),
        notes: extras.notes ?? "",
        pageUrl: extras.pageUrl ?? siteInfo.pageUrl,
        siteKey: extras.siteKey ?? siteInfo.siteKey,
        updatedAt: timestamp,
    };
}

export function addOrUpdateHistoryEntry(history, entry) {
    const normalized = normalizeHistoryEntry(entry, 0);
    if (!normalized) return normalizeHistory(history);
    // Reimporting an address is idempotent; a new alias never replaces an older one.
    const previous = history.find((item) => item.siteKey === normalized.siteKey && item.email === normalized.email);
    if (previous) {
        normalized.active = previous.active;
        normalized.id = previous.id;
        normalized.createdAt = previous.createdAt;
    }
    return normalizeHistory([normalized, ...history]);
}

function escapeCsvValue(value) {
    const text = String(value ?? "");
    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, "\"\"")}"`;
    }
    return text;
}

function keepassCsvValue(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportHistoryAsCsv(history) {
    // KeePassXC's standard CSV export/import columns are Group, Title, Username,
    // Password, URL and Notes. The generated email is the KeePass username.
    // Format reference: KeePassXC User Guide, CSV Importing Databases (GPL project;
    // no KeePassXC source code is copied here).
    const lines = [
        ["Group", "Title", "Username", "Password", "URL", "Notes"].map(keepassCsvValue).join(","),
        ...history.map((entry) => [
            keepassCsvValue("AliasForge"),
            keepassCsvValue(entry.siteKey),
            keepassCsvValue(entry.email),
            keepassCsvValue(""),
            keepassCsvValue(entry.pageUrl),
            keepassCsvValue([
                entry.notes,
                `AliasForge: created ${entry.createdAt}`,
                `Entry ID: ${entry.id}`,
            ].filter(Boolean).join("\n")),
        ].join(",")),
    ];

    return lines.join("\n");
}

function parseCsv(csvText) {
    const row = String(csvText ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const rows = [];
    let values = [];
    let currentValue = "";
    let insideQuotes = false;

    for (let index = 0; index < row.length; index += 1) {
        const character = row[index];
        const nextCharacter = row[index + 1];

        if (character === "\"" && insideQuotes && nextCharacter === "\"") {
            currentValue += "\"";
            index += 1;
            continue;
        }

        if (character === "\"") {
            insideQuotes = !insideQuotes;
            continue;
        }

        if (character === "," && !insideQuotes) {
            values.push(currentValue);
            currentValue = "";
            continue;
        }

        // A quoted note can span lines; only unquoted newlines finish a record.
        if ((character === "\n" || character === "\r") && !insideQuotes) {
            values.push(currentValue);
            if (values.some((value) => value.trim())) rows.push(values);
            values = [];
            currentValue = "";
            continue;
        }

        currentValue += character;
    }

    if (insideQuotes) throw new Error("CSV is incomplete: an opening quote is missing its closing quote.");
    values.push(currentValue);
    if (values.some((value) => value.trim())) rows.push(values);
    return rows;
}

export function importHistoryFromCsv(csvText) {
    const rows = parseCsv(csvText);

    if (rows.length <= 1) {
        return [];
    }

    const header = rows[0];
    const hasKeePassColumns = header.includes("Title") && header.includes("Username") && header.includes("URL");
    const hasOwnColumns = header.includes("email") && ["siteKey", "hostname", "pageUrl"].some((key) => header.includes(key));
    if (!hasKeePassColumns && !hasOwnColumns) throw new Error("CSV requires KeePassXC columns or the AliasForge format.");
    const getColumnIndex = (name) => header.indexOf(name);

    return normalizeHistory(rows.slice(1).map((values, index) => {
        const notes = values[getColumnIndex(hasKeePassColumns ? "Notes" : "notes")];
        const ownId = values[getColumnIndex("id")];
        const importedEmail = values[getColumnIndex(hasKeePassColumns ? "Username" : "email")];
        const importedUrl = values[getColumnIndex(hasKeePassColumns ? "URL" : "pageUrl")];
        const importedTitle = values[getColumnIndex(hasKeePassColumns ? "Title" : "siteKey")];
        const createdAt = values[getColumnIndex("createdAt")];
        const importedId = ownId || notes?.match(/(?:Entry ID|Adresse-ID):\s*([^\n]+)/)?.[1];
        return normalizeHistoryEntry({
            createdAt: createdAt || notes?.match(/(?:created|erstellt)\s+([^\n]+)/)?.[1],
            email: importedEmail,
            hostname: values[getColumnIndex("hostname")],
            id: importedId || crypto.randomUUID(),
            notes: hasKeePassColumns ? String(notes ?? "").replace(/(?:^|\n)(?:AliasForge|SpamTrap|CatchAllMailGen): (?:created|erstellt) .*|(?:^|\n)(?:Entry ID|Adresse-ID): .*$/g, "").trim() : notes,
            pageUrl: importedUrl,
            siteKey: hasKeePassColumns ? importedTitle : values[getColumnIndex("siteKey")],
            updatedAt: values[getColumnIndex("updatedAt")],
        }, index);
    }));
}
