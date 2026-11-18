/*
 * SFMC UX Tools — content script for the pages of Setup that create or edit a user.
 *
 * Those pages have a username next to password fields, which a browser's password manager takes
 * for a login form: it fills in a saved login, also into the external key. This script tells
 * the browser that the passwords asked for here are new ones and that the other fields are not
 * to be filled in, before the browser gets to them. Password managers that are extensions do
 * not read what is said to the browser; each has a word of its own, which is said as well. What
 * is filled in all the same is taken out again.
 */
(() => {
    'use strict';

    const SETTING = 'userAutofill';
    const BLOCKED = 'blocked';
    const USER_PAGE = /\/Administration\/EmployeeDetails\.aspx$/i;
    // where a field's own hint to the browser is kept, to give it back
    const KEPT = 'data-sfmc-ux-tools-autocomplete';
    const GUARDED = '[data-sfmc-ux-tools-autocomplete]';
    // what LastPass, 1Password, Bitwarden and Dashlane look for on a field they are to skip
    const MANAGER_HINTS = {
        'data-lpignore': 'true',
        'data-1p-ignore': 'true',
        'data-bwignore': 'true',
        'data-form-type': 'other',
    };
    // which of those this script put on a field, to take them off again
    const HINTED = 'data-sfmc-ux-tools-hints';
    const PASSWORDS = 'input[type="password"]';
    const TEXTS = 'input[type="text"], input[type="email"], input:not([type])';
    // fields by the text the user last gave them
    const own = new WeakMap();
    let isBlocked = true;

    /**
     * Tells the browser to leave the fields of the page alone, each field once.
     */
    function guard() {
        if (!isBlocked) {
            return;
        }
        for (const field of document.querySelectorAll(
            `:is(${PASSWORDS}, ${TEXTS}):not(${GUARDED})`,
        )) {
            field.setAttribute(KEPT, field.getAttribute('autocomplete') ?? '');
            field.setAttribute('autocomplete', field.matches(PASSWORDS) ? 'new-password' : 'off');
            const added = Object.keys(MANAGER_HINTS).filter((hint) => !field.hasAttribute(hint));
            for (const hint of added) {
                field.setAttribute(hint, MANAGER_HINTS[hint]);
            }
            field.setAttribute(HINTED, added.join(' '));
        }
    }

    /**
     * Undoes what a password manager wrote into a field. LastPass pastes a saved login into the
     * username when the field is entered, and Chrome fills in the saved login the user picks
     * from the list it shows at the password fields, whatever the fields say.
     *
     * @param {Event} event the text of a field changed
     */
    function onInput(event) {
        const field = event.target;
        if (!isBlocked || !(field instanceof HTMLInputElement) || !field.matches(GUARDED)) {
            return;
        }
        // typing, pasting and deleting come from the user and name how the text changed. Chrome
        // filling in a saved password comes as the user's but names nothing; LastPass names a
        // paste that is not the user's; the extension's own key is neither
        if (event.isTrusted === Boolean(event.inputType)) {
            own.set(field, field.value);
            return;
        }
        const before = own.get(field) ?? field.defaultValue;
        if (field.value === before) {
            return;
        }

        field.value = before;
        // for whoever follows the field, as the key of a new user does
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /**
     * Gives the fields back what they said to the browser before.
     */
    function release() {
        for (const field of document.querySelectorAll(GUARDED)) {
            const own = field.getAttribute(KEPT);
            field.removeAttribute('autocomplete');
            if (own) {
                field.setAttribute('autocomplete', own);
            }
            field.removeAttribute(KEPT);
            const added = (field.getAttribute(HINTED) ?? '').split(' ');
            for (const hint of added) {
                if (hint) {
                    field.removeAttribute(hint);
                }
            }
            field.removeAttribute(HINTED);
        }
    }

    /**
     * Follows the user's choice.
     *
     * @param {unknown} value the setting
     */
    function apply(value) {
        isBlocked = value === BLOCKED;
        if (isBlocked) {
            guard();
        } else {
            release();
        }
    }

    /**
     * Reads the user's choice from the extension's storage.
     */
    async function readSetting() {
        try {
            const values = await chrome.storage.sync.get({ [SETTING]: BLOCKED });
            apply(values[SETTING]);
        } catch {
            // without the setting the fields stay guarded
        }
    }

    if (!USER_PAGE.test(location.pathname)) {
        return;
    }
    // the fields are guarded as the page is read, which is before the browser fills them in
    new MutationObserver(guard).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
    guard();
    document.addEventListener('input', onInput, { capture: true });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.hasOwn(changes, SETTING)) {
            apply(changes[SETTING].newValue);
        }
    });
    readSetting();
})();
