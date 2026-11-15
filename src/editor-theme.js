/*
 * SFMC UX Tools — content script for the theme of the code editor.
 *
 * Writes the theme chosen on the extension's options page to an attribute of the html element.
 * The colours themselves are in editor-highlight.css.
 */
(() => {
    'use strict';

    const SETTING = 'editorTheme';
    const ATTRIBUTE = 'data-sfmc-ux-tools-theme';
    const DEFAULT_THEME = 'light';
    const THEMES = new Set([DEFAULT_THEME, 'dark']);

    /**
     * Switches the page to a theme; anything unknown gives the default.
     *
     * @param {string} [theme] name of the theme
     */
    function apply(theme) {
        document.documentElement.setAttribute(ATTRIBUTE, THEMES.has(theme) ? theme : DEFAULT_THEME);
    }

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: DEFAULT_THEME });
            apply(values[SETTING]);
        } catch {
            // without the setting the default stays in place
        }
    }

    apply(DEFAULT_THEME);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            apply(changes[SETTING].newValue);
        }
    });
    readSetting();
})();
