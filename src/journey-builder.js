/*
 * SFMC UX Tools — helpers for Journey Builder. This script runs in the page's own world.
 *
 * Readable keys: Journey Builder has no field for the key of a journey or of an API event. It
 * makes up a random one in the browser and sends it along when the journey or event is saved for
 * the first time; afterwards the key of a journey cannot be changed. This script swaps that
 * random key for one derived from the name in exactly those requests. The server answers with
 * the key it stored, and the page goes on with that. The key of an API event, which the page
 * only shows, becomes a field, and the key that a transactional journey asks for is filled in.
 *
 * Journey names: a new journey is called "New Journey" with the date and time, a name that is
 * also handed on to its API event. Saving a journey under that name is held back until it has a
 * name of its own.
 */
(() => {
    'use strict';

    const KEYS_ATTRIBUTE = 'data-sfmc-ux-tools-readable-keys';
    const NAMES_ATTRIBUTE = 'data-sfmc-ux-tools-journey-name-check';
    const OFF = 'off';
    const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    // the key Journey Builder makes up for an API event
    const RANDOM_EVENT_KEY = new RegExp(`^APIEvent-${GUID}$`, 'i');
    // longest key Marketing Cloud takes for a journey and for an event
    const MAX_LENGTH = 200;
    // where API events are asked for, and the answer for a key that no event has: the server
    // calls such a request a bad one
    const EVENTS = '/fuelapi/interaction/v1/eventDefinitions';
    const EVENT_FREE = 400;
    // the requests that create something, the property that holds the key, and what a key looks
    // like that Journey Builder made up
    const CREATIONS = [
        {
            // a journey; later versions of it are sent to the same address and keep their key
            path: /\/interaction\/v1\/interactions\/?$/,
            property: 'key',
            random: new RegExp(`^${GUID}$`, 'i'),
            isNew: (body) => !body.id && body.version === 1,
            // asked for by key, a journey that exists is found; a key that is free is not
            free: 404,
            // a key the user typed counts only while its field is there to be seen
            typed: () => (document.querySelector(`.${JOURNEY_KEY} input`) ? journeyWish : null),
        },
        {
            // an API event. Events of other kinds are named after what they read from, a data
            // extension for one, so that their names repeat: they keep their random keys
            path: /\/interaction\/v1\/eventDefinitions\/?$/,
            property: 'eventDefinitionKey',
            random: RANDOM_EVENT_KEY,
            isNew: (body) => !body.id,
            free: EVENT_FREE,
            typed: (random) => chosen.get(random),
        },
    ];
    // the requests that read or save journeys; their answers tell the key of a journey
    const JOURNEYS = new RegExp(`/interaction/v1/interactions(?:/(${GUID}))?/?$`, 'i');
    // the details of a journey below its name: the row, its first entry, the icon that opens the
    // row where there is one, and what marks the row as open
    const DETAILS = '.slds-page-header__detail-row';
    const DESCRIPTION = '.description-block';
    const DETAILS_TOGGLE = '.toggle-detail-icon';
    const DETAILS_OPEN = 'detail-visible';
    const JOURNEY_KEY = 'sfmc-ux-tools-journey-key';
    // where a journey is drawn that was never saved
    const UNSAVED_ROUTE = /^#(?:simple\/|0{8}-0{4}-0{4}-0{4}-0{12}\/)/;
    const FOUND = 200;
    // the name on the page that starts a journey, where it is the one Journey Builder made up;
    // next to the name, its element holds a label for screen readers
    const START = '#journey-name-input';
    const START_NAME = '#journey-name-input_text > span';
    // name of the journey on its canvas: as text, the icon that makes it a field, and that field
    const NAME_TEXT = '.name-editor .readonly-text';
    const NAME_EDIT = '.name-editor .edit-icon';
    const NAME_FIELD = '.name-editor input.editable-text';
    // the buttons that save a journey, by themselves or before they do what they are for
    const SAVING_BUTTONS = '.control-save, .control-validate, .control-test, .control-activate';
    const NAME_MESSAGE =
        'SFMC UX Tools: give the journey a name of its own before you save it. You can switch this check off in the extension’s options.';
    // settings of an API event: its name, and where its key is shown
    const EVENT_NAME = '.api-event-hub-view #activity-name-input';
    const EVENT_KEY = '.api-event-hub-view #activity-description';
    const EVENT_KEY_FIELD = 'sfmc-ux-tools-event-key';
    // what surrounds a field of those settings, and the classes that make the surroundings of
    // the key look like those of a text or of a field
    const CONTROL = 'slds-form-element__control';
    const TEXT_LOOK = ['slds-m-top_x-small'];
    const FIELD_LOOK = ['slds-border_bottom'];
    // the key field of a transactional journey, which is the key of its send definition
    const TRANSACTIONAL_KEY = '.transactional-summary-view input.event-key';
    // where a transactional journey is drawn before it is saved for the first time
    const UNSAVED_SIMPLE_ROUTE = /^#simple\//;
    // how long, in milliseconds, a save of the page waits for the answer whether a key is free
    // before it goes out with the key Journey Builder made up
    const PATIENCE = 10_000;
    const toKey = globalThis.sfmcUxToolsToKey;
    // requests by the method and address they were opened with
    const opened = new WeakMap();
    // requests the page gave up
    const aborted = new WeakSet();
    // made-up keys of API events by whether the server knows no event of that key; null while
    // the question is under way
    const unsaved = new Map();
    // the keys chosen for API events, by the random key each of them takes the place of; null
    // stands for a key that still follows the name
    const chosen = new Map();
    // transactional key fields this script has looked at
    const seen = new WeakSet();
    // the name the user last typed on the page that starts a journey
    let typedName = null;
    // the name Journey Builder gave the journey that is being created
    let madeUpName = null;
    // keys of saved journeys by their ids, as the server told them
    const keys = new Map();
    // the key the user typed for the journey that is being created; null while it follows the name
    let journeyWish = null;
    // whether the details of the journey that is being created were opened for its key field
    let isShownOnce = false;

    /**
     * Tells whether a feature is switched on; without a setting it is.
     *
     * @param {string} attribute where the setting of the feature is noted
     * @returns {boolean} true unless it was switched off
     */
    function isOn(attribute) {
        return document.documentElement.getAttribute(attribute) !== OFF;
    }

    /**
     * Tells a field's page that its value changed; Journey Builder waits for a released key.
     *
     * @param {HTMLInputElement} field field this script wrote into
     */
    function announce(field) {
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    }

    /**
     * Tells whether a request creates a journey or an API event under a key that Journey Builder
     * made up, and which readable key could take its place.
     *
     * @param {string} method method of the request
     * @param {string} url address of the request
     * @param {unknown} body what the page is about to send
     * @returns {{creation: object, address: string, content: object, key: string} | null} what kind of thing is created, where its kind is asked for, the body and the key wished for; null for any other request
     */
    function readableKeyFor(method, url, body) {
        if (typeof body !== 'string' || method.toUpperCase() !== 'POST' || !isOn(KEYS_ATTRIBUTE)) {
            return null;
        }
        const address = new URL(url, location.href);
        const creation = CREATIONS.find((item) => item.path.test(address.pathname));
        // whether a key is free can only be asked where this page is at home
        if (!creation || address.origin !== location.origin) {
            return null;
        }
        const content = JSON.parse(body);
        const random = content[creation.property];
        if (
            !creation.isNew(content) ||
            typeof content.name !== 'string' ||
            !creation.random.test(random)
        ) {
            return null;
        }
        // what is created here is no longer new from now on, whatever key it gets
        unsaved.set(random, false);
        const key = creation.typed(random)?.trim() || toKey(content.name, MAX_LENGTH);
        return key
            ? { creation, address: address.pathname.replace(/\/$/, ''), content, key, random }
            : null;
    }

    /**
     * Asks the server for what has a key. The question is given up if it is sent elsewhere, as
     * to a login page, or takes too long: the page's own request waits for the answer.
     *
     * @param {string} address where things of that kind are asked for
     * @param {string} key key to ask for
     * @returns {Promise.<{status: number, content: object | null}>} the server's answer
     */
    async function ask(address, key) {
        const answer = await fetch(`${address}/key:${encodeURIComponent(key)}`, {
            credentials: 'same-origin',
            redirect: 'error',
            signal: AbortSignal.timeout(PATIENCE),
        });
        const content = answer.status === FOUND ? await answer.json() : null;
        return { status: answer.status, content };
    }

    /**
     * Finds a key that nothing has yet. A journey that is created under the key of another one
     * is not refused: Marketing Cloud takes it for a new version of that journey. So a key that
     * is taken gets a number at its end, counted up until the key is free. A key only counts as
     * taken if the server names what has it, which is what ends the counting.
     *
     * @param {{creation: object, address: string, key: string}} wish what readableKeyFor found
     * @returns {Promise.<string | null>} the key to use; null if the server does not say whether it is free
     */
    async function freeKey({ creation, address, key }) {
        let candidate = key;
        for (let count = 2; ; count++) {
            const { status, content } = await ask(address, candidate);
            if (status === creation.free) {
                return candidate;
            }
            const holder = String(content?.[creation.property] ?? '');
            if (status !== FOUND || holder.toLowerCase() !== candidate.toLowerCase()) {
                return null;
            }
            const number = `_${count}`;
            candidate = key.slice(0, MAX_LENGTH - number.length) + number;
        }
    }

    /**
     * Sends a request of the page, with a readable key in it if it creates a journey or an API
     * event and such a key is free. Whatever goes wrong on the way, the request goes out as the
     * page wrote it.
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
            const address = new URL(url, location.href);
            const journey = JOURNEYS.exec(address.pathname);
            if (journey && address.origin === location.origin) {
                request.addEventListener('load', () => noteKeys(request, journey[1]), {
                    once: true,
                });
            }
            const found = readableKeyFor(method, url, parameters[0]);
            // a request the page waits for cannot be held back for a question to the server
            wish = isWaitedFor ? null : found;
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
     * Sends a request that creates a journey or an API event, once the server has said which
     * readable key is free.
     *
     * @param {(body?: unknown) => void} send the browser's own way to send a request
     * @param {XMLHttpRequest} request request of the page
     * @param {unknown[]} parameters what the page sends: the body first
     * @param {{creation: object, address: string, content: object, key: string}} wish what readableKeyFor found
     */
    async function sendOnceKeyIsFree(send, request, parameters, wish) {
        let [body] = parameters;
        try {
            const key = await freeKey(wish);
            if (key) {
                wish.content[wish.creation.property] = key;
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

    /**
     * Notes the keys of the journeys in an answer of the server, which is where the page itself
     * learns them.
     *
     * @param {XMLHttpRequest} request request of the page that was answered
     * @param {string} [asked] id of the journey the request asked for, if it named one
     */
    function noteKeys(request, asked) {
        try {
            const content = JSON.parse(request.responseText);
            const journeys = Array.isArray(content.items) ? content.items : [content];
            for (const journey of journeys) {
                if (typeof journey?.key !== 'string') {
                    continue;
                }
                const ids = [journey.id, journey.definitionId, journeys.length === 1 && asked];
                for (const id of ids) {
                    if (id) {
                        keys.set(String(id).toLowerCase(), journey.key);
                    }
                }
            }
            offerJourneyKey();
        } catch {
            // not an answer that lists journeys
        }
    }

    /**
     * Builds the entry of a journey's details that holds its key.
     *
     * @param {string} shows what the entry is for: a field, or the key to show
     * @param {string} saved key of the journey, if it was saved
     * @returns {HTMLLIElement} the entry
     */
    function keyEntry(shows, saved) {
        const entry = document.createElement('li');
        entry.className = `slds-page-header__detail-block ${JOURNEY_KEY}`;
        entry.dataset.shows = shows;
        const title = document.createElement('p');
        title.className = 'slds-text-title slds-truncate slds-m-bottom_xx-small';
        title.textContent = 'Key';
        const body = document.createElement('p');
        body.className = 'slds-text-body_regular';
        if (saved) {
            // one click marks the whole key, ready to be copied
            body.style.userSelect = 'all';
            body.title = 'The key of this journey. It cannot be changed.';
            body.textContent = saved;
        } else {
            const field = document.createElement('input');
            field.type = 'text';
            field.className = 'slds-input';
            field.maxLength = MAX_LENGTH;
            // room for a key of the usual length
            field.style.minWidth = '20rem';
            field.setAttribute('aria-label', 'Key of the journey');
            field.title =
                'SFMC UX Tools: the key this journey is saved with. It cannot be changed later. If another journey has this key already, a number is added.';
            field.addEventListener('input', () => {
                // an emptied field follows the name again
                journeyWish = field.value === '' ? null : field.value;
            });
            body.append(field);
        }
        entry.append(title, body);
        return entry;
    }

    /**
     * Shows the key of a journey among its details, which Journey Builder leaves out: as a field
     * while the journey was never saved, holding the key derived from its name until the user
     * types another one, and as text once the journey is saved, when its key is settled.
     */
    function offerJourneyKey() {
        const isNew = UNSAVED_ROUTE.test(location.hash);
        if (!isNew) {
            // what was typed for a journey ends with it, whether it was saved or left
            journeyWish = null;
            isShownOnce = false;
        }
        const row = document.querySelector(DETAILS);
        const description = row?.querySelector(DESCRIPTION);
        if (!description) {
            return;
        }
        const saved = isNew ? '' : keys.get(location.hash.slice(1).split('/', 1)[0].toLowerCase());
        const field = isNew && isOn(KEYS_ATTRIBUTE) ? 'field' : '';
        const shows = saved ? `key:${saved}` : field;
        let entry = row.querySelector(`.${JOURNEY_KEY}`);
        if (entry?.dataset.shows !== shows) {
            entry?.remove();
            entry = shows ? keyEntry(shows, saved) : null;
            if (entry) {
                description.after(entry);
            }
        }
        if (!entry) {
            return;
        }
        const toggle = document.querySelector(DETAILS_TOGGLE);
        if (!toggle) {
            // a journey of the simple kinds has no way to open its details
            row.classList.add(DETAILS_OPEN);
        } else if (isNew && !isShownOnce) {
            // opened once, so that the field is seen; after that the row is the user's
            isShownOnce = true;
            if (!row.classList.contains(DETAILS_OPEN)) {
                toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        }
        const input = entry.querySelector('input');
        if (input && journeyWish === null) {
            // the name as it is being typed, or else as the journey shows it
            const typing = document.activeElement?.matches(NAME_FIELD)
                ? document.activeElement.value
                : '';
            const name = typing || document.querySelector(NAME_TEXT)?.textContent || '';
            input.value = toKey(name, MAX_LENGTH);
        } else if (input && input.value !== journeyWish) {
            input.value = journeyWish;
        }
    }

    /**
     * Asks the server whether an API event with a made-up key is one that was never saved; an
     * event that was saved under such a key keeps it, and its key stays the text it is.
     *
     * @param {string} random key Journey Builder made up
     */
    async function checkUnsaved(random) {
        try {
            const { status } = await ask(EVENTS, random);
            unsaved.set(random, status === EVENT_FREE);
        } catch {
            unsaved.set(random, false);
        }
        offerEventKey();
    }

    /**
     * Turns the key that the settings of a new API event only show into a field. It holds the
     * key derived from the event's name until the user types another one.
     */
    function offerEventKey() {
        const shown = document.querySelector(EVENT_KEY);
        const control = shown?.parentElement;
        const hasField = Boolean(shown?.querySelector(`.${EVENT_KEY_FIELD}`));
        if (!hasField && control?.dataset.sfmcUxTools) {
            // the page shows a key as text again: its surroundings get their own look back
            control.classList.remove(...FIELD_LOOK);
            control.classList.add(...TEXT_LOOK);
            control.querySelector(`:scope > .${EVENT_KEY_FIELD}-pencil`)?.remove();
            delete control.dataset.sfmcUxTools;
        }
        if (!shown || hasField || !isOn(KEYS_ATTRIBUTE)) {
            return;
        }
        const random = shown.textContent.trim();
        if (!RANDOM_EVENT_KEY.test(random)) {
            return;
        }
        if (!unsaved.has(random)) {
            // until the server has answered, the key stays as the page shows it
            unsaved.set(random, null);
            checkUnsaved(random);
        }
        if (unsaved.get(random) !== true) {
            return;
        }
        const field = document.createElement('input');
        field.type = 'text';
        // the look of the event's name next to it: a line below the text and a pencil at its end
        const nameControl = document.querySelector(EVENT_NAME)?.closest(`.${CONTROL}`);
        field.className = `${nameControl?.querySelector('input')?.className ?? 'slds-input'} ${EVENT_KEY_FIELD}`;
        const pencil = nameControl?.querySelector(':scope > svg')?.cloneNode(true);
        if (pencil) {
            pencil.setAttribute('aria-hidden', 'true');
            pencil.classList.add(`${EVENT_KEY_FIELD}-pencil`);
            control.prepend(pencil);
        }
        control.classList.remove(...TEXT_LOOK);
        control.classList.add(...FIELD_LOOK);
        control.dataset.sfmcUxTools = 'key';
        field.maxLength = MAX_LENGTH;
        field.dataset.random = random;
        field.setAttribute('aria-labelledby', 'activity-desc_label');
        field.value =
            chosen.get(random) ??
            toKey(document.querySelector(EVENT_NAME)?.value ?? '', MAX_LENGTH);
        field.addEventListener('input', () => {
            // an emptied field follows the name again
            chosen.set(random, field.value === '' ? null : field.value);
        });
        shown.replaceChildren(field);
    }

    /**
     * Fills the key a transactional journey asks for from the name of the journey, once, when
     * its field shows up empty.
     */
    function fillTransactionalKey() {
        const field = document.querySelector(TRANSACTIONAL_KEY);
        if (!field || seen.has(field)) {
            return;
        }
        seen.add(field);
        const name = document.querySelector(NAME_TEXT)?.textContent.trim() ?? '';
        const key = toKey(name, field.maxLength);
        // only for a journey that was never saved; one that was has an address of its own
        const isNew = UNSAVED_SIMPLE_ROUTE.test(location.hash);
        const isFree = field.value === '' && !field.disabled && !field.readOnly;
        if (!key || !isNew || !isFree || name === madeUpName || !isOn(KEYS_ATTRIBUTE)) {
            return;
        }
        field.value = key;
        announce(field);
    }

    /**
     * Notes the name Journey Builder made up for a new journey, as the page that starts a journey
     * shows it. That page first shows the name of the journey before and then puts the new name
     * in its place, so the name is followed, except for one that the user typed there.
     */
    function noteMadeUpName() {
        const name = document.querySelector(START_NAME)?.textContent.trim();
        if (!name || name === typedName || name === madeUpName) {
            return;
        }

        madeUpName = name;
        // another journey is being started: nothing typed for the one before applies to it
        journeyWish = null;
        isShownOnce = false;
    }

    /**
     * Follows what the page draws.
     */
    function onChange() {
        noteMadeUpName();
        offerJourneyKey();
        offerEventKey();
        fillTransactionalKey();
    }

    /**
     * Keeps the key of an API event in step with its name while the key is not the user's own.
     *
     * @param {Event} event something was typed into a field
     */
    function onInput(event) {
        if (!(event.target instanceof Element)) {
            return;
        }
        if (event.target.closest(START)) {
            // a name the user gives the journey on the page that starts it is not a made-up one
            typedName = event.target.value.trim();
        }
        if (event.target.matches(NAME_FIELD)) {
            // the key of a new journey follows its name while the name is typed
            offerJourneyKey();
        }
        const field = document.querySelector(`.${EVENT_KEY_FIELD}`);
        if (!field || !event.target.matches(EVENT_NAME)) {
            return;
        }
        if (chosen.get(field.dataset.random) == null) {
            field.value = toKey(event.target.value, MAX_LENGTH);
        }
    }

    /**
     * Holds back a click that would save a journey under the name Journey Builder made up, and
     * asks for a name instead.
     *
     * @param {MouseEvent} event click anywhere on the page
     */
    function onClick(event) {
        if (
            !madeUpName ||
            !isOn(NAMES_ATTRIBUTE) ||
            !(event.target instanceof Element) ||
            !event.target.closest(SAVING_BUTTONS) ||
            document.querySelector(NAME_TEXT)?.textContent.trim() !== madeUpName
        ) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        document
            .querySelector(NAME_EDIT)
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const field = document.querySelector(NAME_FIELD);
        if (!field) {
            return;
        }
        field.select();
        field.setCustomValidity(NAME_MESSAGE);
        field.reportValidity();
        field.addEventListener('input', () => field.setCustomValidity(''), { once: true });
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
    new MutationObserver(onChange).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
    });
    document.addEventListener('input', onInput, { capture: true });
    document.addEventListener('click', onClick, { capture: true });
})();
