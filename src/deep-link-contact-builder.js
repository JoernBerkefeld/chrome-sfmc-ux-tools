/*
 * SFMC UX Tools — content script for Contact Builder's frame: links to what is open in Contact
 * Builder.
 *
 * Contact Builder keeps what is open in the address of its own frame, which the Marketing Cloud
 * page around it does not copy into the address bar. This script tells that page the route of
 * the frame, when it starts and whenever the route changes, so that deep-link-shell.js can write
 * it into the address in Marketing Cloud's own form. With the route it says whether the user
 * clicked or typed in this frame since it told last: only then does that page give the address
 * an entry of its own, to which the browser's Back and Forward step.
 *
 * It opens nothing for a link: the Marketing Cloud page opens the route of such an address by
 * itself. Only when the browser steps Back or Forward to an entry with a route does that page ask
 * this script to show the route, which it does by writing the route over the one in this frame's
 * address. Seen live: Contact Builder then shows that route, and the browser's history gets no
 * entry for it. Left to Marketing Cloud, such a step lost the entries after it.
 *
 * It asks nothing of Marketing Cloud and changes nothing in it. Only Contact Builder's own
 * document, directly below the Marketing Cloud page, talks to that page.
 */
(() => {
    'use strict';

    // the one document of Contact Builder whose address the Marketing Cloud page takes a route for
    const PAGE = '/contactsmeta/admin.html';
    // Contact Builder opened by itself has no page around it, and a frame further down is not
    // Contact Builder's own
    if (top === globalThis || parent !== top || location.pathname !== PAGE) {
        return;
    }

    // what is told to the Marketing Cloud page, passed on by background.js
    const SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:contact-shown';
    // what the Marketing Cloud page asks of this frame, passed on by background.js: to show a
    // route, when the browser stepped to an entry with that route
    const OPEN_MESSAGE = 'sfmc-ux-tools:deep-link:contact-open';
    // the longest route that is taken for one
    const MOST_ROUTE = 200;
    // such a route: letters, digits, and the four signs seen in Contact Builder's routes
    const ROUTE = new RegExp(String.raw`^[A-Za-z\d/_.-]{1,${MOST_ROUTE}}$`);
    // what a person does in Contact Builder that may open something: a click, a key
    const INPUTS = ['pointerdown', 'keydown'];
    // whether the user clicked or typed in this frame since it told last
    let isByUser = false;

    /**
     * Reads the route from the part of this frame's address from the #.
     *
     * @param {unknown} hash that part of the address
     * @returns {string|null} the route, without the #; null for none and for anything that is not of the form of a route
     */
    function routeOf(hash) {
        const route = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
        return ROUTE.test(route) ? route : null;
    }

    // what the script hands out: its function that only computes, for the tests
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call the function by itself, which nothing else of this script lets them
    globalThis.sfmcUxToolsDeepLinkContactBuilder = { routeOf };

    /**
     * Tells the Marketing Cloud page the route of this frame. It never throws.
     */
    async function tell() {
        const message = { type: SHOWN_MESSAGE, route: routeOf(location.hash) };
        if (isByUser) {
            message.byUser = true;
        }
        isByUser = false;
        try {
            await chrome.runtime.sendMessage(message);
        } catch {
            // the extension was updated or switched off under this page
        }
    }

    for (const type of INPUTS) {
        // before the page's own scripts, which may keep the event to themselves
        addEventListener(
            type,
            (event) => {
                // what a script of the page makes up is nobody's click or key
                if (event.isTrusted) {
                    isByUser = true;
                }
            },
            true,
        );
    }

    /**
     * Shows a route, as the Marketing Cloud page asked for a step through the browser's history:
     * the route is written over the one in this frame's address, which adds no entry. Contact
     * Builder then shows it, and the change of the address tells it as any other. A route that
     * is shown already, and anything that is not of the form of a route, changes nothing.
     *
     * @param {unknown} route the route, without the #
     */
    function show(route) {
        const isRoute = typeof route === 'string' && ROUTE.test(route);
        if (!isRoute || routeOf(location.hash) === route) {
            return;
        }
        // what follows is not the user's doing, whatever they clicked or typed before
        isByUser = false;
        location.replace(`#${route}`);
    }

    chrome.runtime.onMessage.addListener((message, sender) => {
        // only what the extension's own background script passes on
        if (!sender.tab && sender.id === chrome.runtime.id && message?.type === OPEN_MESSAGE) {
            show(message.route);
        }
        return false;
    });

    addEventListener('hashchange', tell);
    tell();
})();
