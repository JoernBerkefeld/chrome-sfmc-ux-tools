/*
 * SFMC UX Tools — content script for the code editor's right-click menu.
 *
 * Marketing Cloud draws a menu of its own over the code. Unless the user chose to keep that menu
 * in the extension's options, a right-click in the editor is kept away from the page, so that the
 * browser shows its standard context menu. The same menu also hangs on a gear button below the
 * editor; the choice is written to an attribute of the html element, and editor-highlight.css
 * hides that button along with the menu.
 */
(() => {
    'use strict';

    const SETTING = 'editorContextMenu';
    const PAGE_MENU = 'page';
    const ATTRIBUTE = 'data-sfmc-ux-tools-context-menu';
    // the browser's menu is the default, also while the setting is still being read
    let isBrowserMenu = true;

    /**
     * Takes note of the user's choice, for the right-click and for the page's styles.
     *
     * @param {string} [value] the setting
     */
    function apply(value) {
        isBrowserMenu = value !== PAGE_MENU;
        document.documentElement.setAttribute(ATTRIBUTE, isBrowserMenu ? 'browser' : PAGE_MENU);
    }

    /**
     * Keeps a right-click in a code editor away from the page.
     *
     * @param {Event} event the contextmenu event, seen before the page sees it
     */
    function keepBrowserContextMenu(event) {
        if (
            isBrowserMenu &&
            event.target instanceof Element &&
            event.target.closest('.CodeMirror')
        ) {
            event.stopImmediatePropagation();
        }
    }

    // the window is first in line for every event of the page
    addEventListener('contextmenu', keepBrowserContextMenu, { capture: true });

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: 'browser' });
            apply(values[SETTING]);
        } catch {
            // without the setting the default stays in place
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            apply(changes[SETTING].newValue);
        }
    });
    apply();
    readSetting();
})();
