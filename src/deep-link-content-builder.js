/*
 * SFMC UX Tools — content script for Content Builder's frame: links to an asset.
 *
 * It tells the Marketing Cloud page around the frame which asset is open, so that
 * deep-link-shell.js can keep its id in the address, and it opens the asset that such an address
 * asked for: it reads the asset's name, searches for it and clicks the row with that id. Once
 * the asset is open, it empties the search again.
 *
 * With what it tells, it says whether the user clicked or typed in this frame since it told last:
 * only then does the Marketing Cloud page give the address an entry of its own in the browser's
 * history. When the browser steps Back or Forward, that page asks this script to show what the
 * entry names: for Content Builder's plain address to close the open asset, by one click on the
 * asset's own close button, and for an asset to open it as for a link, after closing another one
 * that is open. Seen live: left to Marketing Cloud, such a step loaded Content Builder anew, which
 * added an entry that the browser's Back could not pass.
 *
 * It changes nothing in Marketing Cloud: one GET of the asset's id and name, one search, one click
 * on a row of the list, one on the close button of an open asset. Only the document that holds
 * Content Builder's list, directly below the Marketing Cloud page, talks to that page.
 */
(() => {
    'use strict';

    // Content Builder opened by itself has no page around it, and a frame further down is not
    // the one that holds the list
    if (top === globalThis || parent !== top) {
        return;
    }

    const MADE_BY = 'SFMC UX Tools';
    const MARK = 'data-sfmc-ux-tools-deep-link';
    // what is asked of and told to the Marketing Cloud page, passed on by background.js
    const WANTED_MESSAGE = 'sfmc-ux-tools:deep-link:wanted';
    const SHOWN_MESSAGE = 'sfmc-ux-tools:deep-link:shown';
    // what the Marketing Cloud page asks of this frame, passed on by background.js: to close the
    // asset that is open
    const CLOSE_MESSAGE = 'sfmc-ux-tools:deep-link:close';
    // and to open an asset, when the browser stepped to an entry with a link to it
    const OPEN_MESSAGE = 'sfmc-ux-tools:deep-link:open';
    // the longest id that is taken for one: as many digits as a whole number holds exactly
    const MOST_DIGITS = 15;
    const ID = new RegExp(String.raw`^\d{1,${MOST_DIGITS}}$`);
    // milliseconds the page may go on changing before it is looked at again
    const LOOK_DELAY = 250;
    // milliseconds the search may take to list the asset before the link is given up
    // (seen live: on a freshly loaded page the first search took about 30 seconds)
    const ROW_WAIT = 60_000;
    // the key code of Enter, which the search box listens for
    const ENTER_CODE = 13;
    // Content Builder's search box, which only the document with the list has
    const SEARCH = 'input[placeholder="Search"]';
    // the page of an open asset, and where it holds the asset's id
    const DETAILS = '.contentproperties-detailsview';
    const DETAILS_ID = '[data-content-field="id"] input.contentinput-copyvalue';
    // the control of that page that closes it and leads back to the list (from Content
    // Builder's own template)
    const DETAILS_CLOSE = '.contentproperties-close button[data-action="close"]';
    // what a person does in Content Builder that may open or close an asset: a click, a key
    const INPUTS = ['pointerdown', 'keydown'];
    // where the app passes calls on to the REST API
    const ASSETS = '/fuelapi/asset/v1/content/assets/';

    // whether this document was seen to hold the list
    let isList = false;
    // the id that was told last; nothing before the first time
    let told;
    // the asset a link asked for, while its row is waited for, and what ends the wait
    let awaited;
    let deadline;
    // the name that was searched for that asset
    let searchedFor;
    // the asset a link asked for, while its name is still being read
    let reading;
    // the asset that was clicked for a link and the name searched for it, until it is open
    let followed;
    // how many times an asset was asked for or its opening was called off: what is still read
    // for an earlier time is dropped
    let requests = 0;
    // the look at the page that is due, if any
    let due;
    // whether the user clicked or typed in this frame since it told last
    let isByUser = false;
    // the open asset whose close button was clicked, while it is still open: it is asked once
    let closing;

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
     * Says whether an element is drawn: neither it nor anything around it is taken off the page.
     *
     * @param {Element} element the element
     * @returns {boolean} true when it is
     */
    function isDisplayed(element) {
        if (!element.isConnected) {
            return false;
        }
        for (let part = element; part; part = part.parentElement) {
            if (getComputedStyle(part).display === 'none') {
                return false;
            }
        }
        return true;
    }

    /**
     * Reads which asset is open.
     *
     * @returns {string|null} its id; null when none is open
     */
    function openAsset() {
        const view = document.querySelector(DETAILS);
        if (!view || !isDisplayed(view)) {
            return null;
        }
        // the id is what the field holds now, which no change of the page announces
        const value = view.querySelector(DETAILS_ID)?.value;
        return typeof value === 'string' && ID.test(value) ? value : null;
    }

    /**
     * Clicks an element for the user. What follows is not the user's doing, whatever they
     * clicked or typed before.
     *
     * @param {HTMLElement} element the row of a link, or the close button of the open asset
     */
    function press(element) {
        isByUser = false;
        element.click();
    }

    /**
     * Closes the asset that is open, as its own close button does. Without an open asset, or
     * without that button, nothing is clicked.
     */
    function close() {
        const view = document.querySelector(DETAILS);
        const button = document.querySelector(DETAILS_CLOSE);
        if (!(view && button && isDisplayed(view) && isDisplayed(button))) {
            return;
        }

        closing = openAsset();
        press(button);
    }

    /**
     * Shows that a link could not be followed, until the user closes it.
     *
     * @param {string} id id of the asset
     * @param {string} reason why it was not opened
     */
    function notice(id, reason) {
        document.querySelector(`[${CSS.escape(MARK)}="notice"]`)?.remove();
        const box = document.createElement('div');
        box.setAttribute(MARK, 'notice');
        box.setAttribute('role', 'alert');
        box.style.cssText =
            'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;' +
            'display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:4px;' +
            'background:#16325c;color:#fff;font:13px/1.4 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)';
        const text = document.createElement('span');
        text.textContent = `${MADE_BY}: could not open asset ${id} from the link (${reason}).`;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = 'Close';
        close.setAttribute('aria-label', 'Close');
        close.style.cssText =
            'border:0;background:none;color:inherit;font:inherit;font-size:16px;cursor:pointer;padding:0';
        close.addEventListener('click', () => box.remove());
        box.append(text, close);
        document.body.append(box);
    }

    /**
     * Reads the name of an asset from Marketing Cloud's API, through the app. It never throws.
     *
     * @param {string} id id of the asset
     * @returns {Promise.<string|undefined>} the name; nothing when the asset could not be read
     */
    async function readName(id) {
        try {
            const response = await fetch(`${ASSETS}${id}?$fields=id,name`, {
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
            if (String(body?.id) === id && typeof body.name === 'string' && body.name !== '') {
                return body.name;
            }
        } catch {
            // no answer, or one that is no JSON: not read
        }
    }

    /**
     * Searches Content Builder for a name, as typing it and pressing Enter does.
     *
     * @param {HTMLInputElement} box the search box
     * @param {string} name what to search for; empty to list everything again
     */
    function search(box, name) {
        box.value = name;
        for (const type of ['input', 'change']) {
            box.dispatchEvent(new Event(type, { bubbles: true }));
        }
        for (const type of ['keydown', 'keypress', 'keyup']) {
            box.dispatchEvent(
                new KeyboardEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: ENTER_CODE,
                    which: ENTER_CODE,
                }),
            );
        }
    }

    /**
     * Opens the awaited asset once the list shows its row: one click on the name in that row.
     * While another asset is open, the row is not clicked: that asset is asked to close, and the
     * next change of the page is looked at again. It may have been open when the awaited one was
     * asked for, or its row was clicked for an earlier request and its page is drawn only now.
     * Each such asset is asked once, however many times the page is looked at meanwhile.
     */
    function open() {
        if (awaited === undefined) {
            return;
        }
        const now = openAsset();
        if (now !== null && now !== awaited) {
            if (now !== closing) {
                close();
            }
            return;
        }
        // the id is digits only, so it cannot end the selector
        const cell = document.querySelector(
            `tr[data-flow-id="cb:repeater:list:${CSS.escape(awaited)}"] .contentitem-table-name`,
        );
        if (!cell) {
            return;
        }
        clearTimeout(deadline);
        followed = { id: awaited, name: searchedFor };
        awaited = undefined;
        // seen live: the search box's list of suggestions stays open over the asset otherwise
        document.querySelector(SEARCH)?.blur();
        press(cell);
    }

    /**
     * Empties the search once the asset of a link is open, so that the list behind it shows
     * everything again. The search only helped to find the row. A search that the user changed
     * meanwhile is left alone, and so is the search of a link that could not be followed.
     *
     * @param {string|null} now id of the asset that is open; null for none
     */
    function tidy(now) {
        if (followed === undefined || now === null) {
            return;
        }
        const { id, name } = followed;
        // whatever is open now, the link is done with
        followed = undefined;
        const box = document.querySelector(SEARCH);
        if (!(now === id && box?.value === name)) {
            return;
        }

        search(box, '');
        // as after the search itself: the box's list of suggestions must not stay open
        box.blur();
    }

    /**
     * Calls off the opening of an asset that is under way: its row is no longer waited for, its
     * name that is still being read is dropped, and its search is left as it is.
     */
    function cancel() {
        requests++;
        clearTimeout(deadline);
        reading = undefined;
        awaited = undefined;
        followed = undefined;
    }

    /**
     * Opens an asset by its id, in place of whatever was being opened before: reads its name,
     * searches for it and waits for its row.
     *
     * @param {string} id id of the asset
     */
    async function find(id) {
        cancel();
        const request = requests;
        reading = id;
        const name = await readName(id);
        if (request !== requests) {
            // meanwhile another asset was asked for, or the page asked to close
            return;
        }
        reading = undefined;
        if (name === undefined) {
            notice(id, 'not found in this business unit');
            return;
        }
        const box = document.querySelector(SEARCH);
        if (!box) {
            notice(id, 'the search box is gone');
            return;
        }
        search(box, name);
        searchedFor = name;
        awaited = id;
        deadline = setTimeout(() => {
            awaited = undefined;
            const now = openAsset();
            if (now !== null && now !== id) {
                // the asset that was asked to close never did, so the row was never clicked,
                // listed or not
                notice(id, 'another asset is still open');
                return;
            }
            // seen live: the asset exists here, but Content Builder does not list its kind
            // (a web page of CloudPages), or the search did not bring it up
            notice(id, "Content Builder's search did not list it");
        }, ROW_WAIT);
        open();
    }

    /**
     * Asks the Marketing Cloud page once whether its address named an asset, and opens that one.
     */
    async function follow() {
        const id = (await send({ type: WANTED_MESSAGE }))?.asset;
        if (typeof id === 'string' && ID.test(id)) {
            await find(id);
        }
    }

    /**
     * Shows the asset of the entry that the browser stepped to. An asset that is open already
     * stays as it is, and so does one that is being opened already; another one that is open is
     * closed first.
     *
     * @param {unknown} id id of the asset
     */
    function step(id) {
        // asked again for the asset that is being opened: its name is read, its row is waited
        // for, or its row was clicked
        const isUnderWay = reading === id || awaited === id || followed?.id === id;
        if (isUnderWay || typeof id !== 'string' || !ID.test(id)) {
            return;
        }
        if (openAsset() === id) {
            // whatever else was being opened is not what the entry names
            cancel();
            return;
        }
        // a step through the browser's history is no click or key in this frame, whatever the
        // user did here before it: only what they do after this request counts as theirs
        isByUser = false;
        close();
        find(id);
    }

    /**
     * Looks at the page as it is now: tells which asset is open when that changed, and opens the
     * awaited one when its row is there.
     */
    function look() {
        due = undefined;
        if (!isList) {
            if (!document.querySelector(SEARCH)) {
                return;
            }
            // proven to be the document with the list
            isList = true;
            follow();
        }
        const now = openAsset();
        if (now !== closing) {
            // the asset that was asked to close is gone
            closing = undefined;
        }
        if (now !== told) {
            const pending = awaited ?? reading;
            if (isByUser && now !== null && pending !== undefined && now !== pending) {
                // the user opened another asset by hand meanwhile: that one stays, and the one
                // that was asked for is given up
                cancel();
            }
            told = now;
            send(
                isByUser
                    ? { type: SHOWN_MESSAGE, asset: now, byUser: true }
                    : { type: SHOWN_MESSAGE, asset: now },
            );
            isByUser = false;
        }
        tidy(now);
        open();
    }

    for (const type of INPUTS) {
        // before the page's own scripts, which may keep the event to themselves
        addEventListener(
            type,
            (event) => {
                // the keys this script makes up for its search are nobody's
                if (event.isTrusted) {
                    isByUser = true;
                }
            },
            true,
        );
    }

    chrome.runtime.onMessage.addListener((message, sender) => {
        // only what the extension's own background script passes on, and only in the document
        // that was seen to hold the list
        if (!isList || sender.tab || sender.id !== chrome.runtime.id) {
            return false;
        }
        if (message?.type === CLOSE_MESSAGE) {
            // an asset that was being opened must not open after this
            cancel();
            close();
        }
        if (message?.type === OPEN_MESSAGE) {
            step(message.asset);
        }
        return false;
    });

    // Content Builder draws its pages without loading them. A change only books one look
    new MutationObserver(() => {
        due ??= setTimeout(look, LOOK_DELAY);
    }).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
    });
    look();
})();
