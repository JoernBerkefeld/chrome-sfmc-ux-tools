/*
 * SFMC UX Tools — content script for the Marketing Cloud page that holds the app menu.
 *
 * Transactional SMS, push and OTT (WhatsApp and the like) messages exist in Marketing Cloud's
 * API only; no app shows them. This adds an entry "Transactional Messages" to the Mobile Studio
 * menu, which opens a panel that lists those definitions and shows the details of one. It only
 * reads: the lists and the details come from Marketing Cloud's own server, through the page's
 * session.
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
     * @returns {Promise.<object>} the answer
     */
    async function ask(path) {
        const response = await fetch(API + path, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            redirect: 'error',
        });
        let answer;
        try {
            answer = await response.json();
        } catch {
            // an answer that is no JSON is told by its status
        }
        const isObject = typeof answer === 'object' && answer !== null;
        if (!isObject || !response.ok) {
            throw new Error(answer?.message || `Marketing Cloud answered with ${response.status}.`);
        }
        return answer;
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
            const answer = await ask(`${kind}/definitions?$page=${page}&$pageSize=${PAGE_SIZE}`);
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
     */
    function fail(error) {
        fill(make('p', 'error', `That did not work: ${error?.message || error}`));
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
            const definition = await ask(`${kind.id}/definitions/${encodeURIComponent(key)}`);
            // the id of the request says nothing about the definition
            delete definition.requestId;
            if (mine !== asked) {
                return;
            }
            const back = make('button', 'back', `← All ${kind.title} messages`);
            back.type = 'button';
            back.addEventListener('click', () => openList(kind));
            fill(back, show(definition));
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
     */
    async function openList(kind) {
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
        fill(make('p', 'hint', 'Loading …'));
        try {
            const rows = await readList(kind.id, () => mine === asked);
            if (mine !== asked) {
                return;
            }
            fill(
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
                fail(ex);
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
