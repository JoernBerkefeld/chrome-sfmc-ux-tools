/*
 * SFMC UX Tools — background script: loads the TypeScript script into a document that asks for it.
 *
 * The TypeScript script is too large to run in every frame of Content Builder and Automation
 * Studio. A document with a code editor asks for it through editor-typescript-loader.js; it then
 * runs in the page's own script world, next to the language script that uses it.
 */
(() => {
    'use strict';

    const NEED_MESSAGE = 'sfmc-ux-tools:need-typescript';
    const FILE = 'editor-typescript.js';
    // the frames the manifest runs the editor scripts in: those of Content Builder ...
    const EDITOR_FRAME = 'https://content-builder.';
    // ... and the documents of Automation Studio, on any stack of Marketing Cloud's apps
    const APP_PROTOCOL = 'https:';
    const APP_HOST = '.marketingcloudapps.com';
    const AUTOMATION_STUDIO = '/AutomationStudioFuel3/';
    // by document: whether the script could be loaded into it. Forgotten when the browser stops
    // this script, which the TypeScript script allows for by doing nothing the second time
    const injections = new Map();

    /**
     * Tells whether a document is one the editor scripts run in.
     *
     * @param {unknown} address the document's address, as Chrome names it
     * @returns {boolean} true for a frame of Content Builder and for Automation Studio
     */
    function isEditorFrame(address) {
        if (typeof address !== 'string') {
            return false;
        }
        if (address.startsWith(EDITOR_FRAME)) {
            return true;
        }
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const { protocol, hostname, pathname } = new URL(address);
            return (
                protocol === APP_PROTOCOL &&
                hostname.endsWith(APP_HOST) &&
                pathname.startsWith(AUTOMATION_STUDIO)
            );
        } catch {
            return false;
        }
    }

    /**
     * Runs the TypeScript script in a document.
     *
     * @param {number} tabId tab of the document
     * @param {string} documentId the document, which a frame only shows until it loads another one
     * @returns {Promise.<boolean>} false if the document is gone or cannot be reached
     */
    async function inject(tabId, documentId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId, documentIds: [documentId] },
                files: [FILE],
                world: 'MAIN',
            });
            return true;
        } catch {
            // may be asked for again
            injections.delete(documentId);
            return false;
        }
    }

    /**
     * Tells the document that asked whether it has the script now, once per request.
     *
     * @param {object} sender who sent the request, as Chrome describes it
     * @param {(answer: {isLoaded: boolean}) => void} sendResponse answers the request
     */
    async function answer(sender, sendResponse) {
        const { documentId } = sender;
        if (!injections.has(documentId)) {
            injections.set(documentId, inject(sender.tab.id, documentId));
        }
        sendResponse({ isLoaded: await injections.get(documentId) });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (
            message?.type !== NEED_MESSAGE ||
            sender.id !== chrome.runtime.id ||
            typeof sender.tab?.id !== 'number' ||
            typeof sender.frameId !== 'number' ||
            typeof sender.documentId !== 'string' ||
            !isEditorFrame(sender.url)
        ) {
            return false;
        }
        answer(sender, sendResponse);
        // the answer follows once the script ran
        return true;
    });
})();
