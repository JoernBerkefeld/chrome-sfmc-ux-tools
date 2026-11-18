import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/user-autofill.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const USER_PAGE =
    'https://members.s7.exacttarget.com/Content/Administration/EmployeeDetails.aspx?e=1&emid=';
const FORM =
    '<input id="FullName" type="text" /><input id="UserName" data-form-type="username" />' +
    '<input id="ExternalKeyTextBox" type="text" autocomplete="on" />' +
    '<input id="Password" type="password" /><input id="ApiUser" type="checkbox" />';

/**
 * Runs the script in a page.
 *
 * @param {string} url address of the page
 * @param {object} [stored] what the extension's storage holds
 * @returns {{document: Document, hint: (id: string) => string | null, change: (value: string) => void}} the page, a way to read what a field tells the browser, and to change the setting
 */
function page(url, stored = {}) {
    const { window } = new JSDOM(`<!doctype html><body>${FORM}</body>`, {
        runScripts: 'outside-only',
        url,
    });
    const listeners = [];
    window.chrome = {
        storage: {
            sync: { get: (defaults) => Promise.resolve({ ...defaults, ...stored }) },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    window.eval(script);
    return {
        document: window.document,
        hint: (id) => window.document.querySelector(`#${id}`).getAttribute('autocomplete'),
        change: (newValue) => {
            for (const listener of listeners) {
                listener({ userAutofill: { newValue } }, 'sync');
            }
        },
    };
}

test('on the page of a user, the browser is told not to fill in the fields, and password fields become fields for text that show dots', async () => {
    const { document, hint } = page(USER_PAGE);
    assert.equal(hint('FullName'), 'off');
    assert.equal(hint('UserName'), 'off');
    assert.equal(hint('ExternalKeyTextBox'), 'off');
    assert.equal(hint('Password'), 'off');
    const type = (id) => document.querySelector('#' + id).type;
    assert.equal(type('Password'), 'text');
    assert.equal(document.querySelector('#Password').dataset.sfmcUxToolsMasked, '');
    // what is no field for text is left alone
    assert.equal(hint('ApiUser'), null);
    // fields that the page adds later are guarded as they arrive
    document.body.insertAdjacentHTML('beforeend', '<input id="Confirm" type="password" />');
    await tick();
    assert.equal(hint('Confirm'), 'off');
    assert.equal(type('Confirm'), 'text');
    // the page of an existing user is guarded as well
    const edited = page(USER_PAGE.replace('emid=', 'emid=12345'));
    assert.equal(edited.hint('Password'), 'off');
});

test('the setting hands the fields back to the browser, as they were, and guards them again', async () => {
    const { document, hint, change } = page(USER_PAGE, { userAutofill: 'allowed' });
    await tick();
    assert.equal(hint('UserName'), null);
    assert.equal(hint('Password'), null);
    assert.equal(hint('ExternalKeyTextBox'), 'on');
    document.body.insertAdjacentHTML('beforeend', '<input id="Confirm" type="password" />');
    await tick();
    assert.equal(hint('Confirm'), null);
    change('blocked');
    assert.equal(hint('Password'), 'off');
    assert.equal(hint('Confirm'), 'off');
    change('allowed');
    assert.equal(hint('Password'), null);
    assert.equal(hint('ExternalKeyTextBox'), 'on');
    // a password field is one again, with nothing left on it
    const password = document.querySelector('#Password');
    assert.equal(password.type, 'password');
    assert.deepEqual(new Set(password.getAttributeNames()), new Set(['id', 'type']));
});

test('a saved login that a password manager pastes into a field is taken out again; what the user gave stays', async () => {
    const { document, change } = page(USER_PAGE);
    const { Event, InputEvent } = document.defaultView;
    const name = document.querySelector('#UserName');
    let heard = 0;
    document.addEventListener('input', () => {
        heard++;
    });
    const paste = () => {
        name.value = 'saved@login';
        name.dispatchEvent(
            new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }),
        );
    };
    paste();
    assert.equal(name.value, '');
    // whoever follows the field hears of the paste and of its end
    assert.equal(heard, 2);
    // what was there before the paste comes back
    name.value = 'jane';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    paste();
    assert.equal(name.value, 'jane');
    // with the setting off, the password manager has its way
    change('allowed');
    paste();
    assert.equal(name.value, 'saved@login');
});

test('password managers that are extensions are told to skip the fields, in their own words', async () => {
    const { document, change } = page(USER_PAGE);
    const key = document.querySelector('#ExternalKeyTextBox');
    const name = document.querySelector('#UserName');
    for (const field of [key, document.querySelector('#Password')]) {
        assert.equal(field.dataset.lpignore, 'true');
        assert.equal(field.dataset['1pIgnore'], 'true');
        assert.equal(field.dataset.bwignore, 'true');
        assert.equal(field.dataset.formType, 'other');
    }
    // what the page says itself stays, also when the fields are handed back
    assert.equal(name.dataset.formType, 'username');
    assert.equal(name.dataset.lpignore, 'true');
    assert.equal(document.querySelector('#ApiUser').dataset.lpignore, undefined);
    change('allowed');
    assert.equal(name.dataset.formType, 'username');
    assert.equal(name.dataset.lpignore, undefined);
    assert.deepEqual(new Set(key.getAttributeNames()), new Set(['autocomplete', 'id', 'type']));
});

test('other pages are left alone, and the options page offers the setting, guarded first', () => {
    const other = page(
        'https://members.s7.exacttarget.com/Content/Administration/Roles/RoleDetails.aspx',
    );
    assert.equal(other.hint('Password'), null);
    const options = new JSDOM(read('../src/options.html')).window.document;
    assert.deepEqual(
        [...options.querySelectorAll('input[name="userAutofill"]')].map((input) => input.value),
        ['blocked', 'allowed'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) => item.js.includes('user-autofill.js'));
    assert.ok(entry.matches.some((match) => match.endsWith('/EmployeeDetails.aspx*')));
    assert.deepEqual(entry.css, ['user-autofill.css']);
    assert.match(read('../src/user-autofill.css'), /\[data-sfmc-ux-tools-masked\]/);
    assert.equal(entry.run_at, 'document_start');
    assert.equal(entry.all_frames, true);
});
