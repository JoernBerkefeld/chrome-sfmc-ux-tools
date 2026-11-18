/*
 * SFMC UX Tools — content script for the settings that concern Journey Builder.
 *
 * Writes the choices made on the extension's options page to attributes of the html element,
 * where the Journey Builder script, which runs in the page's own world, can read them.
 */
(() => {
    'use strict';

    const ON = 'on';
    // the settings and the attribute each of them is noted in; both are on unless switched off
    const SETTINGS = {
        readableKeys: 'data-sfmc-ux-tools-readable-keys',
        journeyNameCheck: 'data-sfmc-ux-tools-journey-name-check',
    };
    const DEFAULTS = Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, ON]));

    /**
     * Notes settings on the page; anything but "on" switches a feature off.
     *
     * @param {Object.<string, unknown>} values settings by key
     */
    function apply(values) {
        for (const [key, value] of Object.entries(values)) {
            if (Object.hasOwn(SETTINGS, key)) {
                document.documentElement.setAttribute(SETTINGS[key], value === ON ? ON : 'off');
            }
        }
    }

    /**
     * Reads the user's choices from the extension's storage.
     */
    async function readSettings() {
        try {
            apply(await chrome.storage.sync.get(DEFAULTS));
        } catch {
            // without the settings everything stays switched on
        }
    }

    apply(DEFAULTS);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            apply(
                Object.fromEntries(
                    Object.entries(changes).map(([key, change]) => [key, change.newValue]),
                ),
            );
        }
    });
    readSettings();
})();
