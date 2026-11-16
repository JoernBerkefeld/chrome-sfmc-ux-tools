/*
 * SFMC UX Tools — content script for the theme of the code editor.
 *
 * Writes the theme to an attribute of the html element: the one chosen on the extension's
 * options page, or, until something is chosen there, the one that fits the light or dark mode
 * of the system. The colours themselves are in editor-highlight.css.
 */
(() => {
    'use strict';

    const SETTING = 'editorTheme';
    const ATTRIBUTE = 'data-sfmc-ux-tools-theme';
    const SYSTEM = 'system';
    const THEMES = new Set(['light', 'dark']);
    const darkMode = matchMedia('(prefers-color-scheme: dark)');
    let chosen = SYSTEM;

    /**
     * Switches the page to the chosen theme; anything but a theme follows the system.
     */
    function apply() {
        const theme = THEMES.has(chosen) ? chosen : darkMode.matches ? 'dark' : 'light';
        document.documentElement.setAttribute(ATTRIBUTE, theme);
    }

    /**
     * Takes note of the user's choice.
     *
     * @param {string} [value] the setting
     */
    function choose(value) {
        chosen = value;
        apply();
    }

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: SYSTEM });
            choose(values[SETTING]);
        } catch {
            // without the setting the system decides
        }
    }

    apply();
    // the system can change its mode while the page is open, for example at nightfall
    darkMode.addEventListener('change', apply);
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            choose(changes[SETTING].newValue);
        }
    });
    readSetting();
})();
