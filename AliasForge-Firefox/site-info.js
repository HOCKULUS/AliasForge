import { PUBLIC_SUFFIX_RULES } from "./public-suffix-rules.js";

// Design reference: KeePassXC-Browser 1.10.4, background/page.js,
// getTopLevelDomainFromUrl / getBaseDomainFromUrl (upstream license: GPL-3.0).
// https://github.com/keepassxreboot/keepassxc-browser/blob/develop/keepassxc-browser/background/page.js
// Independent implementation of the PSL approach, not copied KeePassXC code.
// We bundle MPL-2.0 rules instead of probing a site's cookies. See MPL-2.0.txt.
const suffixRules = new Set(PUBLIC_SUFFIX_RULES);

function baseDomain(hostname) {
    if (hostname.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return hostname;
    }

    const labels = hostname.split(".");
    let suffixLength = 1;
    for (let index = 0; index < labels.length; index += 1) {
        const suffix = labels.slice(index).join(".");
        // Exceptions override the longest exact/wildcard rule (e.g. city.kawasaki.jp).
        if (suffixRules.has(`!${suffix}`)) {
            suffixLength = labels.length - index - 1;
            break;
        }
        if (suffixRules.has(suffix)) {
            suffixLength = Math.max(suffixLength, labels.length - index);
        }
        if (index > 0 && suffixRules.has(`*.${suffix}`)) {
            suffixLength = Math.max(suffixLength, labels.length - index + 1);
        }
    }
    return labels.slice(-(suffixLength + 1)).join(".");
}

export function getSiteInfo(pageUrl) {
    try {
        let url = new URL(pageUrl);
        // Firefox reader mode still belongs to the original website.
        if (url.protocol === "about:" && url.pathname === "reader") {
            url = new URL(url.searchParams.get("url"));
        }
        if (!["http:", "https:"].includes(url.protocol)) return null;
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        if (!hostname) return null;
        const siteKey = baseDomain(hostname);
        const aliasLabel = siteKey.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(siteKey)
            ? siteKey : siteKey.split(".")[0];
        const alias = aliasLabel.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
        // Never retain passwords or access tokens from a URL in the history.
        return { alias: alias || "website", hostname, origin: url.origin, pageUrl: url.origin, siteKey };
    } catch {
        return null;
    }
}
