/*
 * SFMC UX Tools — content script for Email Studio's frame: links to a view of Email Studio.
 *
 * It tells the Marketing Cloud page around the frame which view is open, so that
 * deep-link-shell.js can keep it in the address, writes the same into the address of this frame,
 * which the Marketing Cloud page copies into its own, and it opens the view that such an address
 * asked for. What is open it learns from deep-link-email-studio-page.js, the extension's script
 * in the page of this frame, which also sets the route.
 *
 * The Marketing Cloud page owns the link: this script asks it for the view to open and never
 * follows the address of its own frame. A link names a route of Email Studio only, never the
 * address of a page, and this script loads no address into anything. It asks nothing of
 * Marketing Cloud and changes nothing in it. Only Email Studio's own document, directly below
 * the Marketing Cloud page, talks to that page.
 */
(() => {
    'use strict';

    // Email Studio opened by itself has no page around it, and a frame further down is not
    // Email Studio's own
    if (top === globalThis || parent !== top) {
        return;
    }

    // what is asked of and told to the Marketing Cloud page, passed on by background.js
    const WANTED_MESSAGE = 'sfmc-ux-tools:deep-link:email-wanted';
    const SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:email-shown';
    // what deep-link-email-studio-page.js tells and is asked, as events of the document whose
    // detail is one text
    const STATE_EVENT = 'sfmc-ux-tools:email-studio:state';
    const GO_EVENT = 'sfmc-ux-tools:email-studio:go';
    // the one text of that script that says nothing about a view: Email Studio is up
    const UP = 'up';
    // what the page's script tells when Email Studio starts to listen for changes of what is open
    const READY = 'ready';
    // the field of the address that names the view: ux-tools=<mid>.r.<route with dots>
    const FIELD = 'ux-tools=';
    // what a link names: r for a route of Email Studio
    const ROUTE_KIND = 'r';
    // the views that Email Studio was seen to write into its state, as kind/thing, and the route
    // that opens each: an open data extension, a folder of data extensions. Seen live: the route
    // of a folder of lists opened another list than the link's, so that view gets no link
    const VIEWS = new Map([
        ['de-pages/de', 'Subscribers/customobject'],
        ['de-grid/dataextension', 'Subscribers/CustomObjects'],
    ]);
    const ROUTES = new Set(VIEWS.values());
    // the longest id that is taken for one: as long as an id of 32 hex digits with its four
    // hyphens; and the longest id of a business unit: as many digits as a whole number holds
    // exactly
    const MOST_ID = 36;
    const ID = new RegExp(String.raw`^[\dA-Fa-f][\dA-Fa-f-]{0,${MOST_ID - 1}}$`);
    const MOST_DIGITS = 15;
    const MID = new RegExp(String.raw`^\d{1,${MOST_DIGITS}}$`);
    // how many parts a view has as the page's script describes it (kind, thing, id), and as a
    // link names it (r, section, kind of thing, id)
    const DESCRIPTION_PARTS = 3;
    const TARGET_PARTS = 4;
    // milliseconds in which several writes to Email Studio's state count as one change: a view
    // among them is what is open, whatever else was written around it
    const RECORD_DELAY = 250;
    // seen live: a route that is set while Email Studio starts is swallowed, or its view is shown
    // for a moment and then covered by the first list of the section. So the route of a link is
    // set once, when Email Studio first says that it listens, and again only when Email Studio
    // itself says that it shows something else, or drops the route from its address without
    // showing the view: at most this many times in all. Nothing is done on a clock, so a slow
    // computer or network only makes it later, never wrong. The link is kept up until whoever
    // looks at the page clicks or types in it, or the tries are used up
    const MOST_TRIES = 6;

    /**
     * Turns what the page's script says is open into what a link names.
     *
     * @param {unknown} description the view as kind/thing/id
     * @returns {string|null} r.<section>.<kind of thing>.<id>; null for anything that has no route
     */
    function targetOf(description) {
        if (typeof description !== 'string') {
            return null;
        }
        const parts = description.split('/');
        const route = VIEWS.get(`${parts[0]}/${parts[1]}`);
        return route === undefined || parts.length !== DESCRIPTION_PARTS || !ID.test(parts[2])
            ? null
            : `${ROUTE_KIND}.${route.replace('/', '.')}.${parts[2]}`;
    }

    /**
     * Turns what a link names into the route of Email Studio that opens it.
     *
     * @param {unknown} target r.<section>.<kind of thing>.<id>
     * @returns {string|undefined} the route, without a slash at its end; nothing unless it is one that Email Studio answers by writing the view into its state
     */
    function routeOf(target) {
        if (typeof target !== 'string') {
            return;
        }
        const parts = target.split('.');
        const route = `${parts[1]}/${parts[2]}`;
        const isKnown =
            parts.length === TARGET_PARTS &&
            parts[0] === ROUTE_KIND &&
            ROUTES.has(route) &&
            ID.test(parts[3]);
        return isKnown ? `${route}/${parts[3]}` : undefined;
    }

    /**
     * Writes the query of this frame's address with or without the field that names the view.
     *
     * @param {string} search the query as it is, from the ?
     * @param {string|null} parameter business unit and view; null for none
     * @returns {string} the query, from the ?; empty when nothing is left
     */
    function withParameter(search, parameter) {
        const fields = search
            .replace(/^\?/, '')
            .split('&')
            .filter((item) => item !== '' && !item.startsWith(FIELD));
        if (parameter !== null) {
            fields.push(`${FIELD}${parameter}`);
        }
        return fields.length === 0 ? '' : `?${fields.join('&')}`;
    }

    // what the script hands out: its functions that only compute, for the tests
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call the functions by themselves, which nothing else of this script lets them
    globalThis.sfmcUxToolsDeepLinkEmailStudio = { targetOf, routeOf, withParameter };

    // true from the start until the link was followed, given up, or there was none: meanwhile
    // nothing is told, so that the section Email Studio starts with cannot take the link out of
    // the address
    let isFollowing = true;
    // the view of the link while it is followed
    let awaited;
    // while a link is followed: its route, what Email Studio wrote last (null for no view), and
    // how often the route was set
    let route;
    let latest = null;
    let tries = 0;
    // whether Email Studio listens for changes of what is open, so that a route gets drawn
    let isListening = false;
    // the wait for Email Studio's start, which its script ends by saying that it is up
    const starting = Promise.withResolvers();
    // the view that is open, as a link names it; null for none
    let open = null;
    // the same of the writes that are counted as one change, and the end of that count
    let counted = null;
    let counting;
    // the view that was told last; nothing before the first time
    let told;

    /**
     * Sends a message to the Marketing Cloud page. It never throws.
     *
     * @param {object} message what to send
     * @returns {Promise.<object|undefined>} the answer; nothing when there is none
     */
    async function send(message) {
        try {
            return await chrome.runtime.sendMessage(message);
        } catch {
            // the extension was updated or switched off under this page
        }
    }

    /**
     * Writes the field that names the view into this frame's address, or takes it out, without
     * loading or routing anything.
     *
     * @param {string|null} parameter business unit and view; null for none
     */
    function mark(parameter) {
        const search = withParameter(location.search, parameter);
        if (search !== location.search) {
            history.replaceState(history.state, '', location.pathname + search + location.hash);
        }
    }

    /**
     * Tells the Marketing Cloud page which view is open, when that changed, and writes what
     * that page wrote into its address into this frame's address too.
     */
    async function tell() {
        const view = open;
        if (view === told) {
            return;
        }
        told = view;
        if (view === null) {
            // no need to wait for the business unit to take the field out
            mark(null);
        }
        const answer = await send({ type: SHOWN_MESSAGE, target: view });
        // meanwhile another view may be open
        if (told !== view || view === null) {
            return;
        }
        const parameter = answer?.parameter;
        const mid = typeof parameter === 'string' ? parameter.slice(0, -view.length - 1) : '';
        // only the business unit before the view that was told is taken from the answer
        mark(MID.test(mid) && parameter === `${mid}.${view}` ? parameter : null);
    }

    /**
     * Ends the following of a link: from now on, what is open is told.
     */
    function endFollowing() {
        isFollowing = false;
        awaited = undefined;
        if (counting === undefined) {
            tell();
        }
    }

    /**
     * Takes the writes that were counted as one change for what is open now.
     */
    function count() {
        counting = undefined;
        open = counted;
        if (!isFollowing) {
            tell();
        } else if (isListening && open !== awaited && tries > 0) {
            // Email Studio put something else in place of the view of the link
            setRoute();
        }
    }

    /**
     * Sets the route of the link that is followed, unless that was done often enough.
     */
    function setRoute() {
        if (tries >= MOST_TRIES) {
            endFollowing();
            return;
        }
        tries++;
        document.dispatchEvent(new CustomEvent(GO_EVENT, { detail: route }));
    }

    document.addEventListener(STATE_EVENT, (event) => {
        if (typeof event.detail !== 'string') {
            return;
        }
        if (event.detail === READY) {
            // seen live: a route that is set before this is taken into the state but not drawn,
            // or leaves Email Studio empty. And for each route Email Studio builds its page
            // anew, whose parts then say again that they listen: only the first time counts
            const isFirst = !isListening;
            isListening = true;
            if (isFirst && isFollowing && route !== undefined) {
                setRoute();
            }
            return;
        }
        if (event.detail === UP) {
            // seen live: a route that is set before this is taken into the state but never drawn
            starting.resolve();
            return;
        }
        const view = targetOf(event.detail);
        if (view !== null || counting === undefined) {
            counted = view;
        }
        counting ??= setTimeout(count, RECORD_DELAY);
        if (isFollowing) {
            latest = view;
        }
    });

    // Email Studio takes a route out of its address again, whether it showed the view or not.
    // If it did not, the route is set once more
    addEventListener('hashchange', () => {
        if (isFollowing && latest !== awaited && tries > 0 && location.hash !== `#${route}`) {
            setRoute();
        }
    });

    /**
     * Asks the Marketing Cloud page for the view of a link and opens it. Its route is set when
     * Email Studio first says that it listens; if it said so before the answer came, the route
     * is set here, once Email Studio is up.
     */
    async function follow() {
        const answer = await send({ type: WANTED_MESSAGE });
        route = routeOf(answer?.target);
        if (route === undefined) {
            endFollowing();
            return;
        }
        awaited = answer.target;
        await starting.promise;
        // the link came after Email Studio began to listen: its route is set now
        // not for whoever clicked or typed meanwhile: they go their own way
        if (isFollowing && isListening && tries === 0) {
            setRoute();
        }
    }

    // whoever clicks or types in Email Studio while a link is still followed goes their own
    // way: the link must not pull them back
    for (const type of ['pointerdown', 'keydown']) {
        addEventListener(
            type,
            (event) => {
                if (isFollowing && event.isTrusted) {
                    endFollowing();
                }
            },
            true,
        );
    }

    follow();
})();
