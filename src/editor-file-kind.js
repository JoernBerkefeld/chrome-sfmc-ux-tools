/*
 * SFMC UX Tools — content script that notes what kind of file the code editor shows.
 *
 * Content Builder's code editor is one frame for every kind of content, and it always edits in
 * its mode for HTML with AMPscript. CloudPages uses that frame for its code resources as well,
 * which are JavaScript, CSS, JSON, XML or plain text files. The page around the frame says what
 * it is about to edit in the message that sets the frame up; this script reads the asset type
 * from that message and writes the kind of file to an attribute of the html element, where the
 * scripts of the page's own script world find it. Nothing of the content is read.
 */
(() => {
    'use strict';

    const ATTRIBUTE = 'data-sfmc-ux-tools-file-kind';
    // the message that sets the editor frame up
    const SETUP_MESSAGE = 'HANDSHAKE';
    const APP_PROTOCOL = 'https:';
    const APP_HOST = '.marketingcloudapps.com';
    // asset types of CloudPages' code resources and the kind of file each one is; an RSS feed is XML
    const KINDS = new Map([
        ['jscoderesource', 'javascript'],
        ['csscoderesource', 'css'],
        ['jsoncoderesource', 'json'],
        ['xmlcoderesource', 'xml'],
        ['rsscoderesource', 'xml'],
        ['textcoderesource', 'text'],
    ]);

    /**
     * Tells whether a message comes from one of Marketing Cloud's apps.
     *
     * @param {string} origin where the message was sent from
     * @returns {boolean} true for an app on any stack
     */
    function isApp(origin) {
        try {
            // read as the browser reads it, so that nothing in the address can pass for its host
            const { protocol, hostname } = new URL(origin);
            return protocol === APP_PROTOCOL && hostname.endsWith(APP_HOST);
        } catch {
            return false;
        }
    }

    /**
     * Takes note of the asset the frame is set up for. Content that is no code resource, such as
     * a landing page or an email, has no kind: it stays what the editor takes it for.
     *
     * @param {MessageEvent} event a message to this frame
     */
    function onMessage(event) {
        try {
            const { data } = event;
            if (
                event.source !== window.parent ||
                data?.type !== SETUP_MESSAGE ||
                !isApp(event.origin)
            ) {
                return;
            }
            const name = data.payload?.asset?.assetType?.name;
            if (typeof name !== 'string') {
                return;
            }
            const kind = KINDS.get(name);
            if (kind === undefined) {
                document.documentElement.removeAttribute(ATTRIBUTE);
                return;
            }
            document.documentElement.setAttribute(ATTRIBUTE, kind);
        } catch {
            // the editor works as before
        }
    }

    // the editor frame is always inside one of Marketing Cloud's apps
    if (window.parent !== globalThis) {
        window.addEventListener('message', onMessage);
    }
})();
