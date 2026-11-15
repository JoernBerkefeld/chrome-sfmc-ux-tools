/*
 * SFMC UX Tools — options page. Each setting is a group of radio buttons named after its key in
 * chrome.storage.sync; the first button of a group is the default.
 */
(() => {
    'use strict';

    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const defaults = {};
    for (const radio of radios) {
        defaults[radio.name] ??= radio.value;
    }

    /**
     * Ticks the radio buttons that match the given settings.
     *
     * @param {Object.<string, string>} values settings by key
     */
    function show(values) {
        for (const radio of radios) {
            radio.checked = values[radio.name] === radio.value;
        }
    }

    /**
     * Shows the saved settings.
     */
    async function load() {
        try {
            show(await chrome.storage.sync.get(defaults));
        } catch {
            // the defaults stay ticked
        }
    }

    show(defaults);
    load();
    document.addEventListener('change', (event) => {
        const { name, value, type } = event.target;
        if (type === 'radio' && Object.hasOwn(defaults, name)) {
            chrome.storage.sync.set({ [name]: value });
        }
    });
})();
