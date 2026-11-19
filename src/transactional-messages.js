/*
 * SFMC UX Tools — content script for the Marketing Cloud page that holds the app menu.
 *
 * Transactional SMS, push and OTT (WhatsApp and the like) messages exist in Marketing Cloud's
 * API only; no app shows them. This adds an entry "Transactional Messages" to the Mobile Studio
 * menu, which opens a panel that lists those definitions, shows the details of one, creates and
 * changes one from a form and deletes one on request. The lists and the details come from
 * Marketing Cloud's own server, through the page's session. A new or changed message goes there
 * when its form is sent, and a delete only after a question that names the message. Before a
 * change or a delete, the message is read again and left alone if it is no longer the one shown.
 */
(() => {
    'use strict';

    const TITLE = 'Transactional Messages';
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
    // what a new message is asked for, whatever its kind
    const COMMON = [
        { path: 'name', label: 'Name', isRequired: true },
        { path: 'definitionKey', label: 'Key', isRequired: true, max: KEY_MAX },
        { path: 'description', label: 'Description' },
        { path: 'status', label: 'Status', input: 'select', options: ['Active', 'Inactive'] },
    ];
    // lists of the business unit that a field offers to choose from; it still takes any text
    const SUGGESTIONS = {
        codes: {
            path: 'legacy/v1/beta/mobile/code/',
            read: (answer) =>
                (answer.entry || []).map((item) => ({ value: item.code, label: item.countryCode })),
        },
        keywords: {
            path: 'legacy/v1/beta/mobile/keyword/',
            read: (answer) =>
                (answer.entry || []).map((item) => ({
                    value: item.keyword,
                    label: item.code?.code,
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
                ...COMMON,
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
                    suggest: 'codes',
                    help: 'The short or long code the message is sent from. A long code starts with the number of its country.',
                },
                {
                    path: 'subscriptions.keyword',
                    label: 'Keyword',
                    isRequired: true,
                    suggest: 'keywords',
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
            ],
        },
        {
            id: 'push',
            title: 'Push',
            fields: [
                ...COMMON,
                { path: 'applicationId', label: 'App', isRequired: true, suggest: 'apps' },
                {
                    path: 'content.customerKey',
                    label: 'Content',
                    // seen live: without content the API refuses the message
                    isRequired: true,
                    suggest: 'contents',
                    help: 'The customer key of the push message in Content Builder.',
                },
                { path: 'options.sound', label: 'Sound' },
                { path: 'options.badge', label: 'Badge' },
            ],
        },
        {
            id: 'ott',
            title: 'OTT',
            fields: [
                ...COMMON,
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
        { title: 'Created', field: 'createdDate' },
        { title: 'Modified', field: 'modifiedDate' },
    ];

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
     * @returns {Promise.<object[]>} the rows
     */
    async function readPages(path, query, field, isWanted) {
        const rows = [];
        let before;
        // asked between the pages only: the first one is always read
        for (let page = 1; page === 1 || isWanted(); page++) {
            const answer = await ask(`${path}?$page=${page}&$pageSize=${PAGE_SIZE}&${query}`);
            const found = Array.isArray(answer[field]) ? answer[field] : [];
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
     * Reads all definitions of a kind.
     *
     * @param {string} kind sms, push or ott
     * @param {() => boolean} isWanted false once something else was asked for or the panel was closed
     * @returns {Promise.<object[]>} the definitions
     */
    function readList(kind, isWanted) {
        return readPages(`${MESSAGES}${kind}/definitions`, NOT_DELETED, 'definitions', isWanted);
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
        const definition = await ask(
            `${MESSAGES}${kind.id}/definitions/${encodeURIComponent(key)}`,
        );
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
            await ask(`${MESSAGES}${kind.id}/definitions/${encodeURIComponent(key)}`, 'DELETE');
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
     * Fills the list a field offers to choose from; a list that cannot be read is done without.
     *
     * @param {HTMLDataListElement} list the list of the field
     * @param {{path: string, query?: string, pages?: string, read: (answer: object) => {value: unknown, label: unknown}[]}} from where its entries come from
     */
    async function suggest(list, from) {
        try {
            const answer = from.pages
                ? // the rest is not read for a form that was closed meanwhile
                  await readPages(from.path, from.query, from.pages, () => list.isConnected)
                : await ask(from.path);
            const entries = from.read(answer);
            for (const { value, label } of entries) {
                if (!(typeof value === 'string' && value)) {
                    continue;
                }

                const option = make('option');
                option.value = value;
                option.label = typeof label === 'string' ? label : '';
                list.append(option);
            }
        } catch {
            // the field takes any text without its list
        }
    }

    /**
     * Builds the field of a form.
     *
     * @param {object} spec what the field is, from the list of its kind of message
     * @param {string} id name for what belongs to the field
     * @returns {{row: HTMLElement, input: HTMLElement}} the line of the form and the field in it
     */
    function field(spec, id) {
        const row = make('label', 'field');
        let input;
        if (spec.input === 'select') {
            input = make('select');
            for (const value of spec.options) {
                input.append(make('option', undefined, value));
            }
        } else if (spec.input === 'textarea') {
            input = make('textarea');
            input.rows = 4;
        } else {
            input = make('input');
            input.type = spec.input === 'checkbox' ? 'checkbox' : 'text';
        }
        input.name = spec.path;
        input.required = Boolean(spec.isRequired);
        if (spec.max) {
            input.maxLength = spec.max;
        }
        const title = make('span', 'label', spec.label + (spec.isRequired ? ' *' : ''));
        // a checkbox stands before its words
        row.append(...(input.type === 'checkbox' ? [input, title] : [title, input]));
        if (spec.suggest) {
            const list = make('datalist');
            list.id = id;
            input.setAttribute('list', id);
            row.append(list);
            suggest(list, SUGGESTIONS[spec.suggest]);
        }
        if (spec.help) {
            row.append(make('span', 'help', spec.help));
        }
        return { row, input };
    }

    /**
     * Turns what a form holds into what the API takes. Text that was left empty is left out.
     *
     * @param {object[]} specs the fields of the kind of message
     * @param {Map.<string, HTMLElement>} inputs the fields of the form by their path
     * @returns {object} the definition
     */
    function toDefinition(specs, inputs) {
        const definition = {};
        for (const { path, input: type } of specs) {
            const value = held({ input: type }, inputs.get(path));
            if (value === '') {
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
            await ask(`${MESSAGES}${kind.id}/definitions`, 'POST', definition);
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
     * definition that has a changed field, whole. A part is sent with everything Marketing Cloud
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
            const [part, name] = spec.path.split('.', 2);
            if (name) {
                changes[part] ||= { ...loaded[part] };
                changes[part][name] = value;
            } else {
                changes[part] = value;
            }
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
            await ask(
                `${MESSAGES}${kind.id}/definitions/${encodeURIComponent(key)}`,
                PATCH,
                changes,
            );
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
            const { row, input } = field(spec, `${NAME}-list-${number}-${index}`);
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
        fill(...(notice ? [make('p', 'notice', notice)] : []), actions, show(definition));
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
        try {
            const definition = await readDefinition(kind, key);
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
            const create = make('button', 'new', `New ${kind.title} message`);
            create.type = 'button';
            create.addEventListener('click', () => openForm(kind));
            fill(
                ...said,
                create,
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
