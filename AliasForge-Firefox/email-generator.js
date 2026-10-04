export { getSiteInfo } from "./site-info.js";

export const DEFAULT_RANDOM_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const DEFAULT_NAME_POOL = Object.freeze({
    firstNames: Object.freeze([
        "Max", "Anna", "Lukas", "Emma", "Felix", "Marie", "Jonas", "Lena",
        "Paul", "Sofia", "Leon", "Clara", "Tim", "Laura", "Nico", "Sarah",
        "Oliver", "Sophia", "Ethan", "Olivia", "Noah", "Ava", "Liam", "Mia",
        "Henry", "Ella", "James", "Grace", "William", "Lily", "Benjamin", "Emily",
        "Daniel", "Charlotte", "Alexander", "Amelia",
    ]),
    lastNames: Object.freeze([
        "Mustermann", "Musterfrau", "Schmidt", "Mueller", "Schneider",
        "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann",
        "Schulz", "Koch", "Bauer", "Richter", "Klein",
        "Anderson", "Bennett", "Carter", "Collins", "Cooper", "Davis", "Edwards", "Evans",
        "Foster", "Gray", "Harris", "Hughes", "Jackson", "Johnson", "Lewis", "Morgan",
        "Parker", "Roberts", "Taylor", "Wilson",
    ]),
});

export const DEFAULT_NAMES_JSON = JSON.stringify({
    firstNames: [...DEFAULT_NAME_POOL.firstNames],
    lastNames: [...DEFAULT_NAME_POOL.lastNames],
}, null, 2);

function stripDiacritics(value) {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function sanitizeSegment(value, maxLength = 40) {
    return stripDiacritics(String(value ?? ""))
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, maxLength);
}

function sanitizeDomainSegment(value, maxLength = 40) {
    return stripDiacritics(String(value ?? ""))
        .replace(/[^a-zA-Z0-9.-]+/g, "-")
        .replace(/\.{2,}/g, ".")
        .replace(/^[.-]+|[.-]+$/g, "")
        .slice(0, maxLength);
}

function clampInt(value, minimum, maximum, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(maximum, Math.max(minimum, parsed));
}

export function createRandomString(settings = {}) {
    const length = clampInt(settings.randomStringLength, 1, 64, 4);
    const charset = String(settings.randomStringCharset ?? "").trim() || DEFAULT_RANDOM_CHARSET;
    const values = crypto.getRandomValues(new Uint32Array(length));

    return Array.from(values, (value) => charset[value % charset.length]).join("");
}

export function formatDateToken(date = new Date()) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
}

function normalizeSeparator(value) {
    const candidate = String(value ?? "-").trim();
    return candidate ? candidate.slice(0, 1) : "-";
}

function asStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

/**
 * Accepts {"firstNames": [...], "lastNames": [...]} (also first/last or
 * vorname/nachname keys), or an array of objects ({first, last}), strings
 * ("Max Mustermann"), or mixed entries.
 */
export function parseNameList(raw) {
    let parsed;
    try {
        parsed = JSON.parse(String(raw ?? ""));
    } catch {
        return null;
    }

    let firstNames = [];
    let lastNames = [];

    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (typeof item === "string") {
                const [first, ...rest] = item.trim().split(/\s+/);
                if (first) {
                    firstNames.push(first);
                }
                if (rest.length > 0) {
                    lastNames.push(rest.join(" "));
                }
            } else if (item && typeof item === "object") {
                const first = item.first ?? item.firstName ?? item.vorname ?? item.firstname;
                const last = item.last ?? item.lastName ?? item.nachname ?? item.lastname;
                if (first) {
                    firstNames.push(String(first));
                }
                if (last) {
                    lastNames.push(String(last));
                }
            }
        }
    } else if (parsed && typeof parsed === "object") {
        for (const key of ["firstNames", "vornamen", "firstName", "first"]) {
            firstNames = firstNames.concat(asStringArray(parsed[key]));
        }
        for (const key of ["lastNames", "nachnamen", "lastName", "last"]) {
            lastNames = lastNames.concat(asStringArray(parsed[key]));
        }
    }

    firstNames = [...new Set(firstNames)];
    lastNames = [...new Set(lastNames)];

    if (firstNames.length === 0 && lastNames.length === 0) {
        return null;
    }

    return { firstNames, lastNames };
}

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function buildNameSegments(settings) {
    const parsed = parseNameList(settings.namesJson);
    const pool = parsed ?? {
        firstNames: [...DEFAULT_NAME_POOL.firstNames],
        lastNames: [...DEFAULT_NAME_POOL.lastNames],
    };

    const hasFirst = pool.firstNames.length > 0;
    const hasLast = pool.lastNames.length > 0;
    if (!hasFirst && !hasLast) {
        return [];
    }

    const first = hasFirst ? sanitizeSegment(pickRandom(pool.firstNames), 20) : "";
    const last = hasLast ? sanitizeSegment(pickRandom(pool.lastNames), 20) : "";
    return [first, last].filter(Boolean);
}

export function buildLocalPart(settings, siteInfo, date = new Date()) {
    const separator = normalizeSeparator(settings.separator);
    const elements = [];

    const addElement = (order, segments, clean = sanitizeSegment) => {
        const cleanedSegments = segments.map((segment) => clean(segment, 40)).filter(Boolean);
        if (cleanedSegments.length === 0) {
            return;
        }
        elements.push({
            order: Number.parseInt(order, 10) || 0,
            value: cleanedSegments.join(separator),
        });
    };

    addElement(settings.orderPrefix, [settings.prefix]);

    if (settings.includeNamePart) {
        addElement(settings.orderName, buildNameSegments(settings));
    }

    if (settings.includeUrlPart) {
        const websitePart = settings.includeUrlSuffix ? siteInfo.siteKey : siteInfo.alias;
        addElement(settings.orderUrl, [websitePart], settings.includeUrlSuffix ? sanitizeDomainSegment : sanitizeSegment);
    }

    if (settings.includeDatePart) {
        addElement(settings.orderDate, [formatDateToken(date)]);
    }

    if (settings.includeSecureString) {
        // Keep the random string untouched so custom character sets are preserved.
        elements.push({
            order: Number.parseInt(settings.orderRandom, 10) || 0,
            value: createRandomString(settings),
        });
    }

    if (elements.length === 0) {
        elements.push({ order: 0, value: "catchall" });
    }

    // The index defines the order; stable sorting keeps equal indexes in their original column.
    elements.sort((left, right) => left.order - right.order);

    let localPart = elements.map((element) => element.value).join(separator);
    localPart = localPart.replace(/[^a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+/g, "-");
    localPart = localPart.replace(/\.{2,}/g, ".");

    // Keep every generated address consistent now that lowercase is not configurable.
    return localPart.toLowerCase();
}

export function buildEmailAddress(settings, siteInfo, date = new Date()) {
    const localPart = buildLocalPart(settings, siteInfo, date);
    const domain = String(settings.mailDomain ?? "").trim().replace(/^@+/, "");
    return `${localPart}@${domain}`;
}
