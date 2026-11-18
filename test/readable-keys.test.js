import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/readable-keys.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DIALOG =
    '<div class="modal"><input id="queryName" maxlength="64" /><input id="queryExternalKey" maxlength="36" /></div>';

/**
 * Runs the script in a page that shows the given fields.
 *
 * @param {string} html fields of the page
 * @param {Object.<string, string>} [stored] saved settings
 * @param {boolean} [isBroken] true makes the read of the settings fail
 * @returns {{document: Document, type: (selector: string, text: string) => void, value: (selector: string) => string, change: (value: string) => void}} the page, a way to type into a field, to read one and to change the setting
 */
function page(html, stored = {}, isBroken = false) {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
    });
    const listeners = [];
    window.chrome = {
        storage: {
            sync: {
                get: (defaults) =>
                    isBroken
                        ? Promise.reject(new Error('broken'))
                        : Promise.resolve({ ...defaults, ...stored }),
            },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    window.eval(script);
    const { document } = window;
    return {
        document,
        type: (selector, text) => {
            const field = document.querySelector(selector);
            field.value = text;
            field.dispatchEvent(new window.Event('input', { bubbles: true }));
        },
        value: (selector) => document.querySelector(selector).value,
        change: (newValue) => {
            for (const listener of listeners) {
                listener({ readableKeys: { newValue } }, 'sync');
            }
        },
    };
}

test('the key follows the name: underscores for spaces, hyphens stay, the rest is left out', () => {
    const { type, value } = page(DIALOG);
    const cases = {
        'My first query': 'My_first_query',
        '  Welcome   series - step 2 ': 'Welcome_series_-_step_2',
        'daily-import_v2': 'daily-import_v2',
        'Preise (EUR) & Währung v1.2': 'Preise_EUR_Wahrung_v12',
        'Crème brûlée / Ñandú': 'Creme_brulee_Nandu',
        __a__b__: 'a_b',
        '(!)': '',
        日本語: '',
        '': '',
    };
    for (const [name, key] of Object.entries(cases)) {
        type('#queryName', name);
        assert.equal(value('#queryExternalKey'), key, name);
    }
});

test('the key is cut to what its field takes and does not end in an underscore', () => {
    const { type, value } = page(DIALOG);
    type('#queryName', 'a'.repeat(40));
    assert.equal(value('#queryExternalKey'), 'a'.repeat(36));
    type('#queryName', `${'a'.repeat(35)} b`);
    assert.equal(value('#queryExternalKey'), 'a'.repeat(35));
    // a field without a limit takes the whole key
    const free = page(
        '<div class="modal"><input id="scriptName" /><input id="scriptExternalKey" /></div>',
    );
    free.type('#scriptName', 'b'.repeat(300));
    assert.equal(free.value('#scriptExternalKey'), 'b'.repeat(300));
});

test('every dialog that is covered gets its key', () => {
    const pairs = [
        [
            '<div class="modal"><input id="queryName" /><input id="queryExternalKey" /></div>',
            '#queryName',
            '#queryExternalKey',
        ],
        [
            '<div class="modal"><input id="scriptName" /><input id="scriptExternalKey" /></div>',
            '#scriptName',
            '#scriptExternalKey',
        ],
        [
            '<div class="modal"><input id="filterActivityName" /><input id="filterActivityExternalKey" /></div>',
            '#filterActivityName',
            '#filterActivityExternalKey',
        ],
        [
            '<div class="modal"><input id="importsName" /><input id="importsKey" /></div>',
            '#importsName',
            '#importsKey',
        ],
        [
            '<div class="modal"><input id="name" /><input id="customerKey" /></div>',
            '#name',
            '#customerKey',
        ],
        [
            '<input id="name" data-testid="new-de-name-input" /><input id="key" data-testid="new-de-key-input" />',
            '#name',
            '#key',
        ],
    ];
    for (const [html, name, key] of pairs) {
        const { type, value } = page(html);
        type(name, 'New item 1');
        assert.equal(value(key), 'New_item_1', html);
    }
});

test('a key that the dialog brought along is never touched, also if this script once wrote the same', () => {
    const { document, type, value } = page(DIALOG);
    type('#queryName', 'My query');
    assert.equal(value('#queryExternalKey'), 'My_query');
    // the dialog is closed, and opened again for the query that was created
    document.body.innerHTML =
        '<div class="modal"><input id="queryName" value="My query" /><input id="queryExternalKey" value="My_query" /></div>';
    type('#queryName', 'My renamed query');
    assert.equal(value('#queryExternalKey'), 'My_query');
});

test('a key that the dialog brought along stays out of reach once the user empties it', () => {
    const { document, type, value } = page(
        '<div class="modal"><input id="queryName" value="My query" /><input id="queryExternalKey" value="3f2a-existing" /></div>',
    );
    // the user enters the key field, which is when the script first looks at it, and empties it
    document
        .querySelector('#queryExternalKey')
        .dispatchEvent(new document.defaultView.Event('focusin', { bubbles: true }));
    type('#queryExternalKey', '');
    type('#queryName', 'My renamed query');
    assert.equal(value('#queryExternalKey'), '');
});

test('a key typed by the user stays; an emptied key follows the name again', () => {
    const { type, value } = page(DIALOG);
    type('#queryName', 'First');
    type('#queryExternalKey', 'my.own.key');
    type('#queryName', 'First try');
    assert.equal(value('#queryExternalKey'), 'my.own.key');
    type('#queryExternalKey', '');
    type('#queryName', 'First try again');
    assert.equal(value('#queryExternalKey'), 'First_try_again');
});

test('the page hears of a key that was filled in, and only when it changed', () => {
    const { document, type } = page(DIALOG);
    const heard = [];
    const key = document.querySelector('#queryExternalKey');
    for (const kind of ['input', 'change']) {
        key.addEventListener(kind, () => {
            heard.push(kind);
        });
    }
    type('#queryName', 'A');
    assert.deepEqual(heard, ['input', 'change']);
    type('#queryName', 'A!');
    assert.deepEqual(heard, ['input', 'change']);
});

test('fields that are not a known pair in its place are left alone', () => {
    // plain ids outside a dialog of Automation Studio
    const loose = page('<input id="name" /><input id="customerKey" />');
    loose.type('#name', 'Some name');
    assert.equal(loose.value('#customerKey'), '');
    // a key field in another dialog than the name
    const apart = page(
        '<div class="modal"><input id="queryName" /></div><div class="modal"><input id="queryExternalKey" /></div>',
    );
    apart.type('#queryName', 'Some name');
    assert.equal(apart.value('#queryExternalKey'), '');
    // a key that cannot be edited
    const fixed = page(
        '<div class="modal"><input id="queryName" /><input id="queryExternalKey" readonly /></div>',
    );
    fixed.type('#queryName', 'Some name');
    assert.equal(fixed.value('#queryExternalKey'), '');
});

test('the setting switches it off and on without a reload; unreadable settings leave it on', async () => {
    const off = page(DIALOG, { readableKeys: 'off' });
    await tick();
    off.type('#queryName', 'One');
    assert.equal(off.value('#queryExternalKey'), '');
    off.change('on');
    off.type('#queryName', 'Two');
    assert.equal(off.value('#queryExternalKey'), 'Two');
    off.change('off');
    off.type('#queryName', 'Three');
    assert.equal(off.value('#queryExternalKey'), 'Two');
    const broken = page(DIALOG, {}, true);
    await tick();
    broken.type('#queryName', 'One');
    assert.equal(broken.value('#queryExternalKey'), 'One');
});

test('the options page offers the setting, on first, and the manifest runs the script where the dialogs are', () => {
    const { document } = new JSDOM(read('../src/options.html')).window;
    assert.deepEqual(
        [...document.querySelectorAll('input[name="readableKeys"]')].map((input) => input.value),
        ['on', 'off'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) => item.js.includes('readable-keys.js'));
    assert.deepEqual(entry.matches, [
        'https://*.marketingcloudapps.com/AutomationStudioFuel3/*',
        'https://*.marketingcloudapps.com/contactsmeta/*',
    ]);
    assert.equal(entry.world, undefined);
    assert.equal(entry.all_frames, true);
});
