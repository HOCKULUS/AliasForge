function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="12" height="14" rx="2"/><path d="M8 7V3h12v14h-4"/></svg>';
const deleteIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>';
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function createIcon(root, type) {
    const svg = root.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const shapes = type === "copy"
        ? [["rect", { x: 4, y: 7, width: 12, height: 14, rx: 2 }], ["path", { d: "M8 7V3h12v14h-4" }]]
        : [["path", { d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" }]];
    for (const [name, attributes] of shapes) {
        const shape = root.createElementNS(SVG_NAMESPACE, name);
        for (const [attribute, value] of Object.entries(attributes)) shape.setAttribute(attribute, String(value));
        svg.append(shape);
    }
    return svg;
}

function createHistoryNodes(root, entries, currentIds, emptyTitle, emptyText) {
    if (!entries.length) {
        const empty = root.createElement("div");
        empty.className = "empty-state";
        const title = root.createElement("strong");
        title.textContent = emptyTitle;
        empty.append(title, root.createTextNode(emptyText));
        return [empty];
    }

    return entries.map((entry) => {
        const date = new Date(entry.createdAt);
        const timestamp = Number.isNaN(date.getTime()) ? "Unknown date" : dateFormat.format(date);
        const article = root.createElement("article");
        article.className = "history-entry";

        const top = root.createElement("div");
        top.className = "entry-top";
        const site = root.createElement("span");
        site.className = "entry-site";
        site.title = entry.hostname;
        site.textContent = entry.siteKey;
        top.append(site);
        if (currentIds.has(entry.id)) {
            const badge = root.createElement("span");
            badge.className = "entry-badge";
            badge.textContent = "Active";
            top.append(badge);
        }
        article.append(top);

        const email = root.createElement("span");
        email.className = "entry-email";
        email.textContent = entry.email;
        article.append(email);

        const bottom = root.createElement("div");
        bottom.className = "entry-bottom";
        const time = root.createElement("time");
        time.textContent = timestamp;
        const actions = root.createElement("div");
        actions.className = "entry-actions";
        if (!currentIds.has(entry.id)) {
            const activate = root.createElement("button");
            activate.className = "text-button";
            activate.type = "button";
            activate.dataset.activateEntry = entry.id;
            activate.setAttribute("aria-label", `Set ${entry.email} as active`);
            activate.textContent = "Set active";
            actions.append(activate);
        }
        for (const [type, title] of [["copy", "Copy"], ["delete", "Delete from history"]]) {
            const button = root.createElement("button");
            button.className = "icon-button";
            button.type = "button";
            button.dataset[type === "copy" ? "copyEntry" : "deleteEntry"] = entry.id;
            button.title = title;
            button.setAttribute("aria-label", `${title} ${entry.email}`);
            button.append(createIcon(root, type));
            actions.append(button);
        }
        bottom.append(time, actions);
        article.append(bottom);
        if (entry.notes) {
            const note = root.createElement("p");
            note.className = "entry-note";
            note.textContent = entry.notes;
            article.append(note);
        }
        return article;
    });
}

export function historyMarkup(entries, currentIds, emptyTitle, emptyText) {
    if (!entries.length) return `<div class="empty-state"><strong>${escapeHtml(emptyTitle)}</strong>${escapeHtml(emptyText)}</div>`;
    // Imported notes, addresses and IDs are untrusted; escape both text and attributes.
    return entries.map((entry) => {
        const date = new Date(entry.createdAt);
        const timestamp = Number.isNaN(date.getTime()) ? "Unknown date" : dateFormat.format(date);
        const label = escapeHtml(entry.email);
        const id = escapeHtml(entry.id);
        return `<article class="history-entry">
            <div class="entry-top"><span class="entry-site" title="${escapeHtml(entry.hostname)}">${escapeHtml(entry.siteKey)}</span>${currentIds.has(entry.id) ? '<span class="entry-badge">Active</span>' : ""}</div>
            <span class="entry-email">${label}</span>
            <div class="entry-bottom"><time>${escapeHtml(timestamp)}</time><div class="entry-actions">
                ${currentIds.has(entry.id) ? "" : `<button class="text-button" type="button" data-activate-entry="${id}" aria-label="Set ${label} as active">Set active</button>`}
                <button class="icon-button" type="button" data-copy-entry="${id}" title="Copy" aria-label="Copy ${label}">${copyIcon}</button>
                <button class="icon-button" type="button" data-delete-entry="${id}" title="Delete from history" aria-label="Delete ${label}">${deleteIcon}</button>
            </div></div>${entry.notes ? `<p class="entry-note">${escapeHtml(entry.notes)}</p>` : ""}
        </article>`;
    }).join("");
}

export function createHistoryView(root = document) {
    const find = (id) => root.querySelector(`#${id}`);
    return {
        render(history, siteInfo) {
            // Determine the current alias before filtering; search must never change the badge.
            const currentIds = new Set(history.filter((entry) => entry.active).map((entry) => entry.id));
            const siteEntries = history.filter((entry) => entry.siteKey === siteInfo?.siteKey);
            const query = find("history-search").value.trim().toLowerCase();
            const matches = history.filter((entry) => [entry.siteKey, entry.email, entry.notes, entry.hostname].some((value) => value.toLowerCase().includes(query)));
            find("site-history-list").replaceChildren(...createHistoryNodes(root, siteEntries, currentIds,
                siteInfo ? "No address for this website yet" : "No website open",
                siteInfo ? "An address is created automatically once a mail domain is configured." : "Open a website to create an address."));
            find("history-list").replaceChildren(...createHistoryNodes(root, matches, currentIds,
                query ? "No matching addresses" : "Your history is empty",
                query ? "Try a different search term." : "Generated and imported addresses will appear here."));
            find("site-count").textContent = String(siteEntries.length);
            find("history-count").textContent = String(history.length);
            find("history-summary").textContent = query ? `${matches.length} of ${history.length} addresses` : `${history.length} ${history.length === 1 ? "address" : "addresses"} total`;
            find("clear-history").disabled = history.length === 0;
            find("export-history").disabled = history.length === 0;
        },
    };
}
