/*
 * SFMC UX Tools — content script for the code editor's right-click menu.
 *
 * Marketing Cloud draws a menu of its own over the code. Unless the user chose to keep that menu
 * in the extension's options, a right-click in the editor is kept away from the page, so that the
 * browser shows its standard context menu.
 */
(() => {
    'use strict';

    const SETTING = 'editorContextMenu';
    const PAGE_MENU = 'page';
    // the browser's menu is the default, also while the setting is still being read
    let isBrowserMenu = true;

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
            isBrowserMenu = values[SETTING] !== PAGE_MENU;
        } catch {
            // without the setting the default stays in place
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            isBrowserMenu = changes[SETTING].newValue !== PAGE_MENU;
        }
    });
    readSetting();
})();
