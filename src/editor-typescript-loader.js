/*
 * SFMC UX Tools — content script that passes on the request for the TypeScript script.
 *
 * The language script runs in the page's own script world, where it cannot talk to the extension.
 * When it finds a code editor it says so with an event on the document; this script hears it and
 * asks the background script to load the TypeScript script into this document. If that fails, the
 * language script is told, so that it may ask again for a later editor.
 */
(() => {
    'use strict';

    const NEED = 'sfmc-ux-tools:need-typescript';
    const FAILED = 'sfmc-ux-tools:typescript-failed';
    let isRequested = false;

    /**
     * Asks the background script for the TypeScript script, unless it was asked already.
     */
    async function request() {
        if (isRequested) {
            return;
        }
        isRequested = true;
        let isLoaded = false;
        try {
            const answer = await chrome.runtime.sendMessage({ type: NEED });
            isLoaded = answer?.isLoaded === true;
        } catch {
            // the extension was updated or removed while the page stayed open, or does not answer
        }
        if (isLoaded) {
            return;
        }

        // without the TypeScript script the editor works as before
        isRequested = false;
        document.dispatchEvent(new CustomEvent(FAILED));
    }

    document.addEventListener(NEED, request);
})();
