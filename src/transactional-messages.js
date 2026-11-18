/*
 * SFMC UX Tools — content script for the Marketing Cloud page that holds the app menu.
 *
 * Transactional SMS, push and OTT (WhatsApp and the like) messages exist in Marketing Cloud's
 * API only; no app shows them. This adds an entry "Transactional Messages" to the Mobile Studio
 * menu, which opens a panel that lists those definitions, shows the details of one and deletes
 * one on request. The lists and the details come from Marketing Cloud's own server, through the
 * page's session, and so does the delete, which is only sent after a question that names the
 * message.
 */
(() => {
    'use strict';

    const TITLE = 'Transactional Messages';
    // said wherever this script adds something, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const ICON = chrome.runtime.getURL('icons/icon16.png');
    const ISSUES = 'https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues';
    // where the page passes calls on to the REST API
    const API = '/cloud/fuelapi/messaging/v1/';
    // rows the API hands out per request unless asked otherwise
    const PAGE_SIZE = 50;
    // Marketing Cloud keeps a deleted definition in its lists, with the status "Deleted"
    const NOT_DELETED = '$filter=status%20neq%20deleted';
    const MARK = 'data-sfmc-ux-tools-transactional';
    const NAME = 'sfmc-ux-tools-transactional';
    // the apps of Mobile Studio that the menu is recognised by
    const MOBILE_APPS = 'a[href$="#app/MobileConnect"], a[href$="#app/MobilePush"]';
    const KINDS = [
        { id: 'sms', title: 'SMS' },
        { id: 'push', title: 'Push' },
        {
            id: 'ott',
            title: 'OTT',
            // nobody could try this one: no account with such a channel was at hand
            note: [
                'OTT covers WhatsApp and similar channels. This tab was built from Salesforce’s documentation, without an account that has such a channel to test it on. If you have one, please tell us whether it works for you: ',
                { text: 'issues on GitHub', href: ISSUES },
                '.',
            ],
        },
    ];
    const COLUMNS = [
        { title: 'Name', field: 'name' },
        { title: 'Key', field: 'definitionKey' },
        { title: 'Status', field: 'status' },
        { title: 'Created', field: 'createdDate' },
        { title: 'Modified', field: 'modifiedDate' },
    ];

    let dialog;
    let body;
    let note;
    let tabs;
    // counts what was asked for, so that a late answer for something else is dropped
    let asked = 0;

    /**
     * Creates an element.
     *
     * @param {string} tag name of the element
     * @param {string} [part] what it is in the panel, for the stylesheet
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
     * Asks Marketing Cloud's API through the page.
     *
     * @param {string} path address below the API of transactional messages
     * @param {string} [method] GET to read, DELETE to delete
     * @returns {Promise.<object>} the answer; an error with isUnanswered when none came
     */
    async function ask(path, method = 'GET') {
        let response;
        try {
            response = await fetch(API + path, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
                method,
                redirect: 'error',
            });
        } catch {
            const error = new Error('Marketing Cloud did not answer. Are you still logged in?');
            // after a request that changes something, nobody knows whether it was carried out
            error.isUnanswered = true;
            throw error;
        }
        let answer;
        try {
            answer = await response.json();
        } catch {
            // an answer that is no JSON is told by its status
        }
        const isObject = typeof answer === 'object' && answer !== null;
        // what was read must be there; what was changed is told by the status alone
        const isUnreadable = method === 'GET' && !isObject;
        if (isUnreadable || !response.ok) {
            throw new Error(answer?.message || `Marketing Cloud answered with ${response.status}.`);
        }
        return isObject ? answer : {};
    }

    /**
     * Reads all definitions of a kind, page by page.
     *
     * @param {string} kind sms, push or ott
     * @param {() => boolean} isWanted false once something else was asked for or the panel was closed
     * @returns {Promise.<object[]>} the definitions
     */
    async function readList(kind, isWanted) {
        const rows = [];
        let before;
        for (let page = 1; isWanted(); page++) {
            const answer = await ask(
                `${kind}/definitions?$page=${page}&$pageSize=${PAGE_SIZE}&${NOT_DELETED}`,
            );
            const found = Array.isArray(answer.definitions) ? answer.definitions : [];
            const first = JSON.stringify(found[0]);
            // the same rows again: the page asked for was ignored, and would be for ever
            if (first === before || found.length === 0) {
                break;
            }
            before = first;
            rows.push(...found);
            // a short page is the last one, whatever the count says; a count may be missing
            const isComplete = Number.isFinite(answer.count) && rows.length >= answer.count;
            if (isComplete || found.length < PAGE_SIZE) {
                break;
            }
        }
        return rows;
    }

    /**
     * Shows a value of a definition: text, or its parts by their names.
     *
     * @param {unknown} value what the API returned
     * @returns {HTMLElement} the element that shows it
     */
    function show(value) {
        if (value === null || typeof value !== 'object') {
            return make('span', 'value', String(value));
        }
        const entries = Object.entries(value);
        if (entries.length === 0) {
            return make('span', 'value', '(none)');
        }
        const list = make('dl', 'fields');
        for (const [key, part] of entries) {
            list.append(make('dt', undefined, key));
            const cell = make('dd');
            cell.append(show(part));
            list.append(cell);
        }
        return list;
    }

    /**
     * Replaces what the panel shows.
     *
     * @param {...(Node|string)} content what to show
     */
    function fill(...content) {
        body.replaceChildren(...content);
    }

    /**
     * Shows that something failed, with what Marketing Cloud said.
     *
     * @param {unknown} error what went wrong
     * @param {...Node} before what stays above it
     */
    function fail(error, ...before) {
        fill(...before, make('p', 'error', `That did not work: ${error?.message || error}`));
    }

    /**
     * Reads one definition.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @returns {Promise.<object>} the definition
     */
    async function readDefinition(kind, key) {
        const definition = await ask(`${kind.id}/definitions/${encodeURIComponent(key)}`);
        // the id of the request says nothing about the definition
        delete definition.requestId;
        return definition;
    }

    /**
     * Deletes a definition that the user has confirmed, unless it is no longer the one shown.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} shown the definition as the details show it
     * @param {HTMLElement} box the confirmation, which takes what goes wrong
     */
    async function remove(kind, shown, box) {
        const mine = ++asked;
        const key = shown.definitionKey;
        const called = `“${shown.name}” (key ${key})`;
        let isSent = false;
        for (const button of box.querySelectorAll('button')) {
            button.disabled = true;
        }
        try {
            // the request names only the key, and the same key can exist in another business unit,
            // which the user may have changed to in another tab since the details were read
            const held = await readDefinition(kind, key);
            if (mine !== asked) {
                // the user went elsewhere before anything was sent: nothing is deleted
                return;
            }
            if (JSON.stringify(held) !== JSON.stringify(shown)) {
                throw new Error(
                    'what Marketing Cloud holds under this key is no longer what is shown here. Was the business unit changed in another tab? Open the message again.',
                );
            }
            isSent = true;
            await ask(`${kind.id}/definitions/${encodeURIComponent(key)}`, 'DELETE');
            // an answer that comes after the user went elsewhere is not shown; the lists are read anew
            if (mine === asked) {
                openList(kind, `Deleted ${called}.`);
            }
        } catch (ex) {
            if (mine !== asked) {
                return;
            }
            // only a delete that went out and got no answer leaves its outcome open
            if (isSent && ex.isUnanswered) {
                openList(
                    kind,
                    `It is not known whether ${called} was deleted: ${ex.message} Look for it in the list.`,
                );
                return;
            }
            box.replaceChildren(make('p', 'error', `Not deleted: ${ex.message}`));
        }
    }

    /**
     * Asks whether a definition is really to be deleted, in place of the button that was clicked.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} shown the definition as the details show it
     * @param {HTMLElement} button the button that was clicked
     */
    function confirmDelete(kind, shown, button) {
        const box = make('div', 'confirm');
        const yes = make('button', 'delete', 'Delete it');
        const no = make('button', 'keep', 'Keep it');
        yes.type = 'button';
        no.type = 'button';
        yes.addEventListener('click', () => remove(kind, shown, box));
        no.addEventListener('click', () => box.replaceWith(button));
        box.append(
            make(
                'p',
                undefined,
                `Delete “${shown.name}” (key ${shown.definitionKey}, status ${shown.status}) for good? Marketing Cloud cannot bring it back, and whatever still sends with this key will fail.`,
            ),
            yes,
            no,
        );
        button.replaceWith(box);
    }

    /**
     * Shows the details of one definition.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {string} key key of the definition
     */
    async function openDetails(kind, key) {
        const mine = ++asked;
        fill(make('p', 'hint', 'Loading …'));
        try {
            const definition = await readDefinition(kind, key);
            if (mine !== asked) {
                return;
            }
            const back = make('button', 'back', `← All ${kind.title} messages`);
            back.type = 'button';
            back.addEventListener('click', () => openList(kind));
            const erase = make('button', 'delete', 'Delete');
            erase.type = 'button';
            erase.addEventListener('click', () => confirmDelete(kind, definition, erase));
            const actions = make('div', 'actions');
            actions.append(back, erase);
            fill(actions, show(definition));
        } catch (ex) {
            if (mine === asked) {
                fail(ex);
            }
        }
    }

    /**
     * Builds the table of definitions.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object[]} rows the definitions
     * @returns {HTMLElement} the table
     */
    function table(kind, rows) {
        const element = make('table', 'list');
        const head = element.createTHead().insertRow();
        for (const { title } of COLUMNS) {
            head.append(make('th', undefined, title));
        }
        const content = element.createTBody();
        for (const row of rows) {
            const line = content.insertRow();
            for (const { field } of COLUMNS) {
                line.insertCell().textContent = row?.[field] ?? '';
            }
            const key = row?.definitionKey;
            // without a key there is nothing to ask the details for
            if (!(typeof key === 'string' && key)) {
                continue;
            }

            line.tabIndex = 0;
            line.title = 'Show the details';
            line.addEventListener('click', () => openDetails(kind, key));
            line.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    openDetails(kind, key);
                }
            });
        }
        return element;
    }

    /**
     * Shows the list of one kind of message.
     *
     * @param {{id: string, title: string, note?: Array}} kind kind of message
     * @param {string} [notice] what just happened, to say above the list
     */
    async function openList(kind, notice) {
        const mine = ++asked;
        for (const tab of tabs.children) {
            tab.setAttribute('aria-selected', String(tab.dataset.kind === kind.id));
        }
        note.replaceChildren(
            ...(kind.note || []).map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                const link = make('a', undefined, part.text);
                link.href = part.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                return link;
            }),
        );
        note.hidden = !kind.note;
        // what just happened stays in view, whatever becomes of the list
        const said = notice ? [make('p', 'notice', notice)] : [];
        fill(...said, make('p', 'hint', 'Loading …'));
        try {
            const rows = await readList(kind.id, () => mine === asked);
            if (mine !== asked) {
                return;
            }
            fill(
                ...said,
                rows.length > 0
                    ? table(kind, rows)
                    : make(
                          'p',
                          'hint',
                          `This business unit has no transactional ${kind.title} messages.`,
                      ),
            );
        } catch (ex) {
            if (mine === asked) {
                fail(ex, ...said);
            }
        }
    }

    /**
     * Builds the panel once.
     */
    function build() {
        dialog = make('dialog', 'panel');
        const head = make('header', 'head');
        const close = make('button', 'close', '×');
        close.type = 'button';
        close.title = 'Close';
        close.addEventListener('click', () => dialog.close());
        // on every screen of the panel: who added it
        const madeBy = make('span', 'made-by');
        madeBy.append(icon(), MADE_BY);
        head.append(make('h2', undefined, TITLE), madeBy, close);
        tabs = make('div', 'tabs');
        tabs.setAttribute('role', 'tablist');
        for (const kind of KINDS) {
            const tab = make('button', 'tab', kind.title);
            tab.type = 'button';
            tab.dataset.kind = kind.id;
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', () => openList(kind));
            tabs.append(tab);
        }
        note = make('p', 'note');
        body = make('div', 'body');
        dialog.append(head, tabs, note, body);
        // a late answer must not fill a panel that was closed
        dialog.addEventListener('close', () => {
            asked++;
        });
        document.body.append(dialog);
    }

    /**
     * Opens the panel on its first tab.
     */
    function open() {
        if (!dialog) {
            build();
        }
        if (!dialog.open) {
            dialog.showModal();
        }
        openList(KINDS[0]);
    }

    /**
     * Adds the entry to the Mobile Studio menu, unless it is there.
     */
    function addEntry() {
        const list = document.querySelector(MOBILE_APPS)?.closest('ul');
        if (!list || list.querySelector(`[${CSS.escape(MARK)}]`)) {
            return;
        }
        // built like the entries of the menu, to look like them
        const item = make('li');
        item.className = 'mc-app-group-dropdown-app';
        item.setAttribute(MARK, '');
        const link = make('a');
        // the page finds its apps by the address after "#"; this entry must not be taken for one
        link.href = '#';
        link.title = TITLE;
        const group = make('span', undefined, 'Mobile Studio: ');
        group.className = 'sr-only';
        const name = make('span', undefined, TITLE);
        name.className = 'mc-app-name';
        link.append(group, name, ' ', icon());
        link.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            open();
        });
        item.append(link);
        list.append(item);
    }

    addEntry();
    // the menu is drawn after the page has loaded, and drawn again when the business unit changes
    new MutationObserver(addEntry).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
})();
