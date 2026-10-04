import { getTab, queryTabs, sendTabMessage } from "./extension-api.js";
import { getSiteInfo } from "./site-info.js";

// Design references: KeePassXC-Browser 1.10.4, common/global.js:getCurrentTab,
// background/tabs.js and background/event.js:onMessage. Upstream license: GPL-3.0.
// https://github.com/keepassxreboot/keepassxc-browser/tree/develop/keepassxc-browser
// Independently implemented tab-scoped lookup; no upstream code copied.

export async function getActiveTab() {
    for (const query of [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }]) {
        const tabs = await queryTabs(query).catch(() => []);
        const tab = tabs?.find((candidate) => Number.isInteger(candidate.id));
        // Keep this tab even if its URL is missing. Another window is not a valid substitute.
        if (tab) return tab;
    }
    return null;
}

export function siteFromTab(tab) {
    return getSiteInfo(tab?.pendingUrl || tab?.url);
}

export async function resolveTabSite(tab) {
    if (!tab) return { tab: null, siteInfo: null, reason: "no-tab" };
    const freshTab = await getTab(tab.id).catch(() => tab);
    const siteInfo = siteFromTab(freshTab);
    if (siteInfo) return { tab: freshTab, siteInfo, reason: "tab" };
    if (freshTab.url || freshTab.pendingUrl) {
        return { tab: freshTab, siteInfo: null, reason: "unsupported-page" };
    }
    // Ask only the top frame. A login iframe must not replace the visible site's identity.
    const response = await sendTabMessage(tab.id, { type: "GET_PAGE_CONTEXT" }, { frameId: 0 })
        .catch(() => null);
    return {
        tab: freshTab,
        siteInfo: getSiteInfo(response?.pageUrl),
        reason: response?.pageUrl ? "top-frame" : "missing-permission",
    };
}

export async function getActiveSite() {
    return resolveTabSite(await getActiveTab());
}

export async function siteForMessage(request, sender) {
    if (sender?.tab) {
        const tab = await getTab(sender.tab.id).catch(() => sender.tab);
        // The browser-provided sender URL is the document actually requesting an alias.
        const frameSite = getSiteInfo(sender.url);
        if (sender.frameId === 0) return frameSite ?? siteFromTab(tab);
        return siteFromTab(tab) ?? frameSite;
    }
    if (Number.isInteger(request.tabId)) {
        const tab = await getTab(request.tabId);
        const { siteInfo } = await resolveTabSite(tab);
        return siteInfo;
    }
    return null;
}
