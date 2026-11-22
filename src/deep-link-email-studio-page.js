/*
 * SFMC UX Tools — script in the page of Email Studio's frame: links to a view of Email Studio.
 *
 * Email Studio keeps what it shows in its own state, which only a script of the page itself can
 * see. This script tells deep-link-email-studio.js, the extension's script in the same frame,
 * what Email Studio shows, as one short text per change, and sets the route of Email Studio when
 * that script asks for it.
 *
 * It reads the state where Email Studio writes it, after Email Studio's own function has run and
 * with that function's result, and it never passes on anything of Email Studio but that text. It
 * only ever sets the route of this frame, and only to one of the routes listed here with an id
 * of digits, or of hex digits and hyphens. It asks nothing of Marketing Cloud.
 */
(() => {
    'use strict';

    // what is told to and asked by deep-link-email-studio.js, as events of the document whose
    // detail is one text
    const STATE_EVENT = 'sfmc-ux-tools:email-studio:state';
    const GO_EVENT = 'sfmc-ux-tools:email-studio:go';
    // the three texts that name no view: Email Studio is up; a part of Email Studio starts to
    // listen for changes of what is open, under the name below, so that from then on a view that
    // is written into the state gets drawn; and nothing more specific than a section is open
    const UP = 'up';
    const READY = 'ready';
    const OPEN_CHANGES = 'change:carbonContent';
    const NOTHING = 'none';
    // the name under which Email Studio's script loader holds the library that keeps its state
    const LIBRARY = 'backbone';
    // the routes of Email Studio that open one thing by its id, read from its own script: the
    // section, the kind of thing, then the id
    const ROUTES = new Set([
        'Subscribers/customobject',
        'Subscribers/CustomObjects',
        'Subscribers/list',
        'Subscribers/lists',
        'Subscribers/group',
        'Subscribers/groups',
        'Subscribers/filters',
        'Content/email',
        'Content/template',
        'Content/contentarea',
        'Content2/email',
        'Content2/asset',
        'Tracking/send',
        'Tracking/sends',
        'Tracking/report',
        'Tracking/reports',
    ]);
    // the longest id that is taken for one: as long as an id of 32 hex digits with its four
    // hyphens
    const MOST_ID = 36;
    const ID = new RegExp(String.raw`^[\dA-Fa-f][\dA-Fa-f-]{0,${MOST_ID - 1}}$`);
    // the longest name of a kind of view that is passed on
    const MOST_LETTERS = 30;
    const KIND = new RegExp(String.raw`^[A-Za-z\d-]{1,${MOST_LETTERS}}$`);
    // how many parts a route to one thing has: section, kind of thing, id
    const ROUTE_PARTS = 3;

    /**
     * Says whether a value is an object with fields.
     *
     * @param {unknown} value the value
     * @returns {boolean} true when it is
     */
    const isRecord = (value) => typeof value === 'object' && value !== null;

    /**
     * Reads an id that Email Studio may hold as a number or as text.
     *
     * @param {unknown} value what its state holds
     * @returns {string|undefined} the id as text; nothing when it is none
     */
    function idOf(value) {
        const text = typeof value === 'number' ? String(value) : value;
        return typeof text === 'string' && ID.test(text) ? text : undefined;
    }

    /**
     * Says whether a text is one of the listed routes with an id, and nothing else.
     *
     * @param {unknown} route what was asked for
     * @returns {boolean} true when it is
     */
    function isRoute(route) {
        if (typeof route !== 'string') {
            return false;
        }
        const parts = route.split('/');
        return (
            parts.length === ROUTE_PARTS &&
            ROUTES.has(`${parts[0]}/${parts[1]}`) &&
            ID.test(parts[2])
        );
    }

    /**
     * Describes what a write to Email Studio's state says about the view that is open.
     *
     * @param {unknown} written the fields that were written
     * @returns {string|undefined} the kind of view, of thing and its id, as kind/thing/id; "none" when nothing more specific than a section is open; nothing when the write says nothing about it
     */
    function describe(written) {
        if (!isRecord(written)) {
            return;
        }
        if (Object.hasOwn(written, 'carbonContent')) {
            const view = written.carbonContent;
            if (!isRecord(view)) {
                // a page of the older kind, which has no route
                return NOTHING;
            }
            // one thing by its id, or a list by the id of its folder
            const id = idOf(view.id) ?? idOf(view.categoryId);
            const isKnown =
                typeof view.content === 'string' &&
                KIND.test(view.content) &&
                typeof view.object === 'string' &&
                KIND.test(view.object) &&
                id !== undefined;
            return isKnown ? `${view.content}/${view.object}/${id}` : NOTHING;
        }
        // a choice in the menu alone opens a section
        if (Object.hasOwn(written, 'curNavItem') || Object.hasOwn(written, 'curSubNavItem')) {
            return NOTHING;
        }
    }

    /**
     * Tells the extension's script one text.
     *
     * @param {string} text what to tell
     */
    function tell(text) {
        document.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: text }));
    }

    // the state that holds what is open, and Email Studio's own function to write to it
    let state;
    let original;
    // the two places in which Email Studio draws a view that has a route
    const DRAWN_IN = ['#carbon-legacy-dynamic', '#carbon-dynamic'];

    /**
     * Says whether a write names a field, written as set({field: value}) or set('field', value).
     *
     * @param {unknown[]} written what was passed to the function
     * @param {string} field the name of the field
     * @returns {boolean} true when it does
     */
    function hasField(written, field) {
        const [first] = written;
        return first === field || (isRecord(first) && Object.hasOwn(first, field));
    }

    /**
     * Makes Email Studio forget, without telling its views, the view it took into its state but
     * did not draw. Seen live: writing the same view again changes nothing for it, so the route
     * of a link would never be drawn after a first try that came too early.
     */
    function forgetUndrawn() {
        const isDrawn = DRAWN_IN.some(
            (place) => (document.querySelector(place)?.childElementCount ?? 0) > 0,
        );
        if (!isDrawn && state !== undefined && original !== undefined) {
            original.call(state, { carbonContent: null }, { silent: true });
        }
    }

    /**
     * Makes the library tell this script each write to a state, and each time a part of Email
     * Studio starts to listen for changes of what is open. Email Studio's own function runs
     * first and its result is handed back; whatever this script does after it cannot reach
     * Email Studio.
     *
     * @param {{Model: {prototype: {set: (...written: unknown[]) => unknown}}}} library the library that keeps Email Studio's state
     */
    function watch(library) {
        // Email Studio's views say that they listen under one of two names of the same function
        for (const name of ['on', 'bind']) {
            const listen = library.Model.prototype[name];
            if (typeof listen !== 'function') {
                continue;
            }
            /**
             * Listens to a state as Email Studio's own function does, and tells when that is
             * for changes of what is open.
             *
             * @param {...unknown} given what Email Studio passes: what to listen for, and who listens
             * @returns {unknown} what Email Studio's own function returned
             */
            library.Model.prototype[name] = function (...given) {
                // eslint-disable-next-line unicorn/no-this-outside-of-class -- this function stands in for a method of Email Studio's library, which must run with the state it was called on
                const result = listen.apply(this, given);
                try {
                    if (typeof given[0] === 'string' && given[0].includes(OPEN_CHANGES)) {
                        tell(READY);
                    }
                } catch {
                    // nothing of this script may break Email Studio
                }
                return result;
            };
        }
        const set = library.Model.prototype.set;
        /**
         * Writes to a state as Email Studio's own function does, and tells what that says.
         *
         * @param {...unknown} written what Email Studio writes: fields, or the name of one and its value, and how
         * @returns {unknown} what Email Studio's own function returned
         */
        library.Model.prototype.set = function (...written) {
            // eslint-disable-next-line unicorn/no-this-outside-of-class -- this function stands in for a method of Email Studio's library, which must run with the state it was called on
            const result = set.apply(this, written);
            try {
                if (hasField(written, 'carbonContent')) {
                    // the state that holds what is open: kept for a view that was not drawn
                    // eslint-disable-next-line unicorn/no-this-outside-of-class, unicorn/no-this-assignment -- the state is known only as the object Email Studio's function was called on
                    state = this;
                    original = set;
                }
                // written as set({field: value}) or as set('field', value)
                const [first, second] = written;
                const text = describe(typeof first === 'string' ? { [first]: second } : first);
                if (text !== undefined) {
                    tell(text);
                }
            } catch {
                // nothing of this script may break Email Studio
            }
            return result;
        };
    }

    // whether the library was taken from the loader already, and whether the start was told
    let isTaken = false;
    let isUpTold = false;

    /**
     * Tells once that Email Studio has started to read its routes.
     */
    function tellUp() {
        if (isUpTold) {
            return;
        }

        isUpTold = true;
        tell(UP);
    }

    /**
     * Takes the library: watches its writes, and tells when Email Studio starts to read its
     * routes, which the library does in one call. If that call was made already, it is told now.
     *
     * @param {object} library the library that keeps Email Studio's state
     */
    function take(library) {
        try {
            if (typeof library?.Model?.prototype?.set !== 'function') {
                return;
            }
            watch(library);
            const history = library.history;
            if (library.History?.started === true) {
                tellUp();
            } else if (typeof history?.start === 'function') {
                const start = history.start;
                /**
                 * Starts to read the routes as the library's own function does, and tells so.
                 *
                 * @param {...unknown} given what Email Studio passes
                 * @returns {unknown} what the library's own function returned
                 */
                history.start = function (...given) {
                    // eslint-disable-next-line unicorn/no-this-outside-of-class -- this function stands in for a method of Email Studio's library, which must run with the object it was called on
                    const result = start.apply(this, given);
                    tellUp();
                    return result;
                };
            }
        } catch {
            // nothing of this script may break Email Studio
        }
    }

    // whether the loader's own notice of loaded scripts is listened to
    let isHooked = false;

    /**
     * Takes the library once Email Studio's script loader holds it. Seen live: asking the loader
     * to load the library, before Email Studio has told it where its scripts are, stops Email
     * Studio from starting. So the loader is only asked what it has already, and listened to: it
     * says so each time it has loaded a script.
     */
    function look() {
        if (isTaken) {
            return;
        }
        try {
            const load = globalThis.require;
            if (typeof load !== 'function' || typeof load.defined !== 'function') {
                return;
            }
            if (!isHooked) {
                isHooked = true;
                const loader = globalThis.requirejs ?? load;
                const told = loader.onResourceLoad;
                /**
                 * Looks for the library, then lets whoever listened before hear the notice.
                 *
                 * @param {...unknown} given what the loader passes
                 * @returns {unknown} what the listener before returned; nothing when there was none
                 */
                loader.onResourceLoad = function (...given) {
                    try {
                        look();
                    } catch {
                        // nothing of this script may break Email Studio
                    }
                    // eslint-disable-next-line unicorn/no-this-outside-of-class -- this function stands in for one of the loader, which must run with the object it was called on
                    return typeof told === 'function' ? told.apply(this, given) : undefined;
                };
            }
            if (load.defined(LIBRARY)) {
                isTaken = true;
                // handed out at once: the loader has it already
                take(load(LIBRARY));
            }
        } catch {
            // a page whose loader is another one
        }
    }

    // the loader comes with one of the page's scripts: looked for whenever one was loaded
    document.addEventListener('load', look, { capture: true });
    document.addEventListener('DOMContentLoaded', look);
    addEventListener('load', look);

    document.addEventListener(GO_EVENT, (event) => {
        if (!isRoute(event.detail)) {
            return;
        }
        try {
            forgetUndrawn();
        } catch {
            // nothing of this script may break Email Studio
        }
        // a hash that is the route already would make setting it change nothing: Email Studio
        // only acts on a change. Its section is set this time, the route with the next try
        location.hash =
            location.hash === `#${event.detail}` ? event.detail.split('/', 1)[0] : event.detail;
    });
    look();
})();
