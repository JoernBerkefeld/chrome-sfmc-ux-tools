/*
 * SFMC UX Tools — content script for readable keys.
 *
 * A dialog that creates something in Marketing Cloud asks for a name and offers a field for the
 * key (external key, customer key). Left empty, the key becomes a GUID. This script fills the key
 * from the name while the name is typed, the way Salesforce derives an API name from a label.
 * A key that the dialog brought along, as when something existing is edited, is never touched.
 */
(() => {
    'use strict';

    const SETTING = 'readableKeys';
    const ON = 'on';
    // Automation Studio draws its dialogs in a modal; only there do its plain ids mean these fields
    const MODAL = '.modal';
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
    ];
    // what a key keeps besides the underscores that replace spaces
    const NOT_KEPT = /[^\w-]/g;
    // the marks that are left of accented letters once they are taken apart
    const MARKS = /\p{M}/gu;
    // key fields by the last key this script wrote into them
    const written = new WeakMap();
    // key fields this script has looked at, and those of them that came with a key
    const seen = new WeakSet();
    const broughtAlong = new WeakSet();
    let isOn = true;

    /**
     * Derives a key from a name: spaces become underscores, accents are dropped, and of the rest
     * only letters, digits, underscores and hyphens stay.
     *
     * @param {string} name what the user typed as the name
     * @param {number} max longest key the field takes; anything below 1 means no limit
     * @returns {string} the key; empty if nothing of the name can be part of a key
     */
    function toKey(name, max) {
        const key = name
            .normalize('NFD')
            .replaceAll(MARKS, '')
            .trim()
            .replaceAll(/\s+/g, '_')
            .replaceAll(NOT_KEPT, '')
            .replaceAll(/_+/g, '_')
            .replaceAll(/^_|_$/g, '');
        return max > 0 ? key.slice(0, max).replace(/_$/, '') : key;
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
            if (!name.matches(pair.name) || pair.route?.test(location.hash) === false) {
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
            const max = PAIRS.find((pair) => key.matches(pair.key))?.max;
            if (key.value !== '') {
                broughtAlong.add(key);
            } else if (isOn && max) {
                key.maxLength = max;
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
    }

    /**
     * Fills the key of a dialog from its name, as long as the key is empty or still the one this
     * script wrote: a key typed by the user or brought along by the dialog stays.
     *
     * @param {Event} event something was typed into a field
     */
    function onInput(event) {
        const name = event.target;
        if (!isOn || !isTextField(name)) {
            return;
        }
        const key = keyFieldOf(name);
        if (!key || isBroughtAlong(key) || key.disabled || key.readOnly) {
            return;
        }
        if (key.value !== '' && key.value !== written.get(key)) {
            return;
        }
        const value = toKey(name.value, key.maxLength);
        if (value === key.value) {
            return;
        }
        key.value = value;
        written.set(key, value);
        // for pages that follow the field instead of reading it when the dialog is confirmed
        key.dispatchEvent(new Event('input', { bubbles: true }));
        key.dispatchEvent(new Event('change', { bubbles: true }));
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
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            isOn = changes[SETTING].newValue === ON;
        }
    });
    readSetting();
})();
