import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const script = read('../src/key-rule.js') + read('../src/readable-keys.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DIALOG =
    '<div class="modal"><input id="queryName" maxlength="64" /><input id="queryExternalKey" maxlength="36" /></div>';

/**
 * Runs the script in a page that shows the given fields.
 *
 * @param {string} html fields of the page
 * @param {Object.<string, string>} [stored] saved settings
 * @param {boolean} [isBroken] true makes the read of the settings fail
 * @param {string} [url] address of the page
 * @returns {{document: Document, type: (selector: string, text: string) => void, value: (selector: string) => string, change: (value: string) => void}} the page, a way to type into a field, to read one and to change the setting
 */
function page(html, stored = {}, isBroken = false, url = 'https://mc.example.com/') {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
        url,
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
            '<div class="modal"><input id="automationName" /><input id="automationKey" /></div>',
            '#automationName',
            '#automationKey',
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

test('a new automation gets its key from the name; one that exists keeps its key', () => {
    const html =
        '<div id="nameInput" class="placard"><textarea class="placard-field" maxlength="200"></textarea></div>' +
        '<input id="externalKeyTextInput" class="placard-field" maxlength="200" />';
    const fresh = page(html);
    fresh.document.defaultView.location.hash = '#Instance/newunspecified/workflow';
    fresh.type('#nameInput textarea', 'Daily import\nof orders');
    assert.equal(fresh.value('#externalKeyTextInput'), 'Daily_import_of_orders');
    // once saved, the page stays open under the address of the automation
    fresh.document.defaultView.location.hash = '#Instance/ZGFpbHk/workflow';
    fresh.type('#nameInput textarea', 'Daily import of all orders');
    assert.equal(fresh.value('#externalKeyTextInput'), 'Daily_import_of_orders');
});

test('a new data extension may have the key length Marketing Cloud allows, not the shorter one of its dialog', () => {
    const html =
        '<input data-testid="new-de-name-input" maxlength="128" /><input data-testid="new-de-key-input" maxlength="36" />';
    const key = '[data-testid="new-de-key-input"]';
    const { document, type, value } = page(html);
    type('[data-testid="new-de-name-input"]', 'a'.repeat(128));
    assert.equal(value(key), 'a'.repeat(128));
    assert.equal(document.querySelector(key).maxLength, 200);
    // entering the key field first widens it as well
    const typed = page(html);
    typed.document
        .querySelector(key)
        .dispatchEvent(new typed.document.defaultView.Event('focusin', { bubbles: true }));
    assert.equal(typed.document.querySelector(key).maxLength, 200);
    // a field that came with a key keeps its limit
    const existing = page(html.replace('maxlength="36"', 'maxlength="36" value="abc"'));
    existing.type('[data-testid="new-de-name-input"]', 'Renamed');
    assert.equal(existing.document.querySelector(key).maxLength, 36);
    assert.equal(existing.value(key), 'abc');
});

test("Email Studio's data extension dialog hears of the key the way its widgets listen: when the field is left", () => {
    const { document, type, value } = page(
        '<div class="new-de-name"><input class="fuel-input" maxlength="128" /></div>' +
            '<div class="new-de-key"><input class="fuel-input" maxlength="200" /></div>',
    );
    const heard = [];
    const key = document.querySelector('.new-de-key input');
    for (const kind of ['input', 'change', 'keyup', 'blur']) {
        key.addEventListener(kind, () => {
            heard.push(kind);
        });
    }
    type('.new-de-name input', 'Order history 2026');
    assert.equal(value('.new-de-key input'), 'Order_history_2026');
    assert.deepEqual(heard, ['input', 'change', 'keyup', 'blur']);
    // the other dialogs read the field or follow its changes; they get no such event
    const other = page(DIALOG);
    let isLeft = false;
    other.document.querySelector('#queryExternalKey').addEventListener('blur', () => {
        isLeft = true;
    });
    other.type('#queryName', 'A');
    assert.equal(isLeft, false);
});

test('a name or key pasted with the mouse is made known to a dialog that waits for a released key, also with readable keys switched off', async () => {
    const html =
        '<input data-testid="new-de-name-input" /><input data-testid="new-de-key-input" /><input id="other" />';
    const NAME = '[data-testid="new-de-name-input"]';
    const KEY = '[data-testid="new-de-key-input"]';
    for (const setting of ['on', 'off']) {
        const { document, value } = page(html, { readableKeys: setting });
        await tick();
        const { InputEvent } = document.defaultView;
        const released = [];
        document.body.addEventListener('keyup', (event) => {
            released.push(event.target.dataset.testid ?? event.target.id);
        });
        const enter = (selector, text, inputType) => {
            const field = document.querySelector(selector);
            field.value = text;
            field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
        };
        enter(KEY, 'pasted_key', 'insertFromPaste');
        assert.deepEqual(released, ['new-de-key-input'], setting);
        assert.equal(value(KEY), 'pasted_key');
        enter(NAME, 'Dropped name', 'insertFromDrop');
        assert.deepEqual(released, ['new-de-key-input', 'new-de-name-input'], setting);
        // the pasted key is the user's own and stays
        assert.equal(value(KEY), 'pasted_key');
        // typing releases a key by itself, and other fields are none of this script's business
        enter(NAME, 'Dropped name!', 'insertText');
        enter('#other', 'x', 'insertFromPaste');
        assert.equal(released.length, 2, setting);
    }
    // with readable keys on, a pasted name also gives the key
    const filled = page(html);
    const name = filled.document.querySelector(NAME);
    name.value = 'Pasted name';
    name.dispatchEvent(
        new filled.document.defaultView.InputEvent('input', {
            bubbles: true,
            inputType: 'insertFromPaste',
        }),
    );
    assert.equal(filled.value(KEY), 'Pasted_name');
});

test('sender profiles, send classifications and delivery profiles get their key on their own pages only', () => {
    const base = 'https://members.s7.exacttarget.com/Content/Administration/SendManagement/';
    const forms = [
        [
            'SenderProfile.aspx',
            '<input id="profileName" /><input id="customerKey" maxlength="36" />',
            '#profileName',
            '#customerKey',
        ],
        [
            'SendClassification.aspx',
            '<input id="txtName" /><input id="txtCustKey" maxlength="36" />',
            '#txtName',
            '#txtCustKey',
        ],
        [
            'DeliveryProfile.aspx',
            '<input id="name" /><input id="customerKey" maxlength="36" />',
            '#name',
            '#customerKey',
        ],
    ];
    for (const [file, html, name, key] of forms) {
        const fresh = page(html, {}, false, base + file);
        fresh.type(name, 'Newsletter (DE)');
        assert.equal(fresh.value(key), 'Newsletter_DE', file);
        // the same page opened for something that exists comes with its key
        const existing = page(
            html.replace('maxlength', 'value="abc" maxlength'),
            {},
            false,
            `${base}${file}?id=1`,
        );
        existing.type(name, 'Renamed');
        assert.equal(existing.value(key), 'abc', file);
        // the same fields on any other page
        const elsewhere = page(html);
        elsewhere.type(name, 'Newsletter');
        assert.equal(elsewhere.value(key), '', file);
    }
});

test('file locations, roles and users get their key when they are new, by what their address says', () => {
    const base = 'https://members.s7.exacttarget.com/Content/Administration/';
    const forms = [
        [
            'SendManagement/ImportLocationDetails.aspx',
            'SendManagement/ImportLocationDetails.aspx',
            '<input id="Name" /><input id="CustomerKey" maxlength="36" />',
            '#Name',
            '#CustomerKey',
        ],
        [
            'Roles/RoleDetails.aspx',
            'Roles/RoleDetails.aspx?id=f4cfb80f-3550-e611-96fe-38eaa7142c61',
            '<input id="Name" /><input id="ExternalKey" maxlength="36" />',
            '#Name',
            '#ExternalKey',
        ],
        [
            'EmployeeDetails.aspx?e=1&emid=',
            'EmployeeDetails.aspx?e=1&emid=12345',
            '<input id="FullName" /><input id="ExternalKeyTextBox" maxlength="50" />',
            '#FullName',
            '#ExternalKeyTextBox',
        ],
    ];
    for (const [fresh, existing, html, name, key] of forms) {
        const created = page(html, {}, false, base + fresh);
        created.type(name, 'Jörn Berkefeld (admin)');
        assert.equal(created.value(key), 'Jorn_Berkefeld_admin', fresh);
        // what exists comes with its key
        const edited = page(
            html.replace('maxlength', 'value="abc" maxlength'),
            {},
            false,
            base + existing,
        );
        edited.type(name, 'Renamed');
        assert.equal(edited.value(key), 'abc', existing);
    }
    // a role or user that exists without a key is not given one either
    for (const [, existing, html, name, key] of forms.slice(1)) {
        const keyless = page(html, {}, false, base + existing);
        keyless.type(name, 'Renamed');
        assert.equal(keyless.value(key), '', existing);
    }
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
    // Contact Builder listens for a released key on an element around the field
    for (const kind of ['input', 'change', 'keyup']) {
        document.body.addEventListener(kind, (event) => {
            if (event.target === key) {
                heard.push(kind);
            }
        });
    }
    type('#queryName', 'A');
    assert.deepEqual(heard, ['input', 'change', 'keyup']);
    type('#queryName', 'A!');
    assert.deepEqual(heard, ['input', 'change', 'keyup']);
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
        'https://*.exacttarget.com/C12/Default.aspx*',
        'https://*.exacttarget.com/Content/Administration/SendManagement/*',
        'https://*.exacttarget.com/Content/Administration/Roles/RoleDetails.aspx*',
        'https://*.exacttarget.com/Content/Administration/EmployeeDetails.aspx*',
    ]);
    assert.equal(entry.world, undefined);
    assert.equal(entry.all_frames, true);
});
