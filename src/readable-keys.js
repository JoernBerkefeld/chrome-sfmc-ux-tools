/*
 * SFMC UX Tools — content script for readable keys.
 *
 * A dialog that creates something in Marketing Cloud asks for a name and offers a field for the
 * key (external key, customer key). Left empty, the key becomes a GUID. This script fills the key
 * from the name while the name is typed, the way Salesforce derives an API name from a label.
 * A key that the dialog brought along, as when something existing is edited, is never touched.
 *
 * Apart from that, and also with readable keys switched off, it makes these dialogs notice a name
 * or key that was pasted with the mouse, and keeps the name typed for an automation when the
 * user clicks elsewhere.
 */
(() => {
    'use strict';

    const SETTING = 'readableKeys';
    const ON = 'on';
    // Automation Studio draws its dialogs in a modal; only there do its plain ids mean these fields
    const MODAL = '.modal';
    // the pages of Setup that define how emails are sent
    const SEND_MANAGEMENT = /\/SendManagement\/\w+\.aspx$/i;
    const TRIGGERED_SEND = /\/Interactions\/TriggeredSendConfiguration\.aspx$/i;
    const ROLE_PAGE = /\/Roles\/RoleDetails\.aspx$/i;
    const USER_PAGE = /\/Administration\/EmployeeDetails\.aspx$/i;
    // the name field of a dialog and the key field that belongs to it
    const PAIRS = [
        // Automation Studio: SQL query, script, filter, import, and data extract or file transfer
        { name: '#queryName', key: '#queryExternalKey', within: MODAL },
        { name: '#scriptName', key: '#scriptExternalKey', within: MODAL },
        { name: '#filterActivityName', key: '#filterActivityExternalKey', within: MODAL },
        { name: '#importsName', key: '#importsKey', within: MODAL },
        { name: '#name', key: '#customerKey', within: MODAL },
        // Automation Studio: the dialog that saves an automation which has no name yet
        { name: '#automationName', key: '#automationKey', within: MODAL },
        // Automation Studio: an automation, whose page stays open once it is saved; only the
        // address tells that it is new
        {
            name: '#nameInput .placard-field',
            key: '#externalKeyTextInput',
            route: /^#Instance\/new/i,
        },
        // Contact Builder: data extension. Its dialog cuts the key shorter than Marketing Cloud
        // asks for: the request behind the dialog takes 200 characters and refuses 201
        {
            name: '[data-testid="new-de-name-input"]',
            key: '[data-testid="new-de-key-input"]',
            max: 200,
        },
        // Email Studio: data extension. Its fields are widgets that take a value over when the
        // field is left, not while it changes
        {
            name: '.new-de-name input.fuel-input',
            key: '.new-de-key input.fuel-input',
            isTakenOnBlur: true,
        },
        // Content Builder: the dialog that saves a content block for the first time. Its fields
        // are widgets that take a value over when a key is released or the field is left; the
        // key field allows more than the 36 characters Marketing Cloud takes
        {
            name: '.contentitem-properties-name input',
            key: '.contentitem-properties-customerkey input',
            within: '.contentitem-modal-properties',
            max: 36,
            isTakenOnBlur: true,
        },
        // Email Studio: triggered send, on a page of its own
        { name: '#txtName', key: '#txtCustomerKey', path: TRIGGERED_SEND },
        // Setup: sender profile, send classification and delivery profile, each a page of its own
        { name: '#profileName', key: '#customerKey', path: SEND_MANAGEMENT },
        { name: '#txtName', key: '#txtCustKey', path: SEND_MANAGEMENT },
        { name: '#name', key: '#customerKey', path: SEND_MANAGEMENT },
        // Setup: file location, on a page next to those
        { name: '#Name', key: '#CustomerKey', path: SEND_MANAGEMENT },
        // Setup: role and user. Their pages say in the address which one they show; a new one
        // has none
        { name: '#Name', key: '#ExternalKey', path: ROLE_PAGE, search: /^(?!.*[?&]id=.)/i },
        // the key of a user follows the name the user logs in with, which may be an email
        // address: here the dots and the @ stay
        {
            name: '#UserName',
            key: '#ExternalKeyTextBox',
            path: USER_PAGE,
            search: /[?&]emid=(&|$)/i,
            notKept: /[^\w.@-]/g,
            // a password manager takes this field for part of a login and fills in a saved one,
            // at any time: on the page of a new user, only a key the user typed is the user's
            isFilledByBrowser: true,
        },
    ];
    // Automation Studio: the name of an automation, a field that opens in place with buttons to
    // take the name over or to drop it
    const NAME_IN_PLACE = '#nameInput.placard.showing';
    const TAKE_OVER = '.placard-accept';
    // the rule for a key, from key-rule.js
    const toKey = globalThis.sfmcUxToolsToKey;
    // how text gets into a field without a key being pressed
    const MOUSE_INPUTS = new Set(['insertFromPaste', 'insertFromDrop']);
    // key fields by the last key this script wrote into them
    const written = new WeakMap();
    // key fields this script has looked at, and those of them that came with a key
    const seen = new WeakSet();
    const broughtAlong = new WeakSet();
    // key fields that a password manager fills in and that the user typed a key into
    const typed = new WeakSet();
    let isOn = true;

    /**
     * Tells whether the page that is open is the one a pair is meant for.
     *
     * @param {object} pair one of PAIRS
     * @returns {boolean} false if the address says otherwise
     */
    function isHere(pair) {
        return (
            pair.route?.test(location.hash) !== false &&
            pair.path?.test(location.pathname) !== false &&
            pair.search?.test(location.search) !== false
        );
    }

    /**
     * Finds the pair whose key field a password manager fills in, on the page it is meant for.
     *
     * @returns {object | undefined} that pair, if this is its page
     */
    function filledPair() {
        return PAIRS.find((pair) => pair.isFilledByBrowser && isHere(pair));
    }

    /**
     * Writes the key that belongs to a name into the key field and tells the page.
     *
     * @param {HTMLInputElement | HTMLTextAreaElement} name name field
     * @param {HTMLInputElement} key key field
     */
    function fill(name, key) {
        const notKept = PAIRS.find(
            (pair) => name.matches(pair.name) && key.matches(pair.key),
        )?.notKept;
        const value = toKey(name.value, key.maxLength, notKept);
        if (value === key.value) {
            return;
        }
        key.value = value;
        written.set(key, value);
        // for pages that follow the field instead of reading it when the dialog is confirmed
        key.dispatchEvent(new Event('input', { bubbles: true }));
        key.dispatchEvent(new Event('change', { bubbles: true }));
        // Contact Builder's dialog takes the key over when a key is released in the field
        key.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        if (PAIRS.some((pair) => pair.isTakenOnBlur && key.matches(pair.key))) {
            // the focus stays where it is: this only tells the widget that the key is complete
            key.dispatchEvent(new Event('blur'));
        }
    }

    /**
     * Puts the key of a new user back to what follows from the username, after a password
     * manager wrote a saved login into it. A key the user typed stays.
     */
    function undoFilledKey() {
        const pair = isOn && filledPair();
        if (!pair) {
            return;
        }
        const name = document.querySelector(pair.name);
        const key = document.querySelector(pair.key);
        if (isTextField(name) && isTextField(key) && !typed.has(key)) {
            fill(name, key);
        }
    }

    /**
     * Tells whether something is a field that text is typed into; an automation's name is a
     * text area.
     *
     * @param {EventTarget | null} target what an event happened on
     * @returns {boolean} true for an input or a text area
     */
    function isTextField(target) {
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    }

    /**
     * Finds the key field that belongs to a name field.
     *
     * @param {Element} name field that was typed into
     * @returns {HTMLInputElement | null} the key field, if this is the name field of a known dialog
     */
    function keyFieldOf(name) {
        for (const pair of PAIRS) {
            if (!name.matches(pair.name) || !isHere(pair)) {
                continue;
            }

            const scope = pair.within ? name.closest(pair.within) : document;
            const key = scope?.querySelector(pair.key);
            if (key) {
                return key;
            }
        }
        return null;
    }

    /**
     * Tells whether a key field came with a key, which is the key of something that exists. What
     * counts is the first look at the field, so that such a key stays out of reach once emptied.
     * An empty field whose dialog allows less than Marketing Cloud does is widened on that look,
     * for the key that is derived and for one typed by hand.
     *
     * @param {HTMLInputElement} key key field of a dialog
     * @returns {boolean} true if the dialog brought the key along
     */
    function isBroughtAlong(key) {
        if (!seen.has(key)) {
            seen.add(key);
            const pair = PAIRS.find((candidate) => key.matches(candidate.key));
            if (pair?.isFilledByBrowser && isHere(pair)) {
                // whatever is there was filled in, and gives way to the key that is derived
            } else if (key.value !== '') {
                broughtAlong.add(key);
            } else if (isOn && pair?.max) {
                key.maxLength = pair.max;
            }
        }
        return broughtAlong.has(key);
    }

    /**
     * Takes the first look at a key field when the user enters it or its name field, which is
     * before either can be changed.
     *
     * @param {Event} event a field got the focus
     */
    function onFocus(event) {
        const field = event.target;
        if (!isTextField(field)) {
            return;
        }
        const key = PAIRS.some((pair) => field.matches(pair.key)) ? field : keyFieldOf(field);
        if (key) {
            isBroughtAlong(key);
        }
        undoFilledKey();
    }

    /**
     * Fills the key of a dialog from its name, as long as the key is empty or still the one this
     * script wrote: a key typed by the user or brought along by the dialog stays.
     *
     * @param {Event} event something was typed into a field
     */
    function onInput(event) {
        const name = event.target;
        if (!isTextField(name)) {
            return;
        }
        // a name or key pasted or dropped with the mouse releases no key, and Contact Builder's
        // dialog would not notice it. That is put right whether or not keys are filled in
        if (
            MOUSE_INPUTS.has(event.inputType) &&
            PAIRS.some((pair) => name.matches(pair.name) || name.matches(pair.key))
        ) {
            name.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
        const filled = filledPair();
        if (filled && name.matches(filled.key)) {
            // typing, pasting and deleting say how the text changed; a password manager that
            // writes into the field does not
            if (event.inputType) {
                if (name.value === '') {
                    typed.delete(name);
                } else {
                    typed.add(name);
                }
            } else {
                if (name.value === '' || name.value === written.get(name)) {
                    // a pasted login that was taken out again: nothing here is the user's
                    typed.delete(name);
                }
                undoFilledKey();
            }
            return;
        }
        if (!isOn) {
            return;
        }
        const key = keyFieldOf(name);
        if (!key || isBroughtAlong(key) || key.disabled || key.readOnly) {
            return;
        }
        if (filled && key.matches(filled.key)) {
            if (typed.has(key)) {
                return;
            }
        } else if (key.value !== '' && key.value !== written.get(key)) {
            return;
        }
        fill(name, key);
    }

    /**
     * Keeps the name typed for an automation when the user clicks anywhere else, as on Save.
     * Automation Studio drops the name unless its "Done" button was clicked first, and then asks
     * for a name the user has just typed. The field's own buttons do what they always did.
     *
     * @param {MouseEvent} event click anywhere on the page
     */
    function onClick(event) {
        const open = document.querySelector(NAME_IN_PLACE);
        if (open && event.target instanceof Node && !open.contains(event.target)) {
            open.querySelector(TAKE_OVER)?.click();
        }
        // a saved login written into the key of a new user is undone before the page is saved
        undoFilledKey();
    }

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: ON });
            isOn = values[SETTING] === ON;
        } catch {
            // without the setting it stays switched on
        }
    }

    document.addEventListener('focusin', onFocus, { capture: true });
    document.addEventListener('input', onInput, { capture: true });
    document.addEventListener('change', undoFilledKey, { capture: true });
    document.addEventListener('click', onClick, { capture: true });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            isOn = changes[SETTING].newValue === ON;
        }
    });
    readSetting();
})();
