/*
 * SFMC UX Tools — background script: loads the TypeScript script into a document that asks for it,
 * and passes messages about links from the frames of Content Builder, Email Studio and Contact
 * Builder to the page around them.
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
    // what Content Builder's frame asks of and tells the Marketing Cloud page around it, for the
    // links to an asset: see deep-link-content-builder.js and deep-link-shell.js
    const DEEP_LINK_WANTED = 'sfmc-ux-tools:deep-link:wanted';
    const DEEP_LINK_SHOWN = 'sfmc-ux-tools:deep-link:shown';
    const DEEP_LINK_MESSAGES = [DEEP_LINK_WANTED, DEEP_LINK_SHOWN];
    // the same two of Email Studio's frame, for the links to a view of it: see
    // deep-link-email-studio.js
    const EMAIL_LINK_WANTED = 'sfmc-ux-tools:deep-link:email-wanted';
    const EMAIL_LINK_SHOWN = 'sfmc-ux-tools:deep-link:email-shown';
    const EMAIL_LINK_MESSAGES = [EMAIL_LINK_WANTED, EMAIL_LINK_SHOWN];
    // what Contact Builder's frame tells that page, for the links to what is open in it: see
    // deep-link-contact-builder.js
    const CONTACT_LINK_SHOWN = 'sfmc-ux-tools:deep-link:contact-shown';
    // where Contact Builder's frame is, on any stack of Marketing Cloud's apps: its path
    const CONTACT_BUILDER_PATH = '/contactsmeta/';
    // the longest route inside Contact Builder that is taken for one, and such a route: letters,
    // digits, and the four signs seen in Contact Builder's routes
    const MOST_ROUTE = 200;
    const CONTACT_ROUTE = new RegExp(String.raw`^[A-Za-z\d/_.-]{1,${MOST_ROUTE}}$`);
    // the start of the host of Content Builder's frames
    const CONTENT_BUILDER_HOST = 'content-builder.';
    // where Email Studio's frame is: the start and the end of its host, and its path
    const EMAIL_STUDIO_HOST = 'members.';
    const EMAIL_STUDIO_DOMAIN = '.exacttarget.com';
    const EMAIL_STUDIO_PATH = '/C12/Default.aspx';
    // the longest id of an asset that is taken for one: as many digits as a whole number holds
    // exactly
    const MOST_DIGITS = 15;
    const ASSET_ID = new RegExp(String.raw`^\d{1,${MOST_DIGITS}}$`);
    // the longest name of a part of a route inside Email Studio that is taken for one, and the
    // longest id in it: as long as an id of 32 hex digits with its four hyphens
    const MOST_LETTERS = 30;
    const MOST_ROUTE_ID = 36;
    const WORD = String.raw`[A-Za-z\d]{1,${MOST_LETTERS}}`;
    // what Email Studio's frame may say it shows: r for a route, its two names and an id of
    // digits, or of hex digits and hyphens
    const EMAIL_TARGET = new RegExp(
        String.raw`^r\.${WORD}\.${WORD}\.[\dA-Fa-f][\dA-Fa-f-]{0,${MOST_ROUTE_ID - 1}}$`,
    );
    // the id Chrome gives the page of a tab, as opposed to the frames in it
    const TOP_FRAME = 0;
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

    /**
     * Reads the address of a frame below the page of a tab.
     *
     * @param {object} sender who sent a message, as Chrome describes it
     * @returns {URL|undefined} the address; nothing for the page itself and for anything else
     */
    function frameAddress(sender) {
        if (
            typeof sender.tab?.id !== 'number' ||
            typeof sender.frameId !== 'number' ||
            sender.frameId === TOP_FRAME ||
            typeof sender.url !== 'string'
        ) {
            return;
        }
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const address = new URL(sender.url);
            return address.protocol === APP_PROTOCOL ? address : undefined;
        } catch {
            // no address
        }
    }

    /**
     * Tells whether a message comes from a frame of Content Builder below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isContentBuilderFrame(sender) {
        const hostname = frameAddress(sender)?.hostname;
        return (
            hostname !== undefined &&
            hostname.startsWith(CONTENT_BUILDER_HOST) &&
            hostname.endsWith(APP_HOST)
        );
    }

    /**
     * Tells whether a message comes from Email Studio's frame below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isEmailStudioFrame(sender) {
        const address = frameAddress(sender);
        return (
            address !== undefined &&
            address.hostname.startsWith(EMAIL_STUDIO_HOST) &&
            address.hostname.endsWith(EMAIL_STUDIO_DOMAIN) &&
            address.pathname === EMAIL_STUDIO_PATH
        );
    }

    /**
     * Tells whether a message comes from Contact Builder's frame below the page of a tab.
     *
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean} true for such a frame only
     */
    function isContactBuilderFrame(sender) {
        const address = frameAddress(sender);
        return (
            address !== undefined &&
            address.hostname.endsWith(APP_HOST) &&
            address.pathname.startsWith(CONTACT_BUILDER_PATH)
        );
    }

    /**
     * Tells whether a message about a link comes from the frame of the app it is about.
     *
     * @param {unknown} type the type of the message
     * @param {object} sender who sent the message, as Chrome describes it
     * @returns {boolean|undefined} true for that app's frame, false for any other sender; nothing when the message is not about a link
     */
    function isFromItsFrame(type, sender) {
        if (DEEP_LINK_MESSAGES.includes(type)) {
            return isContentBuilderFrame(sender);
        }
        if (EMAIL_LINK_MESSAGES.includes(type)) {
            return isEmailStudioFrame(sender);
        }
        if (type === CONTACT_LINK_SHOWN) {
            return isContactBuilderFrame(sender);
        }
    }

    /**
     * Reads what of a message about a link is passed on: its type and, of what a frame says it
     * shows, one text of the form that is expected there, or null.
     *
     * @param {{type: string, asset?: unknown, target?: unknown, route?: unknown}} message what a frame sent
     * @returns {object} what the page gets
     */
    function passable(message) {
        const passed = { type: message.type };
        if (message.type === DEEP_LINK_SHOWN) {
            const isId = typeof message.asset === 'string' && ASSET_ID.test(message.asset);
            passed.asset = isId ? message.asset : null;
        }
        if (message.type === EMAIL_LINK_SHOWN) {
            const isTarget =
                typeof message.target === 'string' && EMAIL_TARGET.test(message.target);
            passed.target = isTarget ? message.target : null;
        }
        if (message.type === CONTACT_LINK_SHOWN) {
            const isRoute = typeof message.route === 'string' && CONTACT_ROUTE.test(message.route);
            passed.route = isRoute ? message.route : null;
        }
        return passed;
    }

    /**
     * Passes a message about a link on to the page of the same tab, and its answer back.
     *
     * @param {{type: string, asset?: unknown, target?: unknown, route?: unknown}} message what the frame of an app sent
     * @param {number} tabId the tab of that frame
     * @param {(answer?: object) => void} sendResponse answers the frame
     */
    async function relay(message, tabId, sendResponse) {
        const passed = passable(message);
        try {
            sendResponse(await chrome.tabs.sendMessage(tabId, passed, { frameId: TOP_FRAME }));
        } catch {
            // the page is gone or does not listen: the frame gets no answer
            sendResponse();
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // each app's messages are taken from that app's frame only
        const isItsFrame = isFromItsFrame(message?.type, sender);
        if (isItsFrame !== undefined) {
            if (!isItsFrame || sender.id !== chrome.runtime.id) {
                return false;
            }
            relay(message, sender.tab.id, sendResponse);
            // the answer follows once the page gave its own
            return true;
        }
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
