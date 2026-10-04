import { DEFAULT_SETTINGS } from "./shared-state.js";

// Derive all bindings from the schema so new settings cannot silently be forgotten.
export function createSettingsForm(root = document) {
    const fields = Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
        const id = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const input = root.querySelector(`#${id}`);
        if (!input) throw new Error(`Einstellungsfeld fehlt: ${id}`);
        return { key, input, isBoolean: typeof fallback === "boolean" };
    });
    const readField = ({ input, isBoolean }) => isBoolean ? input.checked : input.value;
    return {
        read: () => Object.fromEntries(fields.map((field) => [field.key, readField(field)])),
        fill(settings) {
            for (const { key, input, isBoolean } of fields) {
                if (isBoolean) input.checked = settings[key];
                else input.value = settings[key];
            }
        },
        bind(onChange) {
            for (const field of fields) {
                // Send immediately: a popup timer is destroyed when the popup closes.
                field.input.addEventListener("input", () => onChange({ [field.key]: readField(field) }));
            }
        },
        setDisabled(disabled) {
            fields.forEach(({ input }) => { input.disabled = disabled; });
        },
    };
}
