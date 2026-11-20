import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const script = read('../src/key-rule.js') + read('../src/transactional-messages.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// what makes the code editor of a message, as the build ships it; "npm test" builds first
const EDITOR_FILES = [
    'editor-codemirror.js',
    'language-data.js',
    'editor-highlight.js',
    'editor-language.js',
];
const EXTENSION = 'chrome-extension://id/';
/**
 * Leaves the scripts of the code editor on their way for good, so the field of a message stays
 * the plain one.
 *
 * @returns {Promise.<never>} never settles
 */
const neverLoaded = () => new Promise(() => {});
// how a page loads the scripts of the code editor; a test that wants the editor puts its way here
const importing = { load: neverLoaded };
const APP = (name) =>
    `<li class="mc-app-group-dropdown-app"><a href="/cloud/#app/${name}"><span class="mc-app-name">${name}</span></a></li>`;
const MENU = `<ul class="mc-app-group-dropdown-apps">${APP('Email')}</ul>
    <ul class="mc-app-group-dropdown-apps" id="mobile">${APP('MobileConnect')}${APP('MobilePush')}</ul>`;
// a row of a list and a definition, in the shape the API uses for SMS and push
const ROW = (key) => ({
    name: `name of ${key}`,
    definitionKey: key,
    status: 'Active',
    createdDate: '2026-01-02T03:04:00',
    modifiedDate: '2026-01-03T03:04:00',
});
const DEFINITION = {
    requestId: 'r-1',
    ...ROW('welcome'),
    content: { message: 'line 1\nline 2' },
    subscriptions: { shortCode: '4912312345678', keyword: 'WELCOME' },
};

/**
 * Runs the script in a page with the given content.
 *
 * @param {string} html content of the page
 * @param {(path: string, method: string) => {status?: number, body?: unknown, isDown?: boolean}} [answer] what the API answers to a path below the API of transactional messages; isDown lets the request fail without an answer
 * @param {Object.<string, string>} [stored] saved settings of the extension
 * @returns {{window: Window, document: Document, asked: string[], looked: string[], written: string[], calls: object[], entry: () => Element, open: () => Promise.<void>, panel: () => Element, text: () => string}} the page, what was read of the messages, what was read for the lists of a form, what was sent to change something, and every request as it was made
 */
function page(html, answer = () => ({ body: { definitions: [], count: 0 } }), stored = {}) {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
        url: 'https://mc.s7.exacttarget.com/cloud/',
    });
    // jsdom has the element but not the two methods the panel uses, and so never finds a dialog
    // to be a modal one
    window.eval(`
        const modal = new WeakSet();
        const { matches } = Element.prototype;
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute('open', '');
            modal.add(this);
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute('open');
            modal.delete(this);
            this.dispatchEvent(new Event('close'));
        };
        HTMLDialogElement.prototype.matches = function (selector) {
            return selector === ':modal' ? modal.has(this) : matches.call(this, selector);
        };
        // nor does it scroll; what was asked to be scrolled to is noted by its id
        globalThis.scrolled = [];
        Element.prototype.scrollIntoView = function () {
            globalThis.scrolled.push(this.id);
        };
    `);
    // what the script asked the settings for; the entry itself depends on none
    const settingsRead = [];
    window.chrome = {
        runtime: { getURL: (path) => `chrome-extension://id/${path}` },
        storage: {
            sync: {
                // isBroken fails the settings a form reads
                get: (defaults) => {
                    settingsRead.push(defaults);
                    return stored.isBroken
                        ? Promise.reject(new Error('broken'))
                        : Promise.resolve({ ...defaults, ...stored });
                },
            },
        },
    };
    // the files of the extension the script loaded into its page
    const imported = [];
    const { load } = importing;
    window.sfmcUxToolsImport = (url) => {
        imported.push(url);
        return load(window, url);
    };
    const asked = [];
    const looked = [];
    const written = [];
    const calls = [];
    window.fetch = async (url, options) => {
        calls.push({ url, ...options });
        const prefix = '/cloud/fuelapi/';
        assert.ok(url.startsWith(prefix), url);
        // what is read is noted without the filter that every list carries
        const path = url
            .slice(prefix.length)
            .replace(/^messaging\/v1\//, '')
            .replace('&$filter=status%20neq%20deleted', '');
        if (!url.startsWith(`${prefix}messaging/v1/`)) {
            looked.push(path);
        } else if (options.method === 'GET') {
            asked.push(path);
        } else {
            written.push(`${options.method} ${path}`);
        }
        const { status = 200, body, isDown } = answer(path, options.method);
        if (isDown) {
            throw new TypeError('Failed to fetch');
        }
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => {
                if (body === undefined) {
                    throw new SyntaxError('no JSON');
                }
                return body;
            },
        };
    };
    window.eval(script);
    const { document } = window;
    const entry = () => document.querySelector('[data-sfmc-ux-tools-transactional] a');
    const panel = () => document.querySelector('dialog');
    return {
        window,
        document,
        asked,
        looked,
        written,
        calls,
        imported,
        entry,
        panel,
        settingsRead,
        open: async () => {
            // a menu that was put into the page is seen a moment later
            await tick();
            entry().dispatchEvent(
                new window.MouseEvent('click', { bubbles: true, cancelable: true }),
            );
            await tick();
        },
        text: () => panel().querySelector('.sfmc-ux-tools-transactional-body').textContent,
    };
}

/**
 * Lists the rows of the table the panel shows.
 *
 * @param {{panel: () => Element}} at the page
 * @returns {HTMLTableRowElement[]} the rows
 */
function rows(at) {
    return [...at.panel().querySelector('tbody').rows];
}

/**
 * Clicks the tab of a kind of message.
 *
 * @param {{panel: () => Element}} at the page
 * @param {string} kind sms, push or ott
 */
async function tab(at, kind) {
    [...at.panel().querySelectorAll('[role="tab"]')]
        .find((item) => item.dataset.kind === kind)
        .click();
    await tick();
}

test('the Mobile Studio menu gets one entry, built like its own', async () => {
    const at = page(MENU);
    await tick();
    const items = [...at.document.querySelector('#mobile').children];
    assert.equal(items.length, 3);
    assert.equal(items[2].className, 'mc-app-group-dropdown-app');
    assert.equal(items[2].querySelector('.mc-app-name').textContent, 'Transactional Messages');
    // not an address the page would take for one of its apps
    assert.equal(at.entry().getAttribute('href'), '#');
    assert.equal(at.document.querySelectorAll('[data-sfmc-ux-tools-transactional]').length, 1);
    // other changes of the page do not add a second one
    at.document.body.append(at.document.createElement('div'));
    await tick();
    assert.equal(at.document.querySelectorAll('[data-sfmc-ux-tools-transactional]').length, 1);
});

test('the entry comes back when the menu is drawn again, and waits for a menu that comes late', async () => {
    const at = page('<div id="shell"></div>');
    await tick();
    assert.equal(at.entry(), null);
    at.document.querySelector('#shell').innerHTML = MENU;
    await tick();
    assert.ok(at.entry());
    at.document.querySelector('#shell').innerHTML = MENU;
    await tick();
    assert.ok(at.entry());
    assert.equal(at.document.querySelector('#mobile').children.length, 3);
});

test('a page without the Mobile Studio menu is left alone', async () => {
    const at = page(`<ul class="mc-app-group-dropdown-apps">${APP('Email')}</ul>`);
    await tick();
    assert.equal(at.entry(), null);
    assert.equal(at.panel(), null);
});

test('the entry is there without any setting: it is no preview feature and cannot be switched off', async () => {
    // a setting left over from when the entry was a preview feature is not looked at
    for (const stored of [{}, { transactionalMessages: 'off' }, { isBroken: true }]) {
        const at = page(MENU, undefined, stored);
        // at once, without waiting for anything
        assert.ok(at.entry());
        await tick();
        assert.ok(at.entry());
        assert.deepEqual(at.settingsRead, []);
        assert.deepEqual(at.calls, []);
    }
});

/**
 * Opens the options page with the given saved settings.
 *
 * @param {Object.<string, string>} stored saved settings
 * @param {string} [html] the page, when it is not the one of the extension as it is
 * @returns {Promise.<{window: Window, preview: Element, saved: object[]}>} the page, the group of preview features and what was saved
 */
async function optionsPage(stored, html = read('../src/options.html')) {
    const { window } = new JSDOM(html, { runScripts: 'outside-only' });
    const saved = [];
    window.chrome = {
        storage: {
            sync: {
                get: async (defaults) => ({ ...defaults, ...stored }),
                set: (values) => {
                    saved.push({ ...values });
                },
            },
        },
    };
    window.eval(read('../src/options.js'));
    await tick();
    return { window, preview: window.document.querySelector('#preview'), saved };
}

test('the options keep the preview features out of sight until asked for, and say that there are none', async () => {
    const fresh = await optionsPage({});
    const click = (altKey) =>
        fresh.window.document
            .querySelector('#copyright')
            .dispatchEvent(new fresh.window.MouseEvent('click', { bubbles: true, altKey }));
    assert.equal(fresh.preview.hidden, true);
    click(false);
    assert.equal(fresh.preview.hidden, true);
    click(true);
    assert.equal(fresh.preview.hidden, false);
    assert.equal(fresh.preview.querySelector('legend').textContent, 'Preview features');
    assert.equal(
        fresh.preview.querySelector('p').textContent,
        'There are no preview features at the moment.',
    );
    assert.equal(fresh.preview.querySelectorAll('input').length, 0);
    assert.deepEqual(fresh.saved, []);

    // other settings off their default do not show it, and neither does what was saved for
    // Transactional Messages while they were a preview feature
    const other = await optionsPage({
        readableKeys: 'off',
        editorTheme: 'dark',
        transactionalMessages: 'on',
    });
    assert.equal(other.preview.hidden, true);
});

test('a preview feature that is switched on shows its group by itself', async () => {
    // the group holds no feature at the moment, so one is put in as a later version would have it
    const html = read('../src/options.html').replace(
        '<legend>Preview features</legend>',
        `<legend>Preview features</legend>
        <label><input type="radio" name="comingSoon" value="off" />off</label>
        <label><input type="radio" name="comingSoon" value="on" />on</label>`,
    );
    assert.match(html, /name="comingSoon"/);
    const off = await optionsPage({}, html);
    assert.equal(off.preview.hidden, true);
    assert.equal(off.preview.querySelector('input[value="off"]').checked, true);
    off.preview.querySelector('input[value="on"]').click();
    assert.deepEqual(off.saved, [{ comingSoon: 'on' }]);
    // switched on, it shows by itself, so that it can be switched off again
    const on = await optionsPage({ comingSoon: 'on' }, html);
    assert.equal(on.preview.hidden, false);
    assert.equal(on.preview.querySelector('input[value="on"]').checked, true);
});

test('a click opens the panel on the SMS list and does not reach the page', async () => {
    const at = page(MENU);
    await tick();
    let reached = 0;
    at.document.body.addEventListener('click', () => reached++);
    const click = new at.window.MouseEvent('click', { bubbles: true, cancelable: true });
    at.entry().dispatchEvent(click);
    await tick();
    assert.equal(click.defaultPrevented, true);
    assert.equal(reached, 0);
    assert.equal(at.panel().hasAttribute('open'), true);
    assert.deepEqual(at.asked, ['sms/definitions?$page=1&$pageSize=100']);
    assert.match(at.text(), /no transactional SMS messages/);
    const selected = [...at.panel().querySelectorAll('[role="tab"]')].map((item) => [
        item.textContent,
        item.getAttribute('aria-selected'),
    ]);
    assert.deepEqual(selected, [
        ['SMS', 'true'],
        ['Push', 'false'],
        ['OTT', 'false'],
    ]);
});

test('each tab reads its own list and shows the rows', async () => {
    const at = page(MENU, (path) => ({
        body: path.startsWith('push/')
            ? { definitions: [ROW('receipt'), ROW('alert')], count: 2 }
            : { definitions: [], count: 0 },
    }));
    await at.open();
    await tab(at, 'push');
    assert.ok(at.asked.includes('push/definitions?$page=1&$pageSize=100'));
    const cells = [...rows(at)].map((row) => [...row.cells].map((cell) => cell.textContent));
    // the dates as the reader's browser writes them; how that is done has a test of its own
    const created = at.window.sfmcUxToolsFormatDate('2026-01-02T03:04:00');
    const modified = at.window.sfmcUxToolsFormatDate('2026-01-03T03:04:00');
    assert.notEqual(created, '2026-01-02T03:04:00');
    assert.deepEqual(cells, [
        ['name of receipt', 'receipt', 'Active', '', '', created, modified],
        ['name of alert', 'alert', 'Active', '', '', created, modified],
    ]);
    // what the API returned can still be read
    assert.deepEqual(
        [...rows(at)[0].cells].map((cell) => cell.title),
        ['', '', '', '', '', '2026-01-02T03:04:00', '2026-01-03T03:04:00'],
    );
    const titles = () => [...at.panel().querySelectorAll('th')].map((cell) => cell.textContent);
    // what its kind of message has of its own stands after the status
    assert.deepEqual(titles(), ['Name', 'Key', 'Status', 'App', 'Content', 'Created', 'Modified']);
    await tab(at, 'ott');
    assert.equal(at.asked.at(-1), 'ott/definitions?$page=1&$pageSize=100');
    assert.match(at.text(), /no transactional OTT messages/);
});

// a page of a list that is as long as the API lets a page of definitions be
const LARGEST = 100;
const full = (name) => Array.from({ length: LARGEST }, (_, index) => ROW(`${name}-${index}`));

/**
 * Lists the pages of the OTT list that were asked for.
 *
 * @param {{asked: string[]}} at the page
 * @returns {string[]} what was asked for
 */
function pagesRead(at) {
    return at.asked.filter((path) => path.startsWith('ott/definitions?'));
}

/**
 * Opens the panel on an OTT list that the API hands out in the given pages. That list reads
 * nothing but its pages.
 *
 * @param {(number: number) => object} answer what the API answers when asked for a page, by its number from 1
 * @returns {Promise.<object>} the page
 */
async function paged(answer) {
    const at = page(MENU, (path) => ({
        body: path.startsWith('ott/')
            ? answer(Number(/\$page=(\d+)/.exec(path)[1]))
            : { definitions: [] },
    }));
    await at.open();
    await tab(at, 'ott');
    return at;
}

test('a list longer than one page is read whole, although the count of every page is the number of its rows', async () => {
    // as seen live: the count is that of the page, and the page after the last one is empty
    const pages = { 1: full('a'), 2: full('b'), 3: [ROW('last')] };
    const at = await paged((number) => ({
        definitions: pages[number],
        count: pages[number].length,
        page: number,
        pageSize: LARGEST,
    }));
    assert.deepEqual(pagesRead(at), [
        'ott/definitions?$page=1&$pageSize=100',
        'ott/definitions?$page=2&$pageSize=100',
        'ott/definitions?$page=3&$pageSize=100',
    ]);
    assert.match(range(at), / of 201$/);
});

test('the reading of a list ends with a short page, an empty one or one that repeats, whatever the count says', async () => {
    // a short first page is the whole list, also under a count that claims more
    const short = await paged(() => ({ definitions: [ROW('only')], count: 999 }));
    assert.equal(pagesRead(short).length, 1);
    assert.equal(rows(short).length, 1);
    // a full page that is the whole list is followed by an empty one
    const exact = await paged((number) => ({
        definitions: number === 1 ? full('row') : [],
        count: number === 1 ? LARGEST : 0,
    }));
    assert.equal(pagesRead(exact).length, 2);
    assert.match(range(exact), / of 100$/);
    // the page asked for is ignored: always the same rows, with a count and without
    for (const count of [undefined, LARGEST, 999]) {
        const same = await paged(() => ({ definitions: full('same'), count }));
        assert.equal(pagesRead(same).length, 2, count);
        assert.match(range(same), / of 100$/);
    }
    // what is no list of rows ends it too
    const odd = await paged((number) => ({ definitions: number === 1 ? full('row') : 'none' }));
    assert.equal(pagesRead(odd).length, 2);
});

test('a list that is still being read stops when another tab is chosen or the panel is closed', async () => {
    for (const leave of ['tab', 'close']) {
        const gate = Promise.withResolvers();
        const at = page(MENU);
        const quick = at.window.fetch;
        at.window.fetch = async (url, options) => {
            const response = await quick(url, options);
            if (!url.includes('/sms/')) {
                return response;
            }
            // every page of the SMS list is full, different, and waits to be let through
            const number = at.asked.filter((path) => path.startsWith('sms/')).length;
            await gate.promise;
            return { ...response, json: async () => ({ definitions: full(`page${number}`) }) };
        };
        await at.open();
        if (leave === 'tab') {
            await tab(at, 'push');
        } else {
            at.panel().querySelector('.sfmc-ux-tools-transactional-close').click();
        }
        gate.resolve();
        await tick();
        await tick();
        assert.equal(at.asked.filter((path) => path.startsWith('sms/')).length, 1, leave);
    }
});

test('what Marketing Cloud refuses is shown with its message', async () => {
    const answers = {
        sms: { status: 403, body: { message: 'Insufficient privileges', errorcode: 20 } },
        push: { status: 502 },
        ott: { body: 'not an object' },
    };
    const at = page(MENU, (path) => answers[path.split('/', 1)[0]]);
    await at.open();
    assert.match(at.text(), /did not work: Insufficient privileges/);
    await tab(at, 'push');
    assert.match(at.text(), /did not work: Marketing Cloud answered with 502/);
    await tab(at, 'ott');
    assert.match(at.text(), /did not work: Marketing Cloud answered with 200/);
});

test('a row opens the details of its definition, and the way back shows the list again', async () => {
    const at = page(MENU, (path) => ({
        body:
            path === 'sms/definitions/we%2Flcome'
                ? DEFINITION
                : { definitions: [ROW('we/lcome'), { name: 'no key' }], count: 2 },
    }));
    await at.open();
    const [row, keyless] = rows(at);
    // a row without a key cannot be opened
    assert.equal(keyless.hasAttribute('tabindex'), false);
    assert.deepEqual(
        [...keyless.cells].map((cell) => cell.textContent),
        ['no key', '', '', '', '', '', ''],
    );
    row.click();
    await tick();
    assert.equal(at.asked.at(-1), 'sms/definitions/we%2Flcome');
    const names = [...at.panel().querySelectorAll('dt')].map((item) => item.textContent);
    assert.ok(!names.includes('requestId'));
    // under what the panel calls them, not under the names of the API
    assert.deepEqual(names.slice(-5), ['Content', 'Message', 'Subscription', 'Code', 'Keyword']);
    assert.match(at.text(), /line 1\nline 2/);
    at.panel().querySelector('.sfmc-ux-tools-transactional-back').click();
    await tick();
    assert.equal(rows(at).length, 2);
    // the Enter key opens a row as well
    rows(at)[0].dispatchEvent(
        new at.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await tick();
    assert.equal(at.asked.at(-1), 'sms/definitions/we%2Flcome');
});

test('details that cannot be read say why', async () => {
    const at = page(MENU, (path) =>
        path.includes('/definitions/')
            ? { status: 404, body: { message: 'Unable to find Definition gone', errorcode: 30003 } }
            : { body: { definitions: [ROW('gone')], count: 1 } },
    );
    await at.open();
    rows(at)[0].click();
    await tick();
    assert.match(at.text(), /did not work: Unable to find Definition gone/);
});

test('an answer that comes after another tab was chosen is not shown', async () => {
    const { promise: slow, resolve: release } = Promise.withResolvers();
    const at = page(MENU);
    const quick = at.window.fetch;
    at.window.fetch = async (url, options) => {
        const response = await quick(url, options);
        if (url.includes('/sms/')) {
            await slow;
            return { ...response, json: async () => ({ definitions: [ROW('late')], count: 1 }) };
        }
        return response;
    };
    await at.open();
    await tab(at, 'push');
    release();
    await tick();
    await tick();
    assert.match(at.text(), /no transactional Push messages/);
});

test('only the OTT tab says that it could not be tried, with the way to get in touch', async () => {
    const at = page(MENU);
    await at.open();
    const note = at.panel().querySelector('.sfmc-ux-tools-transactional-note');
    assert.equal(note.hidden, true);
    await tab(at, 'ott');
    assert.equal(note.hidden, false);
    assert.match(note.textContent, /WhatsApp/);
    assert.match(note.textContent, /built from Salesforce’s documentation, without an account/);
    const link = note.querySelector('a');
    assert.equal(link.href, JSON.parse(read('../package.json')).bugs.url);
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    await tab(at, 'sms');
    assert.equal(note.hidden, true);
    assert.equal(note.textContent, '');
});

test('the panel closes with its button and opens again on the first tab', async () => {
    const at = page(MENU);
    await at.open();
    await tab(at, 'push');
    at.panel().querySelector('.sfmc-ux-tools-transactional-close').click();
    assert.equal(at.panel().hasAttribute('open'), false);
    await at.open();
    assert.equal(at.document.querySelectorAll('dialog').length, 1);
    assert.equal(at.panel().hasAttribute('open'), true);
    assert.equal(at.panel().querySelector('[role="tab"][aria-selected="true"]').textContent, 'SMS');
    assert.match(at.text(), /no transactional SMS messages/);
    // the list of the first tab was read before, and is not read again
    assert.deepEqual(at.asked, [
        'sms/definitions?$page=1&$pageSize=100',
        'push/definitions?$page=1&$pageSize=100',
    ]);
});

/**
 * Counts how often the list of a kind of message was read.
 *
 * @param {{asked: string[]}} at the page
 * @param {string} [kind] sms, push or ott
 * @returns {number} the number of first pages that were asked for
 */
function listReads(at, kind = 'sms') {
    return at.asked.filter((path) => path.startsWith(`${kind}/definitions?$page=1&`)).length;
}

/**
 * Clicks something of the panel by the last part of its class, and waits for what comes of it.
 *
 * @param {{panel: () => Element}} at the page
 * @param {string} part back, refresh, close and the like
 */
async function click(at, part) {
    at.panel().querySelector(`.sfmc-ux-tools-transactional-${part}`).click();
    await tick();
    await tick();
}

test('a list that was read is shown again without another request: on its tab, on the way back from the details and when the panel opens again', async () => {
    const at = page(MENU, (path) => ({
        body: path.includes('/definitions/')
            ? DEFINITION
            : { definitions: [ROW('welcome')], count: 1 },
    }));
    await at.open();
    await tab(at, 'push');
    await tab(at, 'sms');
    assert.equal(rows(at).length, 1);
    rows(at)[0].click();
    await tick();
    await click(at, 'back');
    assert.equal(rows(at).length, 1);
    await click(at, 'close');
    await at.open();
    assert.equal(rows(at).length, 1);
    await tab(at, 'push');
    assert.equal(rows(at).length, 1);
    assert.deepEqual([listReads(at), listReads(at, 'push'), listReads(at, 'ott')], [1, 1, 0]);
    // the details are read every time they are opened, also when the list has read them before
    const opened = () => at.asked.filter((path) => path === 'push/definitions/welcome').length;
    assert.equal(opened(), 1);
    rows(at)[0].click();
    await tick();
    assert.equal(opened(), 2);
    await click(at, 'back');
    rows(at)[0].click();
    await tick();
    assert.equal(opened(), 3);
});

test('a list whose reading was stopped is not kept, and is read from its start the next time', async () => {
    const gate = Promise.withResolvers();
    const at = page(MENU);
    const quick = at.window.fetch;
    at.window.fetch = async (url, options) => {
        const response = await quick(url, options);
        if (!url.includes('/sms/')) {
            return response;
        }
        await gate.promise;
        return { ...response, json: async () => ({ definitions: full('part') }) };
    };
    await at.open();
    await tab(at, 'push');
    gate.resolve();
    await tick();
    await tick();
    assert.equal(listReads(at), 1);
    at.window.fetch = quick;
    await tab(at, 'sms');
    assert.equal(listReads(at), 2);
    // not the 50 rows of the page that came after the reader had left
    assert.match(at.text(), /no transactional SMS messages/);
});

test('"Refresh" reads the list again and says when it was read', async () => {
    let reads = 0;
    const at = page(MENU, (path) => {
        if (!path.startsWith('sms/')) {
            return { body: { definitions: [] } };
        }
        return { body: { definitions: ++reads === 1 ? [ROW('a')] : [ROW('a'), ROW('b')] } };
    });
    await at.open();
    assert.equal(rows(at).length, 1);
    const refresh = at.panel().querySelector('.sfmc-ux-tools-transactional-refresh');
    // a sign alone, named for whoever cannot see it or lets the mouse rest on it
    assert.equal(refresh.textContent, '');
    assert.equal(refresh.getAttribute('aria-label'), 'Refresh');
    assert.equal(refresh.title, 'Refresh');
    assert.equal(refresh.type, 'button');
    const [sign] = refresh.children;
    assert.equal(refresh.children.length, 1);
    assert.equal(sign.localName, 'svg');
    assert.equal(sign.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(sign.getAttribute('aria-hidden'), 'true');
    assert.equal(sign.getAttribute('stroke'), 'currentColor');
    assert.equal(sign.querySelectorAll('path').length, 2);
    for (const part of sign.querySelectorAll('*')) {
        assert.equal(part.namespaceURI, sign.namespaceURI);
        // drawn in the colour of the button, whatever that is
        assert.equal(part.hasAttribute('fill') || part.hasAttribute('stroke'), false);
    }
    // when the list was read is said right after it
    assert.equal(refresh.nextElementSibling.className, 'sfmc-ux-tools-transactional-read');
    // next to the button for a new message
    assert.equal(refresh.previousElementSibling.textContent, 'New SMS message');
    assert.match(
        at.panel().querySelector('.sfmc-ux-tools-transactional-read').textContent,
        /^read \d{1,2}\D\d{2}/,
    );
    await click(at, 'refresh');
    assert.equal(listReads(at), 2);
    assert.equal(rows(at).length, 2);
    // what was read last is what is kept
    await tab(at, 'push');
    await tab(at, 'sms');
    assert.equal(listReads(at), 2);
    assert.equal(rows(at).length, 2);
    // an empty list can be read again too
    await tab(at, 'push');
    await click(at, 'refresh');
    assert.equal(listReads(at, 'push'), 2);
    assert.match(at.text(), /no transactional Push messages/);
});

test('the lists are forgotten when the menu is drawn again', async () => {
    const at = page('<div id="shell"></div>');
    at.document.querySelector('#shell').innerHTML = MENU;
    await at.open();
    await click(at, 'close');
    // as after a change of the business unit
    at.document.querySelector('#shell').innerHTML = MENU;
    await at.open();
    assert.equal(listReads(at), 2);
    await click(at, 'close');
    // other changes of the page leave the lists alone
    at.document.body.append(at.document.createElement('div'));
    await at.open();
    assert.equal(listReads(at), 2);
});

// rows whose order differs by every column, and whose dates sort another way once they are written out
const SORTED = [
    {
        name: 'beta',
        definitionKey: 'k-2',
        status: 'Inactive',
        createdDate: '2026-01-10T03:04:00',
        modifiedDate: '2026-03-01T00:00:00',
    },
    {
        name: 'Alpha',
        definitionKey: 'k-3',
        status: 'Active',
        createdDate: '2026-01-09T03:04:00',
        modifiedDate: '2026-02-01T00:00:00',
    },
    {
        name: 'gamma',
        definitionKey: 'K-1',
        status: 'Draft',
        createdDate: '2025-12-31T23:00:00',
        modifiedDate: '2026-04-01T00:00:00',
    },
];

/**
 * Opens the panel on an SMS list of the given rows.
 *
 * @param {object[]} definitions the rows
 * @returns {Promise.<object>} the page, with the names of the rows shown, the search field, a way to type into it and one to click the head of a column
 */
async function listing(definitions) {
    const at = page(MENU, (path) => ({
        body: { definitions: path.startsWith('sms/') ? definitions : [ROW('other')] },
    }));
    await at.open();
    at.names = () => rows(at).map((row) => row.cells[0].textContent);
    at.search = () => at.panel().querySelector('.sfmc-ux-tools-transactional-search');
    at.look = (text) => {
        at.search().value = text;
        at.search().dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    at.heads = () => [...at.panel().querySelectorAll('th')];
    at.sort = (title) => {
        at.heads()
            .find((cell) => cell.textContent === title)
            .querySelector('button')
            .click();
    };
    at.sorted = () => at.heads().map((cell) => cell.getAttribute('aria-sort'));
    return at;
}

test('the search narrows the list by name and key while typing, without a request and without leaving the field', async () => {
    const at = await listing([
        ROW('welcome'),
        ROW('Order-Shipped'),
        { ...ROW('zeta'), name: 'Alpha WELCOME back' },
        // nothing to search in
        { status: 'Active' },
    ]);
    const none = () => at.panel().querySelector('table').parentElement.nextElementSibling;
    assert.equal(at.names().length, 4);
    assert.equal(none().hidden, true);
    const field = at.search();
    field.focus();
    const body = at.panel().querySelector('tbody');
    at.look('  WEL ');
    assert.deepEqual(at.names(), ['name of welcome', 'Alpha WELCOME back']);
    // the field typed into is still the same one, and still has the focus
    assert.equal(at.document.activeElement, field);
    assert.equal(at.search(), field);
    assert.equal(at.panel().querySelector('tbody'), body);
    // by key, in whatever case
    at.look('order-s');
    assert.deepEqual(at.names(), ['name of Order-Shipped']);
    // a row that is found still opens its details
    assert.equal(rows(at)[0].tabIndex, 0);
    // the status is not searched
    at.look('active');
    assert.deepEqual(at.names(), []);
    assert.equal(none().hidden, false);
    assert.match(none().textContent, /^No message matches/);
    at.look('');
    assert.equal(at.names().length, 4);
    assert.equal(none().hidden, true);
    assert.equal(listReads(at), 1);
    // what was searched for stays with its list while the page lives
    at.look('zeta');
    await tab(at, 'push');
    assert.equal(at.search().value, '');
    assert.deepEqual(at.names(), ['name of other']);
    await tab(at, 'sms');
    assert.equal(at.search().value, 'zeta');
    assert.deepEqual(at.names(), ['Alpha WELCOME back']);
    await click(at, 'close');
    await at.open();
    assert.equal(at.search().value, 'zeta');
    assert.deepEqual(at.names(), ['Alpha WELCOME back']);
    // an empty list has nothing to search
    const empty = await listing([]);
    assert.equal(empty.search(), null);
});

test('a click on the head of a column sorts by it, another one turns the order around, and dates are sorted as the API writes them', async () => {
    const at = await listing(SORTED);
    // as the API returned them
    assert.deepEqual(at.names(), ['beta', 'Alpha', 'gamma']);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'none', 'none']);
    at.sort('Name');
    assert.deepEqual(at.names(), ['Alpha', 'beta', 'gamma']);
    assert.deepEqual(at.sorted(), ['ascending', 'none', 'none', 'none', 'none', 'none', 'none']);
    at.sort('Name');
    assert.deepEqual(at.names(), ['gamma', 'beta', 'Alpha']);
    assert.deepEqual(at.sorted(), ['descending', 'none', 'none', 'none', 'none', 'none', 'none']);
    at.sort('Name');
    assert.deepEqual(at.names(), ['Alpha', 'beta', 'gamma']);
    // another column starts with its smallest value, whatever the one before was turned to
    at.sort('Name');
    at.sort('Key');
    assert.deepEqual(at.names(), ['gamma', 'beta', 'Alpha']);
    assert.deepEqual(at.sorted(), ['none', 'ascending', 'none', 'none', 'none', 'none', 'none']);
    at.sort('Status');
    assert.deepEqual(at.names(), ['Alpha', 'gamma', 'beta']);
    // written out, the 10th would come before the 9th and December after January
    at.sort('Created');
    assert.deepEqual(at.names(), ['gamma', 'Alpha', 'beta']);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'ascending', 'none']);
    at.sort('Created');
    assert.deepEqual(at.names(), ['beta', 'Alpha', 'gamma']);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'descending', 'none']);
    at.sort('Modified');
    assert.deepEqual(at.names(), ['Alpha', 'beta', 'gamma']);
    at.sort('Modified');
    assert.deepEqual(at.names(), ['gamma', 'beta', 'Alpha']);
    // the titles of the columns are as before, and nothing was asked for
    assert.deepEqual(
        at.heads().map((cell) => cell.textContent),
        ['Name', 'Key', 'Status', 'Code', 'Keyword', 'Created', 'Modified'],
    );
    assert.equal(listReads(at), 1);
    // what is searched for is sorted the same way
    at.look('a');
    assert.deepEqual(at.names(), ['gamma', 'beta', 'Alpha']);
    at.look('et');
    assert.deepEqual(at.names(), ['beta']);
    at.look('');
    // the order stays with its list while the page lives
    await tab(at, 'push');
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'none', 'none']);
    await tab(at, 'sms');
    assert.deepEqual(at.names(), ['gamma', 'beta', 'Alpha']);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'none', 'descending']);
});

test('a date is written in the language and time zone given, and left as it is when it is none', async () => {
    const at = page(MENU, (path) => ({
        body: path.includes('/definitions/')
            ? { ...DEFINITION, modifiedDate: 'some day', content: { createdDate: 7 } }
            : { definitions: [{ ...ROW('welcome'), modifiedDate: 'some day' }] },
    }));
    const format = at.window.sfmcUxToolsFormatDate;
    assert.equal(format('2026-01-02T03:04:00Z', 'en-GB', 'Europe/Berlin'), '2 Jan 2026, 04:04');
    assert.equal(format('2026-01-02T23:04:05.123Z', 'en-GB', 'Asia/Tokyo'), '3 Jan 2026, 08:04');
    assert.equal(format('2026-07-02T03:04:00+02:00', 'en-GB', 'UTC'), '2 Jul 2026, 01:04');
    assert.equal(format('2026-01-02T03:04:00Z', 'de-DE', 'Europe/Berlin'), '02.01.2026, 04:04');
    // without a time zone of its own, a value keeps its hours wherever it is read
    assert.equal(format('2026-01-02T03:04:00', 'en-GB', 'America/New_York'), '2 Jan 2026, 03:04');
    assert.equal(format('2026-01-02T03:04:00', 'en-GB', 'Asia/Tokyo'), '2 Jan 2026, 03:04');
    // what is no date and time stays as it is
    for (const value of ['some day', '2026-13-45T03:04:00', '2026-01-02', '5', '']) {
        assert.equal(format(value, 'en-GB', 'UTC'), value);
    }
    assert.equal(format(5, 'en-GB', 'UTC'), '5');
    assert.equal(format(undefined, 'en-GB', 'UTC'), '');
    assert.equal(format(null, 'en-GB', 'UTC'), '');
    // the list and the details show it so, with what the API returned to be read on it
    await at.open();
    const [created, modified] = [...rows(at)[0].cells].slice(-2);
    assert.equal(created.textContent, format('2026-01-02T03:04:00'));
    assert.equal(created.title, '2026-01-02T03:04:00');
    assert.equal(modified.textContent, 'some day');
    assert.equal(modified.title, 'some day');
    rows(at)[0].click();
    await tick();
    const shown = (path) =>
        [...at.panel().querySelectorAll('dt')].find((item) => item.title === path)
            .nextElementSibling.firstElementChild;
    const createdAt = shown('createdDate');
    assert.equal(createdAt.textContent, format('2026-01-02T03:04:00'));
    assert.equal(createdAt.title, '2026-01-02T03:04:00');
    assert.equal(shown('modifiedDate').textContent, 'some day');
    // a value under that name that is no text is shown like any other, and other values have no such title
    const notText = shown('content.createdDate');
    assert.equal(notText.textContent, '7');
    assert.equal(notText.title, '');
    assert.equal(shown('name').title, '');
});

/**
 * Opens the panel on the details of the SMS definition "welcome".
 *
 * @param {(path: string, method: string) => object} [answer] what the API answers to anything but the list, what the list reads for its columns before the row is clicked and the first read of the details
 * @param {object} [definition] what the first read of the details returns
 * @returns {Promise.<object>} the page, with a way to click a button of the details by its text
 */
async function details(answer = () => ({ body: DEFINITION }), definition = DEFINITION) {
    // counts the reads from the click on the row
    let reads;
    const at = page(MENU, (path, method) => {
        if (path.startsWith('sms/definitions?')) {
            return { body: { definitions: [ROW('welcome')], count: 1 } };
        }
        // the list reads the details for its columns, and the first read after the click fills
        // the details; what comes after is the test's business
        return reads === undefined || (method === 'GET' && reads++ === 0)
            ? { body: definition }
            : answer(path, method);
    });
    await at.open();
    reads = 0;
    rows(at)[0].click();
    await tick();
    at.press = async (text) => {
        [...at.panel().querySelectorAll('button')]
            .find((item) => item.textContent === text)
            .click();
        await tick();
        await tick();
    };
    return at;
}

test('every request uses the session of the page, and every list leaves out what was deleted', async () => {
    const at = await details();
    // the list, the details that the list reads for its columns, and the details that were opened
    assert.equal(at.calls.length, 3);
    for (const call of at.calls) {
        assert.equal(call.credentials, 'same-origin');
        assert.equal(call.redirect, 'error');
        assert.equal(call.method, 'GET');
        assert.ok(call.url.startsWith('/cloud/fuelapi/messaging/v1/sms/definitions'), call.url);
    }
    assert.ok(at.calls[0].url.endsWith('?$page=1&$pageSize=100&$filter=status%20neq%20deleted'));
    assert.ok(at.calls[1].url.endsWith('/definitions/welcome'));
    assert.ok(at.calls[2].url.endsWith('/definitions/welcome'));
});

test('nothing is deleted before the question is answered with yes, and "Keep it" takes the question back', async () => {
    const at = await details();
    await at.press('Delete');
    assert.match(
        at.text(),
        /Delete “name of welcome” \(key welcome, status Active\) for good\? Marketing Cloud cannot bring it back/,
    );
    assert.deepEqual(at.written, []);
    await at.press('Keep it');
    assert.doesNotMatch(at.text(), /for good/);
    assert.deepEqual(at.written, []);
    // the button is back and asks again
    await at.press('Delete');
    assert.match(at.text(), /for good/);
    assert.deepEqual(at.written, []);
});

test('a confirmed delete is sent once, and the list comes back saying what was deleted', async () => {
    const answers = [
        { body: { message: 'Success', deletedDefinitionKey: 'welcome' } },
        // an answer without content counts by its status
        { status: 204 },
    ];
    for (const answerToDelete of answers) {
        const at = await details((path, method) =>
            method === 'DELETE' ? answerToDelete : { body: DEFINITION },
        );
        await at.press('Delete');
        const yes = [...at.panel().querySelectorAll('button')].find(
            (item) => item.textContent === 'Delete it',
        );
        yes.click();
        // a second click while the first is on its way
        yes.click();
        assert.equal(yes.disabled, true);
        await tick();
        await tick();
        await tick();
        assert.deepEqual(at.written, ['DELETE sms/definitions/welcome']);
        const sent = at.calls.find((call) => call.method === 'DELETE');
        assert.equal(sent.credentials, 'same-origin');
        // the list was read again
        assert.equal(listReads(at), 2);
        assert.match(at.text(), /^Deleted “name of welcome” \(key welcome\)\./);
        assert.equal(rows(at).length, 1);
    }
});

test('a refused delete says why and leaves the details', async () => {
    const at = await details((path, method) =>
        method === 'DELETE'
            ? { status: 400, body: { message: 'Definition is in use', errorcode: 1 } }
            : { body: DEFINITION },
    );
    await at.press('Delete');
    await at.press('Delete it');
    assert.deepEqual(at.written, ['DELETE sms/definitions/welcome']);
    assert.match(at.text(), /Not deleted: Definition is in use/);
    // the details are still there, and the list was not opened
    assert.ok(at.panel().querySelector('dl'));
    assert.equal(at.asked.at(-1), 'sms/definitions/welcome');
});

test('what is no longer the message shown is not deleted', async () => {
    // the same key now holds something else, as after a change of the business unit in another tab
    const other = await details(() => ({ body: { ...DEFINITION, definitionId: 'another' } }));
    await other.press('Delete');
    await other.press('Delete it');
    assert.deepEqual(other.written, []);
    assert.match(
        other.text(),
        /Not deleted: what Marketing Cloud holds under this key is no longer/,
    );
    // the key is gone altogether
    const gone = await details(() => ({ status: 404, body: { message: 'Unable to find it' } }));
    await gone.press('Delete');
    await gone.press('Delete it');
    assert.deepEqual(gone.written, []);
    assert.match(gone.text(), /Not deleted: Unable to find it/);
    // the request id differs with every read and does not count
    const same = await details((path, method) =>
        method === 'DELETE' ? { status: 200 } : { body: { ...DEFINITION, requestId: 'r-2' } },
    );
    await same.press('Delete');
    await same.press('Delete it');
    assert.deepEqual(same.written, ['DELETE sms/definitions/welcome']);
});

test('a delete without an answer says that the outcome is unknown, and shows the list', async () => {
    const at = await details((path, method) =>
        method === 'DELETE' ? { isDown: true } : { body: DEFINITION },
    );
    await at.press('Delete');
    await at.press('Delete it');
    await tick();
    assert.deepEqual(at.written, ['DELETE sms/definitions/welcome']);
    assert.match(
        at.text(),
        /^It is not known whether “name of welcome” \(key welcome\) was deleted/,
    );
    assert.equal(listReads(at), 2);
});

test('what became of a delete stays in view when the list cannot be read afterwards', async () => {
    // deleted, but the list fails
    const done = await details((path, method) => {
        if (method === 'DELETE') {
            return { status: 204 };
        }
        return path.includes('?') ? { status: 500 } : { body: DEFINITION };
    });
    // the list that follows the delete is the second one read
    let lists = 0;
    const quick = done.window.fetch;
    done.window.fetch = async (url, options) =>
        url.includes('?') && ++lists > 0
            ? { ok: false, status: 500, json: async () => ({ message: 'Server down' }) }
            : quick(url, options);
    await done.press('Delete');
    await done.press('Delete it');
    await tick();
    assert.match(done.text(), /^Deleted “name of welcome” \(key welcome\)\./);
    assert.match(done.text(), /did not work: Server down/);
    // no answer to the delete, and none to the list either
    let isCut = false;
    const cut = await details();
    const answering = cut.window.fetch;
    cut.window.fetch = async (url, options) => {
        isCut ||= options.method === 'DELETE';
        if (isCut) {
            cut.written.push(`${options.method} cut`);
            throw new TypeError('Failed to fetch');
        }
        return answering(url, options);
    };
    await cut.press('Delete');
    await cut.press('Delete it');
    await tick();
    // the delete, then the list that was tried after it
    assert.deepEqual(cut.written, ['DELETE cut', 'GET cut']);
    assert.match(
        cut.text(),
        /^It is not known whether “name of welcome” \(key welcome\) was deleted/,
    );
    assert.match(cut.text(), /did not work: Marketing Cloud did not answer/);
});

test('a check that gets no answer deletes nothing and says so', async () => {
    const at = await details(() => ({ isDown: true }));
    await at.press('Delete');
    await at.press('Delete it');
    assert.deepEqual(at.written, []);
    assert.match(at.text(), /Not deleted: Marketing Cloud did not answer/);
    assert.doesNotMatch(at.text(), /not known/);
    // the details stay
    assert.ok(at.panel().querySelector('dl'));
});

test('leaving the details before the check has come back sends no delete', async () => {
    const gate = Promise.withResolvers();
    const at = await details();
    const quick = at.window.fetch;
    at.window.fetch = async (url, options) => {
        if (url.endsWith('/definitions/welcome')) {
            await gate.promise;
        }
        return quick(url, options);
    };
    await at.press('Delete');
    await at.press('Delete it');
    await tab(at, 'push');
    gate.resolve();
    await tick();
    await tick();
    assert.deepEqual(at.written, []);
    assert.match(at.text(), /no transactional Push messages/);
});

test('a list that cannot be reached says so in plain words', async () => {
    const at = page(MENU, () => ({ isDown: true }));
    await at.open();
    assert.match(
        at.text(),
        /did not work: Marketing Cloud did not answer\. Are you still logged in\?/,
    );
});

/**
 * Lists what a field of a form offers to choose from.
 *
 * @param {object} at the page with the form
 * @param {string} path name of the field
 * @returns {string[][]} value and label of every entry
 */
function options(at, path) {
    return [...listOf(at.field(path)).children].map((item) => [
        item.lastElementChild.textContent,
        item.firstElementChild.textContent,
    ]);
}

const FIELD = '.sfmc-ux-tools-transactional-field';

/**
 * Finds the list below a field of a form.
 *
 * @param {HTMLElement} input the field
 * @returns {Element|null} the list; nothing when the field has none
 */
function listOf(input) {
    return input.closest(FIELD).querySelector('[role="listbox"]');
}

/**
 * Opens the form for a new message of a kind.
 *
 * @param {string} kind sms, push or ott
 * @param {(path: string, method: string) => object} [answer] what the API answers
 * @param {Object.<string, string>} [stored] saved settings of the extension
 * @returns {Promise.<object>} the page, with ways to fill a field, to tick one, to read one and to send the form
 */
async function form(kind, answer, stored) {
    const at = page(MENU, answer, stored);
    await at.open();
    await tab(at, kind);
    at.panel().querySelector('.sfmc-ux-tools-transactional-new').click();
    await tick();
    at.form = () => at.panel().querySelector('form');
    at.field = (path) => at.form().elements[path];
    at.button = (text) => [...at.form().elements].find((item) => item.textContent === text);
    at.type = (path, text) => {
        at.field(path).value = text;
        at.field(path).dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    at.tick = (path) => {
        at.field(path).click();
    };
    at.send = async () => {
        at.panel()
            .querySelector('form')
            .dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
        await tick();
        await tick();
    };
    at.sent = () =>
        at.calls.filter((call) => call.method === 'POST').map((call) => JSON.parse(call.body));
    return at;
}

test('every list offers a new message of its kind, also when it is empty', async () => {
    const at = page(MENU, (path) => ({
        body: path.startsWith('push/')
            ? { definitions: [ROW('receipt')], count: 1 }
            : { definitions: [], count: 0 },
    }));
    await at.open();
    const offer = () => at.panel().querySelector('.sfmc-ux-tools-transactional-new').textContent;
    assert.equal(offer(), 'New SMS message');
    await tab(at, 'push');
    assert.equal(offer(), 'New Push message');
    assert.equal(rows(at).length, 1);
    await tab(at, 'ott');
    assert.equal(offer(), 'New OTT message');
});

test('a new SMS message is sent with what the form holds, and its details open', async () => {
    const at = await form('sms', (path, method) => {
        if (method === 'POST') {
            return { status: 201, body: { definitionKey: 'Order_shipped' } };
        }
        return { body: path.includes('?') ? { definitions: [] } : DEFINITION };
    });
    assert.match(at.text(), /^New SMS message/);
    assert.deepEqual(
        [...at.form().elements].filter((item) => item.name).map((item) => item.name),
        [
            'name',
            'definitionKey',
            'description',
            'status',
            'content.message',
            'subscriptions.shortCode',
            'subscriptions.keyword',
            'subscriptions.countryCode',
            'subscriptions.autoAddSubscriber',
            'subscriptions.updateSubscriber',
            'options.urlShortenerOptions.isLinkShorteningEnabled',
            'options.urlShortenerOptions.isSubscriberTrackingEnabled',
        ],
    );
    at.type('name', '  Order shipped ');
    at.type('content.message', ' Your order is on its way.\n');
    at.type('subscriptions.shortCode', ' 4912312345678 ');
    at.type('subscriptions.keyword', 'ORDER');
    at.tick('subscriptions.autoAddSubscriber');
    await at.send();
    assert.deepEqual(at.written, ['POST sms/definitions']);
    const call = at.calls.find((item) => item.method === 'POST');
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.deepEqual(at.sent(), [
        {
            name: 'Order shipped',
            definitionKey: 'Order_shipped',
            status: 'Active',
            // the text of the message as typed; what was left empty is not sent, and neither
            // are the options of the link shortener, which were not ticked
            content: { message: ' Your order is on its way.\n' },
            subscriptions: {
                shortCode: '4912312345678',
                keyword: 'ORDER',
                autoAddSubscriber: true,
                updateSubscriber: false,
            },
        },
    ]);
    // the details of the new message, read by its key
    assert.equal(at.asked.at(-1), 'sms/definitions/Order_shipped');
    assert.match(at.text(), /^Created “Order shipped” \(key Order_shipped\)\./);
    assert.ok(at.panel().querySelector('dl'));
});

test('a new push message and a new OTT message carry the fields of their kind', async () => {
    const push = await form('push', () => ({ body: {} }));
    push.type('name', 'Receipt');
    push.type('applicationId', '7d00d57d-0d94-4a5d-85bd-b51a47ba1b9f');
    push.type('content.customerKey', 'receipt_push');
    push.type('options.badge', '1');
    push.field('status').value = 'Inactive';
    await push.send();
    assert.deepEqual(push.written, ['POST push/definitions']);
    assert.deepEqual(push.sent(), [
        {
            name: 'Receipt',
            definitionKey: 'Receipt',
            status: 'Inactive',
            applicationId: '7d00d57d-0d94-4a5d-85bd-b51a47ba1b9f',
            content: { customerKey: 'receipt_push' },
            options: { badge: '1' },
        },
    ]);
    const ott = await form('ott', () => ({ body: {} }));
    ott.type('name', 'Account reset');
    ott.type('senderId', '15555551234');
    ott.type('content.customerKey', 'reset_whatsapp');
    await ott.send();
    assert.deepEqual(ott.written, ['POST ott/definitions']);
    assert.deepEqual(ott.sent(), [
        {
            name: 'Account reset',
            definitionKey: 'Account_reset',
            status: 'Active',
            senderType: 'WhatsApp',
            senderId: '15555551234',
            content: { customerKey: 'reset_whatsapp' },
        },
    ]);
});

test('the key follows the name until one is typed, and not at all when readable keys are off', async () => {
    const at = await form('sms');
    at.type('name', 'Preise (EUR) & Währung v1.2');
    assert.equal(at.field('definitionKey').value, 'Preise_EUR_Wahrung_v12');
    // no longer than a key may be
    at.type('name', 'a'.repeat(50));
    assert.equal(at.field('definitionKey').value, 'a'.repeat(36));
    assert.equal(at.field('definitionKey').maxLength, 36);
    at.type('definitionKey', 'my-own-key');
    at.type('name', 'Another name');
    assert.equal(at.field('definitionKey').value, 'my-own-key');
    // a key that was taken out again follows the name once more
    at.type('definitionKey', '');
    at.type('name', 'Third name');
    assert.equal(at.field('definitionKey').value, 'Third_name');
    const off = await form('sms', undefined, { readableKeys: 'off' });
    off.type('name', 'Order shipped');
    assert.equal(off.field('definitionKey').value, '');
    // settings that cannot be read leave it switched on
    const broken = await form('sms', undefined, { isBroken: true });
    broken.type('name', 'Order shipped');
    assert.equal(broken.field('definitionKey').value, 'Order_shipped');
});

test('a form with a required field left empty is not sent', async () => {
    const at = await form('sms');
    at.type('name', 'Order shipped');
    at.type('content.message', 'text');
    at.type('subscriptions.shortCode', '4912312345678');
    // the keyword is missing
    await at.send();
    assert.deepEqual(at.written, []);
    // blanks are no keyword either
    at.type('subscriptions.keyword', ' '.repeat(3));
    await at.send();
    assert.deepEqual(at.written, []);
    assert.equal(at.field('subscriptions.keyword').value, '');
    assert.deepEqual(
        [...at.form().elements].filter((item) => item.required).map((item) => item.name),
        [
            'name',
            'definitionKey',
            'content.message',
            'subscriptions.shortCode',
            'subscriptions.keyword',
        ],
    );
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.deepEqual(at.written, ['POST sms/definitions']);
});

test('updating the subscriber is only ticked together with adding them', async () => {
    const at = await form('sms');
    const add = at.field('subscriptions.autoAddSubscriber');
    const update = at.field('subscriptions.updateSubscriber');
    at.tick('subscriptions.updateSubscriber');
    assert.deepEqual([add.checked, update.checked], [true, true]);
    at.tick('subscriptions.autoAddSubscriber');
    assert.deepEqual([add.checked, update.checked], [false, false]);
    at.tick('subscriptions.autoAddSubscriber');
    assert.deepEqual([add.checked, update.checked], [true, false]);
});

test('a refused message says why, keeps what was typed and can be sent again', async () => {
    let refusals = 1;
    const at = await form('sms', (path, method) => {
        if (method !== 'POST') {
            return { body: { definitions: [] } };
        }
        return refusals-- > 0
            ? { status: 400, body: { message: 'Keyword not found', errorcode: 10_002 } }
            : { status: 201, body: {} };
    });
    at.type('name', 'Order shipped');
    at.type('content.message', 'text');
    at.type('subscriptions.shortCode', '4912312345678');
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.match(at.text(), /Not created: Keyword not found/);
    assert.equal(at.field('name').value, 'Order shipped');
    assert.equal(at.field('subscriptions.keyword').value, 'ORDER');
    assert.equal(at.button('Create').disabled, false);
    await at.send();
    assert.deepEqual(at.written, ['POST sms/definitions', 'POST sms/definitions']);
    assert.match(at.text(), /^Created “Order shipped”/);
});

test('a message sent twice in a row goes out once, and one without an answer is reported as unknown', async () => {
    const at = await form('ott', (path, method) =>
        method === 'POST' ? { isDown: true } : { body: { definitions: [] } },
    );
    at.type('name', 'Account reset');
    at.type('senderId', '15555551234');
    at.type('content.customerKey', 'reset_whatsapp');
    const sending = at.panel().querySelector('form');
    const submit = () =>
        sending.dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
    submit();
    // again, while the first is on its way
    submit();
    assert.equal(sending.querySelector('button[type="submit"]').disabled, true);
    await tick();
    await tick();
    assert.deepEqual(at.written, ['POST ott/definitions']);
    assert.match(
        at.text(),
        /^It is not known whether “Account reset” \(key Account_reset\) was created/,
    );
    assert.equal(at.asked.at(-1), 'ott/definitions?$page=1&$pageSize=100');
});

// where the mobile messages of Content Builder are read, and what is asked of them
const CONTENTS = 'asset/v1/content/assets';
const OF_CONTENTS =
    '$pageSize=50&$filter=assetType.id%20eq%20230&$fields=id,name,customerKey,availableViews,modifiedDate,modifiedBy,category';
// where the folders of Content Builder are read, for the names of those the contents are in
const FOLDERS = 'asset/v1/content/categories';

test('the content of a push message is offered from the mobile messages of Content Builder, page by page', async () => {
    const full = Array.from({ length: 50 }, (item, index) => ({
        customerKey: `key-${index}`,
        name: `Message ${index}`,
        availableViews: ['push'],
    }));
    const last = [
        // the view is spelled in more than one way
        { customerKey: 'capital', name: 'Written <i>Push</i>', availableViews: ['Push'] },
        // only what was written for push is offered
        { customerKey: 'sms', name: 'A text message', availableViews: ['sMS'] },
        { customerKey: 'inapp', name: 'In the app', availableViews: ['inApp'] },
        { customerKey: 'plain', name: 'No views' },
        // nothing to choose without a key
        { name: 'No key', availableViews: ['push'] },
    ];
    const at = await form('push', (path) => {
        if (!path.startsWith(CONTENTS)) {
            return { body: path.startsWith('push/v1/') ? [] : { definitions: [] } };
        }
        return { body: { count: 55, items: path.includes('$page=1&') ? full : last } };
    });
    await tick();
    assert.deepEqual(
        at.looked.filter((path) => path.startsWith(CONTENTS)),
        [`${CONTENTS}?$page=1&${OF_CONTENTS}`, `${CONTENTS}?$page=2&${OF_CONTENTS}`],
    );
    const offered = options(at, 'content.customerKey');
    assert.equal(offered.length, 51);
    assert.deepEqual(offered[0], ['key-0', 'Message 0']);
    assert.deepEqual(offered.slice(50), [['capital', 'Written <i>Push</i>']]);
    assert.equal(at.panel().querySelector('i'), null);
    // the field still takes a key that is not in the list
    at.type('content.customerKey', 'another-key');
    assert.equal(at.field('content.customerKey').value, 'another-key');
    // the other kinds of message have no such list
    const ott = await form('ott');
    await tick();
    assert.deepEqual(ott.looked, []);
    assert.equal(listOf(ott.field('content.customerKey')), null);
    assert.equal(ott.field('content.customerKey').hasAttribute('role'), false);
});

test('the content field works without its list, and the rest of the list is not read for a form that is gone', async () => {
    const down = await form('push', (path) =>
        path.startsWith(CONTENTS) ? { status: 403, body: { message: 'No' } } : { body: [] },
    );
    await tick();
    assert.equal(listOf(down.field('content.customerKey')), null);
    down.type('content.customerKey', 'typed');
    assert.equal(down.field('content.customerKey').value, 'typed');

    const full = Array.from({ length: 50 }, (item, index) => ({
        customerKey: `key-${index}`,
        name: `Message ${index}`,
        availableViews: ['push'],
    }));
    const at = page(MENU, (path) => {
        if (path.startsWith(CONTENTS)) {
            return { body: { count: 100, items: full } };
        }
        return { body: path.startsWith('push/v1/') ? [] : { definitions: [] } };
    });
    await at.open();
    await tab(at, 'push');
    // the first page waits to be let through
    const pending = Promise.withResolvers();
    const answering = at.window.fetch;
    at.window.fetch = async (url, options) => {
        const response = await answering(url, options);
        if (url.includes(CONTENTS)) {
            await pending.promise;
        }
        return response;
    };
    at.panel().querySelector('.sfmc-ux-tools-transactional-new').click();
    await tick();
    const read = () => at.looked.filter((path) => path.startsWith(CONTENTS));
    assert.equal(read().length, 1);
    at.panel().querySelector('form').remove();
    pending.resolve();
    await tick();
    await tick();
    assert.equal(read().length, 1);
});

test('the form offers the codes, keywords and apps of the business unit, and works without them', async () => {
    const lists = {
        'legacy/v1/beta/mobile/code/': {
            entry: [{ code: '4912312345678', countryCode: 'DE' }, { code: 77 }, {}],
        },
        'legacy/v1/beta/mobile/keyword/': {
            entry: [{ keyword: 'ORDER', code: { code: '4912312345678' } }],
        },
        'push/v1/application': [{ id: 'app-1', name: 'Shop <b>app</b>' }],
    };
    const answer = (path) => ({ body: lists[path] || { definitions: [] } });
    const sms = await form('sms', answer);
    await tick();
    assert.deepEqual(sms.looked, [
        'legacy/v1/beta/mobile/code/',
        'legacy/v1/beta/mobile/keyword/',
        'contacts/v1/attributeSetDefinitions?$pageSize=500',
    ]);
    // only what can be chosen: a code that is no text is left out
    assert.deepEqual(chosen(sms, 'subscriptions.shortCode').slice(1), [
        ['4912312345678', '4912312345678 · DE'],
    ]);
    const push = await form('push', answer);
    await tick();
    assert.deepEqual(push.looked, [
        'push/v1/application',
        'push-internal/v1/application?$page=1&$pageSize=50',
        `${CONTENTS}?$page=1&${OF_CONTENTS}`,
        `${FOLDERS}?$page=1&$pageSize=50`,
    ]);
    // names are shown as text, whatever they contain
    assert.deepEqual(options(push, 'applicationId'), [['app-1', 'Shop <b>app</b>']]);
    assert.equal(push.panel().querySelector('b'), null);
    // lists that cannot be read leave the fields as they are
    const down = await form('sms', (path) =>
        path.startsWith('legacy/') ? { isDown: true } : { body: { definitions: [] } },
    );
    await tick();
    assert.equal(down.field('subscriptions.shortCode').type, 'text');
    down.type('subscriptions.shortCode', '12345');
    assert.equal(down.field('subscriptions.shortCode').value, '12345');
    assert.equal(down.panel().querySelector('form') !== null, true);
});

/**
 * Lists what a field of a form lets choose, when it is a list and no text field.
 *
 * @param {object} at the page with the form
 * @param {string} path name of the field
 * @returns {string[][]} value and text of every entry
 */
function chosen(at, path) {
    return [...at.field(path).options].map((item) => [item.value, item.textContent]);
}

/**
 * Chooses an entry of a list of a form.
 *
 * @param {object} at the page with the form
 * @param {string} path name of the field
 * @param {string} value the entry
 */
function choose(at, path, value) {
    at.field(path).value = value;
    at.field(path).dispatchEvent(new at.window.Event('change', { bubbles: true }));
}

// two codes of one country, as seen live, and a keyword that both of them have
const CODES = 'legacy/v1/beta/mobile/code/';
const KEYWORDS = 'legacy/v1/beta/mobile/keyword/';
const APPS = 'push/v1/application';
const OFFERED = {
    [CODES]: {
        entry: [
            { code: '3197010240', countryCode: 'NL', isShortCode: false, codeType: 'PRIVATE' },
            { code: '8850', countryCode: 'NL', isShortCode: true, codeType: 'SHARED' },
        ],
    },
    [KEYWORDS]: {
        entry: [
            { keyword: 'ORDER', code: { code: '3197010240' } },
            { keyword: 'STOP', code: { code: '3197010240' } },
            { keyword: 'ORDER', code: { code: '8850' } },
            { keyword: 'PROMO', code: { code: '8850' } },
        ],
    },
    [APPS]: [
        { id: 'app-1', name: 'Shop app' },
        { id: 'app-2', name: 'Staff app' },
    ],
    [CONTENTS]: {
        count: 1,
        items: [{ customerKey: 'receipt_push', name: 'Receipt', availableViews: ['push'] }],
    },
};

/**
 * Answers with the lists above, and with a definition or an empty list for the rest.
 *
 * @param {object} [definition] what is read under a key
 * @param {string[]} [down] the lists that cannot be read
 * @returns {(path: string, method: string) => object} what the API answers
 */
function offering(definition = DEFINITION, down = []) {
    return (path, method) => {
        const list = Object.keys(OFFERED).find((name) => path.startsWith(name));
        if (list) {
            return down.includes(list)
                ? { status: 500, body: { message: 'No' } }
                : { body: OFFERED[list] };
        }
        if (method !== 'GET') {
            return { status: 200, body: {} };
        }
        return { body: path.includes('?') ? { definitions: [ROW('welcome')] } : definition };
    };
}

/**
 * Counts how often a list of a form was read.
 *
 * @param {{looked: string[]}} at the page
 * @param {string} list where the list is
 * @returns {number} the requests for its first page
 */
function reads(at, list) {
    return at.looked.filter((path) => path === list || path.startsWith(`${list}?$page=1&`)).length;
}

test('the code is chosen from the codes of the business unit, told apart by more than their country', async () => {
    const at = await form('sms', offering());
    await tick();
    assert.equal(at.field('subscriptions.shortCode').tagName, 'SELECT');
    assert.equal(at.field('subscriptions.shortCode').required, true);
    assert.deepEqual(chosen(at, 'subscriptions.shortCode'), [
        ['', 'Choose a code …'],
        ['3197010240', '3197010240 · NL · long code · PRIVATE'],
        ['8850', '8850 · NL · short code · SHARED'],
    ]);
    assert.equal(at.field('subscriptions.shortCode').value, '');
});

test('the keywords follow the code: none before a code is chosen, and one that the new code lacks is taken out', async () => {
    const at = await form('sms', offering());
    await tick();
    const keyword = () => at.field('subscriptions.keyword');
    assert.equal(keyword().tagName, 'SELECT');
    assert.equal(keyword().disabled, true);
    assert.deepEqual(chosen(at, 'subscriptions.keyword'), [['', 'Choose the code first']]);
    choose(at, 'subscriptions.shortCode', '3197010240');
    assert.equal(keyword().disabled, false);
    // each keyword once: only those of this code
    assert.deepEqual(chosen(at, 'subscriptions.keyword'), [
        ['', 'Choose a keyword …'],
        ['ORDER', 'ORDER'],
        ['STOP', 'STOP'],
    ]);
    choose(at, 'subscriptions.keyword', 'ORDER');
    // the other code has this keyword too, so it stays
    choose(at, 'subscriptions.shortCode', '8850');
    assert.deepEqual(
        chosen(at, 'subscriptions.keyword').map(([value]) => value),
        ['', 'ORDER', 'PROMO'],
    );
    assert.equal(keyword().value, 'ORDER');
    choose(at, 'subscriptions.keyword', 'PROMO');
    choose(at, 'subscriptions.shortCode', '3197010240');
    assert.equal(keyword().value, '');
    choose(at, 'subscriptions.shortCode', '');
    assert.equal(keyword().disabled, true);
    assert.deepEqual(chosen(at, 'subscriptions.keyword'), [['', 'Choose the code first']]);
});

test('a chosen code and keyword are sent as the typed ones were, and a form without them is not sent', async () => {
    const at = await form('sms', offering());
    await tick();
    at.type('name', 'Order shipped');
    at.type('content.message', 'On its way.');
    await at.send();
    assert.deepEqual(at.written, []);
    choose(at, 'subscriptions.shortCode', '8850');
    await at.send();
    assert.deepEqual(at.written, []);
    choose(at, 'subscriptions.keyword', 'PROMO');
    await at.send();
    assert.deepEqual(at.sent(), [
        {
            name: 'Order shipped',
            definitionKey: 'Order_shipped',
            status: 'Active',
            content: { message: 'On its way.' },
            subscriptions: {
                shortCode: '8850',
                keyword: 'PROMO',
                autoAddSubscriber: false,
                updateSubscriber: false,
            },
        },
    ]);
});

test('what was typed before the lists came is kept when the fields become lists', async () => {
    const pending = Promise.withResolvers();
    const at = page(MENU, offering());
    await at.open();
    const answering = at.window.fetch;
    at.window.fetch = async (url, options) => {
        const response = await answering(url, options);
        if (url.includes('legacy/')) {
            await pending.promise;
        }
        return response;
    };
    await click(at, 'new');
    const field = (path) => at.panel().querySelector('form').elements[path];
    assert.equal(field('subscriptions.shortCode').tagName, 'INPUT');
    field('subscriptions.shortCode').value = ' 8850 ';
    field('subscriptions.keyword').value = 'MINE';
    pending.resolve();
    await tick();
    await tick();
    assert.equal(field('subscriptions.shortCode').tagName, 'SELECT');
    assert.equal(field('subscriptions.shortCode').value, '8850');
    assert.equal(field('subscriptions.keyword').value, 'MINE');
    assert.equal(
        field('subscriptions.keyword').selectedOptions[0].textContent,
        'MINE — not found in this business unit',
    );
});

test('a stored code or keyword that the business unit does not have stays chosen, and an untouched form sends nothing', async () => {
    const stored = {
        ...DEFINITION,
        subscriptions: { shortCode: '4912312345678', keyword: 'WELCOME' },
    };
    const at = await editing(stored, offering(stored));
    await tick();
    assert.equal(at.field('subscriptions.shortCode').value, '4912312345678');
    assert.deepEqual(chosen(at, 'subscriptions.shortCode').at(-1), [
        '4912312345678',
        '4912312345678 — not found in this business unit',
    ]);
    assert.equal(at.field('subscriptions.keyword').value, 'WELCOME');
    assert.equal(at.field('subscriptions.keyword').disabled, false);
    assert.deepEqual(chosen(at, 'subscriptions.keyword'), [
        ['', 'Choose a keyword …'],
        ['WELCOME', 'WELCOME — not found in this business unit'],
    ]);
    const before = at.calls.length;
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // it can be chosen again after a look at another code
    choose(at, 'subscriptions.shortCode', '8850');
    assert.equal(at.field('subscriptions.keyword').value, '');
    assert.deepEqual(
        chosen(at, 'subscriptions.keyword').map(([value]) => value),
        ['', 'ORDER', 'PROMO'],
    );
    choose(at, 'subscriptions.shortCode', '4912312345678');
    assert.equal(at.field('subscriptions.keyword').value, '');
    choose(at, 'subscriptions.keyword', 'WELCOME');
    await at.send();
    assert.equal(at.calls.length, before);
});

test('a known code with a keyword of its own that the lists lack keeps that keyword, and a changed one is sent with its part', async () => {
    const stored = {
        ...DEFINITION,
        subscriptions: { shortCode: '8850', keyword: 'OLD', countryCode: 'NL' },
    };
    const at = await editing(stored, (path, method, count) => {
        const offered = offering(stored)(path, method);
        if (method === 'GET' && path.endsWith('definitions/welcome') && count > 1) {
            return {
                body: {
                    ...stored,
                    subscriptions: { ...stored.subscriptions, keyword: 'PROMO' },
                },
            };
        }
        return offered;
    });
    await tick();
    assert.deepEqual(
        chosen(at, 'subscriptions.keyword').map(([value]) => value),
        ['', 'ORDER', 'PROMO', 'OLD'],
    );
    assert.equal(at.field('subscriptions.keyword').value, 'OLD');
    choose(at, 'subscriptions.keyword', 'PROMO');
    await at.send();
    assert.deepEqual(at.changes(), [
        { subscriptions: { shortCode: '8850', keyword: 'PROMO', countryCode: 'NL' } },
    ]);
    assert.match(at.text(), /^Saved “name of welcome”/);
});

test('the code and the keyword stay text fields when one of their lists cannot be read or is empty', async () => {
    for (const down of [[CODES], [KEYWORDS], [CODES, KEYWORDS]]) {
        const at = await form('sms', offering(DEFINITION, down));
        await tick();
        assert.equal(at.field('subscriptions.shortCode').type, 'text', down.join(' '));
        assert.equal(at.field('subscriptions.keyword').type, 'text', down.join(' '));
        assert.equal(at.field('subscriptions.keyword').disabled, false);
        at.type('name', 'Order shipped');
        at.type('content.message', 'On its way.');
        at.type('subscriptions.shortCode', '12345');
        at.type('subscriptions.keyword', 'ANY');
        await at.send();
        assert.deepEqual(at.sent()[0].subscriptions, {
            shortCode: '12345',
            keyword: 'ANY',
            autoAddSubscriber: false,
            updateSubscriber: false,
        });
    }
    // a business unit without keywords has nothing to choose from
    const empty = await form('sms', (path) =>
        path === KEYWORDS ? { body: { entry: [] } } : offering()(path, 'GET'),
    );
    await tick();
    assert.equal(empty.field('subscriptions.shortCode').type, 'text');
    // a list that failed is asked for again by the next form, and the fields become lists then
    let isDown = true;
    const later = await form('sms', (path, method) =>
        offering(DEFINITION, isDown ? [KEYWORDS] : [])(path, method),
    );
    await tick();
    assert.equal(later.field('subscriptions.keyword').type, 'text');
    isDown = false;
    later.button('Cancel').click();
    await tick();
    await click(later, 'new');
    await tick();
    assert.equal(later.field('subscriptions.keyword').tagName, 'SELECT');
    // the codes were kept, the keywords were not
    assert.deepEqual([reads(later, CODES), reads(later, KEYWORDS)], [1, 2]);
});

test('a keyword that names no code is offered with every code', async () => {
    const at = await form('sms', (path, method) =>
        path === KEYWORDS
            ? {
                  body: {
                      entry: [
                          { keyword: 'ANYWHERE' },
                          { keyword: 'ORDER', code: { code: '8850' } },
                      ],
                  },
              }
            : offering()(path, method),
    );
    await tick();
    choose(at, 'subscriptions.shortCode', '3197010240');
    assert.deepEqual(
        chosen(at, 'subscriptions.keyword').map(([value]) => value),
        ['', 'ANYWHERE'],
    );
});

test('the details call the fields by readable names, with the name of the API to be read on them', async () => {
    const at = await details(undefined, {
        ...DEFINITION,
        definitionId: 'id-1',
        somethingNew: 'x',
        subscriptions: { ...DEFINITION.subscriptions, unknownPart: 1 },
        options: {
            isReconcilable: false,
            urlShortenerOptions: { isLinkShorteningEnabled: true, shortenerType: 'SFMC' },
        },
    });
    const names = [...at.panel().querySelectorAll('dt')].map((item) => [
        item.textContent,
        item.title,
    ]);
    assert.deepEqual(names, [
        ['Name', 'name'],
        ['Key', 'definitionKey'],
        ['Status', 'status'],
        ['Created', 'createdDate'],
        ['Modified', 'modifiedDate'],
        ['Content', 'content'],
        ['Message', 'content.message'],
        ['Subscription', 'subscriptions'],
        ['Code', 'subscriptions.shortCode'],
        ['Keyword', 'subscriptions.keyword'],
        // what the panel has no name for keeps the one of the API
        ['unknownPart', 'subscriptions.unknownPart'],
        ['ID', 'definitionId'],
        ['somethingNew', 'somethingNew'],
        ['Options', 'options'],
        ['Reconcilable', 'options.isReconcilable'],
        ['Link shortener', 'options.urlShortenerOptions'],
        ['Shorten links', 'options.urlShortenerOptions.isLinkShorteningEnabled'],
        ['Shortener type', 'options.urlShortenerOptions.shortenerType'],
    ]);
    // an SMS message has nothing that a list names, and reads none for its details
    assert.deepEqual(at.looked, []);
    assert.equal(at.panel().querySelector(RESOLVED), null);
});

const RESOLVED = '.sfmc-ux-tools-transactional-resolved';
const PUSH = {
    ...ROW('receipt'),
    status: 'Draft',
    applicationId: 'app-2',
    content: { customerKey: 'receipt_push' },
};

/**
 * Opens the panel on the details of the push definition "receipt".
 *
 * @param {object} [definition] the definition
 * @param {string[]} [down] the lists that cannot be read
 * @returns {Promise.<object>} the page, with the names shown next to the values of the details
 */
async function pushDetails(definition = PUSH, down = []) {
    const at = page(MENU, (path, method) =>
        path.startsWith('push/definitions?')
            ? { body: { definitions: [ROW('receipt')] } }
            : offering(definition, down)(path, method),
    );
    await at.open();
    await tab(at, 'push');
    rows(at)[0].click();
    await tick();
    await tick();
    at.named = () =>
        Object.fromEntries(
            [...at.panel().querySelectorAll(RESOLVED)].map((item) => [
                item.closest('dd').previousElementSibling.title,
                item.hidden ? null : item.textContent,
            ]),
        );
    return at;
}

test('the details of a push message name its app and its content next to their id and key', async () => {
    const at = await pushDetails();
    assert.deepEqual(at.named(), {
        applicationId: 'Staff app',
        'content.customerKey': 'Receipt',
    });
    // the id and the key stay as they are
    const value = (path) =>
        [...at.panel().querySelectorAll('dt')].find((item) => item.title === path)
            .nextElementSibling.firstElementChild.textContent;
    assert.equal(value('applicationId'), 'app-2');
    assert.equal(value('content.customerKey'), 'receipt_push');
    assert.equal(
        [...at.panel().querySelectorAll('dt')].find((item) => item.title === 'applicationId')
            .textContent,
        'App',
    );
    // what the lists do not hold has no name
    const unknown = await pushDetails({ ...PUSH, applicationId: 'app-9' });
    assert.deepEqual(unknown.named(), { applicationId: null, 'content.customerKey': 'Receipt' });
});

test('details are shown without the names when a list cannot be read, and the list is asked for again the next time', async () => {
    const at = await pushDetails(PUSH, [APPS]);
    assert.deepEqual(at.named(), { applicationId: null, 'content.customerKey': 'Receipt' });
    assert.match(at.text(), /app-2/);
    await click(at, 'back');
    rows(at)[0].click();
    await tick();
    await tick();
    // the list that failed is read again by whatever names with it, the list of messages and
    // the details, each time it is shown; the one that was read is not
    assert.deepEqual([reads(at, APPS), reads(at, CONTENTS)], [4, 1]);
    const none = await pushDetails(PUSH, [APPS, CONTENTS]);
    assert.deepEqual(none.named(), { applicationId: null, 'content.customerKey': null });
    assert.ok(none.panel().querySelector('dl'));
});

test('the lists of names are read once for the details and the forms, until "Refresh" or another business unit', async () => {
    const at = await pushDetails();
    const count = () => [reads(at, APPS), reads(at, CONTENTS)];
    assert.deepEqual(count(), [1, 1]);
    // the form of the message, the details again and a new form use what was read
    const press = async (text) => {
        [...at.panel().querySelectorAll('button')]
            .find((item) => item.textContent === text)
            .click();
        await tick();
        await tick();
    };
    await press('Edit');
    const field = (path) => at.panel().querySelector('form').elements[path];
    assert.deepEqual(
        [...listOf(field('applicationId')).children].map((item) => item.textContent),
        ['Shop appapp-1', 'Staff appapp-2'],
    );
    await press('Cancel');
    assert.equal(at.named().applicationId, 'Staff app');
    await click(at, 'back');
    await click(at, 'new');
    assert.equal(listOf(field('content.customerKey')).children.length, 1);
    assert.deepEqual(count(), [1, 1]);
    await press('Cancel');
    // "Refresh" reads them again, for the list that it shows
    await click(at, 'refresh');
    assert.deepEqual(count(), [2, 2]);
    rows(at)[0].click();
    await tick();
    await tick();
    assert.deepEqual(count(), [2, 2]);
    assert.equal(at.named().applicationId, 'Staff app');
    // and so does a menu that is drawn again, as after a change of the business unit
    await click(at, 'back');
    at.document.querySelector('#mobile').closest('body').insertAdjacentHTML('beforeend', MENU);
    at.document.querySelector('[data-sfmc-ux-tools-transactional]').closest('ul').remove();
    await tick();
    await tab(at, 'push');
    rows(at)[0].click();
    await tick();
    await tick();
    assert.deepEqual(count(), [3, 3]);
});

test('a list of names that was read keeps nothing of those who ask for it later', async () => {
    const at = await pushDetails();
    // every function the page puts into a list of its own from here on
    at.window.eval(`{
        const { push } = Array.prototype;
        globalThis.kept = [];
        Array.prototype.push = function (...items) {
            push.apply(
                globalThis.kept,
                items.filter((item) => typeof item === 'function'),
            );
            return push.apply(this, items);
        };
    }`);
    // the form of the message and the details again: both ask for the lists that were read
    for (const text of ['Edit', 'Cancel']) {
        [...at.panel().querySelectorAll('button')]
            .find((item) => item.textContent === text)
            .click();
        await tick();
        await tick();
    }
    assert.deepEqual([reads(at, APPS), reads(at, CONTENTS)], [1, 1]);
    assert.equal(at.named().applicationId, 'Staff app');
    // whether the one who asked still waits is of no interest any more, so it is not kept
    assert.deepEqual(Array.from(at.window.kept, String), []);
});

test('the form names the app and the content under their fields, while typing and for what is stored', async () => {
    const at = await form('push', offering());
    await tick();
    const named = (path) => {
        const place = at.field(path).closest(FIELD).querySelector(RESOLVED);
        return place.hidden ? null : place.textContent;
    };
    assert.equal(named('applicationId'), null);
    assert.equal(named('content.customerKey'), null);
    at.type('applicationId', 'app-1');
    assert.equal(named('applicationId'), 'Shop app');
    at.type('applicationId', 'app-');
    assert.equal(named('applicationId'), null);
    at.type('applicationId', ' app-2 ');
    assert.equal(named('applicationId'), 'Staff app');
    at.type('content.customerKey', 'receipt_push');
    assert.equal(named('content.customerKey'), 'Receipt');
    // only the fields that hold an id or a key have such a place
    assert.equal(at.form().querySelectorAll(RESOLVED).length, 2);
    // the form of a message that exists names what it holds
    const stored = await pushDetails();
    [...stored.panel().querySelectorAll('button')]
        .find((item) => item.textContent === 'Edit')
        .click();
    await tick();
    await tick();
    const places = [...stored.panel().querySelectorAll(`form ${RESOLVED}`)];
    assert.deepEqual(
        places.map((item) => item.textContent),
        ['Staff app', 'Receipt'],
    );
    // without the lists the form works, and names nothing
    const down = await form('push', offering(DEFINITION, [APPS, CONTENTS]));
    await tick();
    down.type('applicationId', 'app-1');
    assert.equal(down.field('applicationId').value, 'app-1');
    assert.equal(down.form().querySelector(`${RESOLVED}:not([hidden])`), null);
});

/**
 * Lists the statuses a form lets choose.
 *
 * @param {object} at the page with the form
 * @returns {string[]} the statuses
 */
function statuses(at) {
    return [...at.field('status').options].map((item) => item.value);
}

test('only push has the status Draft, and only its new form says what becomes of a new message', async () => {
    const note = /Marketing Cloud stores a new push message as Draft unless it is Active\./;
    const push = await form('push');
    assert.deepEqual(statuses(push), ['Active', 'Inactive', 'Draft']);
    assert.match(push.field('status').closest('label').textContent, note);
    assert.equal(push.field('status').value, 'Active');
    const sms = await form('sms');
    assert.deepEqual(statuses(sms), ['Active', 'Inactive']);
    assert.doesNotMatch(sms.text(), note);
    const ott = await form('ott');
    assert.deepEqual(statuses(ott), ['Active', 'Inactive']);
    assert.doesNotMatch(ott.text(), note);
    // a push message that exists is whatever it is stored as
    const stored = await pushDetails();
    [...stored.panel().querySelectorAll('button')]
        .find((item) => item.textContent === 'Edit')
        .click();
    await tick();
    assert.equal(stored.panel().querySelector('form').elements.status.value, 'Draft');
    assert.equal(stored.panel().querySelector('form').elements.status.options.length, 3);
    assert.doesNotMatch(stored.text(), note);
});

const SHORTEN = 'options.urlShortenerOptions.isLinkShorteningEnabled';
const TRACK = 'options.urlShortenerOptions.isSubscriberTrackingEnabled';

test('a new SMS message names the options of the link shortener only when they are ticked', async () => {
    const at = await form('sms', () => ({ body: {} }));
    at.type('name', 'Order shipped');
    at.type('content.message', 'On its way.');
    at.type('subscriptions.shortCode', '8850');
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.equal(Object.hasOwn(at.sent()[0], 'options'), false);
    const ticked = await form('sms', () => ({ body: {} }));
    ticked.type('name', 'Order shipped');
    ticked.type('content.message', 'On its way.');
    ticked.type('subscriptions.shortCode', '8850');
    ticked.type('subscriptions.keyword', 'ORDER');
    ticked.tick(SHORTEN);
    await ticked.send();
    assert.deepEqual(ticked.sent()[0].options, {
        urlShortenerOptions: { isLinkShorteningEnabled: true },
    });
});

test('a changed option of the link shortener is sent with its whole part, and held against what is stored afterwards', async () => {
    const held = {
        ...DEFINITION,
        options: {
            isReconcilable: false,
            urlShortenerOptions: { isLinkShorteningEnabled: true, shortenerType: 'SFMC' },
        },
    };
    const before = JSON.stringify(held);
    const sent = {
        isReconcilable: false,
        urlShortenerOptions: {
            isLinkShorteningEnabled: false,
            shortenerType: 'SFMC',
            isSubscriberTrackingEnabled: true,
        },
    };
    const run = async (after) => {
        const at = await editing(held, (path, method, count) => {
            if (method !== 'GET') {
                return { status: 200 };
            }
            return { body: count === 1 ? held : after };
        });
        assert.equal(at.field(SHORTEN).checked, true);
        assert.equal(at.field(TRACK).checked, false);
        at.field(SHORTEN).click();
        at.field(TRACK).click();
        await at.send();
        return at;
    };
    // the tick that was taken out is simply gone afterwards: that counts as saved
    const saved = await run({
        ...held,
        options: {
            isReconcilable: false,
            urlShortenerOptions: { shortenerType: 'SFMC', isSubscriberTrackingEnabled: true },
        },
    });
    assert.deepEqual(saved.changes(), [{ options: sent }]);
    assert.match(saved.text(), /^Saved “name of welcome”/);
    // the definition the form was filled from is not altered by what was sent
    assert.equal(JSON.stringify(held), before);
    // what Marketing Cloud did not take is named by its whole path
    const missed = await run(held);
    assert.deepEqual(missed.changes(), [{ options: sent }]);
    assert.match(
        missed.text(),
        /these fields are not as they were sent: options\.urlShortenerOptions\.isLinkShorteningEnabled, options\.urlShortenerOptions\.isSubscriberTrackingEnabled\./,
    );
});

test('an option of a message that has no options yet is sent alone, and untouched options are not sent', async () => {
    const at = await editing(DEFINITION, (path, method, count) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        const options = { urlShortenerOptions: { isSubscriberTrackingEnabled: true } };
        return { body: count === 1 ? DEFINITION : { ...DEFINITION, options } };
    });
    at.field(TRACK).click();
    await at.send();
    assert.deepEqual(at.changes(), [
        { options: { urlShortenerOptions: { isSubscriberTrackingEnabled: true } } },
    ]);
    assert.match(at.text(), /^Saved “name of welcome”/);
    const ticked = {
        ...DEFINITION,
        options: { urlShortenerOptions: { isLinkShorteningEnabled: true } },
    };
    const other = await editing(ticked, () => ({ status: 200, body: ticked }));
    other.type('description', 'new words');
    await other.send();
    assert.equal(Object.hasOwn(other.changes()[0], 'options'), false);
});

test('"Cancel" leaves the form without sending anything', async () => {
    const at = await form('push');
    at.type('name', 'Receipt');
    at.button('Cancel').click();
    await tick();
    assert.deepEqual(at.written, []);
    assert.equal(at.panel().querySelector('form'), null);
    assert.match(at.text(), /no transactional Push messages/);
});

/**
 * Opens the form that changes the SMS definition "welcome".
 *
 * @param {object} [definition] the definition as Marketing Cloud holds it
 * @param {(path: string, method: string, reads: number) => object} [answer] what the API answers once the form is open; reads counts the reads of the definition since then, from 1
 * @returns {Promise.<object>} the page, with ways to fill a field, to read one, to send the form and to read what was sent
 */
async function editing(definition = DEFINITION, answer = () => ({ body: definition })) {
    let reads = 0;
    const at = await details((path, method) => {
        // the lists the form offers are read too, and do not count
        reads += method === 'GET' && path.endsWith('definitions/welcome') ? 1 : 0;
        return answer(path, method, reads);
    }, definition);
    await at.press('Edit');
    at.form = () => at.panel().querySelector('form');
    at.field = (path) => at.form().elements[path];
    at.type = (path, text) => {
        at.field(path).value = text;
        at.field(path).dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    at.send = async () => {
        at.form().dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
        await tick();
        await tick();
        await tick();
    };
    at.changes = () =>
        at.calls.filter((call) => call.method !== 'GET').map((call) => JSON.parse(call.body));
    return at;
}

test('"Edit" opens the form filled with the message, and its key cannot be changed', async () => {
    const at = await editing({ ...DEFINITION, description: 'old words', status: 'Inactive' });
    assert.match(at.text(), /^Edit “name of welcome” \(key welcome\)/);
    assert.equal(at.field('name').value, 'name of welcome');
    assert.equal(at.field('definitionKey').value, 'welcome');
    assert.equal(at.field('definitionKey').readOnly, true);
    assert.equal(at.field('description').value, 'old words');
    assert.equal(at.field('status').value, 'Inactive');
    assert.equal(at.field('content.message').value, 'line 1\nline 2');
    assert.equal(at.field('subscriptions.shortCode').value, '4912312345678');
    assert.equal(at.field('subscriptions.keyword').value, 'WELCOME');
    assert.equal(at.field('subscriptions.countryCode').value, '');
    assert.equal(at.field('subscriptions.autoAddSubscriber').checked, false);
    // the key does not follow the name of a message that exists
    at.type('name', 'Another name');
    assert.equal(at.field('definitionKey').value, 'welcome');
    assert.equal(at.form().querySelector('button[type="submit"]').textContent, 'Save');
});

test('a form that was not changed sends nothing', async () => {
    const at = await editing();
    const before = at.calls.length;
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // typing a value back to what it was is no change either
    at.type('name', 'x');
    at.type('name', 'name of welcome');
    await at.send();
    assert.equal(at.calls.length, before);
});

test('only the changed parts are sent, whole, as the update the page lets through', async () => {
    const held = {
        ...DEFINITION,
        description: 'old words',
        definitionId: 'id-1',
        content: { message: 'line 1\nline 2', unknownToTheForm: 'kept' },
        options: { urlShortenerOptions: { isLinkShorteningEnabled: true } },
    };
    const saved = {
        ...held,
        description: 'new words',
        content: { ...held.content, message: 'new text' },
        subscriptions: { ...held.subscriptions, autoAddSubscriber: true },
    };
    const at = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200, body: { requestId: 'r-9' } };
        }
        // the check before the request sees the message as it was, the look after it the new one
        return { body: reads === 1 ? held : saved };
    });
    at.type('description', ' new words ');
    at.type('content.message', 'new text');
    at.field('subscriptions.autoAddSubscriber').click();
    await at.send();
    assert.deepEqual(at.written, ['POST sms/definitions/welcome']);
    const call = at.calls.find((item) => item.method !== 'GET');
    assert.equal(call.headers['X-HTTP-Method-Override'], 'PATCH');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.credentials, 'same-origin');
    assert.deepEqual(at.changes(), [
        {
            description: 'new words',
            // what the form does not know of a part goes along, so that it is not lost
            content: { message: 'new text', unknownToTheForm: 'kept' },
            subscriptions: {
                shortCode: '4912312345678',
                keyword: 'WELCOME',
                autoAddSubscriber: true,
            },
        },
    ]);
    // neither the key nor parts without a change
    assert.equal(Object.hasOwn(at.changes()[0], 'definitionKey'), false);
    assert.equal(Object.hasOwn(at.changes()[0], 'options'), false);
    assert.equal(Object.hasOwn(at.changes()[0], 'name'), false);
    assert.match(at.text(), /^Saved “name of welcome” \(key welcome\)\./);
    // the details show what Marketing Cloud holds now
    assert.match(at.text(), /new words/);
    assert.equal(at.panel().querySelector('form'), null);
});

test('text that was taken out is sent as empty, and counts as saved when it is gone', async () => {
    const held = { ...DEFINITION, description: 'old words' };
    const at = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        return { body: reads === 1 ? held : DEFINITION };
    });
    at.type('description', '');
    await at.send();
    assert.deepEqual(at.changes(), [{ description: '' }]);
    assert.match(at.text(), /^Saved “name of welcome”/);
});

test('a status the form does not know is kept and not sent as another', async () => {
    const held = { ...DEFINITION, status: 'Paused' };
    const at = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        return { body: reads === 1 ? held : { ...held, name: 'New name' } };
    });
    assert.equal(at.field('status').value, 'Paused');
    assert.deepEqual(
        [...at.field('status').options].map((item) => item.value),
        ['Active', 'Inactive', 'Paused'],
    );
    at.type('name', 'New name');
    await at.send();
    assert.deepEqual(at.changes(), [{ name: 'New name' }]);
});

test('what a field cannot show as it is stored is left alone, unless that very field is changed', async () => {
    const held = {
        ...DEFINITION,
        // none of these come back from their field as they are stored
        description: ' two\nlines ',
        content: { message: 'line 1\r\nline 2' },
        subscriptions: {
            shortCode: 4_912_312_345_678,
            keyword: ' WELCOME ',
            countryCode: null,
            autoAddSubscriber: 'true',
        },
    };
    const untouched = await editing(held);
    const before = untouched.calls.length;
    await untouched.send();
    assert.equal(untouched.calls.length, before);
    assert.match(untouched.text(), /Nothing was changed, so nothing was sent\./);
    // a tick that is stored as text cannot be shown, so it cannot be changed here
    assert.equal(untouched.field('subscriptions.autoAddSubscriber').disabled, true);
    assert.equal(untouched.field('subscriptions.updateSubscriber').disabled, false);
    // only the name is changed: nothing else goes along
    const named = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        return { body: reads === 1 ? held : { ...held, name: 'New name' } };
    });
    named.type('name', 'New name');
    await named.send();
    assert.deepEqual(named.changes(), [{ name: 'New name' }]);
    assert.match(named.text(), /^Saved “name of welcome”/);
    // one field of a part is changed: the rest of the part goes along as it is stored
    const part = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        return {
            body:
                reads === 1
                    ? held
                    : { ...held, subscriptions: { ...held.subscriptions, countryCode: 'DE' } },
        };
    });
    part.type('subscriptions.countryCode', 'DE');
    await part.send();
    assert.deepEqual(part.changes(), [
        {
            subscriptions: {
                shortCode: 4_912_312_345_678,
                keyword: ' WELCOME ',
                countryCode: 'DE',
                autoAddSubscriber: 'true',
            },
        },
    ]);
    assert.match(part.text(), /^Saved “name of welcome”/);
    // a value that is a list or an object is shown in the details only
    const nested = await editing({ ...DEFINITION, description: { odd: true } });
    assert.equal(nested.field('description').disabled, true);
    assert.equal(nested.field('description').value, '');
});

test('a tick that was taken out and a number that was sent count as saved when Marketing Cloud holds them so', async () => {
    const held = {
        ...DEFINITION,
        subscriptions: { ...DEFINITION.subscriptions, autoAddSubscriber: true },
    };
    const at = await editing(held, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        // the tick is simply gone afterwards, and the code comes back as a number
        return {
            body:
                reads === 1
                    ? held
                    : {
                          ...held,
                          subscriptions: { shortCode: 4_912_300_000_000, keyword: 'WELCOME' },
                      },
        };
    });
    at.field('subscriptions.autoAddSubscriber').click();
    at.type('subscriptions.shortCode', '4912300000000');
    await at.send();
    assert.equal(at.changes()[0].subscriptions.autoAddSubscriber, false);
    assert.match(at.text(), /^Saved “name of welcome”/);
});

test('a line that an earlier try left in the form is gone when the next one starts', async () => {
    let refusals = 1;
    const at = await editing(DEFINITION, (path, method) => {
        if (method === 'GET') {
            return { body: DEFINITION };
        }
        return refusals-- > 0 ? { status: 400, body: { message: 'Try again' } } : { isDown: true };
    });
    await at.send();
    assert.match(at.text(), /Nothing was changed/);
    at.type('name', 'New name');
    await at.send();
    assert.match(at.text(), /Not saved: Try again/);
    assert.doesNotMatch(at.text(), /Nothing was changed/);
});

test('what was changed meanwhile, or is another message by now, is not saved over', async () => {
    const at = await editing(DEFINITION, () => ({
        body: { ...DEFINITION, modifiedDate: '2026-02-02T02:02:00' },
    }));
    at.type('name', 'New name');
    await at.send();
    assert.deepEqual(at.written, []);
    assert.match(at.text(), /Not saved: what Marketing Cloud holds under this key is no longer/);
    // the form stays, with what was typed, and can be sent again
    assert.equal(at.field('name').value, 'New name');
    assert.equal(at.form().querySelector('button[type="submit"]').disabled, false);
    // a check that gets no answer saves nothing either
    const down = await editing(DEFINITION, () => ({ isDown: true }));
    down.type('name', 'New name');
    await down.send();
    assert.deepEqual(down.written, []);
    assert.match(down.text(), /Not saved: Marketing Cloud did not answer/);
    assert.equal(down.field('name').value, 'New name');
});

test('a refused change says why and keeps what was typed', async () => {
    const at = await editing(DEFINITION, (path, method) =>
        method === 'GET'
            ? { body: DEFINITION }
            : { status: 400, body: { message: 'Keyword not found', errorcode: 30_003 } },
    );
    at.type('subscriptions.keyword', 'NOPE');
    await at.send();
    assert.deepEqual(at.written, ['POST sms/definitions/welcome']);
    assert.match(at.text(), /Not saved: Keyword not found/);
    assert.equal(at.field('subscriptions.keyword').value, 'NOPE');
    assert.equal(at.form().querySelector('button[type="submit"]').disabled, false);
});

test('an answer that all went well is held against what Marketing Cloud holds afterwards', async () => {
    // answered with success, but the message is as before
    const at = await editing(DEFINITION, (path, method) =>
        method === 'GET' ? { body: DEFINITION } : { status: 200 },
    );
    at.type('name', 'New name');
    at.type('content.message', 'new text');
    await at.send();
    assert.match(
        at.text(),
        /^Marketing Cloud answered that “name of welcome” \(key welcome\) was saved, but these fields are not as they were sent: name, content\.message\./,
    );
    assert.doesNotMatch(at.text(), /^Saved/);
    // the details below show what it holds
    assert.ok(at.panel().querySelector('dl'));
    // answered with success, but the message cannot be read again
    const lost = await editing(DEFINITION, (path, method, reads) => {
        if (method !== 'GET') {
            return { status: 200 };
        }
        return reads === 1
            ? { body: DEFINITION }
            : { status: 500, body: { message: 'Server down' } };
    });
    lost.type('name', 'New name');
    await lost.send();
    await tick();
    assert.match(
        lost.text(),
        /^Marketing Cloud answered that “name of welcome” \(key welcome\) was saved, but it could not be read again: Server down/,
    );
});

test('a change without an answer is reported as unknown, with what Marketing Cloud holds', async () => {
    const at = await editing(DEFINITION, (path, method) =>
        method === 'GET' ? { body: DEFINITION } : { isDown: true },
    );
    at.type('name', 'New name');
    await at.send();
    await tick();
    assert.deepEqual(at.written, ['POST sms/definitions/welcome']);
    assert.match(
        at.text(),
        /^It is not known whether “name of welcome” \(key welcome\) was saved: Marketing Cloud did not answer/,
    );
    assert.ok(at.panel().querySelector('dl'));
});

test('a change is sent once, and not at all when the form is left before its check comes back', async () => {
    const twice = await editing(DEFINITION, (path, method) =>
        method === 'GET' ? { body: DEFINITION } : { status: 200 },
    );
    // the request waits to be let through
    const pending = Promise.withResolvers();
    const answering = twice.window.fetch;
    twice.window.fetch = async (url, options) => {
        const response = await answering(url, options);
        if (options.method !== 'GET') {
            await pending.promise;
        }
        return response;
    };
    twice.type('name', 'New name');
    const sending = twice.form();
    const submit = () =>
        sending.dispatchEvent(
            new twice.window.Event('submit', { bubbles: true, cancelable: true }),
        );
    submit();
    // again before the check has come back
    submit();
    await tick();
    await tick();
    assert.deepEqual(twice.written, ['POST sms/definitions/welcome']);
    // and again while the request itself is on its way
    submit();
    await tick();
    await tick();
    pending.resolve();
    await tick();
    await tick();
    assert.deepEqual(twice.written, ['POST sms/definitions/welcome']);
    // left before the check has come back
    const gate = Promise.withResolvers();
    const left = await editing();
    const quick = left.window.fetch;
    left.window.fetch = async (url, options) => {
        if (url.endsWith('/definitions/welcome')) {
            await gate.promise;
        }
        return quick(url, options);
    };
    left.type('name', 'New name');
    left.form().dispatchEvent(new left.window.Event('submit', { bubbles: true, cancelable: true }));
    await tab(left, 'push');
    gate.resolve();
    await tick();
    await tick();
    assert.deepEqual(left.written, []);
    assert.match(left.text(), /no transactional Push messages/);
});

test('"Cancel" in the form of a message goes back to its details and sends nothing', async () => {
    const at = await editing();
    at.type('name', 'New name');
    [...at.form().elements].find((item) => item.textContent === 'Cancel').click();
    await tick();
    assert.deepEqual(at.written, []);
    assert.equal(at.panel().querySelector('form'), null);
    assert.match(at.text(), /name of welcome/);
    assert.ok(at.panel().querySelector('dl'));
});

test('a required field that was emptied keeps a change from being sent', async () => {
    const at = await editing();
    at.type('name', ' '.repeat(3));
    await at.send();
    assert.deepEqual(at.written, []);
    assert.equal(at.calls.filter((call) => call.method !== 'GET').length, 0);
});

/**
 * Fills the form of a new SMS message with everything it must have.
 *
 * @param {{type: (path: string, text: string) => void}} at the page with the form
 */
function fillSms(at) {
    at.type('name', 'Order shipped');
    at.type('content.message', 'text');
    at.type('subscriptions.shortCode', '4912312345678');
    at.type('subscriptions.keyword', 'ORDER');
}

/**
 * Answers a new message as given, a list with no rows and anything else with the definition.
 *
 * @param {object} toPost the answer to a new message
 * @returns {(path: string, method: string) => object} what the API answers
 */
function answering(toPost) {
    return (path, method) => {
        if (method === 'POST') {
            return toPost;
        }
        return { body: path.includes('?') ? { definitions: [] } : DEFINITION };
    };
}

test('the list is read again after a message was created, whatever became of the request', async () => {
    // created: its details open, and the way back reads the list
    const done = await form('sms', answering({ status: 201, body: {} }));
    assert.equal(listReads(done), 1);
    fillSms(done);
    await done.send();
    assert.equal(listReads(done), 1);
    await click(done, 'back');
    assert.equal(listReads(done), 2);
    // and that list is kept again
    await tab(done, 'push');
    await tab(done, 'sms');
    assert.equal(listReads(done), 2);
    // refused: nobody knows what the refusal left behind
    const refused = await form('sms', answering({ status: 400, body: { message: 'No' } }));
    fillSms(refused);
    await refused.send();
    refused.button('Cancel').click();
    await tick();
    assert.equal(listReads(refused), 2);
    // a form that was left without sending anything changes nothing
    const left = await form('sms', answering({ status: 201 }));
    fillSms(left);
    left.button('Cancel').click();
    await tick();
    assert.equal(listReads(left), 1);
    // the lists of the other kinds are kept
    await tab(refused, 'push');
    await tab(refused, 'sms');
    await tab(refused, 'push');
    assert.equal(listReads(refused, 'push'), 1);
});

test('the list is read again after a message was changed, whatever became of the request', async () => {
    const outcomes = {
        saved: (path, method, reads) => {
            if (method !== 'GET') {
                return { status: 200 };
            }
            return { body: reads === 1 ? DEFINITION : { ...DEFINITION, name: 'New name' } };
        },
        refused: (path, method) =>
            method === 'GET' ? { body: DEFINITION } : { status: 400, body: { message: 'No' } },
        unanswered: (path, method) => (method === 'GET' ? { body: DEFINITION } : { isDown: true }),
    };
    for (const [outcome, answer] of Object.entries(outcomes)) {
        const at = await editing(DEFINITION, answer);
        at.type('name', 'New name');
        await at.send();
        await tick();
        assert.deepEqual(at.written, ['POST sms/definitions/welcome'], outcome);
        // a refusal leaves the form, from which the way back leads over the details
        if (at.form()) {
            [...at.form().elements].find((item) => item.textContent === 'Cancel').click();
            await tick();
        }
        assert.equal(listReads(at), 1, outcome);
        await click(at, 'back');
        assert.equal(listReads(at), 2, outcome);
    }
    // a change that was never sent leaves the list as it was read
    const unsent = await editing(DEFINITION, () => ({ body: { ...DEFINITION, name: 'Other' } }));
    unsent.type('name', 'New name');
    await unsent.send();
    assert.deepEqual(unsent.written, []);
    [...unsent.form().elements].find((item) => item.textContent === 'Cancel').click();
    await tick();
    await click(unsent, 'back');
    assert.equal(listReads(unsent), 1);
});

test('the list is read again after a refused delete, and not after one that was never sent', async () => {
    const refused = await details((path, method) =>
        method === 'DELETE' ? { status: 400, body: { message: 'In use' } } : { body: DEFINITION },
    );
    await refused.press('Delete');
    await refused.press('Delete it');
    assert.deepEqual(refused.written, ['DELETE sms/definitions/welcome']);
    assert.equal(listReads(refused), 1);
    await click(refused, 'back');
    assert.equal(listReads(refused), 2);
    // the check before the delete failed: nothing went out
    const unsent = await details(() => ({ body: { ...DEFINITION, definitionId: 'another' } }));
    await unsent.press('Delete');
    await unsent.press('Delete it');
    assert.deepEqual(unsent.written, []);
    await click(unsent, 'back');
    assert.equal(listReads(unsent), 1);
});

test('a list that was read while a change was on its way is shown, but not kept', async () => {
    const sent = Promise.withResolvers();
    const read = Promise.withResolvers();
    const at = await form('sms', (path, method) => ({
        status: method === 'POST' ? 201 : 200,
        body: { definitions: [] },
    }));
    const quick = at.window.fetch;
    let isHeld = true;
    at.window.fetch = async (url, options) => {
        const response = await quick(url, options);
        if (options.method === 'POST') {
            await sent.promise;
        } else if (isHeld && url.includes('/sms/definitions?')) {
            await read.promise;
        }
        return response;
    };
    fillSms(at);
    at.form().dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    // the reader does not wait for the answer, and the list is asked for before it has come
    await tab(at, 'sms');
    assert.equal(listReads(at), 2);
    sent.resolve();
    await tick();
    await tick();
    read.resolve();
    await tick();
    await tick();
    assert.match(at.text(), /no transactional SMS messages/);
    isHeld = false;
    await tab(at, 'push');
    await tab(at, 'sms');
    // it may have been the list from before the message was created
    assert.equal(listReads(at), 3);
});

/**
 * Reads the note of the pager: which rows of how many are on show.
 *
 * @param {{panel: () => Element}} at the page
 * @returns {string} the note
 */
function range(at) {
    return at.panel().querySelector('.sfmc-ux-tools-transactional-range').textContent;
}

// what a list says of a message: less than its definition holds
const LISTED = ({ name, definitionKey, status, createdDate, modifiedDate }) => ({
    name,
    definitionKey,
    status,
    createdDate,
    modifiedDate,
});
const SMS = (key, more) => ({
    ...ROW(key),
    content: { message: 'text' },
    subscriptions: { shortCode: `code-${key}`, keyword: `KW-${key}` },
    ...more,
});
const PUSHED = (key, appId, customerKey) => ({
    ...ROW(key),
    applicationId: appId,
    content: { customerKey },
});
const CODED = (key, code) => {
    const definition = SMS(key);
    definition.subscriptions.shortCode = code;
    return definition;
};
const NUMBERED = (count) =>
    Array.from({ length: count }, (_, index) => SMS(`m-${String(index).padStart(3, '0')}`));

/**
 * Opens the panel on the list of a kind of message, over an API that hands out the list in
 * pages, with the count of each page, and every definition under its key. The test can hold the
 * reads of single definitions back and let them through, let some of them fail, and change what
 * the API holds.
 *
 * @param {string} kind sms, push or ott
 * @param {object[]} definitions the definitions the API holds
 * @param {{isHeld?: boolean, down?: string[]}} [options] whether a read of a definition waits to be let through, and the lists of names that cannot be read
 * @returns {Promise.<object>} the page, with: held (the definitions by key) and list (the rows of the list), both to be changed; failing (keys that cannot be read); wanted (the keys of the definitions asked for, in that order); flying and most (reads of definitions on their way now, and at most); release (lets held reads through); and ways to look at the list
 */
async function messages(kind, definitions, { isHeld = false, down = [] } = {}) {
    const lists = offering(undefined, down);
    const at = page(MENU, (path, method) => {
        if (!path.startsWith(`${kind}/definitions`)) {
            return path.includes('/definitions')
                ? { body: { definitions: [] } }
                : lists(path, method);
        }
        if (path.includes('?')) {
            const number = Number(/\$page=(\d+)/.exec(path)[1]);
            const found = at.list.slice((number - 1) * LARGEST, number * LARGEST);
            return { body: { definitions: found, count: found.length } };
        }
        const key = decodeURIComponent(path.split('/').at(-1));
        if (method !== 'GET') {
            at.onWrite(key);
            return { status: 200, body: {} };
        }
        return at.failing.has(key) || !at.held.has(key)
            ? { status: 500, body: { message: 'No' } }
            : { body: { requestId: 'r', ...at.held.get(key) } };
    });
    Object.assign(at, {
        held: new Map(definitions.map((definition) => [definition.definitionKey, definition])),
        list: definitions.map((definition) => LISTED(definition)),
        failing: new Set(),
        isHeld,
        wanted: [],
        waiting: [],
        flying: 0,
        most: 0,
        onWrite: () => {},
    });
    const single = new RegExp(`/${kind}/definitions/([^?]+)$`);
    const quick = at.window.fetch;
    at.window.fetch = async (url, options) => {
        const key = options.method === 'GET' && single.exec(url)?.[1];
        if (!key) {
            return quick(url, options);
        }
        at.wanted.push(key);
        at.flying++;
        at.most = Math.max(at.most, at.flying);
        if (at.isHeld) {
            await new Promise((resolve) => {
                at.waiting.push(resolve);
            });
        }
        at.flying--;
        return quick(url, options);
    };
    at.release = async (count = at.waiting.length) => {
        for (const letThrough of at.waiting.splice(0, count)) {
            letThrough();
        }
        await tick();
        await tick();
    };
    at.times = (key) => at.wanted.filter((item) => item === key).length;
    at.names = () => rows(at).map((row) => row.cells[0].textContent);
    at.cells = (from, to) =>
        rows(at).map((row) => [...row.cells].slice(from, to).map((cell) => cell.textContent));
    at.part = (name) => at.panel().querySelector(`.sfmc-ux-tools-transactional-${name}`);
    at.progress = () => (at.part('progress').hidden ? null : at.part('progress').textContent);
    at.look = (text) => {
        at.part('search').value = text;
        at.part('search').dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    at.head = (title) =>
        [...at.panel().querySelectorAll(':scope th button')].find(
            (item) => item.textContent === title,
        );
    at.sorted = () =>
        [...at.panel().querySelectorAll('th')].map((cell) => cell.getAttribute('aria-sort'));
    at.press = async (text) => {
        [...at.panel().querySelectorAll('button')]
            .find((item) => item.textContent === text)
            .click();
        await tick();
        await tick();
    };
    await at.open();
    if (kind !== 'sms') {
        await tab(at, kind);
    }
    return at;
}

// the columns that the details of a message fill: the two after the status
const DETAILS = [3, 5];
const ROWS_SHOWN = 50;

test('a long list is shown in pages of 50 rows, with buttons to turn them and a note of what is on show', async () => {
    const at = await messages('sms', NUMBERED(120));
    const [body, search] = [at.panel().querySelector('tbody'), at.part('search')];
    assert.equal(at.part('pager').hidden, false);
    assert.equal(range(at), '1–50 of 120');
    assert.equal(rows(at).length, ROWS_SHOWN);
    assert.deepEqual([at.part('previous').disabled, at.part('next').disabled], [true, false]);
    assert.deepEqual(
        [at.part('previous').textContent, at.part('next').textContent],
        ['← Previous', 'Next →'],
    );
    // below the table
    assert.equal(
        at.part('pager').previousElementSibling.previousElementSibling.firstElementChild.tagName,
        'TABLE',
    );
    await click(at, 'next');
    assert.equal(range(at), '51–100 of 120');
    assert.equal(at.names()[0], 'name of m-050');
    assert.deepEqual([at.part('previous').disabled, at.part('next').disabled], [false, false]);
    await click(at, 'next');
    assert.equal(range(at), '101–120 of 120');
    assert.equal(rows(at).length, 20);
    assert.deepEqual([at.part('previous').disabled, at.part('next').disabled], [false, true]);
    await click(at, 'previous');
    assert.equal(range(at), '51–100 of 120');
    // only the rows and the pager were drawn again, and the list was read once
    assert.equal(at.panel().querySelector('tbody'), body);
    assert.equal(at.part('search'), search);
    assert.equal(listReads(at), 1);
});

test('searching and sorting take the whole list and go back to its first page', async () => {
    const at = await messages('sms', NUMBERED(120));
    await click(at, 'next');
    await click(at, 'next');
    // found on all pages, shown from the first one
    at.look('m-11');
    assert.equal(rows(at).length, 10);
    assert.equal(at.names()[0], 'name of m-110');
    // what fits on one page needs no pager
    assert.equal(at.part('pager').hidden, true);
    at.look('m-0');
    assert.equal(range(at), '1–50 of 100');
    await click(at, 'next');
    at.look('');
    assert.equal(range(at), '1–50 of 120');
    await click(at, 'next');
    at.head('Name').click();
    assert.equal(range(at), '1–50 of 120');
    assert.equal(at.names()[0], 'name of m-000');
    await click(at, 'next');
    // the last of the whole list comes first, not the last of the page
    at.head('Name').click();
    assert.equal(range(at), '1–50 of 120');
    assert.equal(at.names()[0], 'name of m-119');
    await click(at, 'next');
    assert.equal(at.names()[0], 'name of m-069');
});

test('the page on show is kept with its list, and a list of one page has no pager', async () => {
    const at = await messages('sms', NUMBERED(120));
    await click(at, 'next');
    assert.equal(range(at), '51–100 of 120');
    // another list starts on its own first page
    await tab(at, 'push');
    await tab(at, 'sms');
    assert.equal(range(at), '51–100 of 120');
    await click(at, 'close');
    await at.open();
    assert.equal(range(at), '51–100 of 120');
    await click(at, 'next');
    // a list that got shorter shows its last page in place of one that is gone
    at.list = at.list.slice(0, 60);
    await click(at, 'refresh');
    assert.equal(range(at), '51–60 of 60');
    at.list = at.list.slice(0, ROWS_SHOWN);
    await click(at, 'refresh');
    assert.equal(rows(at).length, ROWS_SHOWN);
    assert.equal(at.part('pager').hidden, true);
    const few = await messages('push', [PUSHED('r1', 'app-1', 'k')]);
    assert.equal(few.part('pager').hidden, true);
});

test('the details of a message are read once and used again after "Refresh"; only a new message and one that was changed are read', async () => {
    const at = await messages('sms', [SMS('a'), SMS('b'), SMS('c')]);
    assert.deepEqual(at.wanted, ['a', 'b', 'c']);
    assert.deepEqual(at.cells(...DETAILS), [
        ['code-a', 'KW-a'],
        ['code-b', 'KW-b'],
        ['code-c', 'KW-c'],
    ]);
    // the code and the keyword of an SMS message are shown as they are, with nothing behind them
    assert.equal(rows(at)[0].cells[DETAILS[0]].title, '');
    await click(at, 'refresh');
    await tab(at, 'push');
    await tab(at, 'sms');
    assert.equal(listReads(at), 2);
    assert.deepEqual(at.wanted, ['a', 'b', 'c']);
    assert.deepEqual(at.cells(...DETAILS)[1], ['code-b', 'KW-b']);
    // changed by someone else: the list says so by its date
    const changed = SMS('b', { modifiedDate: '2026-02-01T10:00:00' });
    changed.subscriptions.keyword = 'OTHER';
    at.held.set('b', changed);
    at.held.set('d', SMS('d'));
    at.list = at.held
        .values()
        .map((definition) => LISTED(definition))
        .toArray();
    await click(at, 'refresh');
    assert.deepEqual(at.wanted, ['a', 'b', 'c', 'b', 'd']);
    assert.deepEqual(at.cells(...DETAILS), [
        ['code-a', 'KW-a'],
        ['code-b', 'OTHER'],
        ['code-c', 'KW-c'],
        ['code-d', 'KW-d'],
    ]);
    assert.equal(at.progress(), null);
});

test('a message that was changed here is read again, although the list has the same date for it', async () => {
    // without the list of keywords the keyword stays a field to type into
    const at = await messages('sms', [SMS('a'), SMS('b')], { down: [KEYWORDS] });
    rows(at)[0].click();
    await tick();
    await at.press('Edit');
    const form = at.panel().querySelector('form');
    form.elements['subscriptions.keyword'].value = 'NEW';
    // within the minute of the change before: the date of the list stays as it is
    at.onWrite = (key) => {
        const stored = SMS(key);
        stored.subscriptions.keyword = 'NEW';
        at.held.set(key, stored);
    };
    form.dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    await tick();
    await tick();
    assert.match(at.text(), /^Saved “name of a”/);
    const before = at.times('a');
    await click(at, 'back');
    assert.equal(listReads(at), 2);
    assert.equal(at.times('a'), before + 1);
    assert.equal(at.times('b'), 1);
    assert.deepEqual(at.cells(...DETAILS), [
        ['code-a', 'NEW'],
        ['code-b', 'KW-b'],
    ]);
});

test('details that were opened are fresh every time, and the list shows what they read', async () => {
    const at = await messages('sms', [SMS('a'), SMS('b')]);
    at.failing.add('b');
    await click(at, 'refresh');
    // a list that is read again shows what was read of its messages before, and asks for none
    assert.deepEqual(at.cells(...DETAILS)[1], ['code-b', 'KW-b']);
    const fresh = await messages('sms', [SMS('a'), SMS('b')]);
    assert.deepEqual([fresh.times('a'), fresh.times('b')], [1, 1]);
    // what Marketing Cloud holds now, not what the list has read
    const other = SMS('b');
    other.subscriptions.keyword = 'LATER';
    fresh.held.set('b', other);
    rows(fresh)[1].click();
    await tick();
    assert.equal(fresh.times('b'), 2);
    assert.match(fresh.text(), /LATER/);
    await click(fresh, 'back');
    // the list uses them, without asking again
    assert.deepEqual(fresh.cells(...DETAILS)[1], ['code-b', 'LATER']);
    assert.equal(fresh.times('b'), 2);
    assert.equal(listReads(fresh), 1);
});

test('another business unit forgets the details that were read', async () => {
    const at = await messages('sms', [SMS('a'), SMS('b')]);
    assert.deepEqual(at.wanted, ['a', 'b']);
    await click(at, 'close');
    // the menu is drawn again, as after a change of the business unit
    at.document.body.insertAdjacentHTML('beforeend', MENU);
    at.document.querySelector('[data-sfmc-ux-tools-transactional]').closest('ul').remove();
    await at.open();
    assert.deepEqual(at.wanted, ['a', 'b', 'a', 'b']);
    assert.deepEqual(at.cells(...DETAILS)[0], ['code-a', 'KW-a']);
});

test('the details of all messages are read in the background, four at a time, those of the page on show first', async () => {
    const definitions = NUMBERED(120);
    const keys = definitions.map((definition) => definition.definitionKey);
    const at = await messages('sms', definitions, { isHeld: true });
    // the list is on show before any of them has come
    assert.equal(rows(at).length, ROWS_SHOWN);
    assert.deepEqual(at.cells(...DETAILS)[0], ['', '']);
    assert.deepEqual(at.wanted, keys.slice(0, 4));
    assert.equal(at.flying, 4);
    // what the reader looks at now comes next
    await click(at, 'next');
    await at.release(4);
    assert.deepEqual(at.wanted.slice(4), keys.slice(50, 54));
    assert.equal(at.flying, 4);
    at.isHeld = false;
    await at.release();
    assert.equal(at.flying, 0);
    assert.equal(at.most, 4);
    // then the rest, in the order of the list, and each of them once
    assert.deepEqual(at.wanted, [
        ...keys.slice(0, 4),
        ...keys.slice(50, 100),
        ...keys.slice(4, 50),
        ...keys.slice(100),
    ]);
    assert.deepEqual(at.cells(...DETAILS)[0], ['code-m-050', 'KW-m-050']);
    assert.equal(at.progress(), null);
    // the list itself was read once, whole
    assert.equal(listReads(at), 1);
    assert.equal(range(at), '51–100 of 120');
});

test('the reading of details pauses when the list is left or the panel closed, and goes on where it stopped', async () => {
    const definitions = NUMBERED(120);
    const keys = definitions.map((definition) => definition.definitionKey);
    const at = await messages('sms', definitions, { isHeld: true });
    await tab(at, 'push');
    await at.release();
    // what was on its way is kept, and nothing more is asked for
    assert.deepEqual(at.wanted, keys.slice(0, 4));
    await tab(at, 'sms');
    assert.deepEqual(at.wanted, keys.slice(0, 8));
    assert.equal(at.progress(), 'details 4 of 120');
    assert.deepEqual(at.cells(...DETAILS)[0], ['code-m-000', 'KW-m-000']);
    await click(at, 'close');
    await at.release();
    assert.equal(at.wanted.length, 8);
    await at.open();
    assert.deepEqual(at.wanted, keys.slice(0, 12));
    assert.equal(at.progress(), 'details 8 of 120');
    // the details of a message stop it as well
    rows(at)[0].click();
    await tick();
    // the message that is opened does not wait for the four that are on their way
    assert.equal(at.flying, 5);
    await at.release();
    assert.deepEqual(at.wanted, [...keys.slice(0, 12), keys[0]]);
    await click(at, 'back');
    assert.equal(at.wanted.length, 17);
    at.most = 0;
    // a list that is shown again while its details are on their way waits for them
    await tab(at, 'push');
    await tab(at, 'sms');
    assert.equal(at.wanted.length, 17);
    assert.equal(at.flying, 4);
    await at.release();
    assert.deepEqual(at.cells(...DETAILS)[12], ['code-m-012', 'KW-m-012']);
    at.isHeld = false;
    await at.release();
    assert.equal(at.most, 4);
    assert.equal(at.progress(), null);
    // every message was asked for once, and the one that was opened once more
    assert.equal(at.wanted.length, keys.length + 1);
    assert.equal(new Set(at.wanted).size, keys.length);
});

test('details that cannot be read leave their cells empty, keep the others coming and are asked for again when the list is shown next', async () => {
    const down = await messages('sms', [SMS('a'), SMS('b'), SMS('c')], { isHeld: true });
    down.failing.add('b');
    await down.release();
    assert.deepEqual(down.cells(...DETAILS), [
        ['code-a', 'KW-a'],
        ['', ''],
        ['code-c', 'KW-c'],
    ]);
    assert.equal(down.progress(), 'details 2 of 3');
    assert.match(down.part('progress').title, /could not be read/);
    assert.deepEqual(down.wanted, ['a', 'b', 'c']);
    down.failing.clear();
    down.isHeld = false;
    await tab(down, 'push');
    await tab(down, 'sms');
    assert.deepEqual(down.wanted, ['a', 'b', 'c', 'b']);
    assert.deepEqual(down.cells(...DETAILS)[1], ['code-b', 'KW-b']);
    assert.equal(down.progress(), null);
});

test('the bar says how many details are read while they come, and the cells fill in where they stand', async () => {
    const at = await messages('sms', NUMBERED(6), { isHeld: true });
    const progress = at.part('progress');
    // in the bar, before the search
    assert.equal(progress.parentElement.className, 'sfmc-ux-tools-transactional-bar');
    assert.equal(progress.nextElementSibling, at.part('search'));
    assert.equal(at.progress(), 'details 0 of 6');
    assert.equal(progress.title, '');
    at.part('search').focus();
    const before = rows(at);
    await at.release(4);
    assert.equal(at.progress(), 'details 4 of 6');
    assert.equal(progress.title, '');
    assert.deepEqual(
        at.cells(...DETAILS).map(([code]) => code),
        ['code-m-000', 'code-m-001', 'code-m-002', 'code-m-003', '', ''],
    );
    // the rows are the ones that stood there, and the field typed into is still in use
    assert.ok(rows(at).every((row, index) => row === before[index]));
    assert.equal(at.document.activeElement, at.part('search'));
    await at.release();
    assert.equal(at.progress(), null);
    assert.ok(rows(at).every((row, index) => row === before[index]));
    // a list without messages, and one whose kind has no such columns, say nothing
    const none = await messages('sms', []);
    assert.equal(none.part('progress'), null);
    const ott = await messages('ott', [ROW('x')]);
    assert.equal(ott.progress(), null);
});

test('a push list names the app and the content of a message, with the id and the key to be read on them', async () => {
    const definitions = [
        PUSHED('r1', 'app-2', 'receipt_push'),
        PUSHED('r2', 'app-9', 'other_key'),
        { ...ROW('r3') },
    ];
    const at = await messages('push', definitions);
    const titles = (of) =>
        rows(of).map((row) => [...row.cells].slice(...DETAILS).map((cell) => cell.title));
    assert.deepEqual(
        [...at.panel().querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Key', 'Status', 'App', 'Content', 'Created', 'Modified'],
    );
    assert.deepEqual(at.cells(...DETAILS), [
        ['Staff app', 'Receipt'],
        // what the lists of the business unit do not hold is shown as it is stored
        ['app-9', 'other_key'],
        ['', ''],
    ]);
    assert.deepEqual(titles(at), [
        ['app-2', 'receipt_push'],
        ['app-9', 'other_key'],
        ['', ''],
    ]);
    // the lists of names are read once for the list of messages
    assert.deepEqual([reads(at, APPS), reads(at, CONTENTS)], [1, 1]);
    // without a list of names, the id stays
    const down = await messages('push', definitions, { down: [APPS] });
    assert.deepEqual(down.cells(...DETAILS)[0], ['app-2', 'Receipt']);
    assert.deepEqual(titles(down)[0], ['app-2', 'receipt_push']);
    // names that come after the details fill in as well
    const late = await messages('push', definitions);
    const gate = Promise.withResolvers();
    const quick = late.window.fetch;
    late.window.fetch = async (url, options) => {
        if (url.includes(APPS)) {
            await gate.promise;
        }
        return quick(url, options);
    };
    await click(late, 'refresh');
    assert.deepEqual(late.cells(...DETAILS)[0], ['app-2', 'Receipt']);
    const before = rows(late);
    gate.resolve();
    await tick();
    assert.deepEqual(late.cells(...DETAILS)[0], ['Staff app', 'Receipt']);
    assert.ok(rows(late).every((row, index) => row === before[index]));
});

test('an SMS list shows the code and the keyword, and an OTT list is as it was and reads no details', async () => {
    const sms = await messages('sms', [SMS('a')]);
    assert.deepEqual(
        [...sms.panel().querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Key', 'Status', 'Code', 'Keyword', 'Created', 'Modified'],
    );
    assert.deepEqual(sms.cells(...DETAILS), [['code-a', 'KW-a']]);
    // it names nothing, and reads no list of names for its rows
    assert.deepEqual(sms.looked, []);
    const ott = await messages('ott', [ROW('x'), ROW('y')]);
    assert.deepEqual(
        [...ott.panel().querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Key', 'Status', 'Created', 'Modified'],
    );
    assert.equal(rows(ott)[0].cells.length, 5);
    assert.deepEqual(ott.wanted, []);
    assert.equal(ott.part('search').placeholder, 'Search name or key');
});

test('the search also finds a message by what its details show: the value and its name', async () => {
    const push = await messages('push', [
        PUSHED('r1', 'app-2', 'receipt_push'),
        PUSHED('r2', 'app-9', 'other_key'),
    ]);
    assert.equal(push.part('search').placeholder, 'Search name, key, app, or content');
    assert.equal(
        push.part('search').getAttribute('aria-label'),
        'Search the Push messages by name, key, app, or content',
    );
    for (const [text, found] of [
        ['staff', ['name of r1']],
        ['APP-2', ['name of r1']],
        ['receipt_p', ['name of r1']],
        ['Receipt', ['name of r1']],
        ['other_', ['name of r2']],
        ['app', ['name of r1', 'name of r2']],
        ['nothing', []],
    ]) {
        push.look(text);
        assert.deepEqual(push.names(), found, text);
    }
    // a message whose details are not read yet is found by them once they have come
    const first = SMS('a', { name: 'x1 first' });
    const second = SMS('b');
    second.subscriptions.keyword = 'X1WORD';
    const sms = await messages('sms', [first, second, SMS('c')], { isHeld: true });
    sms.look('x1');
    assert.deepEqual(sms.names(), ['x1 first']);
    // the row in use stays in use when the rows are drawn again
    rows(sms)[0].focus();
    assert.equal(sms.document.activeElement, rows(sms)[0]);
    await sms.release();
    assert.deepEqual(sms.names(), ['x1 first', 'name of b']);
    assert.equal(sms.document.activeElement, rows(sms)[0]);
    assert.equal(sms.part('search').value, 'x1');
    sms.look('code-c');
    assert.deepEqual(sms.names(), ['name of c']);
});

test('a column of details can be sorted by once the details of all messages are read', async () => {
    const at = await messages('sms', [CODED('a', '300'), CODED('b', '100'), CODED('c', '200')], {
        isHeld: true,
    });
    for (const title of ['Code', 'Keyword']) {
        assert.equal(at.head(title).disabled, true, title);
        assert.match(at.head(title).title, /once the details of all messages are read/);
    }
    assert.equal(at.head('Name').disabled, false);
    assert.match(at.head('Name').title, /^Sort by this column/);
    await at.release(2);
    assert.equal(at.head('Code').disabled, true);
    await at.release();
    assert.equal(at.head('Code').disabled, false);
    assert.match(at.head('Code').title, /^Sort by this column/);
    at.head('Code').click();
    assert.deepEqual(at.names(), ['name of b', 'name of c', 'name of a']);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'ascending', 'none', 'none', 'none']);
    at.head('Code').click();
    assert.deepEqual(at.names(), ['name of a', 'name of c', 'name of b']);
    at.head('Code').click();
    // a list that is read again with a message whose details are missing waits for them
    at.held.set('d', CODED('d', '050'));
    at.list = at.held
        .values()
        .map((definition) => LISTED(definition))
        .toArray();
    await click(at, 'refresh');
    assert.deepEqual(at.names(), ['name of a', 'name of b', 'name of c', 'name of d']);
    assert.equal(at.head('Code').disabled, true);
    assert.deepEqual(at.sorted(), ['none', 'none', 'none', 'none', 'none', 'none', 'none']);
    await at.release();
    assert.deepEqual(at.names(), ['name of d', 'name of b', 'name of c', 'name of a']);
    assert.equal(at.sorted()[DETAILS[0]], 'ascending');
    // a push list is sorted by the names it shows
    const push = await messages('push', [
        PUSHED('r1', 'app-2', 'k1'),
        PUSHED('r2', 'app-1', 'k2'),
        PUSHED('r3', 'app-0', 'k3'),
    ]);
    push.head('App').click();
    // "app-0" has no name, "Shop app" is app-1 and "Staff app" is app-2
    assert.deepEqual(push.names(), ['name of r3', 'name of r2', 'name of r1']);
});

test('the entry and the panel carry the icon of the extension, which names it', async () => {
    const at = page(MENU);
    const manifest = JSON.parse(read('../src/manifest.json'));
    await at.open();
    const inMenu = at.entry().lastElementChild;
    assert.equal(inMenu.tagName, 'IMG');
    const inPanel = at
        .panel()
        .querySelector('.sfmc-ux-tools-transactional-made-by').firstElementChild;
    for (const image of [inMenu, inPanel]) {
        assert.equal(image.src, 'chrome-extension://id/icons/icon16.png');
        assert.equal(image.alt, 'SFMC UX Tools');
        assert.equal(image.title, 'SFMC UX Tools');
    }
    // after the name of the entry
    assert.equal(inMenu.previousElementSibling.textContent, 'Transactional Messages');
    assert.equal(
        at.panel().querySelector('.sfmc-ux-tools-transactional-made-by').textContent,
        'SFMC UX Tools',
    );
    // the header stays while the list and the details change below it
    await tab(at, 'ott');
    assert.equal(inPanel.isConnected, true);
    // a page may load that one file of the extension; the pages with a code editor show it in
    // the boxes of the language features. The page of the panel may also load the code editor
    // of a message, which has a test of its own
    assert.deepEqual(manifest.web_accessible_resources, [
        {
            resources: ['icons/icon16.png'],
            matches: [
                'https://*.exacttarget.com/*',
                'https://*.marketingcloudapps.com/*',
                'https://*.lightning.force.com/*',
            ],
        },
        {
            resources: EDITOR_FILES,
            matches: ['https://*.exacttarget.com/*'],
        },
    ]);
    // every box of the language features carries it in its corner, at its 16 pixels
    const css = read('../src/editor-highlight.css');
    const rule = /html \.sfmc-tooltip::before \{([^}]*)\}/.exec(css)[1];
    assert.match(rule, /float: right;/);
    assert.match(rule, /width: 16px;\s+height: 16px;/);
    assert.match(rule, /chrome-extension:\/\/__MSG_@@extension_id__\/icons\/icon16\.png/);
    assert.equal(manifest.icons['16'], 'icons/icon16.png');
});

const APP_FIELD = 'applicationId';
const ACTIVE = 'sfmc-ux-tools-transactional-combo-active';
const STATUS = '.sfmc-ux-tools-transactional-combo-status';

/**
 * Sends an event to an element.
 *
 * @param {Element} target the element
 * @param {Event} event the event
 * @returns {Event} the event, to see what became of it
 */
function fire(target, event) {
    target.dispatchEvent(event);
    return event;
}

/**
 * Gives a page with a form ways to use the list below one of its fields.
 *
 * @param {object} at the page with the form
 * @param {string} [path] name of the field
 * @returns {object} the field, and ways to read and to use its list
 */
function picker(at, path = APP_FIELD) {
    const input = at.field(path);
    const list = listOf(input);
    const drop = list?.parentElement;
    return {
        input,
        list,
        isOpen: () => !drop.hidden && input.getAttribute('aria-expanded') === 'true',
        // the entries on show: id or key, name, whether it is what the field holds
        shown: () =>
            [...list.children].map((item) => [
                item.lastElementChild.textContent,
                item.firstElementChild.textContent,
                item.getAttribute('aria-selected') === 'true',
            ]),
        status: () => {
            const place = drop.querySelector(STATUS);
            return place.hidden ? null : place.textContent;
        },
        // the entry the arrow keys are at, by its id or key
        at: () => {
            const id = input.getAttribute('aria-activedescendant');
            const item = id ? at.document.querySelector(`#${id}`) : null;
            assert.equal(item?.classList.contains(ACTIVE) ?? false, Boolean(id));
            assert.equal(list.querySelectorAll(`.${ACTIVE}`).length, id ? 1 : 0);
            return item ? item.lastElementChild.textContent : null;
        },
        click: () => fire(input, new at.window.MouseEvent('click', { bubbles: true })),
        key: (key) =>
            fire(
                input,
                new at.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
            ),
        pick: (value) =>
            fire(
                [...list.children].find((item) => item.lastElementChild.textContent === value),
                new at.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
            ),
    };
}

/**
 * Opens the form that changes the push definition "receipt", whose app is "app-2".
 *
 * @returns {Promise.<object>} the page, with ways to reach the fields and to send the form
 */
async function editingPush() {
    const at = await pushDetails();
    [...at.panel().querySelectorAll('button')].find((item) => item.textContent === 'Edit').click();
    await tick();
    await tick();
    at.form = () => at.panel().querySelector('form');
    at.field = (path) => at.form().elements[path];
    at.send = async () => {
        at.form().dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
        await tick();
        await tick();
        await tick();
    };
    at.changes = () =>
        at.calls.filter((call) => call.method !== 'GET').map((call) => JSON.parse(call.body));
    return at;
}

const ALL_APPS = [
    ['app-1', 'Shop app', false],
    ['app-2', 'Staff app', false],
];

test('the list of a field is part of the form, below the field, and the field says so to a screen reader', async () => {
    const at = await form('push', offering());
    await tick();
    const { input, list, isOpen } = picker(at);
    const row = input.closest(FIELD);
    assert.equal(at.form().querySelector('datalist'), null);
    assert.equal(input.hasAttribute('list'), false);
    assert.equal(input.type, 'text');
    assert.equal(input.getAttribute('role'), 'combobox');
    assert.equal(input.getAttribute('aria-autocomplete'), 'list');
    assert.equal(input.getAttribute('aria-controls'), list.id);
    assert.equal(input.getAttribute('aria-expanded'), 'false');
    assert.equal(isOpen(), false);
    // in the flow of the form, right after the field: nothing that floats over the panel
    assert.equal(input.nextElementSibling, list.parentElement);
    assert.ok(row.contains(list));
    assert.deepEqual(
        [...list.children].map((item) => item.getAttribute('role')),
        ['option', 'option'],
    );
    assert.equal(new Set([...list.children].map((item) => item.id)).size, 2);
    // the words of the field are its label
    assert.equal(row.querySelector('label').htmlFor, input.id);
    assert.equal(row.querySelector('label').textContent, 'App *');
    // every field with such a list has one of its own
    const content = picker(at, 'content.customerKey');
    assert.notEqual(content.list.id, list.id);
    assert.deepEqual(content.shown(), [['receipt_push', 'Receipt', false]]);
    // the lists to choose a code and a keyword from stay what they were
    const sms = await form('sms', offering());
    await tick();
    assert.equal(sms.field('subscriptions.shortCode').tagName, 'SELECT');
    assert.equal(sms.form().querySelector(`${FIELD} [role="listbox"]`), null);
});

test('the list opens on focus and on every click, always with all entries, and marks what the field holds', async () => {
    const at = await form('push', offering());
    await tick();
    const app = picker(at);
    app.input.focus();
    assert.equal(app.isOpen(), true);
    assert.deepEqual(app.shown(), ALL_APPS);
    assert.equal(app.status(), null);
    assert.equal(app.at(), null);
    app.input.blur();
    assert.equal(app.isOpen(), false);
    // a value that narrows the list down to one entry: a click still shows them all
    app.input.focus();
    at.type(APP_FIELD, 'app-2');
    assert.deepEqual(app.shown(), [['app-2', 'Staff app', true]]);
    app.key('Escape');
    assert.equal(app.isOpen(), false);
    app.click();
    assert.equal(app.isOpen(), true);
    assert.deepEqual(app.shown(), [ALL_APPS[0], ['app-2', 'Staff app', true]]);
    // the keys start at it, and it is scrolled to
    assert.equal(app.at(), 'app-2');
    assert.equal(at.window.scrolled.at(-1), app.input.getAttribute('aria-activedescendant'));
    // a click into the open list of a field that holds something leaves all of it there
    app.click();
    assert.equal(app.shown().length, 2);
    // the same in the form of a message that exists
    const stored = await editingPush();
    const kept = picker(stored);
    kept.input.focus();
    assert.equal(kept.isOpen(), true);
    assert.deepEqual(kept.shown(), [ALL_APPS[0], ['app-2', 'Staff app', true]]);
    assert.equal(kept.at(), 'app-2');
});

test('typing narrows the list down by name and by id or key, whatever the case, and an emptied field shows all again', async () => {
    const at = await form('push', offering());
    await tick();
    const app = picker(at);
    app.input.focus();
    at.type(APP_FIELD, 'sHOP');
    assert.equal(app.isOpen(), true);
    assert.deepEqual(app.shown(), [ALL_APPS[0]]);
    at.type(APP_FIELD, ' APP-2 ');
    assert.deepEqual(app.shown(), [ALL_APPS[1]]);
    at.type(APP_FIELD, 'app');
    assert.deepEqual(app.shown(), ALL_APPS);
    // nothing is put where the keys are until the user moves there
    assert.equal(app.at(), null);
    at.type(APP_FIELD, 'nothing like it');
    assert.deepEqual(app.shown(), []);
    assert.match(app.status(), /Nothing in the list matches/);
    assert.equal(app.input.value, 'nothing like it');
    at.type(APP_FIELD, '');
    assert.deepEqual(app.shown(), ALL_APPS);
    assert.equal(app.status(), null);
    // typing opens a list that was closed
    app.key('Escape');
    at.type(APP_FIELD, 'staff');
    assert.equal(app.isOpen(), true);
    assert.deepEqual(app.shown(), [ALL_APPS[1]]);
});

test('the arrow keys move through the list, Enter chooses without sending the form, Escape closes the list and not the panel', async () => {
    const at = await form('push', offering());
    await tick();
    const app = picker(at);
    let submits = 0;
    let escapes = 0;
    at.form().addEventListener('submit', () => submits++);
    at.panel().addEventListener('keydown', (event) => {
        escapes += event.key === 'Escape' ? 1 : 0;
    });
    app.input.focus();
    assert.equal(app.key('ArrowDown').defaultPrevented, true);
    assert.equal(app.at(), 'app-1');
    app.key('ArrowDown');
    assert.equal(app.at(), 'app-2');
    assert.equal(at.window.scrolled.at(-1), app.input.getAttribute('aria-activedescendant'));
    // round the ends
    app.key('ArrowDown');
    assert.equal(app.at(), 'app-1');
    assert.equal(app.key('ArrowUp').defaultPrevented, true);
    assert.equal(app.at(), 'app-2');
    app.key('ArrowUp');
    assert.equal(app.at(), 'app-1');
    // moving alone changes nothing
    assert.equal(app.input.value, '');
    const enter = app.key('Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(app.input.value, 'app-1');
    assert.equal(app.isOpen(), false);
    assert.equal(app.input.hasAttribute('aria-activedescendant'), false);
    // with the list closed, Enter is the form's again
    assert.equal(app.key('Enter').defaultPrevented, false);
    // an arrow key opens the list again, on what the field holds
    app.key('ArrowUp');
    assert.equal(app.isOpen(), true);
    assert.deepEqual(app.shown(), [['app-1', 'Shop app', true], ALL_APPS[1]]);
    assert.equal(app.at(), 'app-1');
    const escape = app.key('Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(escapes, 0);
    assert.equal(app.isOpen(), false);
    assert.equal(at.panel().hasAttribute('open'), true);
    assert.ok(at.form().isConnected);
    // with the list closed, Escape is the panel's again
    assert.equal(app.key('Escape').defaultPrevented, false);
    assert.equal(escapes, 1);
    // Enter in an open list with nothing chosen closes it and keeps what was typed
    at.type(APP_FIELD, 'my-own');
    assert.equal(app.isOpen(), true);
    assert.equal(app.key('Enter').defaultPrevented, true);
    assert.equal(app.isOpen(), false);
    assert.equal(app.input.value, 'my-own');
    // Tab leaves the field as ever, and the list closes
    app.key('ArrowDown');
    assert.equal(app.isOpen(), true);
    assert.equal(app.key('Tab').defaultPrevented, false);
    assert.equal(app.isOpen(), false);
    assert.equal(submits, 0);
    assert.deepEqual(at.written, []);
});

test('an entry is chosen with the mouse before the field loses the focus, and the form and the name under the field hear of it', async () => {
    const at = await form('push', offering());
    await tick();
    const app = picker(at);
    const heard = [];
    for (const type of ['input', 'change']) {
        at.form().addEventListener(type, (event) => {
            heard.push(`${type} ${event.target.name}`);
        });
    }
    const named = () => {
        const place = app.input.closest(FIELD).querySelector(RESOLVED);
        return place.hidden ? null : place.textContent;
    };
    app.input.focus();
    const down = app.pick('app-2');
    // the focus stays in the field, so the list is still there when the click lands
    assert.equal(down.defaultPrevented, true);
    assert.equal(at.document.activeElement, app.input);
    assert.equal(app.input.value, 'app-2');
    assert.deepEqual(heard, [`input ${APP_FIELD}`, `change ${APP_FIELD}`]);
    assert.equal(named(), 'Staff app');
    assert.equal(app.isOpen(), false);
    // the next click offers everything again, the chosen one marked
    app.click();
    assert.deepEqual(app.shown(), [ALL_APPS[0], ['app-2', 'Staff app', true]]);
    app.pick('app-1');
    assert.equal(named(), 'Shop app');
    // what is sent is the id and the key, as ever
    at.type('name', 'Receipt');
    picker(at, 'content.customerKey').pick('receipt_push');
    await at.send();
    assert.deepEqual(at.sent(), [
        {
            name: 'Receipt',
            definitionKey: 'Receipt',
            status: 'Active',
            applicationId: 'app-1',
            content: { customerKey: 'receipt_push' },
        },
    ]);
});

test('a field with a list takes and sends what no entry has', async () => {
    const at = await form('push', offering());
    await tick();
    at.type('name', 'Receipt');
    picker(at).input.focus();
    at.type(APP_FIELD, ' 7d00d57d-0d94-4a5d-85bd-b51a47ba1b9f ');
    picker(at).input.blur();
    at.type('content.customerKey', 'a key of my own');
    await at.send();
    assert.equal(at.sent()[0].applicationId, '7d00d57d-0d94-4a5d-85bd-b51a47ba1b9f');
    assert.deepEqual(at.sent()[0].content, { customerKey: 'a key of my own' });
});

test('looking at the lists of a message that exists changes nothing, and a chosen entry is sent alone', async () => {
    const at = await editingPush();
    const app = picker(at);
    const content = picker(at, 'content.customerKey');
    for (const one of [app, content]) {
        one.input.focus();
        one.click();
        one.key('ArrowDown');
        one.key('Escape');
        one.input.blur();
    }
    assert.equal(app.input.value, 'app-2');
    assert.equal(content.input.value, 'receipt_push');
    await at.send();
    assert.deepEqual(at.changes(), []);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // choosing what the field holds already is no change either
    app.click();
    app.pick('app-2');
    await at.send();
    assert.deepEqual(at.changes(), []);
    app.click();
    app.pick('app-1');
    await at.send();
    assert.deepEqual(at.changes(), [{ applicationId: 'app-1' }]);
});

test('a field whose list cannot be read is a plain text field with a note', async () => {
    const at = await form('push', offering(DEFINITION, [APPS]));
    await tick();
    const input = at.field(APP_FIELD);
    const row = input.closest(FIELD);
    assert.equal(listOf(input), null);
    for (const name of ['role', 'aria-expanded', 'aria-controls', 'aria-autocomplete']) {
        assert.equal(input.hasAttribute(name), false, name);
    }
    assert.match(row.textContent, /The list to choose from could not be read\./);
    // nothing opens, and the keys are the form's
    input.focus();
    input.dispatchEvent(new at.window.MouseEvent('click', { bubbles: true }));
    for (const key of ['ArrowDown', 'Enter', 'Escape']) {
        const event = new at.window.KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, key);
    }
    assert.equal(row.querySelector('[role="option"]'), null);
    // the other field has its list
    assert.deepEqual(picker(at, 'content.customerKey').shown(), [
        ['receipt_push', 'Receipt', false],
    ]);
    at.type('name', 'Receipt');
    at.type(APP_FIELD, 'app-1');
    at.type('content.customerKey', 'receipt_push');
    await at.send();
    assert.equal(at.sent()[0].applicationId, 'app-1');
});

test('a list that is still being read says so, and keeps what was typed and stays open when its entries come', async () => {
    const gate = Promise.withResolvers();
    // no message is listed, so nothing but the form asks for the apps
    const at = page(MENU, (path, method) =>
        path.startsWith('push/definitions?')
            ? { body: { definitions: [] } }
            : offering()(path, method),
    );
    await at.open();
    await tab(at, 'push');
    const quick = at.window.fetch;
    at.window.fetch = async (url, options) => {
        if (url.includes(APPS)) {
            await gate.promise;
        }
        return quick(url, options);
    };
    await click(at, 'new');
    at.form = () => at.panel().querySelector('form');
    at.field = (path) => at.form().elements[path];
    const app = picker(at);
    app.input.focus();
    assert.equal(app.isOpen(), true);
    assert.equal(app.status(), 'reading …');
    assert.deepEqual(app.shown(), []);
    app.input.value = 'staff';
    app.input.dispatchEvent(new at.window.Event('input', { bubbles: true }));
    assert.equal(app.status(), 'reading …');
    gate.resolve();
    await tick();
    await tick();
    assert.equal(app.isOpen(), true);
    assert.equal(app.input.value, 'staff');
    assert.deepEqual(app.shown(), [ALL_APPS[1]]);
    assert.equal(app.status(), null);
    // a business unit without any says so, and its field still takes what is typed
    const none = await form('push', (path) =>
        path.startsWith(APPS) ? { body: [] } : offering()(path, 'GET'),
    );
    await tick();
    const empty = picker(none);
    empty.input.focus();
    assert.match(empty.status(), /nothing to choose from/);
    none.type(APP_FIELD, 'app-9');
    assert.equal(empty.input.value, 'app-9');
});

/**
 * Reads the stylesheet of the panel without its comments.
 *
 * @returns {{css: string, rule: (selector: string) => string}} the rules, and what one of them sets
 */
function stylesheet() {
    const css = read('../src/transactional-messages.css').replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const rule = (selector) => {
        const found = css
            .matchAll(/([^{}]+)\{([^}]*)\}/g)
            .find(([, list]) => list.split(',').some((one) => one.trim() === selector));
        assert.ok(found, selector);
        return found[2];
    };
    return { css, rule };
}

test('an entry of a list is shown whole, and the list scrolls by itself', () => {
    const { css, rule } = stylesheet();
    const option = rule('.sfmc-ux-tools-transactional-combo-option');
    assert.match(option, /overflow-wrap:\s*anywhere/);
    assert.match(option, /white-space:\s*normal/);
    // nothing of the panel is cut short with dots or kept on one line
    assert.doesNotMatch(css, /text-overflow|nowrap/);
    const list = rule('.sfmc-ux-tools-transactional-combo-list');
    assert.match(list, /max-height:/);
    assert.match(list, /overflow-y:\s*auto/);
    // in the flow of the form: the panel cannot cut it off
    assert.doesNotMatch(rule('.sfmc-ux-tools-transactional-combo-drop'), /position/);
});

const LISTING = 'sfmc-ux-tools-transactional-listing';

test('in a list only the rows scroll: the table alone is in the place that scrolls, the bar and the pager are outside it', async () => {
    const at = await messages('sms', NUMBERED(120));
    const scroll = at.part('rows');
    const body = at.part('body');
    // the table and nothing else
    assert.deepEqual(
        [...scroll.children].map((item) => item.tagName),
        ['TABLE'],
    );
    assert.equal(scroll.firstElementChild, at.panel().querySelector('table'));
    assert.ok(scroll.querySelector(':scope thead th'));
    // the bar above it, the pager below it, all of them straight in the body of the panel
    assert.deepEqual(
        [...body.children].map((item) =>
            item.className.replace('sfmc-ux-tools-transactional-', ''),
        ),
        ['bar', 'rows', 'hint', 'pager'],
    );
    for (const part of ['new', 'refresh', 'read', 'progress', 'search']) {
        assert.equal(at.part(part).parentElement, at.part('bar'), part);
    }
    assert.equal(at.part('pager').hidden, false);
    // the head of the panel and the tabs are outside the body, which is the last of the panel
    assert.deepEqual(
        [...at.panel().children].map((item) =>
            item.className.replace('sfmc-ux-tools-transactional-', ''),
        ),
        ['head', 'tabs', 'note', 'body'],
    );
    // the panel is told that it shows a list, and keeps that through searching and paging
    assert.equal(at.panel().classList.contains(LISTING), true);
    await click(at, 'next');
    assert.equal(at.panel().classList.contains(LISTING), true);
    assert.equal(at.part('rows'), scroll);
});

test('the details, the forms and an empty list scroll as the panel does, and a list after them is a list again', async () => {
    const at = await messages('sms', NUMBERED(3));
    const isListing = () => at.panel().classList.contains(LISTING);
    assert.equal(isListing(), true);
    rows(at)[0].click();
    await tick();
    await tick();
    assert.ok(at.panel().querySelector('dl'));
    assert.equal(isListing(), false);
    await click(at, 'back');
    assert.equal(isListing(), true);
    await click(at, 'new');
    assert.ok(at.panel().querySelector('form'));
    assert.equal(isListing(), false);
    // a list without messages has no rows to scroll
    await tab(at, 'push');
    assert.match(at.text(), /no transactional Push messages/);
    assert.equal(isListing(), false);
    assert.equal(at.part('rows'), null);
    await tab(at, 'sms');
    assert.equal(isListing(), true);
});

test('the stylesheet lets the rows scroll under the names of their columns, and nothing else of a list', () => {
    const { rule } = stylesheet();
    const panel = rule('.sfmc-ux-tools-transactional-listing[open]');
    assert.match(panel, /overflow:\s*hidden/);
    assert.match(panel, /display:\s*flex/);
    assert.match(panel, /flex-direction:\s*column/);
    const scroll = rule('.sfmc-ux-tools-transactional-body > .sfmc-ux-tools-transactional-rows');
    assert.match(scroll, /overflow:\s*auto/);
    assert.match(scroll, /min-height:\s*0/);
    const head = rule('.sfmc-ux-tools-transactional-list thead th');
    assert.match(head, /position:\s*sticky/);
    assert.match(head, /top:\s*0/);
    // the rows do not show through, and the buttons of the columns are above them
    assert.match(head, /background:\s*#fff/);
    assert.match(head, /z-index:\s*1/);
    // the columns keep their width when the details come in
    assert.match(rule('.sfmc-ux-tools-transactional-list'), /table-layout:\s*fixed/);
    // a row that gets the focus is scrolled to below the names of the columns
    assert.match(rule('.sfmc-ux-tools-transactional-list tbody tr'), /scroll-margin-top:/);
    // the panel without a list scrolls as before
    assert.match(rule('.sfmc-ux-tools-transactional-panel'), /overflow:\s*auto/);
    // the button that reads again shows when the keyboard is at it
    assert.match(rule('.sfmc-ux-tools-transactional-refresh:focus-visible'), /outline:/);
    assert.match(rule('.sfmc-ux-tools-transactional-refresh'), /align-self:\s*stretch/);
});

test('the manifest runs the script on the Marketing Cloud page only, in its top frame', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((item) =>
        item.js.includes('transactional-messages.js'),
    );
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.deepEqual(entry.matches, ['https://*.exacttarget.com/cloud/*']);
    assert.deepEqual(entry.include_globs, ['https://mc.*']);
    // the styles of the code editor of a message come first, so that the panel's own win
    assert.deepEqual(entry.css, [
        'editor-codemirror.css',
        'editor-highlight.css',
        'transactional-messages.css',
    ]);
    // the rule that makes a key from a name comes first, for the form of a new message; the
    // theme of the code editor is the one chosen in the options
    assert.deepEqual(entry.js, ['key-rule.js', 'editor-theme.js', 'transactional-messages.js']);
    // the menu is in the page itself, not in the frames of the apps
    assert.equal(entry.all_frames, undefined);
    // the script uses the page's session through its own requests; it needs no place in the page's world
    assert.equal(entry.world, undefined);
});

test('every rule of the stylesheet is limited to the panel', () => {
    const css = read('../src/transactional-messages.css').replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const selectors = css
        .matchAll(/([^{}]+)\{/g)
        .flatMap(([, list]) => list.split(','))
        .toArray();
    assert.ok(selectors.length > 0);
    for (const selector of selectors) {
        assert.match(selector.trim(), /^\.sfmc-ux-tools-transactional-/);
    }
});

// an editor keeps timers running, which keep the tests from ending
const withEditors = new Set();
after(() => {
    for (const window of withEditors) {
        window.close();
    }
});

/**
 * Loads a script of the code editor into a page, as the browser would.
 *
 * @param {Window} window the page
 * @param {string} url address of the file of the extension
 */
async function loadEditorFile(window, url) {
    withEditors.add(window);
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    const file = url.slice(EXTENSION.length);
    assert.ok(url.startsWith(EXTENSION) && EDITOR_FILES.includes(file), url);
    window.eval(read(`../dist/extension/${file}`));
}

/**
 * Opens something in a page that loads the scripts of the code editor in a given way.
 *
 * @template T
 * @param {() => Promise.<T>} open opens the page
 * @param {(window: Window, url: string) => Promise.<void>} [load] how the page loads a script
 * @returns {Promise.<T>} what was opened, once the editor had the time to be set up
 */
async function withEditor(open, load = loadEditorFile) {
    importing.load = load;
    try {
        const at = await open();
        // the scripts are loaded one after the other
        for (let waited = 0; waited <= EDITOR_FILES.length; waited++) {
            await tick();
        }
        at.editor = () => at.panel().querySelector('.CodeMirror')?.CodeMirror;
        return at;
    } finally {
        importing.load = neverLoaded;
    }
}

/**
 * Presses a key in the code editor of a form.
 *
 * @param {object} at the page
 * @param {object} key what the key is: key, keyCode and the keys held with it
 * @returns {KeyboardEvent} the event, after the page handled it
 */
function press(at, key) {
    const event = new at.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...key,
    });
    at.editor().getInputField().dispatchEvent(event);
    return event;
}

const MESSAGE = 'content.message';
const pause = () => new Promise((resolve) => setTimeout(resolve, 300));

test('the form of an SMS message gets a code editor for the message, and keeps its field', async () => {
    const at = await withEditor(() => form('sms'));
    assert.deepEqual(
        at.imported,
        EDITOR_FILES.map((file) => EXTENSION + file),
    );
    const editor = at.editor();
    assert.ok(editor, 'the editor is there');
    assert.equal(editor.getOption('mode'), 'ampScriptHtmlMixed');
    const wrapper = editor.getWrapperElement();
    assert.equal(at.form().contains(wrapper), true);
    // a click into the editor is none on the label of the field
    assert.equal(wrapper.closest('label'), null);
    const field = at.field(MESSAGE);
    assert.equal(field.localName, 'textarea');
    assert.equal(field.required, true);
    assert.equal(field.classList.contains('sfmc-ux-tools-transactional-coded'), true);
    assert.equal(field.tabIndex, -1);
    assert.equal(field.closest('label').nextElementSibling, wrapper.parentNode);
    // the editor is called what the field is called
    const typing = editor.getInputField();
    const title = at.document.querySelector(`#${typing.getAttribute('aria-labelledby')}`);
    assert.equal(title.textContent, 'Message *');
    assert.equal(typing.getAttribute('aria-required'), 'true');
    // the Tab key moves on to the next field
    assert.equal(editor.getOption('extraKeys').Tab, false);
});

test('the forms of push and OTT messages load no code editor', async () => {
    for (const kind of ['push', 'ott']) {
        const at = await withEditor(() => form(kind));
        assert.deepEqual(at.imported, []);
        assert.equal(at.editor(), undefined);
        assert.equal(at.form().querySelector('textarea'), null);
    }
});

test('what is changed in the code editor goes to the field, and so into the new message', async () => {
    const at = await withEditor(() =>
        form('sms', (path, method) => {
            if (method === 'POST') {
                return { status: 201, body: { definitionKey: 'Order_shipped' } };
            }
            return { body: path.includes('?') ? { definitions: [] } : DEFINITION };
        }),
    );
    const field = at.field(MESSAGE);
    let inputs = 0;
    field.addEventListener('input', () => inputs++);
    assert.equal(field.value, '');
    at.editor().replaceRange('%%=Uppercase(@name)=%%\nis on its way.', { line: 0, ch: 0 });
    assert.equal(field.value, '%%=Uppercase(@name)=%%\nis on its way.');
    assert.equal(inputs, 1);
    // what is put into the field itself shows in the editor, and is not written back
    at.type(MESSAGE, 'On its way.');
    assert.equal(at.editor().getValue(), 'On its way.');
    assert.equal(inputs, 2);
    at.editor().replaceRange(' Today.', { line: 0, ch: 11 });
    at.type('name', 'Order shipped');
    at.type('subscriptions.shortCode', '4912312345678');
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.equal(at.sent().length, 1);
    assert.deepEqual(at.sent()[0].content, { message: 'On its way. Today.' });
});

test('a message that is missing is still pointed at, in its field', async () => {
    const at = await withEditor(() => form('sms'));
    at.type('name', 'Order shipped');
    at.type('subscriptions.shortCode', '4912312345678');
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.deepEqual(at.sent(), []);
    assert.equal(at.field(MESSAGE).validity.valueMissing, true);
    // the browser's note needs the cursor to stay in the field; with a message, it goes on
    at.field(MESSAGE).focus();
    assert.equal(at.document.activeElement, at.field(MESSAGE));
    at.editor().setValue('text');
    at.field('name').focus();
    at.field(MESSAGE).focus();
    assert.equal(at.document.activeElement, at.editor().getInputField());
});

test('an Edit form with a code editor sends nothing untouched, and the message once it is changed', async () => {
    const saved = { ...DEFINITION, content: { message: 'new text' } };
    const at = await withEditor(() =>
        editing(DEFINITION, (path, method, reads) => {
            if (method !== 'GET') {
                return { status: 200, body: { requestId: 'r-9' } };
            }
            return { body: reads === 1 ? DEFINITION : saved };
        }),
    );
    assert.equal(at.editor().getValue(), 'line 1\nline 2');
    assert.equal(at.field(MESSAGE).value, 'line 1\nline 2');
    const before = at.calls.length;
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // changed and changed back is no change either
    at.editor().setValue('other');
    at.editor().setValue('line 1\nline 2');
    await at.send();
    assert.equal(at.calls.length, before);
    at.editor().setValue('new text');
    await at.send();
    assert.deepEqual(at.changes(), [{ content: { message: 'new text' } }]);
    assert.match(at.text(), /^Saved “name of welcome” \(key welcome\)\./);
});

test('without the code editor the field of the message stays a plain one that works', async (t) => {
    const failures = [
        // the browser refuses the file
        () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
        // the files run, but bring no editor
        () => Promise.resolve(),
    ];
    // what a page says in its console comes out in the one of the tests
    const warn = t.mock.method(console, 'warn', () => {});
    for (const load of failures) {
        warn.mock.resetCalls();
        const at = await withEditor(
            () =>
                form('sms', (path, method) => {
                    if (method === 'POST') {
                        return { status: 201, body: { definitionKey: 'Order_shipped' } };
                    }
                    return { body: path.includes('?') ? { definitions: [] } : DEFINITION };
                }),
            load,
        );
        assert.equal(at.editor(), undefined);
        assert.equal(at.form().querySelector('.sfmc-ux-tools-transactional-code'), null);
        const field = at.field(MESSAGE);
        assert.equal(field.className, '');
        assert.equal(field.tabIndex, 0);
        // said in the console only
        assert.equal(warn.mock.callCount(), 1);
        assert.match(
            warn.mock.calls[0].arguments[0],
            /^SFMC UX Tools: the code editor for the message/,
        );
        assert.equal(at.form().querySelector('.sfmc-ux-tools-transactional-error').hidden, true);
        at.type('name', 'Order shipped');
        at.type(MESSAGE, 'On its way.');
        at.type('subscriptions.shortCode', '4912312345678');
        at.type('subscriptions.keyword', 'ORDER');
        await at.send();
        assert.deepEqual(at.sent()[0].content, { message: 'On its way.' });
    }
});

test('a message that cannot be changed here gets no code editor', async () => {
    const at = await withEditor(() =>
        editing({ ...DEFINITION, content: { message: { not: 'text' } } }),
    );
    assert.equal(at.field(MESSAGE).disabled, true);
    assert.equal(at.editor(), undefined);
});

test('the code editor of a message has the colours and language features of every code editor, inside the panel', async () => {
    const at = await withEditor(() => form('sms'));
    const editor = at.editor();
    editor.setValue('%%=Lookup(=%%');
    // the scripts find the editor a moment after it is on the page
    await pause();
    assert.equal(editor.getTokenTypeAt({ line: 0, ch: 5 }), 'sfmc-function');
    // suggestions: the list stands in the panel, which covers everything outside of it
    editor.setValue('%%=Loo');
    editor.setCursor({ line: 0, ch: 6 });
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-Space' in map);
    assert.ok(keyMap, 'Ctrl-Space is bound');
    keyMap['Ctrl-Space'](editor);
    const labels = editor.state.completionActive.data.list.map((hint) => hint.displayText);
    assert.ok(labels.includes('Lookup'), labels.join(' | '));
    const list = at.document.querySelector('.CodeMirror-hints');
    assert.equal(list.parentNode, at.panel());
    // Escape closes the list and nothing else
    let reached = 0;
    at.panel().addEventListener('keydown', () => reached++);
    const closing = press(at, { key: 'Escape', keyCode: 27 });
    assert.equal(editor.state.completionActive, null);
    assert.equal(closing.defaultPrevented, true);
    assert.equal(reached, 0);
    // without a list the key is the panel's, as in every other field
    const leaving = press(at, { key: 'Escape', keyCode: 27 });
    assert.equal(leaving.defaultPrevented, false);
    assert.equal(reached, 1);
    // Ctrl+S and Cmd+S do nothing: no dialog of the browser, nothing sent
    assert.equal(press(at, { key: 's', keyCode: 83, ctrlKey: true }).defaultPrevented, true);
    assert.equal(typeof editor.getOption('extraKeys')['Cmd-S'], 'function');
    assert.deepEqual(at.written, []);
    // parameter help: its box stands in the panel too
    editor.focus();
    editor.setValue('%%=Lookup(=%%');
    editor.setCursor({ line: 0, ch: 10 });
    await pause();
    const box = at.document.querySelector('.sfmc-signature');
    assert.ok(box, 'parameter help is on show');
    assert.equal(box.parentNode, at.panel());
});

test('Escape closes an open box of the code editor and not the panel, which keeps what was typed', async () => {
    const at = await withEditor(() => form('sms'));
    const editor = at.editor();
    at.type('name', 'Order shipped');
    let reached = 0;
    at.panel().addEventListener('keydown', () => reached++);
    const escape = { key: 'Escape', keyCode: 27 };
    // parameter help; the scripts find the editor a moment after it is on the page
    editor.focus();
    editor.setValue('%%=Lookup(=%%');
    await pause();
    editor.setCursor({ line: 0, ch: 10 });
    await pause();
    assert.equal(at.document.querySelector('.sfmc-signature').parentNode, at.panel());
    assert.equal(press(at, escape).defaultPrevented, true);
    assert.equal(at.document.querySelector('.sfmc-signature'), null);
    // the explanation of where the mouse rests; jsdom has no layout, so the editor is told where
    const rest = async () => {
        editor.coordsChar = () => ({ line: 0, ch: 6, xRel: -1 });
        editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
        editor
            .getWrapperElement()
            .dispatchEvent(new at.window.MouseEvent('mousemove', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 450));
        return at.document.querySelector('.sfmc-hover');
    };
    assert.equal((await rest()).parentNode, at.panel());
    assert.equal(press(at, escape).defaultPrevented, true);
    assert.equal(at.document.querySelector('.sfmc-tooltip'), null);
    // with the keyboard in the box, as it is for quick fixes, the box takes the key itself
    const inBox = new at.window.KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...escape,
    });
    (await rest()).dispatchEvent(inBox);
    assert.equal(inBox.defaultPrevented, true);
    assert.equal(at.document.querySelector('.sfmc-tooltip'), null);
    // the panel saw none of these keys, and the form is as it was
    assert.equal(reached, 0);
    assert.equal(at.panel().open, true);
    assert.equal(at.field('name').value, 'Order shipped');
    assert.equal(editor.getValue(), '%%=Lookup(=%%');
    assert.equal(at.field(MESSAGE).value, '%%=Lookup(=%%');
    // with nothing open the key is the panel's again
    assert.equal(press(at, escape).defaultPrevented, false);
    assert.equal(reached, 1);
});

test('a page that has something else under the name of the way the tests load a script loads the code editor as ever', async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const at = page(MENU);
    at.window.sfmcUxToolsImport = { not: 'a function' };
    await at.open();
    await tab(at, 'sms');
    at.panel().querySelector('.sfmc-ux-tools-transactional-new').click();
    await pause();
    // the page of the tests cannot import a file, which is what the script tried
    assert.equal(warn.mock.callCount(), 1);
    assert.doesNotMatch(String(warn.mock.calls[0].arguments[1]), /is not a function/);
    assert.deepEqual(at.imported, []);
    assert.equal(at.panel().querySelector('form').elements[MESSAGE].className, '');
});

test('the manifest lets the page of the panel load the code editor, and styles it', () => {
    const manifest = JSON.parse(read('../dist/extension/manifest.json'));
    const loadable = manifest.web_accessible_resources
        .filter((item) => item.matches.includes('https://*.exacttarget.com/*'))
        .flatMap((item) => item.resources);
    for (const file of EDITOR_FILES) {
        assert.ok(loadable.includes(file), `${file} can be loaded`);
        assert.ok(read(`../dist/extension/${file}`).length > 0);
    }
    // no formatter, and nothing of the editor runs before a form asks for it
    const scripts = manifest.content_scripts
        .filter((item) => item.matches.some((match) => match.includes('exacttarget.com')))
        .flatMap((item) => item.js);
    for (const file of [...EDITOR_FILES, 'editor-format.js']) {
        assert.equal(scripts.includes(file), false, file);
    }
    // CodeMirror's own stylesheet, with the mode Marketing Cloud's editors are known by
    assert.match(read('../dist/extension/editor-codemirror.css'), /\.CodeMirror-lines \{/);
    assert.match(read('../dist/extension/editor-codemirror.js'), /ampScriptHtmlMixed/);
});

// apps as the API lists them: in no order, and with their custom keys when they have any
const KEYED_APPS = [
    { id: 'app-2', name: 'staff app' },
    { id: 'app-3', name: 'Zebra', keys: ['zeta'] },
    { id: 'app-1', name: 'Shop app', keys: ['deeplink', 'campaign'] },
];
const INTERNAL_APPS = 'push-internal/v1/application';
const CUSTOM_KEYS = '.sfmc-ux-tools-transactional-custom-keys';
const MORE = '.sfmc-ux-tools-transactional-combo-more';
const CONTENT_TEXT = 'sfmc-ux-tools-transactional-content-text';

/**
 * Waits for what a click or a sent form sets off: up to three requests in a row.
 */
async function settle() {
    await tick();
    await tick();
    await tick();
}

/**
 * Opens the panel on the push tab of a business unit with one push definition, "receipt".
 *
 * @param {object} [has] what the business unit has
 * @param {object} [has.definition] the definition
 * @param {object} [has.after] the definition once something was sent
 * @param {object[]} [has.contents] the mobile messages of Content Builder
 * @param {object[]} [has.folders] the folders of Content Builder
 * @param {object} [has.asset] the answer to the question for one mobile message
 * @param {object[]} [has.apps] the apps as the public API lists them
 * @param {object[]} [has.internal] the apps as MobilePush's own list has them
 * @param {string[]} [has.down] the starts of the paths that cannot be read
 * @returns {Promise.<object>} the page, with ways to open the details and a form, to reach and fill the fields, to send the form and to read what was sent
 */
async function pushing({
    definition = PUSH,
    after,
    contents = OFFERED[CONTENTS].items,
    folders = [],
    asset = { items: [] },
    apps = KEYED_APPS,
    internal = [],
    down = [],
} = {}) {
    let isSent = false;
    const at = page(MENU, (path, method) => {
        if (down.some((start) => path.startsWith(start))) {
            return { status: 500, body: { message: 'No' } };
        }
        if (path === APPS) {
            return { body: apps };
        }
        if (path.startsWith(`${INTERNAL_APPS}?`)) {
            return { body: { count: internal.length, items: internal } };
        }
        if (path.startsWith(`${CONTENTS}?$page=`)) {
            return { body: { count: contents.length, items: contents } };
        }
        if (path.startsWith(`${CONTENTS}?$filter=`)) {
            return { body: asset };
        }
        if (path.startsWith(FOLDERS)) {
            return { body: { count: folders.length, items: folders } };
        }
        if (path.startsWith('push/definitions?')) {
            return { body: { definitions: [ROW('receipt')] } };
        }
        if (method !== 'GET') {
            isSent = true;
            return { status: 200, body: {} };
        }
        return { body: isSent && after ? after : definition };
    });
    await at.open();
    await tab(at, 'push');
    at.press = async (text) => {
        [...at.panel().querySelectorAll('button')]
            .find((item) => item.textContent === text)
            .click();
        await settle();
    };
    at.details = async () => {
        rows(at)[0].click();
        await settle();
    };
    at.form = () => at.panel().querySelector('form');
    at.field = (path) => at.form().elements[path];
    at.type = (path, text) => {
        at.field(path).value = text;
        at.field(path).dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    // the fields of the custom keys on show, by their key, and the one of a key
    at.keys = () =>
        [...at.form().querySelectorAll(`${CUSTOM_KEYS}:not([hidden]) input`)].map((input) => [
            input.dataset.customKey,
            input.value,
        ]);
    at.key = (key) =>
        [...at.form().querySelectorAll(`${CUSTOM_KEYS} input`)].find(
            (input) => input.dataset.customKey === key,
        );
    at.typeKey = (key, text) => {
        at.key(key).value = text;
        at.key(key).dispatchEvent(new at.window.Event('input', { bubbles: true }));
    };
    at.send = async () => {
        at.form().dispatchEvent(new at.window.Event('submit', { bubbles: true, cancelable: true }));
        await settle();
    };
    at.changes = () =>
        at.calls.filter((call) => call.method !== 'GET').map((call) => JSON.parse(call.body));
    return at;
}

test('the apps of a push message are listed by their name, whatever its case, each with its id', async () => {
    const at = await pushing();
    await at.press('New Push message');
    assert.deepEqual(options(at, 'applicationId'), [
        ['app-1', 'Shop app'],
        ['app-2', 'staff app'],
        ['app-3', 'Zebra'],
    ]);
    // none of them is switched off while nothing says that an app lacks its credentials
    assert.equal(listOf(at.field('applicationId')).querySelector('[aria-disabled]'), null);
});

test('the contents of a push message are listed by their name, whatever its case, each with its key', async () => {
    const at = await pushing({
        contents: [
            { customerKey: 'k-z', name: 'zulu', availableViews: ['push'] },
            { customerKey: 'k-a', name: 'Alpha', availableViews: ['push'] },
            { customerKey: 'k-m', name: 'mike', availableViews: ['push'] },
            // one without a name comes first and is still to be chosen by its key
            { customerKey: 'k-none', availableViews: ['push'] },
        ],
    });
    await at.press('New Push message');
    assert.deepEqual(
        options(at, 'content.customerKey').map(([value]) => value),
        ['k-none', 'k-a', 'k-m', 'k-z'],
    );
});

const MODIFIED = '2026-02-03T04:05:00Z';
const IN_FOLDERS = [
    {
        id: 1,
        customerKey: 'receipt_push',
        name: 'Receipt',
        availableViews: ['push'],
        modifiedDate: MODIFIED,
        modifiedBy: { id: 7, name: 'Jane <b>Doe</b>' },
        category: { id: 12 },
    },
    { id: 2, customerKey: 'plain', name: 'Plain', availableViews: ['push'] },
    // in a folder that the list of folders does not have
    {
        id: 3,
        customerKey: 'lost',
        name: 'Lost',
        availableViews: ['push'],
        modifiedDate: MODIFIED,
        category: { id: 99 },
    },
];
const FOLDER_LIST = [
    { id: 1, name: 'Content Builder', parentId: 0 },
    { id: 12, name: 'Receipts', parentId: 1 },
];

/**
 * Lists what the entries of the list of contents say besides name and key.
 *
 * @param {object} at the page with the form
 * @returns {(string | null)[]} folder, date and who of every entry on show; nothing for an entry that says none
 */
function more(at) {
    return [...listOf(at.field('content.customerKey')).children].map(
        (item) => item.querySelector(MORE)?.textContent ?? null,
    );
}

test('an entry of the list of contents names its folder, when it was last changed and by whom, and is found by its folder', async () => {
    const at = await pushing({ contents: IN_FOLDERS, folders: FOLDER_LIST });
    await at.press('New Push message');
    const when = at.window.sfmcUxToolsFormatDate(MODIFIED);
    assert.notEqual(when, MODIFIED);
    // by name: Lost, Plain, Receipt
    assert.deepEqual(more(at), [
        `modified ${when}`,
        null,
        `Receipts · modified ${when} by Jane <b>Doe</b>`,
    ]);
    // shown as text, between the name and the key
    assert.equal(at.panel().querySelector('b'), null);
    assert.deepEqual(options(at, 'content.customerKey'), [
        ['lost', 'Lost'],
        ['plain', 'Plain'],
        ['receipt_push', 'Receipt'],
    ]);
    assert.deepEqual(
        at.looked.filter((path) => path.startsWith(FOLDERS)),
        [`${FOLDERS}?$page=1&$pageSize=50`],
    );
    // typing the name of a folder leaves what is in it
    at.field('content.customerKey').focus();
    at.type('content.customerKey', 'receipts');
    assert.deepEqual(options(at, 'content.customerKey'), [['receipt_push', 'Receipt']]);
    // the folders are read once, like the other lists, and again after "Refresh"
    await at.press('Cancel');
    await at.press('New Push message');
    assert.equal(more(at)[2].startsWith('Receipts · '), true);
    assert.equal(reads(at, FOLDERS), 1);
    await at.press('Cancel');
    await click(at, 'refresh');
    await at.press('New Push message');
    assert.equal(reads(at, FOLDERS), 2);
});

test('the list of contents does without the folders when they cannot be read', async () => {
    const at = await pushing({ contents: IN_FOLDERS, folders: FOLDER_LIST, down: [FOLDERS] });
    await at.press('New Push message');
    const when = at.window.sfmcUxToolsFormatDate(MODIFIED);
    assert.deepEqual(more(at), [`modified ${when}`, null, `modified ${when} by Jane <b>Doe</b>`]);
    assert.equal(options(at, 'content.customerKey').length, 3);
    at.field('content.customerKey').focus();
    at.type('content.customerKey', 'receipts');
    assert.deepEqual(options(at, 'content.customerKey'), []);
    assert.equal(at.form().querySelector('.sfmc-ux-tools-transactional-error:not([hidden])'), null);
});

/**
 * Builds the answer to the question for one mobile message.
 *
 * @param {string} customerKey its customer key
 * @param {Object.<string, unknown>} texts what it says, by the names of Content Builder
 * @returns {object} the answer
 */
const ASSET = (customerKey, texts) => ({
    count: 1,
    items: [
        {
            name: 'Receipt',
            customerKey,
            views: { push: { meta: { options: { customBlockData: texts } } } },
        },
    ],
});

/**
 * Lists what the details say of the content of a push message.
 *
 * @param {object} at the page with the details
 * @returns {string[][]} what each text is called, the name Content Builder has for it, and the text
 */
function said(at) {
    return [...at.panel().querySelectorAll(`dt.${CONTENT_TEXT}`)].map((item) => [
        item.textContent,
        item.title,
        item.nextElementSibling.textContent,
    ]);
}

test('the details of a push message show what its content says, as text, and read it once', async () => {
    const key = "o'brien key";
    const at = await pushing({
        definition: { ...PUSH, content: { customerKey: key } },
        asset: ASSET(key, {
            'display:title': 'Hi %%=v(@name)=%%',
            // what is empty is left out
            'display:subtitle': '',
            'display:message': '<b>Thanks</b>',
            'display:other': 'not shown',
        }),
    });
    await at.details();
    assert.deepEqual(said(at), [
        ['Title', 'display:title', 'Hi %%=v(@name)=%%'],
        ['Message', 'display:message', '<b>Thanks</b>'],
    ]);
    assert.equal(at.panel().querySelector('b'), null);
    // under the key of the content, in the same list
    const place = [...at.panel().querySelectorAll('dt')].find(
        (item) => item.title === 'content.customerKey',
    );
    const first = at.panel().querySelector(`dt.${CONTENT_TEXT}`);
    assert.equal(first.parentElement, place.parentElement);
    assert.equal(place.nextElementSibling.nextElementSibling, first);
    assert.equal(first.nextElementSibling.className, CONTENT_TEXT);
    // before what else the content holds
    const later = await pushing({
        definition: { ...PUSH, content: { customerKey: key, other: 'x' } },
        asset: ASSET(key, { 'display:title': 'One', 'display:message': 'Two' }),
    });
    await later.details();
    const terms = [...later.panel().querySelectorAll('dt')];
    const from = terms.findIndex((item) => item.title === 'content.customerKey');
    assert.deepEqual(
        terms.slice(from + 1, from + 4).map((item) => item.title),
        ['display:title', 'display:message', 'content.other'],
    );
    assert.equal(terms[from + 1].previousElementSibling, terms[from].nextElementSibling);
    // the key is asked for with its quote doubled, and all of it written for an address
    const asked = () => at.looked.filter((path) => path.startsWith(`${CONTENTS}?$filter=`));
    assert.deepEqual(asked(), [
        `${CONTENTS}?$filter=customerKey%20eq%20'o''brien%20key'&$fields=name,customerKey,views`,
    ]);
    // kept for the next look at the message, and read again after "Refresh"
    await click(at, 'back');
    await at.details();
    assert.equal(said(at).length, 2);
    assert.equal(asked().length, 1);
    await click(at, 'back');
    await click(at, 'refresh');
    await at.details();
    assert.equal(said(at).length, 2);
    assert.equal(asked().length, 2);
    // the form does not show it
    await at.press('Edit');
    assert.equal(at.form().querySelector(`.${CONTENT_TEXT}`), null);
});

test('details whose content cannot be read, is another one or says nothing show no text and no error', async () => {
    const down = await pushing({ down: [`${CONTENTS}?$filter=`] });
    await down.details();
    assert.deepEqual(said(down), []);
    assert.equal(down.panel().querySelector('.sfmc-ux-tools-transactional-error'), null);
    assert.match(down.text(), /receipt_push/);
    // asked for again the next time
    await click(down, 'back');
    await down.details();
    assert.equal(down.looked.filter((path) => path.startsWith(`${CONTENTS}?$filter=`)).length, 2);

    const other = await pushing({ asset: ASSET('another_key', { 'display:title': 'Other' }) });
    await other.details();
    assert.deepEqual(said(other), []);

    const silent = await pushing({ asset: { count: 1, items: [{ customerKey: 'receipt_push' }] } });
    await silent.details();
    assert.deepEqual(said(silent), []);

    // the other kinds of message ask for no content
    const sms = await details();
    assert.deepEqual(sms.looked, []);
});

test('a new push message asks for the custom keys of the app that is chosen, and sends those that are filled', async () => {
    const at = await pushing();
    await at.press('New Push message');
    const group = at.form().querySelector(CUSTOM_KEYS);
    // right below the field of the app
    assert.equal(at.field('applicationId').closest(FIELD).nextElementSibling, group);
    assert.equal(group.hidden, true);
    assert.deepEqual(at.keys(), []);
    at.type('applicationId', 'app-1');
    assert.equal(group.hidden, false);
    assert.deepEqual(at.keys(), [
        ['deeplink', ''],
        ['campaign', ''],
    ]);
    assert.deepEqual(
        [...group.querySelectorAll('.sfmc-ux-tools-transactional-label')].map(
            (item) => item.textContent,
        ),
        ['deeplink', 'campaign'],
    );
    at.typeKey('deeplink', ' shop://a ');
    // another app has other keys, and one without keys has no such fields
    at.type('applicationId', 'app-3');
    assert.deepEqual(at.keys(), [['zeta', '']]);
    at.typeKey('zeta', 'left behind');
    at.type('applicationId', 'app-2');
    assert.deepEqual(at.keys(), []);
    assert.equal(group.hidden, true);
    at.type('applicationId', 'no such app');
    assert.deepEqual(at.keys(), []);
    // what was typed for a key comes back with its app
    at.type('applicationId', 'app-1');
    assert.deepEqual(at.keys(), [
        ['deeplink', ' shop://a '],
        ['campaign', ''],
    ]);
    at.type('name', 'Receipt');
    at.type('definitionKey', 'receipt');
    at.type('content.customerKey', 'receipt_push');
    at.type('options.sound', 'ping');
    await at.send();
    assert.deepEqual(at.written, ['POST push/definitions']);
    // next to the other options; neither the empty key nor the one of another app
    assert.deepEqual(at.changes()[0].options, {
        sound: 'ping',
        customKeys: [{ key: 'deeplink', value: 'shop://a' }],
    });

    // without a filled key the message names none
    const plain = await pushing();
    await plain.press('New Push message');
    plain.type('applicationId', 'app-1');
    plain.type('name', 'Receipt');
    plain.type('definitionKey', 'receipt');
    plain.type('content.customerKey', 'receipt_push');
    await plain.send();
    assert.equal(Object.hasOwn(plain.changes()[0], 'options'), false);
});

// a push message with custom keys: one the app does not list, with an empty value and something
// the form does not know, one of the app, and one whose value is no text
const KEYED = {
    ...PUSH,
    applicationId: 'app-1',
    options: {
        sound: 'old',
        customKeys: [
            { key: 'legacy', value: '', extra: 1 },
            { key: 'deeplink', value: 'shop://a' },
            { key: 'count', value: 5 },
        ],
    },
};
const withKeys = (definition, customKeys, options) => ({
    ...definition,
    options: { ...definition.options, ...options, customKeys },
});

test('the form of a push message shows its stored custom keys at once, also without the list of apps, and sends nothing untouched', async () => {
    const at = await pushing({ definition: KEYED });
    await at.details();
    await at.press('Edit');
    // what is stored first, as it is stored, then what else the app has
    assert.deepEqual(at.keys(), [
        ['legacy', ''],
        ['deeplink', 'shop://a'],
        ['count', '5'],
        ['campaign', ''],
    ]);
    const before = at.calls.length;
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // typing a value back to what it was is no change either
    at.typeKey('deeplink', 'x');
    at.typeKey('deeplink', ' shop://a ');
    await at.send();
    assert.equal(at.calls.length, before);

    const down = await pushing({ definition: KEYED, down: [APPS] });
    await down.details();
    await down.press('Edit');
    assert.deepEqual(down.keys(), [
        ['legacy', ''],
        ['deeplink', 'shop://a'],
        ['count', '5'],
    ]);
});

const NOT_SENT = /Not a custom key of this app, will not be sent\./;

test('another app takes the stored custom keys it does not list out of what is sent, in one request with the app', async () => {
    // app-3 lists zeta only: deeplink is a key of app-1, legacy of no app
    const stored = withKeys(KEYED, [
        { key: 'legacy', value: 'x' },
        { key: 'deeplink', value: 'shop://a' },
        { key: 'zeta', value: 'z' },
    ]);
    const at = await pushing({ definition: stored });
    await at.details();
    await at.press('Edit');
    const before = at.calls.length;
    // the same app: a stored key it does not list is a field as any other
    assert.equal(at.key('legacy').disabled, false);
    assert.doesNotMatch(at.form().textContent, NOT_SENT);
    at.type('applicationId', 'app-3');
    // the fields stay on show, those that are not sent switched off and saying so
    assert.deepEqual(at.keys(), [
        ['legacy', 'x'],
        ['deeplink', 'shop://a'],
        ['zeta', 'z'],
    ]);
    assert.deepEqual(
        ['legacy', 'deeplink', 'zeta'].map((key) => [
            at.key(key).disabled,
            NOT_SENT.test(at.key(key).parentElement.textContent),
        ]),
        [
            [true, true],
            [true, true],
            [false, false],
        ],
    );
    // back at the app the message has, everything is as it was, and nothing is sent
    at.type('applicationId', 'app-1');
    assert.equal(at.key('legacy').disabled, false);
    assert.doesNotMatch(at.form().textContent, NOT_SENT);
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    at.type('applicationId', 'app-3');
    await at.send();
    assert.deepEqual(at.changes(), [
        {
            applicationId: 'app-3',
            options: { sound: 'old', customKeys: [{ key: 'zeta', value: 'z' }] },
        },
    ]);

    // an app that lists every stored key changes the app alone
    const listed = await pushing({
        definition: withKeys({ ...KEYED, applicationId: 'app-3' }, [
            { key: 'deeplink', value: 'shop://a' },
        ]),
    });
    await listed.details();
    await listed.press('Edit');
    listed.type('applicationId', 'app-1');
    await listed.send();
    assert.deepEqual(listed.changes(), [{ applicationId: 'app-1' }]);
});

test('stored custom keys the app does not list pass through under the same app and under an app that is not known', async () => {
    // the same app: legacy, which app-1 does not list, goes back as it is stored
    const same = await pushing({ definition: KEYED });
    await same.details();
    await same.press('Edit');
    same.typeKey('campaign', 'spring');
    await same.send();
    assert.deepEqual(same.changes(), [
        {
            options: {
                sound: 'old',
                customKeys: [...KEYED.options.customKeys, { key: 'campaign', value: 'spring' }],
            },
        },
    ]);

    // an app the list does not have, and a list that cannot be read: nothing is left out
    for (const has of [{}, { down: [APPS] }]) {
        const appId = has.down ? 'app-3' : 'app-9';
        const at = await pushing({ definition: KEYED, ...has });
        await at.details();
        await at.press('Edit');
        at.type('applicationId', appId);
        assert.equal(at.key('legacy').disabled, false);
        assert.doesNotMatch(at.form().textContent, NOT_SENT);
        at.typeKey('deeplink', 'shop://b');
        await at.send();
        assert.deepEqual(at.changes(), [
            {
                applicationId: appId,
                options: {
                    sound: 'old',
                    customKeys: [
                        { key: 'legacy', value: '', extra: 1 },
                        { key: 'deeplink', value: 'shop://b' },
                        { key: 'count', value: 5 },
                    ],
                },
            },
        ]);
    }
});

test('a changed custom key is sent with the whole list, the others as they are stored, in one part with a changed option', async () => {
    const before = JSON.stringify(KEYED);
    const customKeys = [
        { key: 'legacy', value: '', extra: 1 },
        { key: 'deeplink', value: 'shop://b' },
        { key: 'count', value: 5 },
    ];
    const at = await pushing({
        definition: KEYED,
        after: withKeys(KEYED, customKeys, { sound: 'new' }),
    });
    await at.details();
    await at.press('Edit');
    at.typeKey('deeplink', ' shop://b ');
    at.type('options.sound', 'new');
    await at.send();
    assert.deepEqual(at.written, ['POST push/definitions/receipt']);
    assert.deepEqual(at.changes(), [{ options: { sound: 'new', customKeys } }]);
    assert.match(at.text(), /^Saved “name of receipt” \(key receipt\)\./);
    assert.doesNotMatch(at.text(), /not as they were sent/);
    // the definition the form was filled from is not altered by what was sent
    assert.equal(JSON.stringify(KEYED), before);

    // a custom key alone takes the stored options along
    const alone = await pushing({ definition: KEYED, after: withKeys(KEYED, customKeys) });
    await alone.details();
    await alone.press('Edit');
    alone.typeKey('deeplink', 'shop://b');
    await alone.send();
    assert.deepEqual(alone.changes(), [{ options: { sound: 'old', customKeys } }]);
    assert.match(alone.text(), /^Saved /);
    assert.equal(JSON.stringify(KEYED), before);
});

test('an emptied custom key is taken out, a new one is added at the end, and what Marketing Cloud did not take is named', async () => {
    const customKeys = [
        { key: 'legacy', value: '', extra: 1 },
        { key: 'count', value: 5 },
        { key: 'campaign', value: 'spring' },
    ];
    const run = async (after) => {
        const at = await pushing({ definition: KEYED, after });
        await at.details();
        await at.press('Edit');
        at.typeKey('deeplink', ' ');
        at.typeKey('campaign', 'spring');
        await at.send();
        assert.deepEqual(at.changes(), [{ options: { sound: 'old', customKeys } }]);
        return at;
    };
    const saved = await run(withKeys(KEYED, customKeys));
    assert.match(saved.text(), /^Saved /);
    const missed = await run(KEYED);
    assert.match(missed.text(), /these fields are not as they were sent: options\.customKeys\./);
    // the same keys and values count as saved in another order of their parts, a number as
    // text, and with something Marketing Cloud added
    const reordered = await run(
        withKeys(
            KEYED,
            customKeys.map(({ key, value }) => ({ value: String(value), key, id: 7 })),
        ),
    );
    assert.match(reordered.text(), /^Saved /);
    // not in another order of the keys
    const turned = await run(withKeys(KEYED, customKeys.toReversed()));
    assert.match(turned.text(), /not as they were sent: options\.customKeys\./);

    // the last key that is taken out leaves an empty list, which counts as saved when it is gone
    const single = withKeys(PUSH, [{ key: 'deeplink', value: 'shop://a' }]);
    const last = await pushing({ definition: single, after: PUSH });
    await last.details();
    await last.press('Edit');
    last.typeKey('deeplink', '');
    await last.send();
    assert.deepEqual(last.changes(), [{ options: { customKeys: [] } }]);
    assert.match(last.text(), /^Saved /);
});

test('custom keys that the form cannot hold are left alone', async () => {
    // a value that is no text or number cannot be typed over, a second entry of a key has no field
    const odd = withKeys(PUSH, [
        { key: 'nested', value: { a: 1 } },
        { key: 'deeplink', value: 'one' },
        { key: 'deeplink', value: 'two' },
        'no entry',
    ]);
    const at = await pushing({ definition: odd });
    await at.details();
    await at.press('Edit');
    assert.deepEqual(at.keys(), [
        ['nested', ''],
        ['deeplink', 'one'],
    ]);
    assert.equal(at.key('nested').disabled, true);
    at.typeKey('deeplink', 'three');
    await at.send();
    assert.deepEqual(at.changes()[0].options.customKeys, [
        { key: 'nested', value: { a: 1 } },
        { key: 'deeplink', value: 'three' },
        { key: 'deeplink', value: 'two' },
        'no entry',
    ]);

    // what is stored as something else than a list has no fields, and is never sent
    const other = await pushing({
        definition: { ...PUSH, applicationId: 'app-1', options: { customKeys: 'a=b' } },
    });
    await other.details();
    await other.press('Edit');
    assert.deepEqual(other.keys(), []);
    other.type('options.sound', 'ping');
    await other.send();
    assert.deepEqual(other.changes(), [{ options: { customKeys: 'a=b', sound: 'ping' } }]);
});

test('the details list the custom keys of a push message by their name, as text', async () => {
    const at = await pushing({
        definition: withKeys(PUSH, [
            { key: 'deeplink', value: 'shop://<i>a</i>' },
            { key: 'count', value: 5 },
            { key: 'empty' },
        ]),
    });
    await at.details();
    const terms = [...at.panel().querySelectorAll('dt')];
    const term = (path) => terms.find((item) => item.title === path);
    assert.equal(term('options.customKeys').textContent, 'Custom keys');
    assert.deepEqual(
        ['deeplink', 'count', 'empty'].map((key) => [
            term(`options.customKeys.${key}`).textContent,
            term(`options.customKeys.${key}`).nextElementSibling.textContent,
        ]),
        [
            ['deeplink', 'shop://<i>a</i>'],
            ['count', '5'],
            ['empty', ''],
        ],
    );
    assert.equal(at.panel().querySelector('i'), null);
    // entries that hold more than a key and a value are shown as they are stored
    const odd = await pushing({ definition: KEYED });
    await odd.details();
    assert.match(odd.text(), /extra/);
});

test('the stylesheet styles what an entry of a list says besides its name, and sets the custom keys off', () => {
    const css = read('../src/transactional-messages.css');
    assert.match(css, /\.sfmc-ux-tools-transactional-combo-more \{/);
    assert.match(css, /\.sfmc-ux-tools-transactional-custom-keys\[hidden\] \{\s*display: none;/);
});

// the apps as MobilePush's own list has them: one that can push, one without any credentials
// and one whose certificate ran out
const INTERNAL = [
    { id: 'app-1', name: 'Shop app', apnsAuthType: 'Token', apnsAuthKeyFileName: 'key.p8' },
    { id: 'app-2', name: 'staff app', gcmEnabled: false },
    { id: 'app-3', name: 'Zebra', apnsCertificateExpiration: '2020-01-01T00:00:00Z' },
];
const REFUSED = '.sfmc-ux-tools-transactional-refused';
const NO_CREDENTIALS = 'no push credentials set up';

/**
 * Lists the entries of the list of apps that cannot be chosen.
 *
 * @param {{list: Element}} app the field of the app, from picker()
 * @returns {string[]} their ids
 */
function barred(app) {
    return [...app.list.querySelectorAll('[aria-disabled="true"]')].map(
        (item) => item.lastElementChild.textContent,
    );
}

test('an app without push credentials is greyed in the list and taken by neither the mouse nor the keys', async () => {
    const at = await pushing({ internal: INTERNAL });
    await at.press('New Push message');
    await settle();
    assert.deepEqual(
        at.looked.filter((path) => path.startsWith(INTERNAL_APPS)),
        [`${INTERNAL_APPS}?$page=1&$pageSize=50`],
    );
    const app = picker(at);
    app.input.focus();
    assert.deepEqual(
        app.shown().map(([id]) => id),
        ['app-1', 'app-2', 'app-3'],
    );
    assert.deepEqual(barred(app), ['app-2', 'app-3']);
    const entry = (id) =>
        [...app.list.children].find((item) => item.lastElementChild.textContent === id);
    assert.equal(entry('app-2').querySelector(MORE).textContent, NO_CREDENTIALS);
    assert.equal(entry('app-2').classList.contains('sfmc-ux-tools-transactional-combo-off'), true);
    assert.equal(entry('app-1').querySelector(MORE), null);
    // a click on it changes nothing
    app.pick('app-2');
    assert.equal(app.input.value, '');
    assert.equal(app.isOpen(), true);
    // the arrow keys pass over it, in both directions
    app.key('ArrowDown');
    assert.equal(app.at(), 'app-1');
    app.key('ArrowDown');
    assert.equal(app.at(), 'app-1');
    app.key('ArrowUp');
    assert.equal(app.at(), 'app-1');
    app.key('Enter');
    assert.equal(app.input.value, 'app-1');
    assert.equal(at.form().querySelector(REFUSED).hidden, true);
    // typed, it is not where the keys start from, and Enter takes nothing
    app.input.focus();
    at.type('applicationId', 'app-3');
    assert.equal(app.at(), null);
    app.key('Enter');
    assert.equal(app.input.value, 'app-3');
});

test('the rule for an app without push credentials is the one of MobilePush', async () => {
    const cases = [
        [{}, true],
        [{ gcmEnabled: true }, false],
        [{ fcmFileName: 'fcm.json' }, false],
        [{ apnsAuthType: 'Token', apnsAuthKeyFileName: 'key.p8' }, false],
        [{ apnsAuthType: 'Token' }, true],
        [{ apnsAuthType: 'Token', fcmFileName: 'fcm.json' }, false],
        [{ apnsCertificateExpiration: '2999-01-01T00:00:00Z' }, false],
        [{ apnsCertificateExpiration: '2020-01-01T00:00:00Z' }, true],
        [{ apnsCertificateExpiration: '2020-01-01T00:00:00Z', gcmEnabled: true }, false],
        // a date nobody can read counts as one that still holds
        [{ apnsCertificateExpiration: 'soon' }, false],
    ];
    const apps = cases.map((_, index) => ({ id: `app-${index}`, name: `App ${index}` }));
    const at = await pushing({
        // one more app, which MobilePush's list does not have
        apps: [...apps, { id: 'app-new', name: 'Zz new' }],
        internal: cases.map(([state], index) => ({ ...apps[index], ...state })),
    });
    await at.press('New Push message');
    await settle();
    const app = picker(at);
    app.input.focus();
    assert.equal(app.shown().length, cases.length + 1);
    assert.deepEqual(
        barred(app),
        apps.filter((_, index) => cases[index][1]).map(({ id }) => id),
    );
});

test('the app a push message already has can be kept and chosen again, also without push credentials', async () => {
    const at = await pushing({ internal: INTERNAL });
    await at.details();
    await at.press('Edit');
    await settle();
    const app = picker(at);
    assert.equal(app.input.value, 'app-2');
    app.input.focus();
    // it says what is wrong with it, and stays an entry like any other
    assert.deepEqual(barred(app), ['app-3']);
    assert.equal([...app.list.children][1].querySelector(MORE).textContent, NO_CREDENTIALS);
    assert.equal(app.at(), 'app-2');
    const refused = at.form().querySelector(REFUSED);
    assert.equal(refused.hidden, true);
    const before = at.calls.length;
    await at.send();
    assert.equal(at.calls.length, before);
    assert.match(at.text(), /Nothing was changed, so nothing was sent\./);
    // away from it and back
    app.pick('app-1');
    assert.equal(app.input.value, 'app-1');
    app.click();
    app.pick('app-2');
    assert.equal(app.input.value, 'app-2');
    assert.equal(refused.hidden, true);
    // another one without credentials is refused, typed or pasted
    at.type('applicationId', ' app-3 ');
    assert.equal(refused.hidden, false);
    assert.match(refused.textContent, /no push credentials set up/);
    await at.send();
    assert.deepEqual(at.written, []);
    at.type('applicationId', 'app-1');
    assert.equal(refused.hidden, true);
    await at.send();
    assert.deepEqual(at.changes(), [{ applicationId: 'app-1' }]);
});

test('a typed id of an app without push credentials is refused when a new push message is sent', async () => {
    const at = await pushing({ internal: INTERNAL });
    await at.press('New Push message');
    await settle();
    at.type('name', 'Receipt two');
    at.type('content.customerKey', 'receipt_push');
    at.type('applicationId', 'app-2');
    const refused = at.form().querySelector(REFUSED);
    assert.equal(refused.hidden, false);
    assert.equal(at.field('applicationId').validity.customError, true);
    await at.send();
    assert.deepEqual(at.written, []);
    // what was typed stays, to be put right
    assert.equal(at.field('name').value, 'Receipt two');
    at.type('applicationId', 'app-1');
    assert.equal(refused.hidden, true);
    await at.send();
    assert.deepEqual(at.written, ['POST push/definitions']);
    assert.equal(at.changes()[0].applicationId, 'app-1');
});

test('a refusal of an app does not outlive the list it came from', async () => {
    const at = await pushing({ internal: INTERNAL });
    await at.press('New Push message');
    await settle();
    at.type('name', 'Receipt two');
    at.type('content.customerKey', 'receipt_push');
    at.type('applicationId', 'app-2');
    assert.equal(at.field('applicationId').validity.customError, true);
    // the menu is drawn again, as after a change of the business unit: the lists are dropped
    at.document.body.insertAdjacentHTML('beforeend', MENU);
    at.document.querySelector('[data-sfmc-ux-tools-transactional]').closest('ul').remove();
    await settle();
    await at.send();
    assert.equal(at.form()?.querySelector(REFUSED)?.hidden ?? true, true);
    assert.deepEqual(at.written, ['POST push/definitions']);
});

test('without the list that tells which apps lack credentials, no app is greyed or refused', async () => {
    for (const has of [{ down: [INTERNAL_APPS], internal: INTERNAL }, { internal: [] }]) {
        const at = await pushing(has);
        await at.press('New Push message');
        await settle();
        const app = picker(at);
        app.input.focus();
        assert.equal(app.shown().length, 3);
        assert.deepEqual(barred(app), []);
        assert.equal(app.list.querySelector(MORE), null);
        app.pick('app-2');
        assert.equal(app.input.value, 'app-2');
        at.type('name', 'Receipt two');
        at.type('content.customerKey', 'receipt_push');
        await at.send();
        assert.deepEqual(at.written, ['POST push/definitions']);
        assert.equal(at.form()?.querySelector(REFUSED)?.hidden ?? true, true);
    }
});

const ATTRIBUTES = 'contacts/v1/attributeSetDefinitions';
// the attribute sets of a business unit: only what it added to MobileConnect Demographics counts
const SETS = {
    items: [
        { key: 'Other', attributes: [{ storageName: 'Elsewhere', isSystemDefined: false }] },
        {
            key: 'MobileDemographics',
            attributes: [
                { storageName: '_ContactID', isSystemDefined: true },
                { storageName: '_FirstName', isSystemDefined: false },
                { storageName: 'Loyalty_Tier', isSystemDefined: false },
                { storageName: '__Odd', isSystemDefined: false },
                { storageName: 7, isSystemDefined: false },
                { storageName: 'Unsaid' },
            ],
        },
    ],
};
const TOOLS = '.sfmc-ux-tools-transactional-tools';
const PERSON = '.sfmc-ux-tools-transactional-person';
const COUNT = '.sfmc-ux-tools-transactional-count';
const NON_GSM = 'sfmc-ux-tools-transactional-non-gsm';

/**
 * Answers for a business unit with attributes to personalise an SMS with.
 *
 * @param {object} [sets] the answer to the question for the attribute sets
 * @returns {(path: string, method: string) => object} what the API answers
 */
function personalising(sets) {
    return (path, method) => {
        if (path.startsWith(ATTRIBUTES)) {
            return sets ?? { body: SETS };
        }
        if (method === 'POST') {
            return { status: 201, body: { definitionKey: 'Order_shipped' } };
        }
        return { body: path.includes('?') ? { definitions: [] } : DEFINITION };
    };
}

/**
 * Gives a page with the form of an SMS ways to use the helpers below its message.
 *
 * @param {object} at the page with the form
 * @returns {object} the button for personalization, its list, and ways to use them
 */
function helpers(at) {
    const bar = at.form().querySelector(TOOLS);
    const person = bar.querySelector(PERSON);
    const list = bar.querySelector('[role="listbox"]');
    return {
        bar,
        person,
        list,
        isOpen: () => !list.parentElement.hidden && person.getAttribute('aria-expanded') === 'true',
        names: () => [...list.children].map((item) => item.textContent),
        key: (key) =>
            fire(
                list,
                new at.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
            ),
        count: () => bar.querySelector(COUNT).textContent,
        reveal: () => [...bar.querySelectorAll('button')].find((item) => item !== person),
    };
}

test('a button inserts a personalization string for an attribute of the business unit into the message', async () => {
    const at = await form('sms', personalising());
    await tick();
    assert.equal(
        at.looked.filter((path) => path.startsWith(ATTRIBUTES)).join(' '),
        `${ATTRIBUTES}?$pageSize=500`,
    );
    const { bar, person, list, isOpen, names, key } = helpers(at);
    const field = at.field(MESSAGE);
    // below the line of the field, outside of its label
    assert.equal(field.closest('label').nextElementSibling, bar);
    assert.equal(person.hidden, false);
    assert.equal(person.type, 'button');
    assert.equal(person.title, 'Insert personalization');
    assert.equal(person.getAttribute('aria-label'), 'Insert personalization');
    assert.equal(isOpen(), false);
    person.click();
    assert.equal(isOpen(), true);
    assert.equal(at.document.activeElement, list);
    // the list names the attribute the keys are at
    assert.equal(list.getAttribute('aria-activedescendant'), list.firstElementChild.id);
    assert.equal(new Set([...list.children].map((item) => item.id)).size, 3);
    // what the business unit added, without the one underscore the storage puts before a name
    assert.deepEqual(names(), ['FirstName', 'Loyalty_Tier', '_Odd']);
    // at the cursor, with the keys
    at.type(MESSAGE, 'Hi !');
    field.setSelectionRange(3, 3);
    let inputs = 0;
    field.addEventListener('input', () => inputs++);
    key('ArrowDown');
    key('Enter');
    assert.equal(field.value, 'Hi %%Loyalty_Tier%%!');
    assert.equal(inputs, 1);
    assert.equal(isOpen(), false);
    assert.equal(at.document.activeElement, field);
    // in place of what is marked, with the mouse
    field.setSelectionRange(0, 2);
    person.click();
    fire(
        list.firstElementChild,
        new at.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    assert.equal(field.value, '%%FirstName%% %%Loyalty_Tier%%!');
    assert.equal(isOpen(), false);
    // the arrow keys go round, and a second click on the button closes the list
    person.click();
    key('ArrowUp');
    assert.equal(list.lastElementChild.getAttribute('aria-selected'), 'true');
    assert.equal(list.getAttribute('aria-activedescendant'), list.lastElementChild.id);
    person.click();
    assert.equal(isOpen(), false);
    assert.equal(list.hasAttribute('aria-activedescendant'), false);
    assert.equal(at.document.activeElement, person);
    // it is sent like anything typed
    at.type('name', 'Order shipped');
    at.type('subscriptions.shortCode', '4912312345678');
    at.type('subscriptions.keyword', 'ORDER');
    await at.send();
    assert.deepEqual(at.sent()[0].content, { message: '%%FirstName%% %%Loyalty_Tier%%!' });
});

test('Escape closes the list of attributes and not the panel', async () => {
    const at = await form('sms', personalising());
    await tick();
    const { person, isOpen, key } = helpers(at);
    at.type('name', 'Order shipped');
    let reached = 0;
    at.panel().addEventListener('keydown', () => reached++);
    person.click();
    const escape = key('Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(reached, 0);
    assert.equal(isOpen(), false);
    assert.equal(at.panel().open, true);
    assert.equal(at.document.activeElement, person);
    assert.equal(at.field('name').value, 'Order shipped');
    // so does leaving it
    person.click();
    at.field('name').focus();
    assert.equal(isOpen(), false);
});

test('without attributes to insert there is no button for personalization, and a message that cannot be changed has no helpers', async () => {
    const answers = [
        { status: 500, body: { message: 'No' } },
        { isDown: true },
        { body: { items: [] } },
        {
            body: {
                items: [{ key: 'MobileDemographics', attributes: [SETS.items[1].attributes[0]] }],
            },
        },
        { body: { items: [{ key: 'MobileDemographics' }] } },
    ];
    for (const sets of answers) {
        const at = await form('sms', personalising(sets));
        await tick();
        assert.equal(helpers(at).person.hidden, true);
        assert.equal(at.form().querySelector('.sfmc-ux-tools-transactional-error').hidden, true);
        // the form works as ever
        at.type('name', 'Order shipped');
        at.type(MESSAGE, 'On its way.');
        at.type('subscriptions.shortCode', '4912312345678');
        at.type('subscriptions.keyword', 'ORDER');
        await at.send();
        assert.deepEqual(at.sent()[0].content, { message: 'On its way.' });
    }
    const odd = await editing({ ...DEFINITION, content: { message: { not: 'text' } } });
    assert.equal(odd.field(MESSAGE).disabled, true);
    assert.equal(odd.form().querySelector(TOOLS), null);
});

test('the attribute goes into the code editor at its cursor, and from there into the message', async () => {
    const at = await withEditor(() => form('sms', personalising()));
    const { bar, person, key, isOpen } = helpers(at);
    const editor = at.editor();
    // the editor stands between the line of the field and the helpers
    assert.equal(editor.getWrapperElement().parentNode.nextElementSibling, bar);
    editor.setValue('Hi !\nBye');
    editor.setCursor({ line: 0, ch: 3 });
    person.click();
    key(' ');
    assert.equal(editor.getValue(), 'Hi %%FirstName%%!\nBye');
    assert.equal(at.field(MESSAGE).value, 'Hi %%FirstName%%!\nBye');
    assert.equal(isOpen(), false);
    assert.equal(at.document.activeElement, editor.getInputField());
});

test('the length of an SMS is counted below it, with what the GSM alphabet does not have', async () => {
    const at = await form('sms');
    await tick();
    const { count, reveal } = helpers(at);
    assert.equal(count(), '0 characters');
    const texts = [
        ['a', '1 character'],
        ['Hello\nyou', '9 characters'],
        // the whole basic set counts one each
        ['@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¤¡ÄÖÑÜ§¿äöñüà', '42 characters'],
        // what the extension table has takes the room of two
        ['€[x', '5 characters'],
        ['\f^{}\\[~]|€', '20 characters'],
        // an emoji is one character
        ['Hi 😀 ‘x’', '8 characters · 3 not in the GSM alphabet'],
        ['ç', '1 character · 1 not in the GSM alphabet'],
        ['Hi %%FirstName%%', '16 characters · length depends on personalization'],
        [
            'Hi %%Name%% ✓',
            '13 characters · 1 not in the GSM alphabet · length depends on personalization',
        ],
    ];
    for (const [text, said] of texts) {
        at.type(MESSAGE, text);
        assert.equal(count(), said, text);
        // only the code editor can mark them
        assert.equal(reveal().hidden, true);
    }
    assert.equal(reveal().textContent, 'Show non-GSM characters');
    // a message that exists is counted at once
    const stored = await editing();
    assert.equal(helpers(stored).count(), '13 characters');
});

test('"Show non-GSM characters" marks them in the code editor until the message is changed', async () => {
    const at = await withEditor(() => form('sms'));
    const { count, reveal } = helpers(at);
    const editor = at.editor();
    const marked = () =>
        [...editor.getAllMarks()]
            .filter((mark) => mark.className === NON_GSM)
            .map((mark) => {
                const { from, to } = mark.find();
                return [from.line, from.ch, to.line, to.ch];
            });
    assert.equal(reveal().hidden, true);
    editor.setValue('a😀b\nç‘ €');
    assert.equal(count(), '9 characters · 3 not in the GSM alphabet');
    assert.equal(reveal().hidden, false);
    assert.equal(reveal().type, 'button');
    // nothing is marked before it is asked for
    assert.deepEqual(marked(), []);
    reveal().click();
    assert.deepEqual(marked(), [
        [0, 1, 0, 3],
        [1, 0, 1, 1],
        [1, 1, 1, 2],
    ]);
    // asked for again, they are marked once
    reveal().click();
    assert.equal(marked().length, 3);
    assert.deepEqual(at.written, []);
    // the next change takes the marks away; they are not put back by themselves
    editor.replaceRange('!', { line: 0, ch: 0 });
    assert.deepEqual(marked(), []);
    assert.equal(reveal().hidden, false);
    // nothing to show: no button
    editor.setValue('plain text');
    assert.equal(count(), '10 characters');
    assert.equal(reveal().hidden, true);
});

test('the stylesheet greys an app that cannot be chosen, and styles the helpers of a message', () => {
    const css = read('../src/transactional-messages.css');
    assert.match(css, /\.sfmc-ux-tools-transactional-combo-off \{/);
    assert.match(css, /\.sfmc-ux-tools-transactional-refused\[hidden\] \{\s*display: none;/);
    assert.match(css, /\.sfmc-ux-tools-transactional-tools button\[hidden\] \{\s*display: none;/);
    assert.match(css, /\.sfmc-ux-tools-transactional-non-gsm \{/);
});
