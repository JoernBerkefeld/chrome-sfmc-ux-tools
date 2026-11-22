/*
 * SFMC UX Tools — content script for the frames of MobileConnect and MobilePush.
 *
 * Neither app lets a message be deleted from its list, and MobileConnect lets none be deleted at
 * all; Marketing Cloud's API can. This adds a "Delete" button to the details page of a
 * MobileConnect message, and to both lists a checkbox in front of each row with a button
 * "Delete selected (n)".
 *
 * Deleting cannot be undone, and some messages must not be deleted here, so:
 * - nothing is sent before the click in the script's own dialog, which names each message;
 * - every chosen message is read again and judged from that answer, never from its row;
 * - whatever the judgement needs and cannot read, or reads in another shape than expected,
 *   refuses the message;
 * - right before its delete request, a message is read and judged once more;
 * - the only request that changes anything is DELETE of the message itself, for ids the user chose.
 * What Marketing Cloud answers is shown as text only.
 */
(() => {
    'use strict';

    // said wherever this script adds something, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const NAME = 'sfmc-ux-tools-mobile-delete';
    const MARK = 'data-sfmc-ux-tools-mobile-delete';
    // what the script added, by that mark, and the rows of a list
    const DETAILS_BUTTON = '[data-sfmc-ux-tools-mobile-delete="details"]';
    const SELECTED_BUTTON = '[data-sfmc-ux-tools-mobile-delete="selected"]';
    const ROW_BOX = 'input[data-sfmc-ux-tools-mobile-delete="row"]';
    const ROWS = ':scope tbody tr';
    // where the extension lists the transactional messages, and deletes them safely
    const PANEL = 'Mobile Studio → Transactional Messages';
    // the largest page the API hands out of the definitions
    const LARGEST_PAGE = 100;
    // pages of definitions that are read at most; a list that is longer is taken as not read
    const MOST_PAGES = 100;
    // details that are read at the same time, to leave Marketing Cloud's server to the app
    const DETAILS_AT_ONCE = 4;
    // how the API says that a listed transactional definition is not there: seen for an SMS
    // definition whose mobile message was deleted, which is listed for good but cannot be read
    const NOT_FOUND = 404;
    const ORPHANED = '30003';
    // sendMethod of an SMS message that a journey made, and sendInitiator of such a push message
    const SMS_JOURNEY = 'INTERACTION';
    const PUSH_JOURNEY = 3;
    // sendInitiator of a push message that the API triggers, and the status of an active one,
    // whoever starts it
    const PUSH_API = 1;
    const PUSH_ACTIVE = 2;
    // the status of a transactional definition that was deleted
    const DELETED = 'deleted';

    const MISSING =
        'Marketing Cloud’s answer lacks what is needed to tell whether it is safe to delete.';
    const NOT_THE_ONE = 'Marketing Cloud answered with another message than the one asked for.';
    const JOURNEY =
        'A journey made it. The journey would lose its message, and deleting such a message was never tried.';
    const SMS_OWNED = `It belongs to a transactional SMS message. Deleting it here would leave that one broken for good: listed, but impossible to open or delete. Delete the transactional message under ${PANEL} instead.`;
    const SMS_UNREAD =
        'The transactional SMS messages could not be read completely, so it cannot be ruled out that it belongs to one of them.';
    const PUSH_OWNED = `A transactional push message has the same name, so it is taken to belong to it. Delete the transactional message under ${PANEL} instead.`;
    const PUSH_UNREAD =
        'The transactional push messages could not be read completely, so it cannot be ruled out that it belongs to one of them.';
    const PUSH_IN_USE = 'It is active. Make it inactive first.';

    /**
     * Says whether a value can be an id: text that is not empty, or a number.
     *
     * @param {unknown} value what the API or the page holds
     * @returns {boolean} true when it can
     */
    const isId = (value) =>
        (typeof value === 'string' && value.trim() !== '') ||
        (typeof value === 'number' && Number.isFinite(value));
    /**
     * Writes an id or a name so that two spellings of the same one are equal.
     *
     * @param {string|number} value the id or name
     * @returns {string} it, without spaces around it and in small letters
     */
    const same = (value) => String(value).trim().toLowerCase();
    /**
     * Says whether the id of a triggered send definition stands for "none": the number 0, or text
     * of zeros and hyphens with at least one zero, which is the empty GUID that was seen live.
     * Nothing else is "none": not a missing field, null, empty text or blanks, which were never
     * seen.
     *
     * @param {unknown} value what a message holds in the field
     * @returns {boolean} true when it names no definition
     */
    const isNone = (value) =>
        value === 0 || (typeof value === 'string' && /^[0-]*0[0-]*$/.test(value));
    /**
     * Reads a whole number that the API may write as a number or as text.
     *
     * @param {unknown} value what the API returned
     * @returns {number|undefined} the number; nothing when it is none
     */
    const code = (value) => {
        if (Number.isSafeInteger(value)) {
            return value;
        }
        return typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
    };

    /**
     * Judges whether a message may be deleted, from what was read just now. It asks nothing and
     * changes nothing. Whatever is missing, has another shape than expected or was not read
     * refuses the message.
     *
     * @param {string} kind sms for MobileConnect, push for MobilePush
     * @param {string|number} id the id that was asked for
     * @param {unknown} message what the API answered for that id
     * @param {{isComplete: boolean, ids?: Set.<string>, names?: Set.<string>}} [definitions] the transactional definitions of the kind: for sms the ids of all of them, for push the names of those that are not deleted, both as same() writes them; nothing when they were not read
     * @returns {{isAllowed: boolean, reason?: string, name?: string, needs?: boolean}} whether it may be deleted, why not, its name when it has one, and needs when the judgement takes the definitions, which were not handed in
     */
    function judge(kind, id, message, definitions) {
        if (typeof message !== 'object' || message === null || Array.isArray(message)) {
            return { isAllowed: false, reason: MISSING };
        }
        if (!isId(id) || !isId(message.id) || String(message.id) !== String(id)) {
            return { isAllowed: false, reason: NOT_THE_ONE };
        }
        if (typeof message.name !== 'string' || message.name.trim() === '') {
            return { isAllowed: false, reason: MISSING };
        }
        const { name } = message;
        const refuse = (reason, more) => ({ isAllowed: false, reason, name, ...more });
        if (kind === 'sms') {
            const { sendMethod, smsTriggeredSendDefinitionId: held } = message;
            if (typeof sendMethod !== 'string' || sendMethod.trim() === '') {
                return refuse(MISSING);
            }
            // a field that is not there is not a zero
            if (!isNone(held) && !isId(held)) {
                return refuse(MISSING);
            }
            if (sendMethod.trim().toUpperCase() === SMS_JOURNEY) {
                return refuse(JOURNEY);
            }
            if (isNone(held)) {
                return { isAllowed: true, name };
            }
            // the id alone proves nothing: a message activated in MobileConnect has one too.
            // Only a definition with that id does, whatever its name
            if (!definitions) {
                return refuse(SMS_UNREAD, { needs: true });
            }
            if (definitions.isComplete !== true || typeof definitions.ids?.has !== 'function') {
                return refuse(SMS_UNREAD);
            }
            return definitions.ids.has(same(held)) ? refuse(SMS_OWNED) : { isAllowed: true, name };
        }
        if (kind === 'push') {
            const initiator = code(message.sendInitiator);
            const status = code(message.status);
            if (initiator === undefined || status === undefined) {
                return refuse(MISSING);
            }
            if (initiator === PUSH_JOURNEY) {
                return refuse(JOURNEY);
            }
            if (initiator === PUSH_API) {
                // no id links a push message to its transactional definition; the name does
                if (!definitions) {
                    return refuse(PUSH_UNREAD, { needs: true });
                }
                if (
                    definitions.isComplete !== true ||
                    typeof definitions.names?.has !== 'function'
                ) {
                    return refuse(PUSH_UNREAD);
                }
                if (definitions.names.has(same(name))) {
                    return refuse(PUSH_OWNED);
                }
            }
            // MobilePush's own delete button refuses active messages, also those by location
            // and of a CloudPage, which the message does not tell from one sent by hand
            return status === PUSH_ACTIVE ? refuse(PUSH_IN_USE) : { isAllowed: true, name };
        }
        return refuse(MISSING);
    }

    // what the script hands out: the judgement, for the tests, and the two ways it leaves a
    // page, which a test replaces because its page cannot be loaded again
    const shared = {
        judge,
        reload: () => location.reload(),
        // the address of the app without a route, which is its overview
        toOverview: () => location.assign(location.pathname + location.search),
    };
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call the judgement by itself and replace the two functions that load the page again, which nothing else of this script lets them
    globalThis.sfmcUxToolsMobileDelete = shared;

    // the two apps, each with where its messages and its transactional definitions are in the
    // API, its list and how a row of it names its message
    const APPS = [
        {
            kind: 'sms',
            path: '/MobileConnectFuel3/',
            message: 'legacy/v1/beta/mobile/message/',
            definitions: 'messaging/v1/sms/definitions',
            repeater: '#messagesGridRepeater',
            rowId: (row) =>
                row.cells[0]?.querySelector('a[data-id][data-status]')?.dataset.id || undefined,
            // the page of one message: its route, with the id, and the header the button goes into
            route: /^#!\/message\/view\/([^/?#]+)$/,
            header: '.container > header.header',
        },
        {
            kind: 'push',
            path: '/mobilepush/',
            message: 'push/v1/message/',
            definitions: 'messaging/v1/push/definitions',
            repeater: '#messageGridRepeater',
            rowId: (row) =>
                row.cells[0]?.querySelector('div.message-name-cell[data-id]')?.dataset.id ||
                undefined,
        },
    ];
    const app = APPS.find((item) => location.pathname.startsWith(item.path));
    if (!app) {
        return;
    }
    const ICON = chrome.runtime.getURL('icons/icon16.png');
    // where the app passes calls on to the REST API
    const API = `${app.path}fuelapi/`;
    // the ids of the messages ticked in the list
    const selected = new Set();
    // the dialog that is open, if any
    let dialog;

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
     * Creates the icon of the extension, which names the extension when the mouse rests on it.
     *
     * @returns {HTMLImageElement} the icon
     */
    function icon() {
        const image = make('img', 'icon');
        image.src = ICON;
        image.alt = MADE_BY;
        image.title = MADE_BY;
        image.width = 16;
        image.height = 16;
        return image;
    }

    /**
     * Creates a button of the script, marked with the icon.
     *
     * @param {string} mark what it is, by which it is found again
     * @param {string} text what it says
     * @returns {{button: HTMLButtonElement, label: HTMLElement}} the button, and the part of it that holds its text
     */
    function marked(mark, text) {
        const button = make('button', 'button');
        button.type = 'button';
        button.setAttribute(MARK, mark);
        button.title = `Added by ${MADE_BY}`;
        const label = make('span', undefined, text);
        button.append(icon(), label);
        return { button, label };
    }

    /**
     * Asks Marketing Cloud's API through the app. It never throws.
     *
     * @param {string} path address below the API
     * @param {string} [method] GET to read, DELETE to delete
     * @returns {Promise.<{isOk: boolean, body?: object, status?: number, message?: string, isUnanswered?: boolean}>} the answer, or why there is none
     */
    async function ask(path, method = 'GET') {
        let response;
        try {
            response = await fetch(API + path, {
                // what is judged must be what Marketing Cloud holds now
                cache: 'no-store',
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                method,
                redirect: 'error',
            });
        } catch {
            // after a delete request, nobody knows whether it was carried out
            return {
                isOk: false,
                isUnanswered: true,
                message: 'Marketing Cloud did not answer. Are you still logged in?',
            };
        }
        let body;
        try {
            body = await response.json();
        } catch {
            // an answer that is no JSON is told by its status
        }
        const isObject = typeof body === 'object' && body !== null && !Array.isArray(body);
        // what was read must be there; a delete is told by the status alone
        if (!response.ok || (method === 'GET' && !isObject)) {
            return {
                isOk: false,
                status: response.status,
                body: isObject ? body : undefined,
                message:
                    (isObject && typeof body.message === 'string' && body.message) ||
                    `Marketing Cloud answered with ${response.status}.`,
            };
        }
        return { isOk: true, body: isObject ? body : {} };
    }

    /**
     * Reads the list of all transactional definitions of the app, page by page, until a page is
     * shorter than what was asked for. Each answer must say that its page has the size asked for.
     *
     * @returns {Promise.<object[]|undefined>} the rows; nothing when the list could not be read, had another shape than expected, repeated itself or did not end
     */
    async function readList() {
        const rows = [];
        const keys = new Set();
        for (let page = 1; page <= MOST_PAGES; page++) {
            const answer = await ask(`${app.definitions}?$page=${page}&$pageSize=${LARGEST_PAGE}`);
            // seen live: the answer repeats the size asked for. One that does not may have cut
            // its pages shorter, and then a short page is not the last one
            if (
                !answer.isOk ||
                !Array.isArray(answer.body.definitions) ||
                answer.body.pageSize !== LARGEST_PAGE
            ) {
                return;
            }
            for (const row of answer.body.definitions) {
                const key = row?.definitionKey;
                // a key that comes twice: the page asked for was ignored, or the list moved
                if (typeof key !== 'string' || key === '' || keys.has(key)) {
                    return;
                }
                keys.add(key);
                rows.push(row);
            }
            // only a short page is the last one: the count of the answer is that of the page
            if (answer.body.definitions.length < LARGEST_PAGE) {
                return rows;
            }
        }
    }

    /**
     * Reads what the judgement takes of the transactional definitions of the app. For SMS, every
     * definition is read by itself for its id, whatever it is called; one that the API says is
     * not there any more has no message left and is passed over. For push, the names of those
     * that are not deleted.
     *
     * @returns {Promise.<{isComplete: boolean, ids?: Set.<string>, names?: Set.<string>}>} what was read; not complete when anything of it could not be read or had another shape than expected
     */
    async function readDefinitions() {
        const rows = await readList();
        if (!rows) {
            return { isComplete: false };
        }
        if (app.kind === 'push') {
            const names = new Set();
            for (const row of rows) {
                if (typeof row.name !== 'string' || typeof row.status !== 'string') {
                    return { isComplete: false };
                }
                if (same(row.status) !== DELETED) {
                    names.add(same(row.name));
                }
            }
            return { isComplete: true, names };
        }
        const ids = new Set();
        let isComplete = true;
        let next = 0;
        const work = async () => {
            while (isComplete && next < rows.length) {
                const key = rows[next++].definitionKey;
                const answer = await ask(`${app.definitions}/${encodeURIComponent(key)}`);
                if (answer.isOk) {
                    if (isId(answer.body.definitionId)) {
                        ids.add(same(answer.body.definitionId));
                    } else {
                        isComplete = false;
                    }
                } else if (
                    answer.status !== NOT_FOUND ||
                    String(answer.body?.errorcode) !== ORPHANED
                ) {
                    isComplete = false;
                }
            }
        };
        await Promise.all(Array.from({ length: DETAILS_AT_ONCE }, work));
        return isComplete ? { isComplete, ids } : { isComplete: false };
    }

    /**
     * Reads a message and judges it. The transactional definitions are read when the first
     * message needs them, once for all messages of the same click.
     *
     * @param {{definitions?: Promise.<object>}} run what belongs to one click on a delete button
     * @param {string} id id of the message
     * @returns {Promise.<{id: string, isAllowed: boolean, reason?: string, name?: string}>} the judgement
     */
    async function inspect(run, id) {
        const answer = await ask(app.message + encodeURIComponent(id));
        if (!answer.isOk) {
            return {
                id,
                isAllowed: false,
                reason: `It could not be read again, so nothing is known about it: ${answer.message}`,
            };
        }
        let verdict = judge(app.kind, id, answer.body);
        if (verdict.needs) {
            run.definitions ??= readDefinitions();
            verdict = judge(app.kind, id, answer.body, await run.definitions);
        }
        return { id, isAllowed: verdict.isAllowed, reason: verdict.reason, name: verdict.name };
    }

    /**
     * Writes how many messages something is about.
     *
     * @param {number} count how many
     * @returns {string} "1 message" or "n messages"
     */
    function messages(count) {
        return count === 1 ? '1 message' : `${count} messages`;
    }

    /**
     * Builds a list of messages, each by its name and with what is said about it.
     *
     * @param {{id: string, name?: string, said?: string}[]} items the messages
     * @returns {HTMLUListElement} the list
     */
    function listed(items) {
        const list = make('ul', 'list');
        for (const item of items) {
            const entry = make('li');
            // a message that could not be read has no name
            const name = make('strong', undefined, item.name ?? `Message ${item.id}`);
            name.title = `ID ${item.id}`;
            entry.append(name);
            if (item.said) {
                entry.append(make('span', 'said', ` — ${item.said}`));
            }
            list.append(entry);
        }
        return list;
    }

    /**
     * Deletes the messages the user confirmed, one after the other. Each is read and judged
     * again first and passed over when it is no longer allowed or no longer has the name that
     * was shown. A failure does not stop the rest.
     *
     * @param {object} run what belongs to this click
     * @param {{id: string, name: string}[]} allowed the messages to delete
     * @param {HTMLElement} progress where it says how far it is
     * @returns {Promise.<{id: string, name: string, state: string, said?: string}[]>} what came of each
     */
    async function carryOut(run, allowed, progress) {
        const results = [];
        for (const [index, item] of allowed.entries()) {
            const done = (state, said) => {
                results.push({ ...item, state, said });
            };
            // without the dialog nobody sees what happens: nothing more is sent
            if (!run.dialog.isConnected) {
                done('skipped', 'The dialog was closed.');
                continue;
            }
            progress.textContent = `Deleting ${index + 1} of ${allowed.length} …`;
            const again = await inspect(run, item.id);
            if (!again.isAllowed) {
                done('skipped', `Not deleted, because it changed meanwhile. ${again.reason}`);
                continue;
            }
            if (again.name !== item.name) {
                done('skipped', 'Not deleted, because it has another name now.');
                continue;
            }
            const answer = await ask(app.message + encodeURIComponent(item.id), 'DELETE');
            if (answer.isOk) {
                done('deleted');
            } else if (answer.isUnanswered) {
                done('unknown', `It is not known whether it was deleted: ${answer.message}`);
            } else {
                done('failed', `Not deleted: ${answer.message}`);
            }
        }
        return results;
    }

    /**
     * Opens the dialog for the chosen messages: reads and judges each, then names those that
     * will be deleted and those that will not, and deletes only after the click on its button.
     *
     * @param {string[]} ids ids of the chosen messages
     * @param {boolean} isDetails true when asked from the page of one message
     */
    async function start(ids, isDetails) {
        if (dialog?.isConnected || ids.length === 0) {
            return;
        }
        const run = { isOver: false, isBusy: false, after: undefined };
        const box = make('dialog', 'dialog');
        dialog = box;
        run.dialog = box;
        const head = make('div', 'head');
        head.append(make('h2', undefined, 'Delete messages'), icon(), make('span', 'by', MADE_BY));
        const body = make('div', 'body');
        const buttons = make('div', 'buttons');
        box.append(head, body, buttons);
        /**
         * Builds a button of the dialog.
         *
         * @param {string} part what it is, for the stylesheet
         * @param {string} text what it says
         * @param {() => void} act what a click does
         * @returns {HTMLButtonElement} the button
         */
        const button = (part, text, act) => {
            const made = make('button', part, text);
            made.type = 'button';
            made.addEventListener('click', act);
            return made;
        };
        const close = () => box.close();
        // Esc must not close the dialog while messages are being deleted
        box.addEventListener('cancel', (event) => {
            if (run.isBusy) {
                event.preventDefault();
            }
        });
        box.addEventListener('close', () => {
            run.isOver = true;
            box.remove();
            run.after?.();
        });
        body.append(
            make(
                'p',
                undefined,
                `Reading ${messages(ids.length)} again before anything is deleted …`,
            ),
        );
        buttons.append(button('cancel', 'Cancel', close));
        document.body.append(box);
        box.showModal();

        const checked = [];
        for (const id of ids) {
            checked.push(await inspect(run, id));
            if (run.isOver) {
                return;
            }
        }
        const allowed = checked.filter((item) => item.isAllowed);
        const refused = checked
            .filter((item) => !item.isAllowed)
            .map((item) => ({ ...item, said: item.reason }));
        body.replaceChildren();
        if (allowed.length) {
            body.append(
                make('h3', undefined, `Will be deleted (${allowed.length})`),
                listed(allowed),
                make(
                    'p',
                    'warning',
                    'Marketing Cloud cannot bring a deleted message back. Whatever still sends with it will fail.',
                ),
            );
        }
        if (refused.length) {
            body.append(
                make('h3', undefined, `Will not be deleted (${refused.length})`),
                listed(refused),
            );
        }
        if (allowed.length === 0) {
            buttons.replaceChildren(button('cancel', 'Close', close));
            return;
        }
        const confirm = button('delete', `Delete ${messages(allowed.length)}`, async () => {
            run.isBusy = true;
            const progress = make('p', 'progress');
            body.replaceChildren(progress);
            buttons.replaceChildren();
            const results = await carryOut(run, allowed, progress);
            run.isBusy = false;
            const count = (state) => results.filter((item) => item.state === state).length;
            const summary = [`${count('deleted')} deleted`, `${count('failed')} failed`];
            if (count('skipped')) {
                summary.push(`${count('skipped')} not deleted because they changed`);
            }
            if (count('unknown')) {
                summary.push(`${count('unknown')} unknown`);
            }
            body.replaceChildren(make('p', 'result', `${summary.join(', ')}.`));
            const others = results.filter((item) => item.state !== 'deleted');
            if (others.length) {
                body.append(listed(others));
            }
            for (const item of results) {
                if (item.state === 'deleted') {
                    selected.delete(item.id);
                }
            }
            // the list is read again once the result was seen
            const isChanged = count('deleted') + count('unknown') > 0;
            if (isChanged) {
                run.after =
                    isDetails && count('deleted')
                        ? () => shared.toOverview()
                        : () => shared.reload();
            }
            // the dialog was closed meanwhile, so nobody sees the result: what Close would do
            // is done now, because messages may be deleted already
            if (!box.isConnected) {
                run.after?.();
                return;
            }
            buttons.replaceChildren(button('cancel', 'Close', close));
        });
        buttons.replaceChildren(confirm, button('cancel', 'Cancel', close));
    }

    /**
     * Reads the id of the message whose page the route is that of.
     *
     * @returns {string|undefined} the id; nothing on any other route
     */
    function routeId() {
        const found = app.route?.exec(location.hash);
        if (!found) {
            return;
        }
        try {
            return decodeURIComponent(found[1]) || undefined;
        } catch {
            // no id that could be asked for
        }
    }

    /**
     * Keeps the "Delete" button in the header of a message's page: there while the route is that
     * of a message and the header is on the page, gone otherwise.
     */
    function syncDetails() {
        const id = routeId();
        const found = id === undefined ? null : document.querySelector(app.header);
        const header = found?.querySelector('h3.title') ? found : null;
        for (const old of document.querySelectorAll(DETAILS_BUTTON)) {
            if (old.parentElement !== header || old.value !== id) {
                old.remove();
            }
        }
        if (!header || header.querySelector(DETAILS_BUTTON)) {
            return;
        }
        const { button } = marked('details', 'Delete');
        button.value = id;
        button.addEventListener('click', () => {
            // only the message whose page is still the one on show
            if (routeId() === button.value) {
                start([button.value], true);
            }
        });
        header.append(button);
    }

    /**
     * Lists the ticked messages that the list shows, in the order of its rows.
     *
     * @param {Element} repeater the list
     * @returns {string[]} their ids
     */
    function chosen(repeater) {
        const ids = [];
        for (const row of repeater.querySelectorAll(ROWS)) {
            const id = app.rowId(row);
            if (id && selected.has(id) && !ids.includes(id)) {
                ids.push(id);
            }
        }
        return ids;
    }

    /**
     * Keeps the checkboxes of the list and its "Delete selected" button in step with the rows
     * the list shows now. A message that the list no longer shows is no longer chosen.
     */
    function syncList() {
        const repeater = document.querySelector(app.repeater);
        const header = repeater?.querySelector('.repeater-header');
        if (!header) {
            return;
        }
        let button = header.querySelector(SELECTED_BUTTON);
        if (!button) {
            ({ button } = marked('selected', ''));
            button.addEventListener('click', () => {
                const list = document.querySelector(app.repeater);
                if (list) {
                    start(chosen(list), false);
                }
            });
            (header.querySelector('.repeater-header-left') ?? header).append(button);
        }
        const present = new Set();
        for (const row of repeater.querySelectorAll(ROWS)) {
            const id = app.rowId(row);
            let box = row.querySelector(ROW_BOX);
            if (!id) {
                box?.remove();
                continue;
            }
            present.add(id);
            if (!box) {
                box = make('input', 'check');
                box.type = 'checkbox';
                box.setAttribute(MARK, 'row');
                box.title = `Select for “Delete selected” (${MADE_BY})`;
                box.setAttribute('aria-label', 'Select this message for deleting');
                // a click on the row opens the message; one on the box must not
                box.addEventListener('click', (event) => event.stopPropagation());
                box.addEventListener('change', () => {
                    if (box.checked) {
                        selected.add(box.value);
                    } else {
                        selected.delete(box.value);
                    }
                    syncList();
                });
                row.cells[0].prepend(box);
            }
            if (box.value !== id) {
                box.value = id;
            }
            if (box.checked !== selected.has(id)) {
                box.checked = selected.has(id);
            }
        }
        // a list without rows is one that is being drawn again: what was chosen is kept until
        // its rows are back, and does not count while they are away
        if (present.size) {
            for (const id of selected) {
                if (!present.has(id)) {
                    selected.delete(id);
                }
            }
        }
        const count = [...selected].filter((id) => present.has(id)).length;
        const label = button.querySelector('span');
        const text = `Delete selected (${count})`;
        if (label.textContent !== text) {
            label.textContent = text;
        }
        button.disabled = count === 0;
    }

    /**
     * Puts the buttons and checkboxes where they belong on the page as it is now.
     */
    function sync() {
        if (app.route) {
            syncDetails();
        }
        syncList();
    }

    // both apps draw their pages without loading them: the route changes, and so does the page
    new MutationObserver(sync).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
    addEventListener('hashchange', sync);
    sync();
})();
