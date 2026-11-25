import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const frameScript = read('../src/email-studio-de-switcher.js');
const shellScript = read('../src/email-studio-de-switcher-shell.js');
const backgroundScript = read('../src/background.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const plain = (value) => structuredClone(value);
const EXTENSION = 'extension-id';
const BACKGROUND = { id: EXTENSION };
const STATE = 'sfmc-ux-tools:email-studio:state';
const GO = 'sfmc-ux-tools:email-studio:go';
const LIST = 'sfmc-ux-tools:de-switcher:list';
const OPEN = '0a1b2c3d-0000-4000-8000-00000000000a';
const OTHER = '0a1b2c3d-0000-4000-8000-00000000000b';
const THIRD = '0a1b2c3d-0000-4000-8000-00000000000c';
const FOLDER = 4242;
const HEADER =
    '<div class="op-head"><div class="op-head-back"><div class="lg-head-breadcrumb clearfix"><div class="breadcrumb-step pull-left">Data Extensions</div><div class="breadcrumb-separator pull-left">&gt;</div><div class="breadcrumb-step pull-left">Alpha_Log</div></div></div><div class="op-head-title"><div class="op-head-nd"><div class="op-head-name"><div id="op-name-box"><input id="op-head-name-static" type="text"></div></div></div></div></div>';
const ENTRIES = [
    { id: OPEN, name: 'Alpha_Log' },
    { id: OTHER, name: 'Beta_Queue' },
    { id: THIRD, name: 'Gamma_Log' },
];

/**
 * Runs the frame's script in a page of Email Studio.
 *
 * @param {(message: object) => unknown} [answer] what the background script answers
 * @returns {Promise.<object>} the window, its document, what was asked and opened, and helpers
 */
async function frame(answer = () => ({ items: ENTRIES, isCut: false })) {
    const { window } = new JSDOM(`<!doctype html><html><body>${HEADER}</body></html>`, {
        runScripts: 'outside-only',
        url: 'https://members.s7.exacttarget.com/C12/Default.aspx#Subscribers',
    });
    const asked = [];
    const opened = [];
    window.chrome = {
        runtime: {
            getURL: (path) => `chrome-extension://${EXTENSION}/${path}`,
            sendMessage: async (message) => {
                asked.push(structuredClone(message));
                return answer(message);
            },
        },
    };
    window.eval(frameScript);
    const { document } = window;
    document.addEventListener(GO, (event) => {
        opened.push(event.detail);
    });
    const button = () => document.querySelector('.sfmc-ux-tools-de-switcher-button');
    const panel = () => document.querySelector('.sfmc-ux-tools-de-switcher-panel');
    const step = () => [...document.querySelectorAll('.breadcrumb-step')].at(-1);
    return {
        window,
        document,
        asked,
        opened,
        button,
        panel,
        step,
        tell: (text) => document.dispatchEvent(new window.CustomEvent(STATE, { detail: text })),
        names: () =>
            [...document.querySelectorAll('.sfmc-ux-tools-de-switcher-item')].map(
                (item) => item.textContent,
            ),
        status: () => panel()?.querySelector('[role="status"]').textContent,
        search: (text) => {
            const input = panel().querySelector('input');
            input.value = text;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
        },
        key: (target, key) =>
            target.dispatchEvent(
                new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
            ),
    };
}

test('the button is shown after the last step of the path while a data extension is open, and only then', async () => {
    const { tell, button, step, document } = await frame();
    assert.equal(button(), null);
    tell('up');
    tell(`de-pages/de/${OPEN}`);
    assert.ok(button());
    assert.equal(button().previousElementSibling, step());
    assert.match(button().title, /^SFMC UX Tools: /);
    assert.equal(button().getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelectorAll('.sfmc-ux-tools-de-switcher-button').length, 1);
    assert.equal(step().getAttribute('role'), 'button');
    assert.equal(step().getAttribute('tabindex'), '0');
    assert.match(step().title, /^SFMC UX Tools: /);
    tell(`de-grid/dataextension/${FOLDER}`);
    assert.equal(button(), null);
    assert.equal(step().hasAttribute('role'), false);
    assert.equal(step().hasAttribute('tabindex'), false);
    assert.equal(step().title, '');
    tell(`de-pages/de/${OPEN}`);
    tell('none');
    assert.equal(button(), null);
    tell(`de-pages/de/${OPEN}`);
    tell('cleared');
    assert.equal(button(), null);
});

test('texts that name no view leave the button as it is, and odd ones show none', async () => {
    const { tell, button } = await frame();
    tell(`de-pages/de/${OPEN}`);
    tell('ready');
    tell('change:carbonContent');
    assert.ok(button());
    const odd = await frame();
    for (const text of ['de-pages/de/1', 'de-pages/de/', `de-pages/de/${OPEN}/x`, 7, null]) {
        odd.tell(text);
    }
    assert.equal(odd.button(), null);
});

test('a header that Email Studio draws again gets the button again', async () => {
    const { tell, button, step, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    document.querySelector('.op-head').outerHTML = HEADER;
    await tick();
    assert.ok(button());
    assert.equal(button().previousElementSibling, step());
});

test('a click lists the data extensions of the folder, asked for once per opening, with the open one marked', async () => {
    const { tell, button, panel, asked, names, status, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    button().click();
    assert.ok(panel());
    assert.equal(button().getAttribute('aria-expanded'), 'true');
    assert.equal(status(), 'Loading…');
    assert.equal(document.activeElement, panel().querySelector('input'));
    await tick();
    assert.deepEqual(asked, [{ type: LIST, id: OPEN }]);
    assert.deepEqual(names(), ['Alpha_Log', 'Beta_Queue', 'Gamma_Log']);
    assert.equal(status(), '3 of 3');
    const marked = document.querySelector('[aria-current="true"]');
    assert.equal(marked.textContent, 'Alpha_Log');
    button().click();
    assert.equal(panel(), null);
    button().click();
    await tick();
    assert.equal(asked.length, 2);
});

test('the search box keeps the data extensions whose name holds its text', async () => {
    const { tell, button, search, names, status } = await frame();
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    search('log');
    assert.deepEqual(names(), ['Alpha_Log', 'Gamma_Log']);
    assert.equal(status(), '2 of 3');
    search('zzz');
    assert.deepEqual(names(), []);
    assert.equal(status(), 'No data extension matches.');
});

test('a data extension that is picked is opened by Email Studio’s route, and the open one is not opened again', async () => {
    const { tell, button, panel, opened, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    document.querySelector('[aria-current="true"]').click();
    assert.deepEqual(opened, []);
    assert.equal(panel(), null);
    button().click();
    await tick();
    const items = [...document.querySelectorAll('.sfmc-ux-tools-de-switcher-item')];
    items[1].click();
    assert.deepEqual(opened, [`Subscribers/customobject/${OTHER}`]);
    assert.equal(panel(), null);
});

test('the arrow keys move between the search box and the data extensions, and Escape closes', async () => {
    const { tell, button, panel, key, step, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    const input = panel().querySelector('input');
    const items = [...document.querySelectorAll('.sfmc-ux-tools-de-switcher-item')];
    key(input, 'ArrowDown');
    assert.equal(document.activeElement, items[0]);
    key(items[0], 'ArrowDown');
    key(items[1], 'ArrowDown');
    key(items[2], 'ArrowDown');
    assert.equal(document.activeElement, items[2]);
    key(items[2], 'ArrowUp');
    assert.equal(document.activeElement, items[1]);
    key(items[1], 'Escape');
    assert.equal(panel(), null);
    assert.equal(document.activeElement, step());
});

test('a click elsewhere closes the list', async () => {
    const { window, tell, button, panel, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    panel().dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    assert.ok(panel());
    document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(panel(), null);
});

test('a list that could not be read says so', async () => {
    for (const answer of [
        () => ({ isFailed: true }),
        () => ({ items: [] }),
        () => {},
        () => {
            throw new Error('gone');
        },
    ]) {
        const { tell, button, status, names } = await frame(answer);
        tell(`de-pages/de/${OPEN}`);
        button().click();
        await tick();
        assert.equal(status(), 'The data extensions of this folder could not be read.');
        assert.deepEqual(names(), []);
    }
});

test('a folder with more data extensions than were listed says so', async () => {
    const { tell, button, status } = await frame(() => ({ items: ENTRIES, isCut: true }));
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    assert.equal(status(), '3 of 3; the folder has more');
});

test('an answer for a data extension that is no longer open is dropped', async () => {
    let release;
    const { tell, button, panel } = await frame(
        () =>
            new Promise((resolve) => {
                release = () => resolve({ items: ENTRIES });
            }),
    );
    tell(`de-pages/de/${OPEN}`);
    button().click();
    await tick();
    tell(`de-pages/de/${OTHER}`);
    assert.equal(panel(), null);
    release();
    await tick();
    assert.equal(panel(), null);
});

/**
 * Runs the script of the Marketing Cloud page with a stand-in for Marketing Cloud's API.
 *
 * @param {Object.<string, unknown>} answers what the API answers, by address; a missing one fails
 * @returns {{send: (message: object, sender?: object) => Promise.<object>|false, fetched: string[]}} a way to send it a message, and what it read
 */
function shell(answers) {
    const listeners = [];
    const fetched = [];
    const chrome = {
        runtime: {
            id: EXTENSION,
            onMessage: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    const fetch = async (address, options) => {
        fetched.push(address);
        assert.equal(options.method, 'GET');
        assert.equal(options.credentials, 'same-origin');
        return Object.hasOwn(answers, address)
            ? { ok: true, status: 200, json: async () => structuredClone(answers[address]) }
            : { ok: false, status: 404, json: async () => ({}) };
    };
    vm.runInNewContext(shellScript, { chrome, fetch });
    const send = (message, sender = BACKGROUND) => {
        const { promise, resolve } = Promise.withResolvers();
        const willAnswer = listeners[0](message, sender, (answer) => resolve(plain(answer)));
        return willAnswer === true && promise;
    };
    return { send, fetched };
}

const API = '/cloud/fuelapi/internal/v1/customobjects/';
const pageAddress = (page) =>
    `${API}category/${FOLDER}/?retrievalType=1&$page=${page}&$pagesize=25&$orderBy=Name%20ASC`;
const made = (count, from = 0) =>
    Array.from({ length: count }, (_, index) => ({
        id: `0a1b2c3d-0000-4000-8000-${String(from + index).padStart(12, '0')}`,
        name: `DE_${from + index}`,
        customerKey: 'not passed on',
        totalRowCount: 5,
    }));

test('the page reads the folder of the data extension, then the data extensions of that folder, and passes on ids and names only', async () => {
    const { send, fetched } = shell({
        [API + OPEN]: { categoryId: FOLDER, name: 'Alpha_Log' },
        [pageAddress(1)]: { count: 3, items: ENTRIES.map((entry) => ({ ...entry, extra: 1 })) },
    });
    assert.deepEqual(await send({ type: LIST, id: OPEN }), {
        folder: FOLDER,
        items: ENTRIES,
        isCut: false,
    });
    assert.deepEqual(fetched, [API + OPEN, pageAddress(1)]);
});

test('the page reads every page of a large folder, up to 40', async () => {
    const answers = { [API + OPEN]: { categoryId: FOLDER } };
    for (let page = 1; page <= 3; page += 1) {
        answers[pageAddress(page)] = {
            count: 60,
            items: made(page === 3 ? 10 : 25, (page - 1) * 25),
        };
    }
    const { send, fetched } = shell(answers);
    const answer = await send({ type: LIST, id: OPEN });
    assert.equal(answer.items.length, 60);
    assert.equal(answer.isCut, false);
    assert.deepEqual(answer.items[0], { id: made(1)[0].id, name: 'DE_0' });
    assert.equal(fetched.length, 4);

    const huge = { [API + OPEN]: { categoryId: FOLDER } };
    for (let page = 1; page <= 40; page += 1) {
        huge[pageAddress(page)] = { count: 2000, items: made(25, (page - 1) * 25) };
    }
    const big = shell(huge);
    const cut = await big.send({ type: LIST, id: OPEN });
    assert.equal(cut.items.length, 1000);
    assert.equal(cut.isCut, true);
    assert.equal(big.fetched.length, 41);
});

test('the page fails when the data extension, its folder or a page cannot be read, and leaves out odd entries', async () => {
    assert.deepEqual(await shell({}).send({ type: LIST, id: OPEN }), { isFailed: true });
    assert.deepEqual(
        await shell({ [API + OPEN]: { categoryId: '4242' } }).send({ type: LIST, id: OPEN }),
        { isFailed: true },
    );
    assert.deepEqual(
        await shell({ [API + OPEN]: { categoryId: FOLDER } }).send({ type: LIST, id: OPEN }),
        { isFailed: true },
    );
    assert.deepEqual(
        await shell({
            [API + OPEN]: { categoryId: FOLDER },
            [pageAddress(1)]: { count: 30, items: made(25) },
        }).send({ type: LIST, id: OPEN }),
        { isFailed: true },
    );
    const odd = await shell({
        [API + OPEN]: { categoryId: FOLDER },
        [pageAddress(1)]: {
            count: 6,
            items: [
                ENTRIES[0],
                ENTRIES[0],
                { id: '1', name: 'x' },
                { id: OTHER, name: '' },
                { id: OTHER, name: 'x'.repeat(201) },
                null,
            ],
        },
    }).send({ type: LIST, id: OPEN });
    assert.deepEqual(odd.items, [ENTRIES[0]]);
});

test('the page only answers the background script, and only for an id of the form', () => {
    const { send, fetched } = shell({});
    assert.equal(send({ type: LIST, id: OPEN }, { id: 'another-extension' }), false);
    assert.equal(send({ type: LIST, id: OPEN }, { id: EXTENSION, tab: { id: 1 } }), false);
    for (const id of ['1', `${OPEN}/x`, '../x', 7, undefined]) {
        assert.equal(send({ type: LIST, id }), false);
    }
    assert.equal(send({ type: 'other', id: OPEN }), false);
    assert.deepEqual(fetched, []);
});

/**
 * Runs the background script with a stand-in for the extension API.
 *
 * @param {(message: object) => unknown} page what the Marketing Cloud page answers
 * @returns {{send: (message: object, sender: object) => Promise.<object>|false, passed: object[]}} a way to send it a message, and what it passed on
 */
function background(page) {
    const listeners = [];
    const passed = [];
    const chrome = {
        runtime: {
            id: EXTENSION,
            onMessage: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
        tabs: {
            sendMessage: async (tabId, message, options) => {
                passed.push(structuredClone({ tabId, message, options }));
                return page(message);
            },
        },
    };
    vm.runInNewContext(backgroundScript, { chrome, URL });
    const send = (message, sender) => {
        const { promise, resolve } = Promise.withResolvers();
        const willAnswer = listeners[0](message, sender, (answer) => resolve(plain(answer)));
        return willAnswer === true && promise;
    };
    return { send, passed };
}

const FRAME = {
    id: EXTENSION,
    tab: { id: 7 },
    frameId: 3,
    documentId: 'A1',
    url: 'https://members.s7.exacttarget.com/C12/Default.aspx?entityType=none&entityID=0&ks=ks#Subscribers',
};

test('the background script asks the page of the tab for Email Studio’s frame, and passes back ids and names only', async () => {
    const { send, passed } = background(() => ({
        folder: FOLDER,
        items: [
            ...ENTRIES.map((entry) => ({ ...entry, extra: 1 })),
            { id: '1', name: 'x' },
            { id: OTHER, name: 'x'.repeat(201) },
            null,
        ],
        isCut: true,
    }));
    assert.deepEqual(await send({ type: LIST, id: OPEN, more: 1 }, FRAME), {
        items: ENTRIES,
        isCut: true,
    });
    assert.deepEqual(passed, [
        { tabId: 7, message: { type: LIST, id: OPEN }, options: { frameId: 0 } },
    ]);
    const many = background(() => ({ items: made(1500) }));
    assert.equal((await many.send({ type: LIST, id: OPEN }, FRAME)).items.length, 1000);
});

test('the background script tells the frame a failure when the page gives no list', async () => {
    for (const page of [
        () => ({ isFailed: true }),
        () => {},
        () => ({ items: 'x' }),
        () => {
            throw new Error('no page');
        },
    ]) {
        assert.deepEqual(await background(page).send({ type: LIST, id: OPEN }, FRAME), {
            isFailed: true,
        });
    }
});

test('the background script takes the question from Email Studio’s frame only, and only for an id of the form', () => {
    const { send, passed } = background(() => ({ items: ENTRIES }));
    for (const other of [
        { id: 'another-extension' },
        { tab: undefined },
        { frameId: 0 },
        { url: 'https://content-builder.s7.marketingcloudapps.com/' },
        { url: 'https://mc.s7.exacttarget.com/cloud/' },
        { url: 'https://members.s7.exacttarget.com/C12/Other.aspx' },
        { url: 'https://members.s7.exacttarget.com.example.org/C12/Default.aspx' },
    ]) {
        assert.equal(
            send({ type: LIST, id: OPEN }, { ...FRAME, ...other }),
            false,
            JSON.stringify(other),
        );
    }
    for (const id of ['1', `${OPEN}/x`, '../x', 7, undefined]) {
        assert.equal(send({ type: LIST, id }, FRAME), false);
    }
    assert.deepEqual(passed, []);
});

test('the manifest runs the frame’s script in Email Studio and the other one on the Marketing Cloud page, without a new permission', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = (file) => manifest.content_scripts.filter((item) => item.js.includes(file));
    assert.deepEqual(entry('email-studio-de-switcher.js'), [
        {
            matches: ['https://*.exacttarget.com/C12/Default.aspx*'],
            js: ['email-studio-de-switcher.js'],
            css: ['email-studio-de-switcher.css'],
            all_frames: true,
            run_at: 'document_start',
        },
    ]);
    assert.deepEqual(entry('email-studio-de-switcher-shell.js'), [
        {
            matches: ['https://*.exacttarget.com/cloud/*'],
            include_globs: ['https://mc.*'],
            js: ['email-studio-de-switcher-shell.js'],
            run_at: 'document_idle',
        },
    ]);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    assert.ok(
        manifest.web_accessible_resources.some(
            (item) =>
                item.resources.includes('icons/icon16.png') &&
                item.matches.includes('https://*.exacttarget.com/*'),
        ),
    );
});

test('the name of the data extension in the path opens the list too, by a click, Enter or Space', async () => {
    const { tell, step, panel, key, asked, document } = await frame();
    tell(`de-pages/de/${OPEN}`);
    step().click();
    assert.ok(panel());
    await tick();
    assert.equal(asked.length, 1);
    step().click();
    assert.equal(panel(), null);
    key(step(), 'Enter');
    assert.ok(panel());
    key(panel().querySelector('input'), 'Escape');
    assert.equal(panel(), null);
    assert.equal(document.activeElement, step());
    key(step(), ' ');
    assert.ok(panel());
    key(step(), ' ');
    key(step(), 'a');
    assert.equal(panel(), null);
});
