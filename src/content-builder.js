/*
 * SFMC UX Tools — readable keys for Content Builder. This script runs in the page's own world.
 *
 * The page that creates an email has no field for its key: the email is sent to the server
 * without one, and the server makes up a random key. This script adds a key derived from the
 * name to exactly that request. A content block has a field for its key, which the content
 * script for readable keys fills from the name; here that key is checked before it goes out.
 *
 * Marketing Cloud refuses what is created under a key that is taken, so a key that is taken
 * gets a number at its end.
 */
(() => {
    'use strict';

    const KEYS_ATTRIBUTE = 'data-sfmc-ux-tools-readable-keys';
    const OFF = 'off';
    // where content is created; what is saved again goes to an address that ends in its id
    const ASSETS = /\/asset\/v1\/content\/assets\/?$/;
    // the kinds of email, as the page names them
    const EMAILS = new Set(['htmlemail', 'templatebasedemail', 'textonlyemail']);
    // longest key Marketing Cloud takes for content
    const MAX_LENGTH = 36;
    const FOUND = 200;
    // how long, in milliseconds, a save of the page waits for the answer whether a key is free
    // before it goes out as the page wrote it
    const PATIENCE = 10_000;
    const toKey = globalThis.sfmcUxToolsToKey;
    // requests by the method and address they were opened with
    const opened = new WeakMap();
    // requests the page gave up
    const aborted = new WeakSet();

    /**
     * Tells whether a request creates an email without a key, or anything under the key that
     * follows from its name, and which key that is.
     *
     * @param {string} method method of the request
     * @param {string} url address of the request
     * @param {unknown} body what the page is about to send
     * @returns {{address: string, content: object, key: string} | null} where content is asked for, the body and the key wished for; null for any other request
     */
    function readableKeyFor(method, url, body) {
        const isOff = document.documentElement.getAttribute(KEYS_ATTRIBUTE) === OFF;
        if (isOff || typeof body !== 'string' || method.toUpperCase() !== 'POST') {
            return null;
        }
        const address = new URL(url, location.href);
        // whether a key is free can only be asked where this page is at home
        if (!ASSETS.test(address.pathname) || address.origin !== location.origin) {
            return null;
        }
        const content = JSON.parse(body);
        if (content.id || typeof content.name !== 'string') {
            return null;
        }
        const key = toKey(content.name, MAX_LENGTH);
        const given = content.customerKey ?? '';
        // a key the user typed is the user's; one that follows from the name was filled in
        const isWished = given === '' ? EMAILS.has(content.assetType?.name) : given === key;
        return key && isWished
            ? { address: address.pathname.replace(/\/$/, ''), content, key }
            : null;
    }

    /**
     * Asks the server for the content that has a key. The question is given up if it is sent
     * elsewhere, as to a login page, or takes too long: the page's own request waits for it.
     *
     * @param {string} address where content is asked for
     * @param {string} key key to ask for
     * @returns {Promise.<string[] | null>} the keys of what was found; null without an answer that lists content
     */
    async function ask(address, key) {
        const filter = encodeURIComponent(`customerKey eq '${key}'`);
        const answer = await fetch(`${address}?$fields=customerKey&$filter=${filter}`, {
            credentials: 'same-origin',
            redirect: 'error',
            signal: AbortSignal.timeout(PATIENCE),
        });
        const content = answer.status === FOUND ? await answer.json() : null;
        return Array.isArray(content?.items)
            ? content.items.map((item) => String(item?.customerKey ?? ''))
            : null;
    }

    /**
     * Finds a key that nothing has yet: a key that is taken gets a number at its end, counted
     * up until the key is free. A key only counts as taken if the server names what has it,
     * which is what ends the counting.
     *
     * @param {{address: string, key: string}} wish what readableKeyFor found
     * @returns {Promise.<string | null>} the key to use; null if the server does not say whether it is free
     */
    async function freeKey({ address, key }) {
        let candidate = key;
        for (let count = 2; ; count++) {
            const holders = await ask(address, candidate);
            if (holders?.length === 0) {
                return candidate;
            }
            const wanted = candidate.toLowerCase();
            if (!holders?.some((holder) => holder.toLowerCase() === wanted)) {
                return null;
            }
            const number = `_${count}`;
            candidate = key.slice(0, MAX_LENGTH - number.length) + number;
        }
    }

    /**
     * Sends a request of the page, with a readable key in it if it creates content that is to
     * have one and such a key is free. Whatever goes wrong on the way, the request goes out as
     * the page wrote it.
     *
     * @param {(body?: unknown) => void} send the browser's own way to send a request
     * @param {XMLHttpRequest} request request of the page
     * @param {unknown[]} parameters what the page sends: the body first
     */
    function sendWithReadableKey(send, request, parameters) {
        let wish = null;
        const opening = opened.get(request);
        try {
            const [method, url, isWaitedFor] = opening ?? ['', '', true];
            // a request the page waits for cannot be held back for a question to the server
            wish = isWaitedFor ? null : readableKeyFor(method, url, parameters[0]);
        } catch {
            // not a request this script knows how to read
        }
        if (wish) {
            sendOnceKeyIsFree(send, request, parameters, { ...wish, opening });
        } else {
            Reflect.apply(send, request, parameters);
        }
    }

    /**
     * Sends a request that creates content, once the server has said which readable key is free.
     *
     * @param {(body?: unknown) => void} send the browser's own way to send a request
     * @param {XMLHttpRequest} request request of the page
     * @param {unknown[]} parameters what the page sends: the body first
     * @param {{address: string, content: object, key: string, opening: unknown}} wish what readableKeyFor found, and how the request was opened
     */
    async function sendOnceKeyIsFree(send, request, parameters, wish) {
        let [body] = parameters;
        try {
            const key = await freeKey(wish);
            if (key) {
                wish.content.customerKey = key;
                body = JSON.stringify(wish.content);
            }
        } catch {
            // the question went unanswered
        }
        // meanwhile the page may have given the request up, or opened it for something else
        if (aborted.has(request) || opened.get(request) !== wish.opening) {
            return;
        }
        try {
            Reflect.apply(send, request, [body, ...parameters.slice(1)]);
        } catch {
            // the request is in no state to be sent any more
        }
    }

    // the page's requests pass through here on their way out
    XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
        apply: (open, request, parameters) => {
            aborted.delete(request);
            // the third parameter says whether the page goes on while the request is under way
            opened.set(request, [
                String(parameters[0]),
                String(parameters[1]),
                parameters[2] === false,
            ]);
            return Reflect.apply(open, request, parameters);
        },
    });
    XMLHttpRequest.prototype.send = new Proxy(XMLHttpRequest.prototype.send, {
        apply: sendWithReadableKey,
    });
    XMLHttpRequest.prototype.abort = new Proxy(XMLHttpRequest.prototype.abort, {
        apply: (abort, request, parameters) => {
            aborted.add(request);
            return Reflect.apply(abort, request, parameters);
        },
    });
})();
