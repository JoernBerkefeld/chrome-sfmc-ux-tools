/*
 * SFMC UX Tools — content script for the "format on save" setting.
 *
 * Writes the choice made on the extension's options page to an attribute of the html element,
 * where the formatting script, which runs in the page's own world, can read it.
 */
(() => {
    'use strict';

    const SETTING = 'editorFormatOnSave';
    const ATTRIBUTE = 'data-sfmc-ux-tools-format-on-save';
    const OFF = 'off';

    /**
     * Notes the setting on the page; anything but "on" switches it off.
     *
     * @param {string} [value] the setting
     */
    function apply(value) {
        document.documentElement.setAttribute(ATTRIBUTE, value === 'on' ? 'on' : OFF);
    }

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: OFF });
            apply(values[SETTING]);
        } catch {
            // without the setting it stays switched off
        }
    }

    apply(OFF);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            apply(changes[SETTING].newValue);
        }
    });
    readSetting();
})();
