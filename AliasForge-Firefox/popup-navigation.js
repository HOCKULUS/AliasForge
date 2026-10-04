const SETTINGS_TABS = new Set(["mail", "automatic", "behavior", "licenses"]);

// A deliberate burst, not a lifetime counter: any interruption starts over.
export function createDebugSequence(now = () => performance.now()) {
    let count = 0;
    let started = 0;
    let last = 0;
    return {
        reset() { count = 0; },
        click(isHistory) {
            if (!isHistory) { count = 0; return false; }
            const time = now();
            if (!count || time - last > 800 || time - started > 6000) {
                count = 0;
                started = time;
            }
            last = time;
            count += 1;
            if (count !== 10) return false;
            count = 0;
            return true;
        },
    };
}

export function createPopupNavigation({ onDebugOpen, onDebugDisable }, root = document) {
    const main = root.querySelector("#main-view");
    const settings = root.querySelector("#settings-view");
    const toggle = root.querySelector("#toggle-settings");
    const debugTab = root.querySelector("#debug-tab");
    const buttons = Array.from(root.querySelectorAll(".tab-button"));
    const panels = Array.from(root.querySelectorAll(".tab-panel"));
    const sequence = createDebugSequence();
    let activeMain = "site";
    let activeSettings = "mail";
    let settingsOpen = false;
    let debugEnabled = false;

    function render() {
        main.hidden = settingsOpen;
        settings.hidden = !settingsOpen;
        debugTab.hidden = !debugEnabled;
        toggle.setAttribute("aria-expanded", String(settingsOpen));
        toggle.setAttribute("aria-label", settingsOpen ? "Close settings" : "Open settings");
        const active = settingsOpen ? activeSettings : activeMain;
        buttons.forEach((button) => {
            const selected = button.dataset.tab === active;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
        panels.forEach((panel) => {
            panel.hidden = panel.dataset.panel !== active;
            panel.classList.toggle("is-active", !panel.hidden);
        });
    }

    function selectTab(tab) {
        if (tab === "debug" && !debugEnabled) return;
        settingsOpen = SETTINGS_TABS.has(tab);
        if (settingsOpen) activeSettings = tab;
        else activeMain = tab;
        render();
        if (tab === "debug") onDebugOpen();
    }

    function showSettings(tab = activeSettings) {
        sequence.reset();
        selectTab(tab);
    }

    // Capture phase includes clicks on the tab's counter, and resets on every other click.
    root.addEventListener("click", (event) => {
        if (sequence.click(event.target.closest?.("[data-tab]")?.dataset.tab === "history")) {
            debugEnabled = true;
            render();
        }
    }, true);
    for (const event of ["input", "keydown", "visibilitychange"]) {
        root.addEventListener(event, () => sequence.reset(), true);
    }
    buttons.forEach((button) => button.addEventListener("click", () => selectTab(button.dataset.tab)));
    toggle.addEventListener("click", () => settingsOpen ? selectTab(activeMain) : showSettings());
    root.querySelector("#close-settings").addEventListener("click", () => {
        selectTab(activeMain);
        toggle.focus();
    });
    root.querySelector("#disable-debug").addEventListener("click", () => {
        debugEnabled = false;
        sequence.reset();
        selectTab("history");
        buttons.find((button) => button.dataset.tab === "history").focus();
        onDebugDisable();
    });
    render();
    return { showSettings, get debugEnabled() { return debugEnabled; } };
}
