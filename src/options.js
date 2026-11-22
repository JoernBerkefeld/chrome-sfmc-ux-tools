/*
 * SFMC UX Tools — options page. Each setting is a group of radio buttons named after its key in
 * chrome.storage.sync; the first button of a group is the default. The group of preview features
 * is hidden until the copyright sign is clicked with Alt held, or one of them is switched on. One
 * button removes the business units that the links to an asset keep in chrome.storage.local.
 */
(() => {
    'use strict';

    // where deep-link-shell.js keeps the business units this browser has seen, in
    // chrome.storage.local
    const BUSINESS_UNITS_KEY = 'deepLinkBusinessUnits';
    const radios = [...document.querySelectorAll('input[type="radio"]')];
    // the unfinished features, which the page does not show by itself
    const preview = document.querySelector('#preview');
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
            // a preview feature that is switched on can be seen, and so switched off again
            if (radio.checked && radio.value !== defaults[radio.name] && preview.contains(radio)) {
                preview.hidden = false;
            }
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
    document.querySelector('#copyright').addEventListener('click', (event) => {
        if (event.altKey) {
            preview.hidden = false;
        }
    });
    document.querySelector('#forgetBusinessUnits').addEventListener('click', async () => {
        const done = document.querySelector('#forgetBusinessUnitsDone');
        try {
            await chrome.storage.local.remove(BUSINESS_UNITS_KEY);
            done.textContent = 'Forgotten.';
        } catch {
            done.textContent = 'Could not be forgotten. Please try again.';
        }
    });
    document.addEventListener('change', (event) => {
        const { name, value, type } = event.target;
        if (type === 'radio' && Object.hasOwn(defaults, name)) {
            chrome.storage.sync.set({ [name]: value });
        }
    });
})();
