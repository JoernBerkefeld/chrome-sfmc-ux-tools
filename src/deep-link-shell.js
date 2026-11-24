/*
 * SFMC UX Tools — content script for the Marketing Cloud page around the apps: links to an asset
 * of Content Builder, to a view of Email Studio and to a route of Contact Builder.
 *
 * Content Builder's address never changes while one moves through it, so nobody can send a link
 * to an asset. This script keeps the business unit and the id of the asset that Content Builder
 * shows in the address, as #app/Content%20Builder/ux-tools/<mid>/asset/<id>, and hands the id of
 * such an address to Content Builder's frame, where deep-link-content-builder.js opens the asset.
 * Without the extension such an address opens Content Builder as any other.
 *
 * Email Studio's address names a view, but does not open it. For Email Studio the script keeps
 * one more field in the address, ux-tools=<mid>.r.<route with dots>, and hands its route to
 * Email Studio's frame, where deep-link-email-studio.js opens the view. This script owns the
 * link: the frame asks for it and never follows its own address.
 *
 * Contact Builder's address on this page does not follow what is opened in it, though the page
 * opens a route of Contact Builder that its address names. So the script writes the route that
 * deep-link-contact-builder.js tells from Contact Builder's frame into the address, in the page's
 * own form: #app/Contact%20Builder/contactsmeta/admin.html?ux-tools=<mid>%23<route>. Without the
 * extension such an address opens the same route. Nothing is handed to that frame.
 *
 * Seen live: neither Content Builder nor Contact Builder adds an entry to the browser's history
 * for what the user opens. So in these two apps the script adds one itself, when the user opened
 * something else than the address names: the browser's Back and Forward then step through what
 * was opened. Everything else is written over the entry that is there. On such a step the script
 * never writes the address back.
 *
 * Seen live: left to Marketing Cloud, a step to an entry with an asset loads Content Builder's
 * frame anew, which adds an entry that the browser's Back cannot pass, and a step to a route of
 * Contact Builder makes Marketing Cloud move that frame, which removes the entries after it. So
 * the script shows such an entry itself and keeps the step from Marketing Cloud's own router:
 * it asks Content Builder's frame to open the asset, or to close the open one for the plain
 * address, and Contact Builder's frame to show the route. It does so only within one app whose
 * frame has told what it shows, and for a link only when its business unit is the one that was
 * read last. Any other step is left to Marketing Cloud, and its link is decided as ever. Email
 * Studio is left out of this: it adds entries of its own.
 *
 * Seen live: Contact Builder's tabs are links of this page, and the one that is chosen is marked
 * by a class. A step that is kept from Marketing Cloud's router would leave the tab of the route
 * before marked. So the script remembers, for each route that Contact Builder's frame tells,
 * which tab is marked then, and marks that tab itself on such a step. A route it has not seen
 * leaves the tabs as they are. Nothing of this is kept beyond the visit of the page.
 *
 * Seen live: Contact Builder goes back in the browser's history when it is given a route to a
 * data extension that the business unit the user is in does not have, and the page with the
 * dialog is gone. So a link into Contact Builder whose business unit is not known to be the one
 * the user is in has its route taken out of the address before the page reads it: Contact Builder
 * opens its start page, and the route is opened only once the business unit was read and is the
 * right one, by loading the page again with the link. For that the script keeps the id of the
 * business unit it read last in the page's local storage, and a pass for that one link in the
 * tab's session storage.
 *
 * A link of another business unit is not followed. Its own dialog says which business unit the
 * link belongs to and offers to switch to it; nothing switches without the click. The dialog comes
 * as soon as the business unit the user is in is known, by the API or by the page's own header,
 * and it stays over the greyed-out page until the user picks one of its buttons. For a business
 * unit that the account does not have, it says so, with the name under which this browser has
 * seen that business unit before: the script keeps the ids and names of the business units of
 * each account it ran in, in the extension's storage on this computer.
 *
 * It only ever writes the address of this page, only while that address is the one of the app
 * that told what it shows, and only with ids made of digits and a route of a fixed form. It reads the business units through Marketing Cloud's API and
 * changes nothing in Marketing Cloud.
 */
(() => {
    'use strict';

    // said in the dialog, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const NAME = 'sfmc-ux-tools-deep-link';
    // what Content Builder's frame asks and tells, passed on by background.js
    const WANTED_MESSAGE = 'sfmc-ux-tools:deep-link:wanted';
    const SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:shown';
    // the same two of Email Studio's frame
    const EMAIL_WANTED_MESSAGE = 'sfmc-ux-tools:deep-link:email-wanted';
    const EMAIL_SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:email-shown';
    // what Contact Builder's frame tells: the route it shows. It asks nothing
    const CONTACT_SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:contact-shown';
    // what this page asks of Content Builder's frame, passed on by background.js: to close the
    // asset that is open, and to open one
    const CLOSE_MESSAGE = 'sfmc-ux-tools:deep-link:close';
    const OPEN_MESSAGE = 'sfmc-ux-tools:deep-link:open';
    // and of Contact Builder's frame: to show a route
    const CONTACT_OPEN_MESSAGE = 'sfmc-ux-tools:deep-link:contact-open';
    // the three apps a link can lead into
    const CONTENT_BUILDER = 'content-builder';
    const EMAIL_STUDIO = 'email-studio';
    const CONTACT_BUILDER = 'contact-builder';
    // the apps in which the browser's Back and Forward step through what was opened: seen live,
    // these two add no entries of their own to the browser's history. Email Studio does
    const STEPPED = [CONTENT_BUILDER, CONTACT_BUILDER];
    // what a person does on the page that may open something: a click, a key
    const INPUTS = ['pointerdown', 'keydown'];
    // how the browser names a step through its history, by Back or Forward
    const TRAVERSE = 'traverse';
    // the longest id that is taken for one: as many digits as a whole number holds exactly
    const MOST_DIGITS = 15;
    // Content Builder's route on this page, as the page writes it and as a person may type it
    const APP = '#app/Content(?:%20| )Builder';
    const APP_ADDRESS = '#app/Content%20Builder/';
    // what this script adds to that route for an asset: ux-tools/<mid>/asset/<id>
    const MARKER = 'ux-tools/';
    const ASSET = '/asset/';
    const DIGITS = String.raw`\d{1,${MOST_DIGITS}}`;
    const ID = new RegExp(`^${DIGITS}$`);
    const ANY_ROUTE = new RegExp(`^${APP}(?:/|$)`);
    const PLAIN_ROUTE = new RegExp(`^${APP}/?$`);
    const ASSET_ROUTE = new RegExp(`^${APP}/${MARKER}(${DIGITS})${ASSET}(${DIGITS})/?$`);
    // Email Studio's route on this page, and the one that holds the address of its frame: seen
    // live, the page keeps that address's path and query there and, after %23, the route inside
    // Email Studio
    const EMAIL_APP = '#app/Email';
    const EMAIL_ANY_ROUTE = new RegExp(`^${EMAIL_APP}(?:/|$)`);
    const EMAIL_PAGE = `${EMAIL_APP}/C12/Default.aspx`;
    // the query Email Studio's address has when the page opens it by itself
    const EMAIL_START_QUERY = 'entityType=none&entityID=0&ks=ks';
    // the field of this page's query that hands it an address to open, and what that address is
    // marked with before its base64 form
    const ARRIVAL_FIELD = 'hash';
    const ARRIVAL_MARK = 'logged-in';
    // where the route inside Email Studio starts
    const INNER_ROUTE = /%23|#/;
    // the field this script adds to that query for a view: ux-tools=<mid>.r.<route with dots>
    const FIELD = 'ux-tools=';
    // the longest name of a part of a route inside Email Studio that is taken for one, and the
    // longest id in it: as long as an id of 32 hex digits with its four hyphens
    const MOST_LETTERS = 30;
    const MOST_ROUTE_ID = 36;
    const WORD = String.raw`[A-Za-z\d]{1,${MOST_LETTERS}}`;
    // what a link names in Email Studio: r for a route, its two names and an id of digits, or
    // of hex digits and hyphens
    const TARGET = String.raw`r\.${WORD}\.${WORD}\.[\dA-Fa-f][\dA-Fa-f-]{0,${MOST_ROUTE_ID - 1}}`;
    const EMAIL_TARGET = new RegExp(`^${TARGET}$`);
    const EMAIL_FIELD = new RegExp(String.raw`^${FIELD}(${DIGITS})\.(${TARGET})$`);
    // Contact Builder's route on this page, as the page writes it and as a person may type it
    const CONTACT_APP = '#app/Contact(?:%20| )Builder';
    const CONTACT_ADDRESS = '#app/Contact%20Builder';
    // the address of Contact Builder's frame, which the page takes from its own address: seen
    // live, without it the page stays blank
    const CONTACT_PAGE = '/contactsmeta/admin.html';
    const CONTACT_PAGE_PATTERN = String.raw`/contactsmeta/admin\.html`;
    // the longest route inside Contact Builder that is taken for one
    const MOST_ROUTE = 200;
    // such a route: letters, digits, and the four signs seen in Contact Builder's routes
    const ROUTE = String.raw`[A-Za-z\d/_.-]{1,${MOST_ROUTE}}`;
    const CONTACT_ROUTE = new RegExp(`^${ROUTE}$`);
    // Contact Builder's tabs on this page, one of these each, and the class that the chosen one
    // and elements inside it have
    const TAB = 'div.top-level-nav-item-wrapper';
    const SELECTED = 'selected';
    const CONTACT_ANY_ROUTE = new RegExp(`^${CONTACT_APP}(?:/|$)`);
    const CONTACT_PLAIN_ROUTE = new RegExp(`^${CONTACT_APP}/?$`);
    // a link into Contact Builder: the business unit as a field of the frame's address, seen live
    // to be passed on to the frame and to leave the route working, then the route after %23
    const CONTACT_LINK = new RegExp(
        String.raw`^${CONTACT_APP}${CONTACT_PAGE_PATTERN}\?${FIELD}(${DIGITS})(?:%23|#)(${ROUTE})$`,
    );
    // the path of this page, and of the page that switches the business unit and then opens the
    // address it was given
    const SHELL_PATH = '/cloud/';
    const SWITCH_PATH = '/cloud/context-switch.html';
    // seen live: the page that switches the business unit opens the app but drops what followed
    // the app in the address. The link is kept under this name in the tab's session storage for
    // the switch, and taken out again by the page that opens after it
    const CARRIED = 'sfmcUxToolsDeepLink';
    const CARRIED_LINK = new RegExp(
        `^(${CONTENT_BUILDER}|${EMAIL_STUDIO}|${CONTACT_BUILDER})/(${DIGITS})/(.+)$`,
    );

    // where the id of the business unit that was read last is kept, in the page's local storage
    const LAST_UNIT = 'sfmcUxToolsBusinessUnit';
    // where the one link into Contact Builder that may be opened as it is, because its business
    // unit was just read to be the right one, is kept in the tab's session storage for the one
    // load of the page that opens it
    const PASS = 'sfmcUxToolsDeepLinkPass';

    /**
     * Writes a link as one text, by which two links are told apart.
     *
     * @param {{app: string, mid: string, what: string}|null} link the link
     * @returns {string|null} the text; null for no link
     */
    const keyOf = (link) => (link ? `${link.app}/${link.mid}/${link.what}` : null);

    /**
     * Keeps a link for the page that opens after the business unit was switched.
     *
     * @param {{app: string, mid: string, what: string}} link the link
     */
    function carry(link) {
        try {
            sessionStorage.setItem(CARRIED, keyOf(link));
        } catch {
            // no session storage: the switch still happens, the link is not followed
        }
    }

    /**
     * Takes out the link that was kept before a switch of the business unit.
     *
     * @returns {{app: string, mid: string, what: string}|null} the link; null when none was kept
     */
    function carried() {
        try {
            const kept = sessionStorage.getItem(CARRIED);
            sessionStorage.removeItem(CARRIED);
            const found = CARRIED_LINK.exec(kept ?? '');
            if (!found) {
                return null;
            }
            const [, app, mid, what] = found;
            return isWhole(app, what) ? { app, mid, what } : null;
        } catch {
            return null;
        }
    }
    // where this page passes calls on to the REST API, for the business units of the account
    const ACCOUNTS = '/cloud/fuelapi/platform-internal/v1/accounts';
    // how many business units are asked for at once, and how many such pages are read at most
    const PAGE_SIZE = 50;
    const MOST_PAGES = 20;
    // where the business units this browser has seen are kept, in chrome.storage.local; the
    // options page removes it by the same name
    const MEMORY_KEY = 'deepLinkBusinessUnits';
    // where the page's header shows the business unit the user is in, as "MID: <id> <name>", and
    // its name alone; seen live, the page draws them some time after it was loaded
    const HEADER = '.mc-account-switcher-current-account-details';
    const HEADER_NAME = '.mc-account-switcher-current-account-name';
    const HEADER_MID = new RegExp(String.raw`MID:\s*(${DIGITS})(?!\d)(.*)`, 's');
    // milliseconds after which the business unit the user is in counts as unknown
    const CURRENT_WAIT = 10_000;

    /**
     * Says whether a value is an id as this script takes it: text of digits only.
     *
     * @param {unknown} value what an address or a message holds
     * @returns {boolean} true when it is
     */
    const isId = (value) => typeof value === 'string' && ID.test(value);
    /**
     * Reads an id that the API may write as a number or as text.
     *
     * @param {unknown} value what the API returned
     * @returns {string|undefined} the id as text of digits; nothing when it is none
     */
    const digits = (value) => {
        const text = typeof value === 'number' ? String(value) : value;
        return isId(text) ? text : undefined;
    };
    /**
     * Says whether a value is an object with fields, as the storage and the API hand them out.
     *
     * @param {unknown} value the value
     * @returns {boolean} true when it is
     */
    const isRecord = (value) =>
        typeof value === 'object' && value !== null && !Array.isArray(value);

    /**
     * Says whether the route of this page is Content Builder's, whatever follows it.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {boolean} true for Content Builder, false for any other app
     */
    function isContentBuilderHash(hash) {
        return typeof hash === 'string' && ANY_ROUTE.test(hash);
    }

    /**
     * Reads the business unit and the asset that an address asks for.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {{mid: string, asset: string}|null} both ids; null when the address names no asset
     */
    function parse(hash) {
        const found = typeof hash === 'string' ? ASSET_ROUTE.exec(hash) : null;
        return found ? { mid: found[1], asset: found[2] } : null;
    }

    /**
     * Writes the address of Content Builder, with or without an asset.
     *
     * @param {string} pathname path of this page
     * @param {string} search what follows the path, from the ?
     * @param {unknown} mid id of the business unit of the asset
     * @param {unknown} id id of the asset; unless both are ids, the address is Content Builder's own
     * @returns {string} the address, from the path on
     */
    function address(pathname, search, mid, id) {
        const marker = isId(mid) && isId(id) ? `${MARKER}${mid}${ASSET}${id}` : '';
        return `${pathname}${search}${APP_ADDRESS}${marker}`;
    }

    /**
     * Writes the address that switches to a business unit and then opens an asset of it.
     *
     * @param {string} origin where this page is, up to its path
     * @param {string} mid id of the business unit
     * @param {string} asset id of the asset
     * @returns {string|undefined} the address; nothing unless both are ids
     */
    function switchAddress(origin, mid, asset) {
        if (!isId(mid) || !isId(asset)) {
            return;
        }
        // only to Content Builder itself: the page that switches the business unit drops what
        // follows the app in the address anyway; the link is kept for the page that opens there
        // (see carry)
        const target = origin + address(SHELL_PATH, '', mid, null);
        return `${origin}${SWITCH_PATH}?m=${mid}&h=${encodeURIComponent(target)}`;
    }

    /**
     * Says whether the route of this page is Email Studio's, whatever follows it.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {boolean} true for Email Studio, false for any other app
     */
    function isEmailHash(hash) {
        return typeof hash === 'string' && EMAIL_ANY_ROUTE.test(hash);
    }

    /**
     * Says whether a value names a view of Email Studio as a link does.
     *
     * @param {unknown} value what an address or a message holds
     * @returns {boolean} true when it does
     */
    const isTarget = (value) => typeof value === 'string' && EMAIL_TARGET.test(value);

    /**
     * Takes apart the route of this page that holds the address of Email Studio's frame.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {{fields: string[], route: string}|undefined} the fields of the query, and the route inside Email Studio as it is written; nothing for any other route
     */
    function emailParts(hash) {
        if (typeof hash !== 'string' || !hash.startsWith(EMAIL_PAGE)) {
            return;
        }
        const rest = hash.slice(EMAIL_PAGE.length);
        const cut = rest.search(INNER_ROUTE);
        const query = cut === -1 ? rest : rest.slice(0, cut);
        if (query !== '' && !query.startsWith('?')) {
            return;
        }
        return {
            fields: query.slice(1).split('&'),
            route: cut === -1 ? '' : rest.slice(cut),
        };
    }

    /**
     * Reads the business unit and the view of Email Studio that an address asks for.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {{mid: string, target: string}|null} both; null when the address names no view
     */
    function parseEmail(hash) {
        const field = emailParts(hash)?.fields.find((item) => item.startsWith(FIELD));
        const found = field === undefined ? null : EMAIL_FIELD.exec(field);
        return found ? { mid: found[1], target: found[2] } : null;
    }

    /**
     * Writes the address of Email Studio, with or without a view, and otherwise as it is.
     *
     * @param {string} pathname path of this page
     * @param {string} search what follows the path, from the ?
     * @param {unknown} hash the part of the address from the #, as it is now
     * @param {unknown} mid id of the business unit of the view
     * @param {unknown} target the view; unless both are what they should be, the address names none
     * @returns {string|undefined} the address, from the path on; nothing when the address is not Email Studio's
     */
    function emailAddress(pathname, search, hash, mid, target) {
        const parts = emailParts(hash);
        if (!parts) {
            return;
        }
        const fields = parts.fields.filter((item) => item !== '' && !item.startsWith(FIELD));
        if (isId(mid) && isTarget(target)) {
            fields.push(`${FIELD}${mid}.${target}`);
        }
        const query = fields.length === 0 ? '' : `?${fields.join('&')}`;
        return `${pathname}${search}${EMAIL_PAGE}${query}${parts.route}`;
    }

    /**
     * Writes the address that switches to a business unit and then opens a view of Email Studio.
     *
     * @param {string} origin where this page is, up to its path
     * @param {unknown} mid id of the business unit
     * @param {unknown} target the view
     * @returns {string|undefined} the address; nothing unless both are what they should be
     */
    function emailSwitchAddress(origin, mid, target) {
        if (!isId(mid) || !isTarget(target)) {
            return;
        }
        // seen live: the page that switches the business unit writes the ? of the address it is
        // given as %3F, and Email Studio then answers "not found". So it is only sent to Email
        // Studio itself; the link is kept for the page that opens there (see carry)
        const to = `${origin}${SHELL_PATH}${EMAIL_APP}`;
        return `${origin}${SWITCH_PATH}?m=${mid}&h=${encodeURIComponent(to)}`;
    }

    /**
     * Says whether the route of this page is Contact Builder's, whatever follows it.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {boolean} true for Contact Builder, false for any other app
     */
    function isContactBuilderHash(hash) {
        return typeof hash === 'string' && CONTACT_ANY_ROUTE.test(hash);
    }

    /**
     * Says whether a value is a route inside Contact Builder as this script takes it.
     *
     * @param {unknown} value what an address or a message holds
     * @returns {boolean} true when it is
     */
    const isRoute = (value) => typeof value === 'string' && CONTACT_ROUTE.test(value);

    /**
     * Reads the business unit and the route of Contact Builder that an address asks for.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {{mid: string, route: string}|null} both; null when the address names no business unit with a route
     */
    function parseContact(hash) {
        const found = typeof hash === 'string' ? CONTACT_LINK.exec(hash) : null;
        return found ? { mid: found[1], route: found[2] } : null;
    }

    /**
     * Writes the address of Contact Builder, with or without a route, in the page's own form.
     *
     * @param {string} pathname path of this page
     * @param {string} search what follows the path, from the ?
     * @param {unknown} mid id of the business unit of the route; unless it is an id, the address names the route alone
     * @param {unknown} route the route inside Contact Builder; unless it is one, the address is Contact Builder's own
     * @returns {string} the address, from the path on
     */
    function contactAddress(pathname, search, mid, route) {
        if (!isRoute(route)) {
            return `${pathname}${search}${CONTACT_ADDRESS}`;
        }
        const field = isId(mid) ? `?${FIELD}${mid}` : '';
        return `${pathname}${search}${CONTACT_ADDRESS}${CONTACT_PAGE}${field}%23${route}`;
    }

    /**
     * Writes the address that switches to a business unit and then opens Contact Builder.
     *
     * @param {string} origin where this page is, up to its path
     * @param {unknown} mid id of the business unit
     * @param {unknown} route the route inside Contact Builder
     * @returns {string|undefined} the address; nothing unless both are what they should be
     */
    function contactSwitchAddress(origin, mid, route) {
        if (!isId(mid) || !isRoute(route)) {
            return;
        }
        // only to Contact Builder itself, as for the other apps: the link is kept for the page
        // that opens there (see carry)
        const to = origin + contactAddress(SHELL_PATH, '', null, null);
        return `${origin}${SWITCH_PATH}?m=${mid}&h=${encodeURIComponent(to)}`;
    }

    /**
     * Says whether a value is what a link names in an app: an asset, a view or a route.
     *
     * @param {unknown} app the app
     * @param {unknown} what what an address or a message holds
     * @returns {boolean} true when it is; false also for an app that is none of the three
     */
    function isWhole(app, what) {
        if (app === CONTENT_BUILDER) {
            return isId(what);
        }
        if (app === EMAIL_STUDIO) {
            return isTarget(what);
        }
        return app === CONTACT_BUILDER && isRoute(what);
    }

    /**
     * Writes the address that switches to the business unit of a link and then opens its app.
     *
     * @param {string} origin where this page is, up to its path
     * @param {{app: string, mid: string, what: string}} link the link
     * @returns {string|undefined} the address; nothing unless the link is whole and into one of the three apps
     */
    function switchOf(origin, link) {
        if (link.app === CONTENT_BUILDER) {
            return switchAddress(origin, link.mid, link.what);
        }
        if (link.app === EMAIL_STUDIO) {
            return emailSwitchAddress(origin, link.mid, link.what);
        }
        if (link.app === CONTACT_BUILDER) {
            return contactSwitchAddress(origin, link.mid, link.what);
        }
    }

    /**
     * Reads the address that the page was handed to open by itself. Seen live: after a login or a
     * switch of the business unit the page is loaded as ?hash=logged-in<the address from the #,
     * in base64>, and writes that address itself a moment later, over whatever stands there.
     *
     * @param {string} search the query of this page, from the ?
     * @returns {string|null} that address, from the #; null when the page was not handed one
     */
    function arrival(search) {
        try {
            const handed = new URLSearchParams(search).get(ARRIVAL_FIELD);
            if (!handed?.startsWith(ARRIVAL_MARK)) {
                return null;
            }
            const hash = atob(handed.slice(ARRIVAL_MARK.length));
            return hash.startsWith('#') ? hash : null;
        } catch {
            // not what the page writes there
            return null;
        }
    }

    /**
     * Writes the query of this page with another address to open by itself.
     *
     * @param {string} search the query of this page, from the ?
     * @param {string} hash the address to open, from the #
     * @returns {string} the query, from the ?
     */
    function withArrival(search, hash) {
        const fields = new URLSearchParams(search);
        fields.set(ARRIVAL_FIELD, ARRIVAL_MARK + btoa(hash));
        return `?${fields}`;
    }

    /**
     * Writes the part of this page's address from the # that holds a link, for the app of that
     * link.
     *
     * @param {{app: string, mid: string, what: string}} link the link
     * @returns {string|undefined} that part of the address; nothing unless the link is whole
     */
    function landing(link) {
        if (link.app === CONTENT_BUILDER) {
            return isId(link.mid) && isId(link.what)
                ? address('', '', link.mid, link.what)
                : undefined;
        }
        if (link.app === CONTACT_BUILDER) {
            return isId(link.mid) && isRoute(link.what)
                ? contactAddress('', '', link.mid, link.what)
                : undefined;
        }
        if (link.app !== EMAIL_STUDIO || !isTarget(link.what)) {
            return;
        }
        // the section of Email Studio is the first name of the route
        const [, section] = link.what.split('.', 2);
        return emailAddress(
            '',
            '',
            `${EMAIL_PAGE}?${EMAIL_START_QUERY}%23${section}`,
            link.mid,
            link.what,
        );
    }

    /**
     * Reads the link that an address holds, into one of the three apps.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {{app: string, mid: string, what: string}|null} the app, the business unit and what to open there; null when the address is no link
     */
    function linkOf(hash) {
        const asset = parse(hash);
        if (asset) {
            return { app: CONTENT_BUILDER, mid: asset.mid, what: asset.asset };
        }
        const view = parseEmail(hash);
        if (view) {
            return { app: EMAIL_STUDIO, mid: view.mid, what: view.target };
        }
        const route = parseContact(hash);
        return route ? { app: CONTACT_BUILDER, mid: route.mid, what: route.route } : null;
    }

    /**
     * Tells which of the three apps the route of this page belongs to.
     *
     * @param {unknown} hash the part of the address from the #
     * @returns {string|undefined} the app; nothing for any other
     */
    function appOf(hash) {
        if (isContentBuilderHash(hash)) {
            return CONTENT_BUILDER;
        }
        if (isEmailHash(hash)) {
            return EMAIL_STUDIO;
        }
        return isContactBuilderHash(hash) ? CONTACT_BUILDER : undefined;
    }

    /**
     * Reads what this script takes of a business unit that the API described.
     *
     * @param {unknown} item what the API returned for it
     * @returns {{mid: string, name: string, parent: string|null, hasAccess: unknown}|undefined} its id, name and the id of the business unit above it; nothing when it has no id
     */
    function unit(item) {
        const mid = digits(item?.accountId);
        if (mid === undefined) {
            return;
        }
        return {
            mid,
            name: typeof item.name === 'string' ? item.name : '',
            parent: digits(item.parentId) ?? null,
            hasAccess: item.hasAccess,
        };
    }

    /**
     * Adds the business units of an account to those this browser has seen. It asks nothing and
     * stores nothing.
     *
     * @param {unknown} memory what was kept so far: {[id of the enterprise]: {name, units: {[id]: name}}}
     * @param {{mid: string, name: string, parent: string|null}[]} [units] the business units of the account
     * @param {{mid: string, parent: string|null}} [current] the business unit the user is in, for an account whose list does not name its enterprise
     * @returns {object|undefined} what to keep now; nothing when there is nothing to add
     */
    function merge(memory, units, current) {
        if (!Array.isArray(units) || units.length === 0) {
            return;
        }
        // the enterprise is the one business unit with none above it
        const top = units.find((item) => item.parent === null);
        const enterprise = top?.mid ?? current?.parent ?? current?.mid;
        if (!isId(enterprise)) {
            return;
        }
        const kept = isRecord(memory) ? memory : {};
        const old =
            Object.hasOwn(kept, enterprise) && isRecord(kept[enterprise]) ? kept[enterprise] : {};
        const entry = {
            name: top?.name || (typeof old.name === 'string' ? old.name : ''),
            units: { ...(isRecord(old.units) && old.units) },
        };
        for (const item of units) {
            if (item.name !== '') {
                entry.units[item.mid] = item.name;
            }
        }
        return { ...kept, [enterprise]: entry };
    }

    /**
     * Keeps the id of a business unit that was just read as the one the user is in.
     *
     * @param {{mid: string}} [found] the business unit; nothing when it could not be read
     * @returns {object|undefined} the same
     */
    function note(found) {
        if (isId(found?.mid)) {
            try {
                localStorage.setItem(LAST_UNIT, found.mid);
            } catch {
                // no local storage: a link into Contact Builder is then never known to be right
            }
        }
        return found;
    }

    /**
     * Reads the id of the business unit that was read last.
     *
     * @returns {string|undefined} the id; nothing when none was kept or what is kept is no id
     */
    function noted() {
        try {
            const kept = localStorage.getItem(LAST_UNIT);
            return isId(kept) ? kept : undefined;
        } catch {
            // no local storage
        }
    }

    /**
     * Takes out the pass for the one link that may be opened as it is.
     *
     * @returns {string|null} that link, as one text; null when there is no pass
     */
    function admitted() {
        try {
            const pass = sessionStorage.getItem(PASS);
            sessionStorage.removeItem(PASS);
            return pass;
        } catch {
            return null;
        }
    }

    // what the script hands out: its functions that only compute, for the tests, and the ways it
    // leaves the page and loads it again, which a test replaces because its page cannot do either
    const shared = {
        parse,
        address,
        isContentBuilderHash,
        switchAddress,
        isEmailHash,
        parseEmail,
        emailAddress,
        emailSwitchAddress,
        isContactBuilderHash,
        parseContact,
        contactAddress,
        contactSwitchAddress,
        arrival,
        withArrival,
        landing,
        merge,
        go: (to) => location.assign(to),
        reload: () => location.reload(),
    };
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call the functions by themselves and replace the one that leaves the page, which nothing else of this script lets them
    globalThis.sfmcUxToolsDeepLink = shared;

    // the link the address asked for, until its app took it or the dialog told why not
    let wanted = null;
    // the decision about that link that is under way: a link is decided once
    let deciding = Promise.resolve();
    // what an app shows now, as far as its frame told: {app, what}
    let shown = null;
    // the link that this script wrote into the address last, as one text; null for none
    let marked = null;
    // the link into Email Studio that was taken from the address last, as one text. Seen live:
    // the page writes the address of Email Studio's frame into its own again and again, with
    // the link that frame was loaded with, which is no new link
    let takenEmail = null;
    // the link that was taken from the address the page was handed to open, as one text, until
    // the page writes that address itself a moment later: that is no new link either
    let takenArrival = null;
    // the link into Contact Builder that the address asked for, while it is not known to belong
    // to the business unit the user is in: until then, and after the dialog about it, its
    // business unit stays in the address while Contact Builder shows its route. Seen live: the
    // page opens the route in the business unit the user is in, before the dialog is answered
    let heldContact = null;
    // the link into Contact Builder whose route was taken out of the address, until the user is
    // known to be in its business unit or picked a button of the dialog about it: until then
    // nothing is written into Contact Builder's address
    let parked = null;
    // whether the user clicked or typed on this page since an app last told what it shows
    let isByUser = false;
    // whether the change of the address that comes next is a step through the browser's history
    let isStep = false;
    // the app the address belongs to now; nothing for any other
    let here = appOf(location.hash);
    // the app for which this script wrote an address since that app became the one of the
    // address; null for none. Only after that does an address get an entry of its own, so that
    // what an app shows first never adds one
    let written = null;
    // whether a link into Content Builder is being followed: from the link until Content Builder
    // tells an open asset. Its frame tells "nothing open" first, which must not take the link
    // out of the address
    let isFollowing = false;
    // whether such a "nothing open" was kept out of the address meanwhile
    let isHeldBack = false;
    // the link into Content Builder of an entry that was stepped to, which its frame was asked
    // to open, until Content Builder tells that asset open; null for none. Seen live: a frame
    // that is loaded anew meanwhile never got that request, and asks for what to open instead
    let steppedTo = null;
    // which of Contact Builder's tabs was chosen when its frame told a route, by that route, for
    // this visit of the page
    const tabs = new Map();
    // whether the route that Contact Builder's frame tells next is the answer to a step that this
    // script showed itself, until the user clicks or types on this page: the tab that is chosen
    // then is the one this script chose, or the one of the route before
    let isStepAnswer = false;

    /**
     * Finds the one tab of Contact Builder that is chosen.
     *
     * @returns {{all: Element[], chosen: number}|undefined} the tabs and the place of the chosen one among them; nothing unless exactly one is chosen
     */
    function readTabs() {
        const all = [...document.querySelectorAll(TAB)];
        const chosen = all.filter(
            (tab) => tab.classList.contains(SELECTED) || tab.querySelector(`.${SELECTED}`),
        );
        return chosen.length === 1 ? { all, chosen: all.indexOf(chosen[0]) } : undefined;
    }

    /**
     * Remembers which tab is chosen for a route that Contact Builder's frame told. A route that
     * answers a step this script showed itself is left out: its tab may be the one of the route
     * before.
     *
     * @param {unknown} route what the frame told
     */
    function noteTab(route) {
        if (isStepAnswer || !isRoute(route) || appOf(location.hash) !== CONTACT_BUILDER) {
            return;
        }
        const found = readTabs();
        if (found) {
            tabs.set(route, found.chosen);
        }
    }

    /**
     * Chooses the tab that was chosen when Contact Builder's frame told a route: the class moves
     * from the tab that has it, and from each element inside that has it, to the same places of
     * the other tab. A route that was never told leaves the tabs as they are.
     *
     * @param {string} route the route of the entry that was stepped to
     */
    function chooseTab(route) {
        const found = readTabs();
        const to = found?.all[tabs.get(route)];
        const from = found?.all[found.chosen];
        if (!to || to === from) {
            return;
        }
        const twins = [to, ...to.querySelectorAll('*')];
        for (const [place, element] of [from, ...from.querySelectorAll('*')].entries()) {
            if (!element.classList.contains(SELECTED)) {
                continue;
            }

            element.classList.remove(SELECTED);
            twins[place]?.classList.add(SELECTED);
        }
    }

    /**
     * Asks Marketing Cloud's API about the business units, through this page. It never throws.
     *
     * @param {string} path what follows the address of the business units
     * @returns {Promise.<object|undefined>} the answer; nothing when there is none or it is an error
     */
    async function ask(path) {
        try {
            const response = await fetch(ACCOUNTS + path, {
                // the business unit may have been switched in another tab
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                method: 'GET',
                redirect: 'error',
            });
            if (!response.ok) {
                return;
            }
            const body = await response.json();
            return isRecord(body) ? body : undefined;
        } catch {
            // no answer, or one that is no JSON: not read
        }
    }

    /**
     * Reads the business unit the user is in now. It is asked each time, because that can change
     * while this page stays open.
     *
     * @returns {Promise.<{mid: string, name: string, parent: string|null}|undefined>} the business unit; nothing when it could not be read
     */
    async function readCurrent() {
        return note(unit(await ask('/@current')));
    }

    /**
     * Reads the business unit that the page's own header shows.
     *
     * @returns {{mid: string, name: string, parent: null}|undefined} the business unit; nothing while the header does not show one
     */
    function readHeader() {
        const found = HEADER_MID.exec(document.querySelector(HEADER)?.textContent ?? '');
        if (!found) {
            return;
        }
        const name = document.querySelector(HEADER_NAME)?.textContent ?? found[2];
        return { mid: found[1], name: name.trim(), parent: null };
    }

    /**
     * Finds the business unit the user is in, by whatever answers first: the API or, if asked
     * for, the page's header. It gives up after a while.
     *
     * @param {boolean} isLoading true to take the header too; it is only known to be right while the page is loaded
     * @returns {Promise.<{mid: string, name: string, parent: string|null}|undefined>} the business unit; nothing when neither told it in time
     */
    function findCurrent(isLoading) {
        return new Promise((resolve) => {
            const watcher = new MutationObserver(() => take(readHeader()));
            const timer = setTimeout(() => finish(), CURRENT_WAIT);
            /**
             * Ends the search.
             *
             * @param {object} [found] the business unit; nothing when the time is up
             */
            function finish(found) {
                watcher.disconnect();
                clearTimeout(timer);
                resolve(note(found));
            }
            /**
             * Takes what one of the two told, if it told a business unit.
             *
             * @param {object} [found] the business unit
             */
            function take(found) {
                if (found) {
                    finish(found);
                }
            }
            (async () => take(await readCurrent()))();
            if (!isLoading) {
                return;
            }

            watcher.observe(document, { characterData: true, childList: true, subtree: true });
            take(readHeader());
        });
    }

    /**
     * Waits until the page has a body, which it has not yet when this script starts.
     *
     * @returns {Promise.<void>} settles once there is one
     */
    function whenBody() {
        return new Promise((resolve) => {
            if (document.body) {
                resolve();
                return;
            }
            const watcher = new MutationObserver(() => {
                if (!document.body) {
                    return;
                }

                watcher.disconnect();
                resolve();
            });
            watcher.observe(document, { childList: true, subtree: true });
        });
    }

    /**
     * Reads the business units of the account, page by page, until a page is shorter than what
     * was asked for or the most pages were read.
     *
     * @returns {Promise.<object[]|undefined>} the business units; nothing when a page could not be read
     */
    async function readList() {
        const units = [];
        for (let page = 1; page <= MOST_PAGES; page++) {
            const body = await ask(
                `?$page=${page}&$pageSize=${PAGE_SIZE}&includeParentDetails=true`,
            );
            if (!Array.isArray(body?.items)) {
                return;
            }
            for (const item of body.items) {
                const read = unit(item);
                if (read) {
                    units.push(read);
                }
            }
            if (body.items.length < PAGE_SIZE) {
                break;
            }
        }
        return units;
    }

    /**
     * Reads the business units this browser has seen. It never throws.
     *
     * @returns {Promise.<object>} them, by the id of their enterprise; empty when there are none
     */
    async function recall() {
        try {
            const stored = (await chrome.storage.local.get(MEMORY_KEY))[MEMORY_KEY];
            return isRecord(stored) ? stored : {};
        } catch {
            return {};
        }
    }

    /**
     * Adds the business units of this account to those this browser has seen. A list that could
     * not be read changes nothing.
     *
     * @param {Promise.<object[]|undefined>} reading the business units of the account, once read
     */
    async function remember(reading) {
        const units = await reading;
        if (!units || units.length === 0) {
            return;
        }
        const current = units.some((item) => item.parent === null)
            ? undefined
            : await readCurrent();
        try {
            const stored = (await chrome.storage.local.get(MEMORY_KEY))[MEMORY_KEY];
            const merged = merge(stored, units, current);
            if (merged) {
                await chrome.storage.local.set({ [MEMORY_KEY]: merged });
            }
        } catch {
            // the extension was updated or switched off under this page: nothing is kept
        }
    }

    // the business units of the account this page was loaded in
    const listed = readList();
    remember(listed);
    // seen live: right after a switch of the business unit, the one that is remembered for
    // Contact Builder's links was still the one before, because a page without a link never
    // read it. So every load of the page reads it, link or not
    if (location.pathname === SHELL_PATH) {
        findCurrent(true);
    }

    /**
     * Finds a business unit among those this browser has seen.
     *
     * @param {object} memory them, by the id of their enterprise
     * @param {string} mid id of the business unit
     * @returns {{name: string, enterprise: string}|undefined} its name and what its account is called; nothing when it was never seen
     */
    function seen(memory, mid) {
        for (const [id, entry] of Object.entries(memory)) {
            if (!isRecord(entry?.units) || !Object.hasOwn(entry.units, mid)) {
                continue;
            }
            const name = entry.units[mid];
            if (typeof name === 'string' && name !== '') {
                const enterprise =
                    typeof entry.name === 'string' && entry.name !== ''
                        ? entry.name
                        : `the account ${id}`;
                return { name, enterprise };
            }
        }
    }

    /**
     * Creates an element.
     *
     * @param {string} tag name of the element
     * @param {string} [part] what it is, for the stylesheet
     * @param {string} [text] its text
     * @returns {HTMLElement} the element
     */
    function make(tag, part, text) {
        const element = document.createElement(tag);
        if (part) {
            element.className = `${NAME}-${part}`;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    }

    /**
     * Shows the script's dialog about a link that was not followed, over the greyed-out page,
     * until the user picks one of its buttons. Nothing else closes it.
     *
     * @param {string[]} lines what it says, one paragraph each
     * @param {{text: string, act?: () => void}[]} choices its buttons; each closes the dialog
     */
    function tell(lines, choices) {
        document.querySelector(`dialog.${NAME}-dialog`)?.remove();
        const box = make('dialog', 'dialog');
        // neither Escape nor a click next to it closes it
        box.closedBy = 'none';
        let isChosen = false;
        const head = make('div', 'head');
        const image = make('img');
        image.src = chrome.runtime.getURL('icons/icon16.png');
        image.alt = MADE_BY;
        image.title = `${MADE_BY}: added this dialog, which asks before a link to another business unit is opened.`;
        image.width = 16;
        image.height = 16;
        head.append(
            make('h2', undefined, 'Link to another business unit'),
            image,
            make('span', 'by', MADE_BY),
        );
        const body = make('div');
        for (const line of lines) {
            body.append(make('p', undefined, line));
        }
        const buttons = make('div', 'buttons');
        for (const choice of choices) {
            const button = make('button', undefined, choice.text);
            button.type = 'button';
            button.addEventListener('click', () => {
                isChosen = true;
                box.close();
                choice.act?.();
            });
            buttons.append(button);
        }
        box.addEventListener('cancel', (event) => event.preventDefault());
        box.addEventListener('close', () => {
            if (isChosen) {
                box.remove();
            } else if (box.isConnected) {
                // seen in Chrome: a second Escape closes a dialog whose first one was refused
                box.showModal();
            }
        });
        box.append(head, body, buttons);
        (document.body ?? document.documentElement).append(box);
        box.showModal();
    }

    /**
     * Lets go of a link whose route was taken out of the address, once the user stays where they
     * are: from then on the address follows Contact Builder as ever.
     *
     * @param {{app: string, mid: string, what: string}} link the link the dialog was about
     */
    function release(link) {
        // the click on the dialog's button opened nothing: it adds no entry to the history
        isByUser = false;
        if (parked !== link) {
            return;
        }
        parked = null;
        if (shown?.app === CONTACT_BUILDER) {
            write(CONTACT_BUILDER);
        }
    }

    /**
     * Ends the following of a link into Content Builder that leads to no asset. What Content
     * Builder told meanwhile is written now, over the entry that is there.
     */
    function unfollow() {
        const isBehind = isFollowing && isHeldBack;
        isFollowing = false;
        isHeldBack = false;
        if (isBehind && shown === null && appOf(location.hash) === CONTENT_BUILDER) {
            write(CONTENT_BUILDER);
        }
    }

    /**
     * Opens a link into Contact Builder whose route was taken out of the address, now that the
     * user is known to be in its business unit: the link is written back and the page loaded
     * again, once, with a pass for exactly this link.
     *
     * @param {{app: string, mid: string, what: string}} link the link
     */
    function reopen(link) {
        const hash = landing(link);
        try {
            if (hash === undefined) {
                throw new TypeError('no link');
            }
            sessionStorage.setItem(PASS, keyOf(link));
        } catch {
            // without a pass the page is not loaded again: Contact Builder stays as it is
            release(link);
            return;
        }
        history.replaceState(
            history.state,
            '',
            arrival(location.search) === null
                ? location.pathname + location.search + hash
                : location.pathname + withArrival(location.search, hash) + location.hash,
        );
        shared.reload();
    }

    /**
     * Tells the user why a link was not followed: it belongs to another business unit, to which
     * the dialog offers to switch, or to one that the account does not have.
     *
     * @param {{app: string, mid: string, what: string}} link what the address asked for
     * @param {{mid: string, name: string, parent: string|null}} [current] the business unit the user is in; nothing when it could not be read
     */
    async function explain(link, current) {
        const [found, units, memory] = await Promise.all([ask(`/${link.mid}`), listed, recall()]);
        const target = unit(found);
        const isOpen =
            target?.mid === link.mid &&
            units?.find((item) => item.mid === link.mid)?.hasAccess !== false;
        if (isOpen) {
            let here = 'The business unit you are in could not be read.';
            if (current) {
                // the header may show the id without a name
                here =
                    current.name === ''
                        ? `You are in the business unit ${current.mid}.`
                        : `You are in ${current.name} (${current.mid}).`;
            }
            tell(
                [`This link belongs to the business unit ${target.name} (${link.mid}). ${here}`],
                [
                    {
                        text: 'Switch and open',
                        act: () => {
                            carry(link);
                            shared.go(switchOf(location.origin, link));
                        },
                    },
                    { text: 'Stay here', act: () => release(link) },
                ],
            );
            return;
        }
        // what the account is called: by its list, or by what was kept of it before
        const enterprise = units?.find((item) => item.parent === null);
        const top = enterprise?.mid ?? current?.parent ?? current?.mid;
        const kept = top !== undefined && Object.hasOwn(memory, top) ? memory[top]?.name : '';
        const account = enterprise?.name || (typeof kept === 'string' ? kept : '');
        const lines = [
            `The business unit ${link.mid} of this link does not exist in the Marketing Cloud account you are logged in to${
                account === '' ? '' : ` (${account})`
            }, or you have no access to it.`,
        ];
        const before = seen(memory, link.mid);
        if (before) {
            lines.push(`This browser has seen it before: ${before.name} in ${before.enterprise}.`);
        }
        tell(lines, [{ text: 'Close', act: () => release(link) }]);
    }

    /**
     * Tells the user why a link is not followed. A dialog that cannot be shown leaves the page
     * as it is.
     *
     * @param {{app: string, mid: string, what: string}} link what the address asked for
     * @param {{mid: string, name: string, parent: string|null}} [current] the business unit the user is in; nothing when it could not be read
     */
    async function refuse(link, current) {
        try {
            await explain(link, current);
        } catch {
            // the extension was updated or switched off under this page
            release(link);
        }
    }

    /**
     * Decides about a link as soon as the business unit the user is in is known, without waiting
     * for the app: a link of another business unit, or of an unknown one, is used up and the
     * dialog tells why. A link of this business unit is left for its app to ask for.
     *
     * @param {{app: string, mid: string, what: string}} link what the address asked for
     * @param {boolean} isLoading true while the page is loaded, when its header may tell the business unit too
     */
    async function decide(link, isLoading) {
        const current = await findCurrent(isLoading);
        await whenBody();
        // meanwhile another link may have come
        if (wanted !== link) {
            return;
        }
        if (current?.mid === link.mid) {
            if (link.app === CONTACT_BUILDER) {
                // nothing to hand over: the page opens the route itself. From now on the
                // address is written as for any route that Contact Builder shows
                wanted = null;
                heldContact = null;
                if (parked === link) {
                    reopen(link);
                }
            }
            return;
        }
        wanted = null;
        if (link.app === CONTENT_BUILDER) {
            unfollow();
        }
        await refuse(link, current);
    }

    /**
     * Takes a link that the address asked for.
     *
     * @param {{app: string, mid: string, what: string}|null} link what the address asked for; null for none
     * @param {boolean} isLoading true while the page is loaded
     * @param {boolean} [isTakenOut] true for a link into Contact Builder whose route is not in the address
     */
    function consider(link, isLoading, isTakenOut = false) {
        wanted = link;
        parked = null;
        // from here on, not only once the frame was answered: the frame asks and tells "nothing
        // open" at once, and is answered only after the business unit was read
        isFollowing = link?.app === CONTENT_BUILDER;
        isHeldBack = false;
        if (link === null) {
            return;
        }
        if (link.app === EMAIL_STUDIO) {
            takenEmail = keyOf(link);
        }
        if (link.app === CONTACT_BUILDER) {
            if (isTakenOut) {
                parked = link;
            } else {
                heldContact = link;
            }
        }
        deciding = decide(link, isLoading);
    }

    /**
     * Answers an app's question for what to open: what the link names, once, and only when the
     * link leads into that app and belongs to the business unit the user is in now.
     *
     * @param {string} app the app whose frame asks
     * @param {(answer: {asset: string|null}|{target: string|null}) => void} sendResponse answers the question
     */
    async function hand(app, sendResponse) {
        /**
         * Answers in the words of the app that asked.
         *
         * @param {string|null} what what to open; null for nothing
         */
        const answer = (what) => {
            sendResponse(app === EMAIL_STUDIO ? { target: what } : { asset: what });
        };
        // a link is decided once: what was started for it is waited for
        let waited;
        do {
            waited = deciding;
            await waited;
        } while (waited !== deciding);
        if (
            app === CONTENT_BUILDER &&
            steppedTo !== null &&
            keyOf(linkOf(location.hash)) === keyOf(steppedTo)
        ) {
            // the frame was loaded anew while the asset of a step was being opened: it is given
            // that asset again, as often as it asks, and the link stays in the address
            answer(steppedTo.what);
            return;
        }
        const link = wanted;
        // a link into the other app is left for that one
        if (link === null || link.app !== app) {
            answer(null);
            if (app === CONTENT_BUILDER) {
                unfollow();
            }
            return;
        }
        // a link is followed once
        wanted = null;
        // read anew, not from the header: the business unit may have been switched in another tab
        const current = await findCurrent(false);
        if (current?.mid === link.mid) {
            answer(link.what);
            return;
        }
        answer(null);
        if (app === CONTENT_BUILDER) {
            unfollow();
        }
        await refuse(link, current);
    }

    /**
     * Writes the address of one of the three apps, for the page as it is now.
     *
     * @param {string} app the app whose address this is
     * @param {string} [mid] id of the business unit the user is in
     * @param {string|null} what what the app shows; null for nothing
     * @returns {string|undefined} the address, from the path on; nothing when the app has none to write
     */
    function addressOf(app, mid, what) {
        const { pathname, search, hash } = location;
        if (app === CONTENT_BUILDER) {
            return address(pathname, search, mid, what);
        }
        if (app === EMAIL_STUDIO) {
            return emailAddress(pathname, search, hash, mid, what);
        }
        if (app === CONTACT_BUILDER) {
            return contactAddress(pathname, search, mid, what);
        }
    }

    /**
     * Writes the address of an app for what it shows now, without making the page route again.
     * The business unit is read for it each time; when it cannot be read, the address names
     * nothing, because a link without the right business unit would be wrong. Contact Builder's
     * address then names the route alone: that is the page's own form, which nothing checks.
     *
     * The address is written over the entry of the browser's history that is there. It gets an
     * entry of its own only when the user caused it, in one of the two apps that add none
     * themselves, when it names something else than the address does now, and not for the first
     * address that is written for the app.
     *
     * @param {string} app the app whose address this is
     * @param {boolean} [canAdd] true when the user caused what is shown; otherwise the entry that is there is always written over
     * @returns {Promise.<string|null>} the business unit and what is shown, as written into the address; null when it names nothing
     */
    async function write(app, canAdd = false) {
        const told = shown;
        /**
         * Says whether a link into Contact Builder is held: one whose route was taken out of
         * the address, or one whose route is what is shown.
         *
         * @returns {boolean} true when the address must stay as it is
         */
        const isHeld = () =>
            app === CONTACT_BUILDER &&
            (parked !== null || (heldContact !== null && told?.what === heldContact.what));
        if (isHeld()) {
            // a link that is not decided yet, or the route of a link of another business unit:
            // the address stays as it is
            return null;
        }
        let mid;
        if (told !== null) {
            mid = (await readCurrent())?.mid;
            // meanwhile the app may show something else, the page another app, or a link
            // to this route may have come
            if (shown !== told || appOf(location.hash) !== app || isHeld()) {
                return null;
            }
        }
        const isNamed = told !== null && (mid !== undefined || app === CONTACT_BUILDER);
        const what = isNamed ? told.what : null;
        const to = addressOf(app, mid, what);
        if (to === undefined) {
            // a route of Email Studio that does not hold the address of its frame, or no app
            // of the three
            marked = null;
            return null;
        }
        const isLink = what !== null && mid !== undefined;
        const key = isLink ? keyOf({ app, mid, what }) : null;
        // the plain address of an app names nothing, as an address without a link does
        const isAdded =
            canAdd &&
            STEPPED.includes(app) &&
            written === app &&
            key !== keyOf(linkOf(location.hash));
        marked = key;
        written = app;
        if (isAdded) {
            history.pushState(history.state, '', to);
        } else {
            history.replaceState(history.state, '', to);
        }
        return isLink ? `${mid}.${what}` : null;
    }

    /**
     * Takes what an app shows now into the address, if the address is that app's.
     *
     * @param {string} app the app whose frame told
     * @param {unknown} what id of the asset, name of the view or route, or anything else for none
     * @param {boolean} [isToldByUser] true when the frame saw a click or a key of the user since it told last
     * @returns {Promise.<string|null>} what was written into the address; null when it names nothing
     */
    function show(app, what, isToldByUser = false) {
        if (appOf(location.hash) !== app) {
            // another app's address is never touched
            if (shown === null || shown.app === app) {
                shown = null;
                marked = null;
            }
            return Promise.resolve(null);
        }
        // a click or a key on this page counts for the one address that is written next,
        // whatever comes of that
        const canAdd = isToldByUser || isByUser;
        isByUser = false;
        if (heldContact !== null && app === CONTACT_BUILDER && what !== heldContact.what) {
            // Contact Builder went on to another route: the link is done with
            heldContact = null;
        }
        shown = isWhole(app, what) ? { app, what } : null;
        if (app === CONTENT_BUILDER && (isToldByUser || shown?.what === steppedTo?.what)) {
            // the asset of the step is open, or the user went on by hand
            steppedTo = null;
        }
        if (app === CONTENT_BUILDER && isFollowing) {
            if (shown === null && !isToldByUser) {
                // the frame of a link that is being followed has nothing open yet: the link
                // stays in the address
                isHeldBack = true;
                marked = null;
                return Promise.resolve(null);
            }
            // the asset is open, or the user went on by hand
            isFollowing = false;
            isHeldBack = false;
        }
        return write(app, canAdd);
    }

    /**
     * Tells Email Studio's frame what was written into the address for the view it shows.
     *
     * @param {unknown} target the view, or anything else for none
     * @param {(answer: {parameter: string|null}) => void} sendResponse answers the frame
     */
    async function showEmail(target, sendResponse) {
        let parameter = null;
        try {
            parameter = await show(EMAIL_STUDIO, target);
        } catch {
            // an address that cannot be written: the frame is told that there is no link
        }
        sendResponse({ parameter });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // only what the extension's own background script passes on
        if (sender.id !== chrome.runtime.id || sender.tab) {
            return false;
        }
        if (message?.type === WANTED_MESSAGE || message?.type === EMAIL_WANTED_MESSAGE) {
            hand(message.type === WANTED_MESSAGE ? CONTENT_BUILDER : EMAIL_STUDIO, sendResponse);
            // the answer follows once the business unit was read
            return true;
        }
        if (message?.type === EMAIL_SHOWN_MESSAGE) {
            showEmail(message.target, sendResponse);
            // the answer follows once the business unit was read
            return true;
        }
        if (message?.type === SHOWN_MESSAGE) {
            show(CONTENT_BUILDER, message.asset, message.byUser === true);
            sendResponse({});
        }
        if (message?.type === CONTACT_SHOWN_MESSAGE) {
            noteTab(message.route);
            show(CONTACT_BUILDER, message.route, message.byUser === true);
            sendResponse({});
        }
        return false;
    });

    /**
     * Notes a click or a key of the user on this page, as opposed to one that a script made up.
     *
     * @param {Event} event the click or the key
     */
    function noteInput(event) {
        if (!event.isTrusted) {
            return;
        }
        isByUser = true;
        // what Contact Builder's frame tells from here on answers no step
        isStepAnswer = false;
        // the user went on by hand: a link that was being followed no longer holds the address
        isFollowing = false;
        isHeldBack = false;
        steppedTo = null;
    }
    for (const type of INPUTS) {
        // before the page's own scripts, which may keep the event to themselves
        addEventListener(type, noteInput, true);
    }

    // the browser tells a step through its history before the address changes. Where it does
    // not tell, no change of the address is taken for such a step
    globalThis.navigation?.addEventListener('navigate', (event) => {
        // only a step that changes nothing but the route is followed by a change of the address
        if (event.navigationType === TRAVERSE && event.hashChange === true) {
            isStep = true;
        }
    });

    /**
     * Asks something of the frames below this page, through background.js. It never throws.
     *
     * @param {object} message what is asked: to close the open asset, to open one, or to show a route
     */
    async function request(message) {
        try {
            await chrome.runtime.sendMessage(message);
        } catch {
            // the extension was updated or switched off under this page
        }
    }

    /**
     * Shows the entry of the browser's history that was stepped to, in place of Marketing Cloud:
     * only Content Builder's plain address, and a link of the business unit that was read last.
     * The address is left as the entry has it, and the link is not decided again.
     *
     * @param {string} app the app of the address, which is one of the two whose entries this script adds
     * @returns {boolean} true when the script shows the entry; false when the step is left to Marketing Cloud
     */
    function hasTakenOver(app) {
        const linked = linkOf(location.hash);
        // the address names something else than the asset of an earlier step, or nothing
        steppedTo = null;
        if (linked === null) {
            if (app !== CONTENT_BUILDER || !PLAIN_ROUTE.test(location.hash)) {
                return false;
            }
            // nothing is followed any more. The frame is asked whatever was told last, which
            // may be behind: without an open asset it closes nothing
            marked = null;
            isFollowing = false;
            isHeldBack = false;
            request({ type: CLOSE_MESSAGE });
            return true;
        }
        if (linked.mid !== noted()) {
            return false;
        }
        // the link of the entry is shown from here, in place of any link that was waited for
        wanted = null;
        heldContact = null;
        marked = keyOf(linked);
        if (app === CONTENT_BUILDER) {
            // until the asset is open, "nothing open" must not take the link out of the entry.
            // The frame is asked whatever was told last: it knows itself what is open
            isFollowing = true;
            isHeldBack = false;
            steppedTo = linked;
            request({ type: OPEN_MESSAGE, asset: linked.what });
        } else {
            // Marketing Cloud's router, which chooses the tab, does not see the step
            isStepAnswer = true;
            chooseTab(linked.what);
            request({ type: CONTACT_OPEN_MESSAGE, route: linked.what });
        }
        return true;
    }

    /**
     * Says whether the address lacks what the app shows now, after the page wrote its own route.
     *
     * @param {string} hash the part of the address from the #
     * @returns {boolean} true when the address should be written again
     */
    function isOverwritten(hash) {
        if (shown.app === CONTENT_BUILDER) {
            return PLAIN_ROUTE.test(hash);
        }
        if (shown.app === EMAIL_STUDIO) {
            return emailParts(hash) !== undefined && keyOf(linkOf(hash)) !== marked;
        }
        return shown.app === CONTACT_BUILDER && CONTACT_PLAIN_ROUTE.test(hash);
    }

    // seen live: a few seconds after it was loaded, the page writes Content Builder's plain route
    // over whatever followed it, and the address of Email Studio's frame whenever that changes.
    // While something is shown, the address gets it back. A step through the browser's history
    // that this script shows itself is kept apart
    addEventListener(
        'hashchange',
        (event) => {
            const app = appOf(location.hash);
            // a step through the browser's history, by Back or Forward, in one of the two apps
            // whose entries this script adds. In any other app it is a change like any other
            const isStepped = isStep && STEPPED.includes(app);
            isStep = false;
            // within one app whose frame told what it shows since the page came to it: that
            // frame is there to be asked
            if (isStepped && app === here && written === app && hasTakenOver(app)) {
                // the click or key that made the step opened nothing
                isByUser = false;
                // Marketing Cloud's own router does not get to see the step
                event.stopImmediatePropagation();
                return;
            }
            follow(app, isStepped);
        },
        // before the page's own listeners, so that a step can be kept from them
        true,
    );

    /**
     * Takes a change of the address that is left to Marketing Cloud.
     *
     * @param {string} [app] the app the address belongs to now; nothing for any other
     * @param {boolean} isStepped true for a step through the browser's history in one of the two apps whose entries this script adds
     */
    function follow(app, isStepped) {
        // the address changed again: the asset of an earlier step is no longer what it names
        steppedTo = null;
        if (app !== here) {
            // another app, or none: its first address adds no entry to the history
            here = app;
            written = null;
            isByUser = false;
        }
        if (isStepped) {
            // the click or key that made the step opened nothing
            isByUser = false;
        }
        if (app !== CONTENT_BUILDER) {
            isFollowing = false;
            isHeldBack = false;
        }
        if (app !== EMAIL_STUDIO) {
            takenEmail = null;
        }
        if (app !== CONTACT_BUILDER) {
            heldContact = null;
            if (parked !== null) {
                // the page left Contact Builder before the link was decided: it is done with
                if (wanted === parked) {
                    wanted = null;
                }
                parked = null;
            }
        }
        if (app === undefined) {
            takenArrival = null;
        }
        if (shown !== null && shown.app !== app) {
            shown = null;
            marked = null;
        }
        if (app === undefined) {
            marked = null;
            return;
        }
        // seen live: a link pasted into a tab that is already open only changes the hash; the
        // page then loads Content Builder anew, which asks again for the wanted asset. Only
        // what this script wrote itself, and what was taken already, is no new link
        const linked = linkOf(location.hash);
        const key = keyOf(linked);
        if (key !== keyOf(heldContact)) {
            // the address no longer holds the link that was held
            heldContact = null;
        }
        if (linked !== null && key === takenArrival) {
            // the page wrote the address it was handed: once, so the same link pasted later
            // is a new one again
            takenArrival = null;
        } else if (
            linked !== null &&
            key !== marked &&
            key !== takenEmail &&
            key !== keyOf(heldContact)
        ) {
            consider(linked, false);
        }
        if (isStepped) {
            // the address of the entry is never written over with what is shown. Seen live:
            // for an entry with a link Marketing Cloud shows what it names by itself, but for
            // Content Builder's plain address it leaves the asset open
            if (shown?.app === CONTENT_BUILDER && PLAIN_ROUTE.test(location.hash)) {
                request({ type: CLOSE_MESSAGE });
            }
            return;
        }
        // after the page's own router has read its plain route: this listener was added first
        // and would otherwise hide that route from it
        setTimeout(() => {
            if (shown !== null && isOverwritten(location.hash)) {
                write(shown.app);
            }
        }, 0);
    }

    // only the Marketing Cloud page itself takes a link: the page that switches the business
    // unit lies under the same path and would use up the link that was kept for the page after it
    if (location.pathname !== SHELL_PATH) {
        return;
    }
    const kept = carried();
    // a pass is used up by this load of the page, whatever the address holds
    const pass = admitted();
    /**
     * Says whether Contact Builder must not be given the route of a link: its business unit is
     * not the one that was read last, and the link has no pass.
     *
     * @param {{app: string, mid: string, what: string}} asked the link
     * @returns {boolean} true when the route stays out of the address until the business unit was read
     */
    const isUnsure = (asked) =>
        asked.app === CONTACT_BUILDER && keyOf(asked) !== pass && noted() !== asked.mid;
    // the address the page is about to open by itself, when it was handed over that way
    const arriving = arrival(location.search);
    const routed = linkOf(location.hash);
    const arrived = arriving === null ? null : linkOf(arriving);
    let link = routed ?? arrived;
    let isTakenOut = false;
    if (arrived !== null && isUnsure(arrived)) {
        // the address that was handed over is what the page opens, and it writes it over the
        // route a moment later: that link is the one to decide, and it is taken out of both
        // places before the page has read them, so that Contact Builder opens its start page
        link = arrived;
        history.replaceState(
            history.state,
            '',
            location.pathname +
                withArrival(location.search, CONTACT_ADDRESS) +
                (routed === null ? location.hash : CONTACT_ADDRESS),
        );
        isTakenOut = true;
    } else if (link !== null && isUnsure(link)) {
        // before the page has read its address: Contact Builder opens its start page. (Only
        // the route holds such a link here: one that was handed over was dealt with above)
        history.replaceState(
            history.state,
            '',
            location.pathname + location.search + CONTACT_ADDRESS,
        );
        isTakenOut = true;
    } else if (
        link === null &&
        kept !== null &&
        appOf(arriving ?? location.hash) === kept.app &&
        isUnsure(kept)
    ) {
        // the page after a switch of the business unit opens Contact Builder without the link:
        // the link stays out of the address until the switch is known to have happened
        link = kept;
        isTakenOut = true;
    }
    // a kept link belongs into the address of its own app only: when the page is about to open
    // another app, the kept link is dropped, as it was taken out of the session storage already
    if (link === null && kept !== null && appOf(arriving ?? location.hash) === kept.app) {
        // seen live: after a switch of the business unit the page opens the app without the
        // link, and Email Studio then starts in its first section, where the route of the
        // link leaves it empty. So the link is written back into the address now, before
        // the page has read it: from here on it is a link like any other
        const hash = landing(kept);
        if (hash !== undefined) {
            history.replaceState(
                history.state,
                '',
                arriving === null
                    ? location.pathname + location.search + hash
                    : location.pathname + withArrival(location.search, hash),
            );
            link = kept;
        }
    }
    if (routed === null && arriving !== null && !isTakenOut) {
        // the link stands in the address that the page writes itself a moment later
        takenArrival = keyOf(link);
    }
    consider(link, true, isTakenOut);
})();
