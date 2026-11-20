/*
 * SFMC UX Tools — content script for the Marketing Cloud page that holds the app menu.
 *
 * Transactional SMS, push and OTT (WhatsApp and the like) messages exist in Marketing Cloud's
 * API only; no app shows them. When switched on in the options, where it is a preview feature
 * that is off, this adds an entry "Transactional Messages" to the Mobile Studio menu, which
 * opens a panel that lists those definitions, shows the details of one, creates and changes one
 * from a form and deletes one on request. The lists and the details come from
 * Marketing Cloud's own server, through the page's session, and so do the codes, keywords, apps
 * and contents that the forms let choose from and that the details name. A list is read once and kept while
 * the page lives; it is read again after a message was created, changed or deleted here, and
 * when "Refresh" is clicked. A list is read whole and shown in pages. What a list does not say of
 * a message, such as its code or its app, is read message by message once the list is on show,
 * and kept until the message changes. A new or changed message goes there
 * when its form is sent, and a delete only after a question that names the message. Before a
 * change or a delete, the message is read again and left alone if it is no longer the one shown.
 */
(() => {
    'use strict';

    const TITLE = 'Transactional Messages';
    // the setting that shows the entry; it is off until someone switches it on in the options
    const SETTING = 'transactionalMessages';
    const ON = 'on';
    // said wherever this script adds something, so that nobody takes it for Marketing Cloud's own
    const MADE_BY = 'SFMC UX Tools';
    const ICON = chrome.runtime.getURL('icons/icon16.png');
    const ISSUES = 'https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues';
    // where the page passes calls on to the REST API
    const API = '/cloud/fuelapi/';
    // the page refuses a PATCH request outright (seen live: 501 "Unsupported Request"); the API
    // takes a POST for one when this header says so
    const PATCH = 'PATCH';
    const OVERRIDE = 'X-HTTP-Method-Override';
    // the part of the API that holds the transactional messages
    const MESSAGES = 'messaging/v1/';
    // rows the API hands out per request unless asked otherwise
    const PAGE_SIZE = 50;
    // the largest page the API hands out of the definitions; it refuses to hand out a larger one
    // (seen live: 400 "pageSize must be an integer between 1 and 100")
    const LARGEST_PAGE = 100;
    // definitions the panel shows at a time; the rest of a list is a click on "Next" away
    const ROWS_SHOWN = 50;
    // details that are read at the same time, to leave Marketing Cloud's server to the page
    const DETAILS_AT_ONCE = 4;
    // Marketing Cloud keeps a deleted definition in its lists, with the status "Deleted"
    const NOT_DELETED = '$filter=status%20neq%20deleted';
    const MARK = 'data-sfmc-ux-tools-transactional';
    const NAME = 'sfmc-ux-tools-transactional';
    // the apps of Mobile Studio that the menu is recognised by
    const MOBILE_APPS = 'a[href$="#app/MobileConnect"], a[href$="#app/MobilePush"]';
    // the longest key of a transactional email; taken for these messages too, which nobody measured
    const KEY_MAX = 36;
    // the kind of Content Builder asset that holds a mobile message ("jsonmessage"); it is what
    // SFMC DevTools takes the content of a push message to be
    const MOBILE_MESSAGE = 230;
    // lines of the field a message is typed into
    const MESSAGE_ROWS = 8;
    // said of a stored code or keyword that the lists of the business unit do not hold
    const NOT_FOUND = ' — not found in this business unit';
    // set on the panel while it shows a list of messages: only the rows of the list scroll then
    const LISTING = `${NAME}-listing`;
    const SVG = 'http://www.w3.org/2000/svg';
    const REFRESH = 'Refresh';
    // said in the list below a field, in place of entries
    const READING = 'reading …';
    const NOTHING_OFFERED = 'This business unit has nothing to choose from here.';
    const NOTHING_MATCHES = 'Nothing in the list matches. The field takes what you typed as it is.';
    // said under a field whose list could not be read
    const NO_LIST = 'The list to choose from could not be read. Type the id or key.';
    /**
     * Lists what a new message is asked for, whatever its kind.
     *
     * @param {object} [status] what the status field of the kind has of its own, such as its options
     * @returns {object[]} the fields
     */
    const common = (status) => [
        { path: 'name', label: 'Name', isRequired: true },
        { path: 'definitionKey', label: 'Key', isRequired: true, max: KEY_MAX },
        { path: 'description', label: 'Description' },
        {
            path: 'status',
            label: 'Status',
            input: 'select',
            options: ['Active', 'Inactive'],
            ...status,
        },
    ];
    /**
     * Puts together the parts of a label that are there.
     *
     * @param {...unknown} parts what the API returned
     * @returns {string} the texts among them, with a dot in between
     */
    const joined = (...parts) =>
        parts.filter((part) => typeof part === 'string' && part).join(' · ');
    // lists of the business unit that a field offers to choose from, each entry with the value
    // to send and the name to show for it
    const SUGGESTIONS = {
        codes: {
            path: 'legacy/v1/beta/mobile/code/',
            // two codes of one country are told apart by the code itself and by what kind it is
            read: (answer) =>
                (answer.entry || []).map((item) => ({
                    value: item.code,
                    label: joined(
                        item.code,
                        item.countryCode,
                        typeof item.isShortCode === 'boolean' &&
                            (item.isShortCode ? 'short code' : 'long code'),
                        item.codeType,
                    ),
                })),
        },
        keywords: {
            path: 'legacy/v1/beta/mobile/keyword/',
            // a keyword belongs to one code; the same word under another code is another entry
            read: (answer) =>
                (answer.entry || []).map((item) => ({
                    value: item.keyword,
                    label: item.keyword,
                    within: item.code?.code,
                })),
        },
        apps: {
            path: 'push/v1/application',
            read: (answer) =>
                (Array.isArray(answer) ? answer : []).map((item) => ({
                    value: item.id,
                    label: item.name,
                })),
        },
        contents: {
            path: 'asset/v1/content/assets',
            query: `$filter=assetType.id%20eq%20${MOBILE_MESSAGE}&$fields=name,customerKey,availableViews`,
            // comes in pages, under this name
            pages: 'items',
            // a mobile message is written for one use, which it names as its view: push, sms or
            // inApp, in whatever case. Seen on a business unit with push definitions: every one of
            // them holds a message written for push
            read: (items) =>
                items
                    .filter(
                        (item) =>
                            Array.isArray(item.availableViews) &&
                            item.availableViews.some(
                                (view) => String(view).toLowerCase() === 'push',
                            ),
                    )
                    .map((item) => ({ value: item.customerKey, label: item.name })),
        },
    };
    const KINDS = [
        {
            id: 'sms',
            title: 'SMS',
            fields: [
                ...common(),
                {
                    path: 'content.message',
                    label: 'Message',
                    input: 'textarea',
                    isRequired: true,
                },
                {
                    path: 'subscriptions.shortCode',
                    label: 'Code',
                    isRequired: true,
                    choose: 'codes',
                    help: 'The short or long code the message is sent from. A long code starts with the number of its country.',
                },
                {
                    path: 'subscriptions.keyword',
                    label: 'Keyword',
                    isRequired: true,
                    choose: 'keywords',
                    // only the keywords of the code that is chosen in this field
                    within: 'subscriptions.shortCode',
                },
                {
                    path: 'subscriptions.countryCode',
                    label: 'Country code',
                    help: 'For a short code only: the two letters of its country, such as US.',
                },
                {
                    path: 'subscriptions.autoAddSubscriber',
                    label: 'Add the recipient as a subscriber if they are new',
                    input: 'checkbox',
                },
                {
                    path: 'subscriptions.updateSubscriber',
                    label: 'Update the subscriber with what the request brings',
                    input: 'checkbox',
                    // Marketing Cloud takes this one only together with the other
                    needs: 'subscriptions.autoAddSubscriber',
                },
                {
                    path: 'options.urlShortenerOptions.isLinkShorteningEnabled',
                    label: 'Shorten the links in the message',
                    input: 'checkbox',
                    // a new message does not name it unless it is ticked
                    isOptional: true,
                },
                {
                    path: 'options.urlShortenerOptions.isSubscriberTrackingEnabled',
                    label: 'Track the shortened links by subscriber',
                    input: 'checkbox',
                    isOptional: true,
                },
            ],
            // what the list shows of a message that only its details hold
            columns: [
                { title: 'Code', field: 'subscriptions.shortCode', isDetail: true },
                { title: 'Keyword', field: 'subscriptions.keyword', isDetail: true },
            ],
        },
        {
            id: 'push',
            title: 'Push',
            fields: [
                ...common({
                    // seen live: push has a third status, and a message created as anything
                    // but Active is stored with it
                    options: ['Active', 'Inactive', 'Draft'],
                    whenNew:
                        'Marketing Cloud stores a new push message as Draft unless it is Active.',
                }),
                {
                    path: 'applicationId',
                    label: 'App',
                    isRequired: true,
                    suggest: 'apps',
                    isNamed: true,
                },
                {
                    path: 'content.customerKey',
                    label: 'Content',
                    // seen live: without content the API refuses the message
                    isRequired: true,
                    suggest: 'contents',
                    isNamed: true,
                    help: 'The customer key of the push message in Content Builder.',
                },
                { path: 'options.sound', label: 'Sound' },
                { path: 'options.badge', label: 'Badge' },
            ],
            // shown by the name that the list of the business unit has for the id or the key
            columns: [
                { title: 'App', field: 'applicationId', isDetail: true, names: 'apps' },
                {
                    title: 'Content',
                    field: 'content.customerKey',
                    isDetail: true,
                    names: 'contents',
                },
            ],
        },
        {
            id: 'ott',
            title: 'OTT',
            fields: [
                ...common(),
                {
                    path: 'senderType',
                    label: 'Sender type',
                    input: 'select',
                    options: ['WhatsApp'],
                    isRequired: true,
                },
                {
                    path: 'senderId',
                    label: 'Sender ID',
                    isRequired: true,
                    help: 'For WhatsApp: the phone number of the sender.',
                },
                {
                    path: 'content.customerKey',
                    label: 'Content',
                    isRequired: true,
                    help: 'The customer key of the message in Content Builder.',
                },
            ],
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
        { title: 'Created', field: 'createdDate', isDate: true },
        { title: 'Modified', field: 'modifiedDate', isDate: true },
    ];
    // the column that those of a kind of message come after
    const BEFORE_DETAILS = 'status';
    const SORT = 'Sort by this column; again to turn the order around';
    const SORT_LATER = 'This column can be sorted by once the details of all messages are read.';
    const UNREAD =
        'Some details could not be read. They are asked for again when the list is shown next.';
    // writes what a list is searched by: "name or key"
    const EITHER = new Intl.ListFormat('en', { type: 'disjunction' });
    // the fields of a definition that hold a date, wherever they are shown
    const DATES = new Set(COLUMNS.filter((column) => column.isDate).map((column) => column.field));
    // a date and time as the API writes it; the first group is its time zone, which may be missing
    const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i;
    // what a list is searched by
    const SEARCHED = ['name', 'definitionKey'];
    // what the details call a field of a definition, by its path; a field that is not in here
    // is shown under the name the API has for it
    const LABELS = new Map([
        ['name', 'Name'],
        ['definitionKey', 'Key'],
        ['definitionId', 'ID'],
        ['description', 'Description'],
        ['status', 'Status'],
        ['createdDate', 'Created'],
        ['modifiedDate', 'Modified'],
        ['applicationId', 'App'],
        ['senderType', 'Sender type'],
        ['senderId', 'Sender ID'],
        ['content', 'Content'],
        ['content.message', 'Message'],
        ['content.customerKey', 'Content key'],
        ['subscriptions', 'Subscription'],
        ['subscriptions.shortCode', 'Code'],
        ['subscriptions.countryCode', 'Country code'],
        ['subscriptions.keyword', 'Keyword'],
        ['subscriptions.autoAddSubscriber', 'Add new subscribers'],
        ['subscriptions.updateSubscriber', 'Update subscribers'],
        ['options', 'Options'],
        ['options.sound', 'Sound'],
        ['options.badge', 'Badge'],
        ['options.isReconcilable', 'Reconcilable'],
        ['options.urlShortenerOptions', 'Link shortener'],
        ['options.urlShortenerOptions.isLinkShorteningEnabled', 'Shorten links'],
        ['options.urlShortenerOptions.isSubscriberTrackingEnabled', 'Track by subscriber'],
        ['options.urlShortenerOptions.shortenerType', 'Shortener type'],
    ]);
    // the lists as they were read, by their kind: {rows, readAt}. A kind that is not in here is
    // read when its list is shown next
    const lists = new Map();
    // what the user searches and sorts each list by and the page of it on show, counted from 0,
    // kept while the page lives
    const views = new Map(
        KINDS.map((kind) => [
            kind.id,
            { search: '', field: undefined, isReversed: false, page: 0 },
        ]),
    );
    // what was read of single messages, by their kind and then by their key: {definition,
    // modifiedDate}, the latter as the row of the list had it that the details were read for. It
    // outlives the lists, so that a list that is read again asks only for what is new or changed
    const details = new Map(KINDS.map((kind) => [kind.id, new Map()]));
    // the details that are being read right now, by kind and key, for all lists together
    const reading = new Map();
    // lets the list on show go on reading details when one of them has come
    let wake = () => {};
    // counts what may have made a list another one than the one being read: every request that
    // changes a message, when it goes out and when it is over, and every menu that is drawn again
    let changed = 0;
    // the lists the fields offer to choose from, by their name: with the entries once they are
    // read, with those who wait for them while they are being read. A list that could not be
    // read is not in here, and is asked for again the next time
    const offers = new Map();

    let dialog;
    let body;
    let note;
    let tabs;
    // counts what was asked for, so that a late answer for something else is dropped
    let asked = 0;
    // counts the forms, to give the lists of their fields names of their own
    let forms = 0;

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
     * @param {string} path address below the API
     * @param {string} [method] GET to read, POST to create, PATCH to change, DELETE to delete
     * @param {object} [content] what to send along
     * @returns {Promise.<object>} the answer; an error with isUnanswered when none came
     */
    async function ask(path, method = 'GET', content) {
        let response;
        try {
            response = await fetch(API + path, {
                body: content && JSON.stringify(content),
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    ...(content && { 'Content-Type': 'application/json' }),
                    ...(method === PATCH && { [OVERRIDE]: PATCH }),
                },
                method: method === PATCH ? 'POST' : method,
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
     * Reads a list the API hands out in pages, page by page.
     *
     * @param {string} path where the list is
     * @param {string} query what else to ask for, such as a filter
     * @param {string} field name the rows of a page come under
     * @param {() => boolean} isWanted false once nobody waits for the rest any more
     * @param {number} [size] rows to ask for at a time
     * @returns {Promise.<object[]>} the rows
     */
    async function readPages(path, query, field, isWanted, size = PAGE_SIZE) {
        const rows = [];
        let before;
        // asked between the pages only: the first one is always read
        for (let page = 1; page === 1 || isWanted(); page++) {
            const answer = await ask(`${path}?$page=${page}&$pageSize=${size}&${query}`);
            const found = Array.isArray(answer[field]) ? answer[field] : [];
            const first = JSON.stringify(found[0]);
            // the same rows again: the page asked for was ignored, and would be for ever
            if (first === before || found.length === 0) {
                break;
            }
            before = first;
            rows.push(...found);
            // only a short page is the last one. The count of the answer does not tell: for the
            // definitions it is the number of rows in this page, not in the list (seen live)
            if (found.length < size) {
                break;
            }
        }
        return rows;
    }

    /**
     * Forgets the lists that were read: they are those of the business unit the menu was drawn
     * for before.
     */
    function forget() {
        lists.clear();
        offers.clear();
        for (const kept of details.values()) {
            kept.clear();
        }
        changed++;
    }

    /**
     * Keeps the details of a message for the lists.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {object} definition the definition as it was read
     * @param {unknown} modifiedDate when it was last changed, as the list says it or, without a list, the definition itself
     */
    function keep(kind, key, definition, modifiedDate) {
        details.get(kind.id).set(key, { definition, modifiedDate });
    }

    /**
     * Looks up the details that were read of a row of a list.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @returns {object|undefined} the definition; nothing when it was not read, or changed since
     */
    function detailsOf(kind, row) {
        const kept = details.get(kind.id).get(row?.definitionKey);
        return kept && kept.modifiedDate === row.modifiedDate ? kept.definition : undefined;
    }

    /**
     * Reads a list that fields offer to choose from, once for everyone who asks while the page
     * lives: the details, the forms and the lists share it. A list that cannot be read, was
     * stopped halfway or was forgotten meanwhile is not kept.
     *
     * @param {string} name codes, keywords, apps or contents
     * @param {() => boolean} isWanted false once the one who asks no longer waits for it; a list that comes in pages is read on while anyone does
     * @returns {Promise.<{value: string, label: string}[]|undefined>} the entries; nothing when they could not be read
     */
    function readOffers(name, isWanted) {
        const kept = offers.get(name);
        if (kept) {
            kept.wanted.push(isWanted);
            return kept.promise;
        }
        const from = SUGGESTIONS[name];
        const offer = { wanted: [isWanted] };
        let isWhole = true;
        const isRead = async () => {
            try {
                const answer = from.pages
                    ? await readPages(from.path, from.query, from.pages, () => {
                          isWhole = offer.wanted.some((wants) => wants());
                          return isWhole;
                      })
                    : await ask(from.path);
                if (isWhole && offers.get(name) === offer) {
                    // only what can be chosen
                    offer.entries = from
                        .read(answer)
                        .filter(({ value }) => typeof value === 'string' && value)
                        .map((entry) => ({
                            ...entry,
                            label: typeof entry.label === 'string' ? entry.label : '',
                        }));
                }
            } catch {
                // whoever asked does without the list
            }
            offer.wanted = [];
            if (!offer.entries && offers.get(name) === offer) {
                offers.delete(name);
            }
            return offer.entries;
        };
        offers.set(name, offer);
        offer.promise = isRead();
        return offer.promise;
    }

    /**
     * Looks up what an entry of a list is called, in what was read of that list so far.
     *
     * @param {string} name codes, keywords, apps or contents
     * @param {unknown} value what a definition holds: a code, a keyword, the id of an app or the customer key of a content
     * @returns {string|undefined} its name; nothing when the list was not read or does not hold it
     */
    function nameOf(name, value) {
        return (
            offers.get(name)?.entries?.find((entry) => entry.value === value)?.label || undefined
        );
    }

    /**
     * Builds the place that names what a field holds, which stays empty until the list is read
     * and whenever the list does not hold the value.
     *
     * @param {string} name the list the value is one of
     * @param {() => unknown} read reads the value
     * @returns {{element: HTMLElement, draw: () => void}} the place, and what to call when the value has changed
     */
    function resolved(name, read) {
        const element = make('span', 'resolved');
        const draw = () => {
            const found = nameOf(name, read());
            element.textContent = found || '';
            element.hidden = !found;
        };
        const drawLater = async () => {
            await readOffers(name, () => element.isConnected);
            draw();
        };
        draw();
        drawLater();
        return { element, draw };
    }

    /**
     * Sends a request that changes a message. Whatever comes of it, also nothing at all, the
     * list of its kind and the details of that message may no longer be what was read, and are
     * read again when the list is shown next.
     *
     * @param {{id: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {string} method POST to create, PATCH to change, DELETE to delete
     * @param {object} [content] what to send along
     * @returns {Promise.<object>} the answer
     */
    async function write(kind, key, method, content) {
        // a new one is sent to the definitions themselves, with its key in what is sent
        const path = method === 'POST' ? '' : `/${encodeURIComponent(key)}`;
        const stale = () => {
            lists.delete(kind.id);
            // the list would not tell: it has the minute of the last change, and a second change
            // within that minute leaves it as it is
            details.get(kind.id).delete(key);
            changed++;
        };
        stale();
        try {
            return await ask(`${MESSAGES}${kind.id}/definitions${path}`, method, content);
        } finally {
            // a list that was read while the request was on its way may be the one from before it
            stale();
        }
    }

    /**
     * Writes a date of the API in the reader's language and time zone. A value that names no
     * time zone is shown with the hours it has, because nobody has seen which zone it is meant in.
     *
     * @param {unknown} value what the API returned
     * @param {string} [locale] language to write it in; the browser's when left out
     * @param {string} [timeZone] time zone to write it in; the browser's when left out
     * @returns {string} date and time; the value as it is when it is no date
     */
    function formatDate(value, locale, timeZone) {
        const raw = String(value ?? '');
        const parts = ISO.exec(raw);
        if (!parts) {
            return raw;
        }
        const hasZone = Boolean(parts[1]);
        const date = new Date(hasZone ? raw : `${raw}Z`);
        // the right shape, but no such day or hour
        if (Number.isNaN(date.getTime())) {
            return raw;
        }
        return date.toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: hasZone ? timeZone : 'UTC',
        });
    }
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the tests call it with a language and a time zone of their own, which nothing else of this script lets them
    globalThis.sfmcUxToolsFormatDate = formatDate;

    /**
     * Puts a date into an element, with the value of the API to be read when the mouse rests on it.
     *
     * @param {HTMLElement} element where the date is shown
     * @param {unknown} value what the API returned
     * @returns {HTMLElement} the element
     */
    function stamp(element, value) {
        element.textContent = formatDate(value);
        if (typeof value === 'string' && value) {
            element.title = value;
        }
        return element;
    }

    /**
     * Reads all definitions of a kind.
     *
     * @param {string} kind sms, push or ott
     * @param {() => boolean} isWanted false once something else was asked for or the panel was closed
     * @returns {Promise.<object[]>} the definitions
     */
    function readList(kind, isWanted) {
        return readPages(
            `${MESSAGES}${kind}/definitions`,
            NOT_DELETED,
            'definitions',
            isWanted,
            LARGEST_PAGE,
        );
    }

    /**
     * Shows a value of a definition: text, or its parts by what they are called here. The name
     * the API has for a part is to be read when the mouse rests on it.
     *
     * @param {unknown} value what the API returned
     * @param {Map.<string, string>} [named] the list that names a value, by the path of its field
     * @param {string} [path] names from the definition down to the value, joined by dots
     * @returns {HTMLElement} the element that shows it
     */
    function show(value, named = new Map(), path = '') {
        if (value === null || typeof value !== 'object') {
            return make('span', 'value', String(value));
        }
        const entries = Object.entries(value);
        if (entries.length === 0) {
            return make('span', 'value', '(none)');
        }
        const list = make('dl', 'fields');
        for (const [key, part] of entries) {
            const at = path ? `${path}.${key}` : key;
            const title = make('dt', undefined, LABELS.get(at) ?? key);
            title.title = at;
            const cell = make('dd');
            cell.append(
                typeof part === 'string' && DATES.has(key)
                    ? stamp(make('span', 'value'), part)
                    : show(part, named, at),
            );
            if (typeof part === 'string' && named.has(at)) {
                cell.append(resolved(named.get(at), () => part).element);
            }
            list.append(title, cell);
        }
        return list;
    }

    /**
     * Replaces what the panel shows.
     *
     * @param {...(Node|string)} content what to show
     */
    function fill(...content) {
        // only a list of messages keeps the panel from scrolling, and says so itself
        dialog.classList.remove(LISTING);
        body.replaceChildren(...content);
    }

    /**
     * Creates a part of a drawing.
     *
     * @param {string} tag name of the element
     * @param {Object.<string, string>} attributes what it is drawn with
     * @returns {SVGElement} the part
     */
    function shape(tag, attributes) {
        const element = document.createElementNS(SVG, tag);
        for (const [name, value] of Object.entries(attributes)) {
            element.setAttribute(name, value);
        }
        return element;
    }

    /**
     * Draws the sign for reading something again: an arrow that runs round in a circle.
     *
     * @returns {SVGElement} the sign, in the colour of the text around it
     */
    function reloadSign() {
        const sign = shape('svg', {
            class: `${NAME}-sign`,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '1.5',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false',
        });
        sign.append(
            // the circle, open at the top right, and the head of the arrow there
            shape('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9' }),
            shape('path', { d: 'M13.5 2v3.5H10' }),
        );
        return sign;
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
        const definition = await ask(
            `${MESSAGES}${kind.id}/definitions/${encodeURIComponent(key)}`,
        );
        // the id of the request says nothing about the definition
        delete definition.requestId;
        return definition;
    }

    /**
     * Reads the details of a row of a list and keeps them, unless a message was changed here or
     * the business unit left meanwhile. Details that cannot be read are done without.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @returns {Promise.<void>} over once the details are kept, or not to be had
     */
    function readDetails(kind, row) {
        const key = row.definitionKey;
        const id = `${kind.id} ${key}`;
        const before = changed;
        const isRead = async () => {
            try {
                const definition = await readDefinition(kind, key);
                if (before === changed) {
                    keep(kind, key, definition, row.modifiedDate);
                }
            } catch {
                // the row stays without them until its list is shown next
            }
            reading.delete(id);
            wake();
        };
        const read = isRead();
        reading.set(id, read);
        return read;
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
            await write(kind, key, 'DELETE');
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
     * Builds an entry of a list to choose from.
     *
     * @param {string} value what is sent
     * @param {string} label what is shown
     * @returns {HTMLOptionElement} the entry
     */
    function choice(value, label) {
        const option = make('option', undefined, label);
        option.value = value;
        return option;
    }

    /**
     * Puts a list of the business unit below a text field, to choose from: all of it whenever
     * the field is entered or clicked, whatever the field holds, and what matches the name or
     * the value while the user types. The field takes any text, with its list and without; a
     * list that cannot be read is done without, and the rest of one is not read for a form that
     * was closed meanwhile.
     *
     * @param {HTMLInputElement} input the text field
     * @param {string} id name for the list and its entries
     * @param {string} name codes, keywords, apps or contents
     * @returns {HTMLElement} the field with its list
     */
    function combo(input, id, name) {
        const box = make('div', 'combo');
        const drop = make('div', 'combo-drop');
        const status = make('div', 'combo-status');
        const list = make('div', 'combo-list');
        list.id = id;
        list.setAttribute('role', 'listbox');
        drop.hidden = true;
        drop.append(status, list);
        box.append(input, drop);
        input.autocomplete = 'off';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', id);
        input.setAttribute('aria-expanded', 'false');
        // taken away when the list cannot be read: the field is a plain text field then
        const wired = new AbortController();
        const on = (target, type, listener) =>
            target.addEventListener(type, listener, { signal: wired.signal });
        // nothing while the list is being read
        let entries;
        // what the user typed to narrow the list down, in small letters; empty for all of it
        let typed = '';
        // the entries on show, and the one among them that the arrow keys are at
        let shown = [];
        let active;
        // true while an entry is put into the field, which is no typing
        let isChoosing = false;

        const close = () => {
            drop.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        };
        const choose = (entry) => {
            isChoosing = true;
            input.value = entry.value;
            // as if it was typed: the name under the field and the form hear of it
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            isChoosing = false;
            typed = '';
            close();
        };
        const draw = () => {
            const current = input.value.trim();
            shown = (entries || []).filter(
                ({ value, label }) =>
                    value.toLowerCase().includes(typed) || label.toLowerCase().includes(typed),
            );
            if (!shown.includes(active)) {
                active = undefined;
            }
            let at;
            list.replaceChildren(
                ...shown.map((entry) => {
                    const option = make('div', 'combo-option');
                    option.id = `${id}-${entries.indexOf(entry)}`;
                    option.setAttribute('role', 'option');
                    option.setAttribute('aria-selected', String(entry.value === current));
                    option.append(
                        make('span', 'combo-name', entry.label || entry.value),
                        make('span', 'combo-value', entry.value),
                    );
                    // before the field loses the focus, which would close the list
                    option.addEventListener('mousedown', () => choose(entry));
                    if (entry === active) {
                        option.classList.add(`${NAME}-combo-active`);
                        at = option;
                    }
                    return option;
                }),
            );
            status.textContent = NOTHING_MATCHES;
            if (!entries) {
                status.textContent = READING;
            } else if (entries.length === 0) {
                status.textContent = NOTHING_OFFERED;
            }
            status.hidden = shown.length > 0;
            if (at && !drop.hidden) {
                input.setAttribute('aria-activedescendant', at.id);
                at.scrollIntoView({ block: 'nearest' });
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        };
        const open = () => {
            // what the field holds is where the keys start from
            const current = input.value.trim();
            active = (entries || []).find((entry) => entry.value === current);
            drop.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            draw();
        };
        const openAll = () => {
            typed = '';
            open();
        };
        const move = (step) => {
            if (shown.length === 0) {
                return;
            }
            const index = shown.indexOf(active);
            const last = shown.length - 1;
            const from = step > 0 ? last : 0;
            const to = step > 0 ? 0 : last;
            active = shown[index === -1 || index === from ? to : index + step];
            draw();
        };
        const keys = {
            ArrowDown: (event) => {
                event.preventDefault();
                if (drop.hidden) {
                    openAll();
                } else {
                    move(1);
                }
            },
            ArrowUp: (event) => {
                event.preventDefault();
                if (drop.hidden) {
                    openAll();
                } else {
                    move(-1);
                }
            },
            Enter: (event) => {
                if (drop.hidden) {
                    return;
                }
                // closes the list; the form is sent by the next one
                event.preventDefault();
                if (active) {
                    choose(active);
                } else {
                    close();
                }
            },
            Escape: (event) => {
                if (drop.hidden) {
                    return;
                }
                // closes the list, not the panel
                event.preventDefault();
                event.stopPropagation();
                close();
            },
            Tab: close,
        };
        on(input, 'focus', openAll);
        // every click, also into a field that holds something
        on(input, 'click', openAll);
        on(input, 'blur', close);
        on(input, 'input', () => {
            if (isChoosing) {
                return;
            }

            typed = input.value.trim().toLowerCase();
            open();
        });
        on(input, 'keydown', (event) => {
            if (Object.hasOwn(keys, event.key)) {
                keys[event.key](event);
            }
        });
        // a click into the list, also on its scrollbar, leaves the focus in the field
        on(drop, 'mousedown', (event) => event.preventDefault());
        const read = async () => {
            const found = await readOffers(name, () => input.isConnected);
            if (found) {
                entries = found;
                // an open list stays open, narrowed down by what was typed meanwhile
                if (drop.hidden) {
                    draw();
                } else {
                    open();
                }
                return;
            }
            wired.abort();
            for (const attribute of [
                'role',
                'aria-autocomplete',
                'aria-controls',
                'aria-expanded',
                'aria-activedescendant',
            ]) {
                input.removeAttribute(attribute);
            }
            drop.replaceWith(make('span', 'help', NO_LIST));
        };
        draw();
        read();
        return box;
    }

    /**
     * Fills a list to choose from with entries, and with what was stored when they do not
     * have it.
     *
     * @param {HTMLSelectElement} select the list
     * @param {string} hint what its first, empty entry says
     * @param {{value: string, label: string}[]} entries what to choose from
     * @param {string} kept what was stored; empty when nothing was, or when it does not belong here
     * @param {string} value what to choose, if the list has it
     */
    function offer(select, hint, entries, kept, value) {
        const isMissing = kept && entries.every((entry) => entry.value !== kept);
        select.replaceChildren(
            choice('', hint),
            ...entries.map((entry) => choice(entry.value, entry.label || entry.value)),
            ...(isMissing ? [choice(kept, kept + NOT_FOUND)] : []),
        );
        select.value = [...select.options].some((item) => item.value === value) ? value : '';
    }

    /**
     * Turns two text fields of a form into lists to choose from, the second with the entries
     * that belong to what the first holds, once both lists of the business unit are read. Without
     * them, or when one of them is empty, the fields stay as they are and take any text. What a
     * field held is kept, also when the lists do not have it.
     *
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path; gets the lists in place of the text fields
     * @param {{path: string, label: string, choose: string}} first the field that is chosen first, such as the code
     * @param {{path: string, label: string, choose: string}} second the field that depends on it, such as the keyword
     */
    async function chooseBoth(inputs, first, second) {
        const typed = [inputs.get(first.path), inputs.get(second.path)];
        const isShown = () => typed[0].isConnected;
        const [all, dependents] = await Promise.all([
            readOffers(first.choose, isShown),
            readOffers(second.choose, isShown),
        ]);
        // a field that cannot show what is stored stays switched off, as the text field it is
        if (!all?.length || !dependents?.length || !isShown() || typed.some((it) => it.disabled)) {
            return;
        }
        const stored = [held(first, typed[0]), held(second, typed[1])];
        const [chosen, dependent] = [first, second].map((spec, index) => {
            const select = make('select');
            select.name = spec.path;
            select.required = Boolean(spec.isRequired);
            const isFocused = document.activeElement === typed[index];
            typed[index].replaceWith(select);
            inputs.set(spec.path, select);
            if (isFocused) {
                select.focus();
            }
            return select;
        });
        const [one, other] = [first.label.toLowerCase(), second.label.toLowerCase()];
        const offerDependents = (value) => {
            const within = chosen.value;
            // an entry that does not say what it belongs to is offered everywhere
            const own = dependents.filter((entry) => String(entry.within ?? within) === within);
            // what was stored belongs to what it was stored with
            const kept = within === stored[0] ? stored[1] : '';
            let hint = `Choose the ${one} first`;
            if (within) {
                hint =
                    kept || own.length > 0 ? `Choose a ${other} …` : `This ${one} has no ${other}`;
            }
            offer(dependent, hint, within ? own : [], kept, value);
            dependent.disabled = !within;
        };
        offer(chosen, `Choose a ${one} …`, all, stored[0], stored[0]);
        offerDependents(stored[1]);
        // another code: the keyword stays only when the new code has it too
        chosen.addEventListener('change', () => offerDependents(dependent.value));
    }

    /**
     * Builds the field of a form.
     *
     * @param {object} spec what the field is, from the list of its kind of message
     * @param {string} id name for what belongs to the field
     * @param {boolean} isNew true in the form for a new message
     * @returns {{row: HTMLElement, input: HTMLElement}} the line of the form and the field in it
     */
    function field(spec, id, isNew) {
        // a field with a list below it is no label as a whole: a click into the list would
        // count as one into the field
        const row = make(spec.suggest ? 'div' : 'label', 'field');
        let input;
        if (spec.input === 'select') {
            input = make('select');
            for (const value of spec.options) {
                input.append(make('option', undefined, value));
            }
        } else if (spec.input === 'textarea') {
            input = make('textarea');
            input.rows = MESSAGE_ROWS;
        } else {
            input = make('input');
            input.type = spec.input === 'checkbox' ? 'checkbox' : 'text';
        }
        input.name = spec.path;
        input.required = Boolean(spec.isRequired);
        if (spec.max) {
            input.maxLength = spec.max;
        }
        const title = make(
            spec.suggest ? 'label' : 'span',
            'label',
            spec.label + (spec.isRequired ? ' *' : ''),
        );
        if (spec.suggest) {
            input.id = `${id}-field`;
            title.htmlFor = input.id;
            row.append(title, combo(input, id, spec.suggest));
        } else {
            // a checkbox stands before its words
            row.append(...(input.type === 'checkbox' ? [input, title] : [title, input]));
        }
        if (spec.isNamed) {
            const { element, draw } = resolved(spec.suggest, () => input.value.trim());
            // typing and choosing from the list both come as this
            input.addEventListener('input', draw);
            row.append(element);
        }
        if (spec.help) {
            row.append(make('span', 'help', spec.help));
        }
        if (isNew && spec.whenNew) {
            row.append(make('span', 'help', spec.whenNew));
        }
        return { row, input };
    }

    /**
     * Turns what a form holds into what the API takes. Text that was left empty is left out, and
     * so is a tick that a new message need not name and that was not set.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @returns {object} the definition
     */
    function toDefinition(specs, inputs) {
        const definition = {};
        for (const { path, input: type, isOptional } of specs) {
            const value = held({ input: type }, inputs.get(path));
            if (value === '' || (isOptional && value === false)) {
                continue;
            }
            const names = path.split('.');
            const last = names.pop();
            let at = definition;
            for (const name of names) {
                at[name] ||= {};
                at = at[name];
            }
            at[last] = value;
        }
        return definition;
    }

    /**
     * Says whether keys are to be made from names, as the options of the extension have it.
     *
     * @returns {Promise.<boolean>} false when the user switched that off
     */
    async function isKeyFromName() {
        try {
            const { readableKeys } = await chrome.storage.sync.get({ readableKeys: 'on' });
            return readableKeys === 'on';
        } catch {
            // without the setting it stays switched on
            return true;
        }
    }

    /**
     * Checks that a form has everything it must have, and points at what is missing.
     *
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @returns {boolean} true when it can be sent
     */
    function isComplete(form, inputs) {
        // blanks alone are no entry: a required field that holds nothing else counts as empty
        for (const input of inputs.values()) {
            if (input.type === 'text') {
                input.value = input.value.trim();
            }
        }
        return form.reportValidity();
    }

    /**
     * Sends a new definition and shows what became of it.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @param {HTMLElement} says where a refusal is shown
     */
    async function create(kind, form, inputs, says) {
        const buttons = [...form.querySelectorAll('button')];
        // one is on its way already (its buttons are switched off until it is answered), or a
        // required field is empty
        if (buttons.some((button) => button.disabled) || !isComplete(form, inputs)) {
            return;
        }
        const mine = ++asked;
        for (const button of buttons) {
            button.disabled = true;
        }
        const definition = toDefinition(kind.fields, inputs);
        const called = `“${definition.name}” (key ${definition.definitionKey})`;
        try {
            await write(kind, definition.definitionKey, 'POST', definition);
            // an answer that comes after the user went elsewhere is not shown
            if (mine === asked) {
                openDetails(kind, definition.definitionKey, `Created ${called}.`);
            }
        } catch (ex) {
            if (mine !== asked) {
                return;
            }
            if (ex.isUnanswered) {
                openList(
                    kind,
                    `It is not known whether ${called} was created: ${ex.message} Look for it in the list.`,
                );
                return;
            }
            // what was typed stays, to be put right
            says.textContent = `Not created: ${ex.message}`;
            says.hidden = false;
            for (const button of buttons) {
                button.disabled = false;
            }
        }
    }

    /**
     * Reads a value of a definition by the path of its field.
     *
     * @param {object} definition the definition
     * @param {string} path names from the definition down to the value, joined by dots
     * @returns {unknown} the value, undefined when it is not there
     */
    function valueAt(definition, path) {
        let at = definition;
        for (const name of path.split('.')) {
            at = at?.[name];
        }
        return at;
    }

    /**
     * Reads what a field of a form holds.
     *
     * @param {{input?: string}} spec what the field is
     * @param {HTMLElement} input the field
     * @returns {string|boolean} a tick, or text; the text of a message as typed, other text without the blanks around it
     */
    function held(spec, input) {
        if (spec.input === 'checkbox') {
            return input.checked;
        }
        return spec.input === 'textarea' ? input.value : input.value.trim();
    }

    /**
     * Collects what a form changes of a definition, as the API takes it: every part of the
     * definition that has a changed field, whole, however deep in it the field is. A part is sent with everything Marketing Cloud
     * holds in it, also what the form does not know, because nobody has seen whether the API
     * keeps what is left out of a part.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @param {object} loaded the definition the form was filled from
     * @param {Map.<string, string|boolean>} filled what each field held when the form was filled
     * @returns {{changes: object, paths: string[]}} what to send, and the fields that differ
     */
    function toChanges(specs, inputs, loaded, filled) {
        const changes = {};
        const paths = [];
        for (const spec of specs) {
            const value = held(spec, inputs.get(spec.path));
            // changed is what the user changed in the form. Holding the field against the
            // definition would also catch what a field cannot show as it is stored, such as a
            // number, line breaks or blanks around a text, and send that back altered
            if (value === filled.get(spec.path) || spec.path === 'definitionKey') {
                continue;
            }
            paths.push(spec.path);
            const names = spec.path.split('.');
            const last = names.pop();
            let at = changes;
            let from = loaded;
            // every part on the way down is copied once, so that the definition the form was
            // filled from stays as it was read
            for (const name of names) {
                from = from?.[name];
                if (at[name] === undefined || at[name] === from) {
                    at[name] = typeof from === 'object' && from !== null ? { ...from } : {};
                }
                at = at[name];
            }
            at[last] = value;
        }
        return { changes, paths };
    }

    /**
     * Sends the changes of a definition, unless it is no longer the one the form was filled
     * from, and shows what became of them.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {HTMLFormElement} form the form
     * @param {Map.<string, HTMLElement>} inputs its fields by their path
     * @param {HTMLElement} says where a refusal is shown
     * @param {object} loaded the definition the form was filled from
     * @param {Map.<string, string|boolean>} filled what each field held when the form was filled
     */
    async function save(kind, form, inputs, says, loaded, filled) {
        const buttons = [...form.querySelectorAll('button')];
        // one is on its way already, or a required field is empty
        if (buttons.some((button) => button.disabled) || !isComplete(form, inputs)) {
            return;
        }
        const key = loaded.definitionKey;
        const { changes, paths } = toChanges(kind.fields, inputs, loaded, filled);
        // what an earlier try said no longer holds
        says.hidden = true;
        if (paths.length === 0) {
            says.textContent = 'Nothing was changed, so nothing was sent.';
            says.hidden = false;
            return;
        }
        const mine = ++asked;
        for (const button of buttons) {
            button.disabled = true;
        }
        const called = `“${loaded.name}” (key ${key})`;
        // how far it got: the check before, the request itself, the look at what came of it
        let step = 'check';
        try {
            // as before a delete: the request names only the key, which another business unit
            // may hold too, and someone else may have changed the message since it was read
            const current = await readDefinition(kind, key);
            if (mine !== asked) {
                // the user went elsewhere before anything was sent: nothing is saved
                return;
            }
            if (JSON.stringify(current) !== JSON.stringify(loaded)) {
                throw new Error(
                    'what Marketing Cloud holds under this key is no longer what this form was filled from. Was it changed meanwhile, or the business unit changed in another tab? Open the message again.',
                );
            }
            step = 'send';
            await write(kind, key, PATCH, changes);
            if (mine !== asked) {
                return;
            }
            step = 'read';
            // an answer that all went well was never seen for a real message: what Marketing
            // Cloud holds now is read and held against what was sent
            const now = await readDefinition(kind, key);
            if (mine !== asked) {
                return;
            }
            const missed = paths.filter((path) => {
                const sent = valueAt(changes, path);
                // what is not there counts as not ticked, or as no text; a number as its digits
                const got = valueAt(now, path) ?? (sent === false ? false : '');
                return (typeof sent === 'boolean' ? got : String(got)) !== sent;
            });
            showDetails(
                kind,
                now,
                missed.length === 0
                    ? `Saved ${called}.`
                    : `Marketing Cloud answered that ${called} was saved, but these fields are not as they were sent: ${missed.join(', ')}. See below what it holds now.`,
            );
        } catch (ex) {
            if (mine !== asked) {
                return;
            }
            if (step === 'read') {
                openDetails(
                    kind,
                    key,
                    `Marketing Cloud answered that ${called} was saved, but it could not be read again: ${ex.message}`,
                );
                return;
            }
            if (step === 'send' && ex.isUnanswered) {
                openDetails(
                    kind,
                    key,
                    `It is not known whether ${called} was saved: ${ex.message} See below what Marketing Cloud holds now.`,
                );
                return;
            }
            // nothing was saved; what was typed stays, to be put right
            says.textContent = `Not saved: ${ex.message}`;
            says.hidden = false;
            for (const button of buttons) {
                button.disabled = false;
            }
        }
    }

    /**
     * Shows the form for a new definition, or for one that exists.
     *
     * @param {{id: string, title: string, fields: object[]}} kind kind of message
     * @param {object} [loaded] the definition to change; none for a new one
     */
    async function openForm(kind, loaded) {
        const mine = ++asked;
        const isFollowing = !loaded && (await isKeyFromName());
        if (mine !== asked) {
            return;
        }
        const form = make('form', 'form');
        // the form checks its fields itself, when it is sent
        form.noValidate = true;
        const inputs = new Map();
        const number = ++forms;
        for (const [index, spec] of kind.fields.entries()) {
            const { row, input } = field(spec, `${NAME}-list-${number}-${index}`, !loaded);
            inputs.set(spec.path, input);
            form.append(row);
            if (!loaded) {
                continue;
            }
            const value = valueAt(loaded, spec.path);
            const isTick = spec.input === 'checkbox';
            // what the field cannot hold is shown in the details only, and left as it is
            const isHeld = isTick
                ? value === undefined || typeof value === 'boolean'
                : value === undefined || value === null || typeof value !== 'object';
            if (!isHeld) {
                input.disabled = true;
                input.title = 'This value cannot be changed here.';
            } else if (isTick) {
                input.checked = value === true;
            } else {
                const text = value === undefined || value === null ? '' : String(value);
                // a choice the form does not know is kept as it is, not turned into another
                if (text && spec.input === 'select' && !spec.options.includes(text)) {
                    input.append(make('option', undefined, text));
                }
                input.value = text;
            }
        }
        // the key follows the name, as in the dialogs of Marketing Cloud, until one is typed
        const name = inputs.get('name');
        const key = inputs.get('definitionKey');
        // the key of a message cannot be changed once it exists
        key.readOnly = Boolean(loaded);
        // what the form holds before the user touches it, to tell later what they changed
        const filled = new Map(
            kind.fields.map((spec) => [spec.path, held(spec, inputs.get(spec.path))]),
        );
        let isTyped = false;
        key.addEventListener('input', () => {
            isTyped = key.value !== '';
        });
        name.addEventListener('input', () => {
            if (isFollowing && !isTyped) {
                key.value = globalThis.sfmcUxToolsToKey(name.value, KEY_MAX);
            }
        });
        for (const { path, needs } of kind.fields) {
            if (!needs) {
                continue;
            }
            const dependent = inputs.get(path);
            const needed = inputs.get(needs);
            dependent.addEventListener('change', () => {
                needed.checked ||= dependent.checked;
            });
            needed.addEventListener('change', () => {
                dependent.checked &&= needed.checked;
            });
        }
        const says = make('p', 'error');
        says.hidden = true;
        const send = make('button', 'save', loaded ? 'Save' : 'Create');
        send.type = 'submit';
        const cancel = make('button', 'keep', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () =>
            loaded ? openDetails(kind, loaded.definitionKey) : openList(kind),
        );
        form.append(says, send, cancel);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            if (loaded) {
                save(kind, form, inputs, says, loaded, filled);
            } else {
                create(kind, form, inputs, says);
            }
        });
        const second = kind.fields.find((spec) => spec.within);
        if (second) {
            chooseBoth(
                inputs,
                kind.fields.find((spec) => spec.path === second.within),
                second,
            );
        }
        fill(
            make(
                'h3',
                'title',
                loaded
                    ? `Edit “${loaded.name}” (key ${loaded.definitionKey})`
                    : `New ${kind.title} message`,
            ),
            form,
        );
        name.focus();
    }

    /**
     * Shows a definition with what can be done with it.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} definition the definition, as it was just read
     * @param {string} [notice] what just happened, to say above the details
     */
    function showDetails(kind, definition, notice) {
        const back = make('button', 'back', `← All ${kind.title} messages`);
        back.type = 'button';
        back.addEventListener('click', () => openList(kind));
        const edit = make('button', 'keep', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', () => openForm(kind, definition));
        const erase = make('button', 'delete', 'Delete');
        erase.type = 'button';
        erase.addEventListener('click', () => confirmDelete(kind, definition, erase));
        const does = make('div', 'does');
        does.append(edit, erase);
        const actions = make('div', 'actions');
        actions.append(back, does);
        const named = new Map(
            kind.fields.filter((spec) => spec.isNamed).map((spec) => [spec.path, spec.suggest]),
        );
        fill(...(notice ? [make('p', 'notice', notice)] : []), actions, show(definition, named));
    }

    /**
     * Shows the details of one definition.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {string} key key of the definition
     * @param {string} [notice] what just happened, to say above the details
     */
    async function openDetails(kind, key, notice) {
        const mine = ++asked;
        const said = notice ? [make('p', 'notice', notice)] : [];
        fill(...said, make('p', 'hint', 'Loading …'));
        const before = changed;
        try {
            const definition = await readDefinition(kind, key);
            // the lists show it too, until theirs say that it was changed after this
            if (before === changed) {
                keep(kind, key, definition, definition.modifiedDate);
            }
            if (mine === asked) {
                showDetails(kind, definition, notice);
            }
        } catch (ex) {
            if (mine === asked) {
                fail(ex, ...said);
            }
        }
    }

    /**
     * Lists the columns of the list of a kind of message.
     *
     * @param {{columns?: object[]}} kind kind of message
     * @returns {object[]} the columns every list has, with those of the kind among them
     */
    function columnsOf(kind) {
        const at = COLUMNS.findIndex((column) => column.field === BEFORE_DETAILS) + 1;
        return COLUMNS.toSpliced(at, 0, ...(kind.columns || []));
    }

    /**
     * Reads what a column shows of a row that only the details of its message hold.
     *
     * @param {{id: string}} kind kind of message
     * @param {object} row the row
     * @param {{field: string, names?: string}} column the column
     * @returns {{text: string, name?: string}} the value as the definition holds it, empty until it is read, and what the business unit calls it, if it is known
     */
    function detail(kind, row, column) {
        const value = valueAt(detailsOf(kind, row), column.field);
        return {
            text: value === undefined || value === null ? '' : String(value),
            name: column.names ? nameOf(column.names, value) : undefined,
        };
    }

    /**
     * Builds the row of a definition in its list.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {object} row the definition
     * @param {object[]} columns the columns of the list
     * @returns {{element: HTMLTableRowElement, fill: () => void}} the row, and what to call when its details or their names have come
     */
    function line(kind, row, columns) {
        const element = make('tr');
        const late = [];
        for (const column of columns) {
            const cell = element.insertCell();
            if (column.isDetail) {
                late.push([column, cell]);
            } else if (column.isDate) {
                stamp(cell, row?.[column.field]);
            } else {
                cell.textContent = row?.[column.field] ?? '';
            }
        }
        const fill = () => {
            for (const [column, cell] of late) {
                const { text, name = text } = detail(kind, row, column);
                cell.textContent = name;
                // the id or the key behind a name is to be read when the mouse rests on it
                if (text && column.names) {
                    cell.title = text;
                }
            }
        };
        fill();
        const key = row?.definitionKey;
        // without a key there is nothing to ask the details for
        if (!(typeof key === 'string' && key)) {
            return { element, fill };
        }

        element.tabIndex = 0;
        element.dataset.key = key;
        element.title = 'Show the details';
        element.addEventListener('click', () => openDetails(kind, key));
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                openDetails(kind, key);
            }
        });
        return { element, fill };
    }

    /**
     * Picks the definitions that match what is searched for, in the order asked for. A row is
     * also found by what the columns of its kind hold and show, once its details are read.
     *
     * @param {{id: string}} kind kind of message
     * @param {object[]} rows the definitions as they were read
     * @param {{search: string, isReversed: boolean}} view what the user searches by, and which way round the order is
     * @param {object[]} columns the columns of the list
     * @param {object} [column] the column to sort by; none for the order of the list
     * @returns {object[]} the definitions to show
     */
    function listed(kind, rows, { search, isReversed }, columns, column) {
        const wanted = search.trim().toLowerCase();
        const late = columns.filter((item) => item.isDetail);
        const found = wanted
            ? rows.filter((row) =>
                  [
                      ...SEARCHED.map((name) => row?.[name]),
                      ...late.flatMap((item) => Object.values(detail(kind, row, item))),
                  ].some((text) => typeof text === 'string' && text.toLowerCase().includes(wanted)),
              )
            : rows;
        if (!column) {
            return found;
        }
        const turn = isReversed ? -1 : 1;
        const text = column.isDetail
            ? (row) => {
                  const shown = detail(kind, row, column);
                  return shown.name ?? shown.text;
              }
            : (row) => String(row?.[column.field] ?? '');
        // a date is sorted as the API writes it, which puts the earlier one first
        const order = column.isDate
            ? (one, other) => (one > other) - (one < other)
            : (one, other) => one.localeCompare(other, undefined, { sensitivity: 'base' });
        return found.toSorted((one, other) => turn * order(text(one), text(other)));
    }

    /**
     * Builds the table of definitions, with the field to search it by and the buttons to page
     * through it. Searching, sorting and paging redraw its rows and the line below them only, so
     * that the field being typed in stays as it is. The details that the list did not bring are
     * read while the table is on show, a few at a time, and fill in row by row.
     *
     * @param {{id: string, title: string, columns?: object[]}} kind kind of message
     * @param {object[]} rows the definitions
     * @param {() => boolean} isShown false once the panel shows something else or is closed
     * @returns {{search: HTMLInputElement, progress: HTMLElement, content: HTMLElement[]}} the search field, the place that says how many details are read, and the table with what belongs below it
     */
    function table(kind, rows, isShown) {
        const view = views.get(kind.id);
        const columns = columnsOf(kind);
        // the columns that only the details of a message fill
        const late = kind.columns || [];
        const element = make('table', 'list');
        const head = element.createTHead().insertRow();
        const content = element.createTBody();
        const none = make('p', 'hint', 'No message matches what you search for.');
        const pager = make('div', 'pager');
        const previous = make('button', 'previous', '← Previous');
        const next = make('button', 'next', 'Next →');
        const range = make('span', 'range');
        const progress = make('span', 'progress');
        // the rows whose details can be asked for, by their key
        const keyed = new Map(
            (late.length > 0 ? rows : [])
                .filter((row) => typeof row?.definitionKey === 'string' && row.definitionKey)
                .map((row) => [row.definitionKey, row]),
        );
        // the keys whose details are not there yet, and those among them nobody has asked for
        const missing = new Set(keyed.keys().filter((key) => !detailsOf(kind, keyed.get(key))));
        const waiting = new Set(missing);
        // what fills the cells of a row on show, by its key
        const drawn = new Map();
        // the details this table waits for
        let awaited = 0;
        // a column of details puts the rows in order only when every row has them
        const sorted = () => {
            const column = columns.find((item) => item.field === view.field);
            return column?.isDetail && missing.size > 0 ? undefined : column;
        };
        const mark = () => {
            const by = sorted();
            for (const cell of head.cells) {
                const direction = view.isReversed ? 'descending' : 'ascending';
                cell.setAttribute(
                    'aria-sort',
                    cell.dataset.field === by?.field ? direction : 'none',
                );
                const sort = cell.firstChild;
                sort.disabled = 'detail' in cell.dataset && missing.size > 0;
                sort.title = sort.disabled ? SORT_LATER : SORT;
            }
        };
        const draw = () => {
            mark();
            const found = listed(kind, rows, view, columns, sorted());
            const last = Math.max(Math.ceil(found.length / ROWS_SHOWN) - 1, 0);
            // a list that got shorter has no such page any more
            view.page = Math.min(view.page, last);
            const from = view.page * ROWS_SHOWN;
            const shown = found.slice(from, from + ROWS_SHOWN);
            // rows that are drawn again while one of them is being used keep it in use
            const used = content.contains(document.activeElement)
                ? document.activeElement.dataset.key
                : undefined;
            drawn.clear();
            content.replaceChildren(
                ...shown.map((row) => {
                    const { element: item, fill } = line(kind, row, columns);
                    if (item.dataset.key) {
                        drawn.set(item.dataset.key, fill);
                    }
                    return item;
                }),
            );
            if (used) {
                [...content.rows].find((item) => item.dataset.key === used)?.focus();
            }
            none.hidden = shown.length > 0;
            pager.hidden = last === 0;
            range.textContent = `${from + 1}–${from + shown.length} of ${found.length}`;
            previous.disabled = view.page === 0;
            next.disabled = view.page === last;
        };
        // what has come changes the rows, or their order: they are drawn again. Otherwise the
        // cells are filled where they stand
        const fill = (isOtherRows, cells) => {
            if (isOtherRows) {
                draw();
                return;
            }
            for (const cell of cells) {
                cell();
            }
            mark();
        };
        const tell = () => {
            progress.hidden = missing.size === 0;
            progress.textContent = `details ${keyed.size - missing.size} of ${keyed.size}`;
            // nothing is asked for any more, and still some are not there
            progress.title = awaited === 0 && waiting.size === 0 ? UNREAD : '';
        };
        const arrived = (key) => {
            if (!detailsOf(kind, keyed.get(key))) {
                return;
            }
            missing.delete(key);
            // a row that is not on show may match what is searched for by what has come
            const isFound = view.search.trim() && !drawn.has(key);
            fill(isFound || sorted()?.isDetail, drawn.has(key) ? [drawn.get(key)] : []);
        };
        const more = () => {
            if (!isShown()) {
                return;
            }
            while (waiting.size > 0) {
                // the rows on show first, then the others in the order of the list
                const key =
                    drawn.keys().find((item) => waiting.has(item)) ?? waiting.values().next().value;
                const row = keyed.get(key);
                // what another showing of this list has asked for is waited for, not asked again
                let read = reading.get(`${kind.id} ${key}`);
                const isOwn = !read;
                if (isOwn) {
                    if (reading.size >= DETAILS_AT_ONCE) {
                        break;
                    }
                    read = readDetails(kind, row);
                }
                waiting.delete(key);
                awaited++;
                const follow = async () => {
                    await read;
                    awaited--;
                    if (!isShown()) {
                        return;
                    }
                    if (isOwn || detailsOf(kind, row)) {
                        arrived(key);
                    } else {
                        // it was asked for an earlier state of the list: once more, for this one
                        waiting.add(key);
                    }
                    more();
                };
                follow();
            }
            tell();
        };
        for (const { title, field, isDetail } of columns) {
            const cell = make('th');
            cell.scope = 'col';
            cell.dataset.field = field;
            if (isDetail) {
                cell.dataset.detail = '';
            }
            const sort = make('button', 'sort', title);
            sort.type = 'button';
            sort.addEventListener('click', () => {
                view.isReversed = view.field === field && !view.isReversed;
                view.field = field;
                view.page = 0;
                draw();
            });
            cell.append(sort);
            head.append(cell);
        }
        const by = EITHER.format([
            'name',
            'key',
            ...late.map((column) => column.title.toLowerCase()),
        ]);
        const search = make('input', 'search');
        search.type = 'search';
        search.placeholder = `Search ${by}`;
        search.setAttribute('aria-label', `Search the ${kind.title} messages by ${by}`);
        search.value = view.search;
        search.addEventListener('input', () => {
            view.search = search.value;
            view.page = 0;
            draw();
        });
        const turn = (button, pages) => {
            button.type = 'button';
            button.addEventListener('click', () => {
                view.page += pages;
                draw();
            });
        };
        turn(previous, -1);
        turn(next, 1);
        pager.append(previous, range, next);
        draw();
        // the names of what the columns show come with the list they are in, for all rows at once
        for (const { names } of late) {
            if (!names) {
                continue;
            }
            const name = async () => {
                await readOffers(names, isShown);
                if (isShown()) {
                    fill(view.search.trim() || sorted()?.isDetail, drawn.values());
                }
            };
            name();
        }
        wake = more;
        more();
        // the rows scroll under the names of their columns; what is around the table stays
        const scroll = make('div', 'rows');
        scroll.append(element);
        return { search, progress, content: [scroll, none, pager] };
    }

    /**
     * Shows a list that was read, with what can be done with it.
     *
     * @param {{id: string, title: string}} kind kind of message
     * @param {{rows: object[], readAt: Date}} list the definitions, and when they were read
     * @param {HTMLElement[]} said what just happened, to stay above the list
     */
    function showList(kind, { rows, readAt }, said) {
        const create = make('button', 'new', `New ${kind.title} message`);
        create.type = 'button';
        create.addEventListener('click', () => openForm(kind));
        const refresh = make('button', 'refresh');
        refresh.type = 'button';
        refresh.title = REFRESH;
        refresh.setAttribute('aria-label', REFRESH);
        refresh.append(reloadSign());
        refresh.addEventListener('click', () => {
            lists.delete(kind.id);
            // the names shown with the messages are read again as well
            offers.clear();
            openList(kind);
        });
        const read = make(
            'span',
            'read',
            `read ${readAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        );
        // the time alone does not tell a list that was read on another day
        read.title = readAt.toLocaleString();
        const bar = make('div', 'bar');
        bar.append(create, refresh, read);
        if (rows.length === 0) {
            fill(
                ...said,
                bar,
                make(
                    'p',
                    'hint',
                    `This business unit has no transactional ${kind.title} messages.`,
                ),
            );
            return;
        }
        const mine = asked;
        const { search, progress, content } = table(kind, rows, () => mine === asked);
        bar.append(progress, search);
        fill(...said, bar, ...content);
        dialog.classList.add(LISTING);
    }

    /**
     * Shows the list of one kind of message: the one that was read before, unless a message of
     * that kind was created, changed or deleted since, or none was read yet.
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
        const kept = lists.get(kind.id);
        if (kept) {
            showList(kind, kept, said);
            return;
        }
        fill(...said, make('p', 'hint', 'Loading …'));
        const before = changed;
        try {
            const rows = await readList(kind.id, () => mine === asked);
            // whoever went elsewhere stopped the reading, maybe before its last page: what came
            // of it is neither shown nor kept
            if (mine !== asked) {
                return;
            }
            const list = { rows, readAt: new Date() };
            if (before === changed) {
                lists.set(kind.id, list);
            }
            showList(kind, list, said);
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
        // a menu that was drawn again may be the one of another business unit
        forget();
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

    // the menu is drawn after the page has loaded, and drawn again when the business unit changes
    const menu = new MutationObserver(addEntry);

    /**
     * Shows the entry, or takes it away; anything but "on" hides it. A panel that is open stays
     * until it is closed.
     *
     * @param {unknown} value the setting
     */
    function apply(value) {
        if (value === ON) {
            addEntry();
            menu.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            menu.disconnect();
            document.querySelector(`[${CSS.escape(MARK)}]`)?.remove();
        }
    }

    /**
     * Reads whether the entry is switched on.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: 'off' });
            apply(values[SETTING]);
        } catch {
            // without the setting the entry stays hidden
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            apply(changes[SETTING].newValue);
        }
    });
    readSetting();
})();
