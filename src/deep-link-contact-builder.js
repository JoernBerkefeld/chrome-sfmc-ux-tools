/*
 * SFMC UX Tools — content script for Contact Builder's frame: links to what is open in Contact
 * Builder.
 *
 * Contact Builder keeps what is open in the address of its own frame, which the Marketing Cloud
 * page around it does not copy into the address bar. This script tells that page the route of
 * the frame, when it starts and whenever the route changes, so that deep-link-shell.js can write
 * it into the address in Marketing Cloud's own form.
 *
 * It only tells: it opens nothing, because the Marketing Cloud page opens the route of such an
 * address by itself. It asks nothing of Marketing Cloud and changes nothing in it. Only Contact
 * Builder's own document, directly below the Marketing Cloud page, talks to that page.
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
    // the longest route that is taken for one
    const MOST_ROUTE = 200;
    // such a route: letters, digits, and the four signs seen in Contact Builder's routes
    const ROUTE = new RegExp(String.raw`^[A-Za-z\d/_.-]{1,${MOST_ROUTE}}$`);

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
        try {
            await chrome.runtime.sendMessage({
                type: SHOWN_MESSAGE,
                route: routeOf(location.hash),
            });
        } catch {
            // the extension was updated or switched off under this page
        }
    }

    addEventListener('hashchange', tell);
    tell();
})();
