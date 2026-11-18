import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const script = read('../src/key-rule.js') + read('../src/transactional-messages.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
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
    // jsdom has the element but not the two methods the panel uses
    window.eval(`
        HTMLDialogElement.prototype.showModal = function () {
            this.setAttribute('open', '');
        };
        HTMLDialogElement.prototype.close = function () {
            this.removeAttribute('open');
            this.dispatchEvent(new Event('close'));
        };
    `);
    window.chrome = {
        runtime: { getURL: (path) => `chrome-extension://id/${path}` },
        storage: {
            sync: {
                get: (defaults) =>
                    stored.isBroken
                        ? Promise.reject(new Error('broken'))
                        : Promise.resolve({ ...defaults, ...stored }),
            },
        },
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
        entry,
        panel,
        open: async () => {
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

test('a click opens the panel on the SMS list and does not reach the page', async () => {
    const at = page(MENU);
    let reached = 0;
    at.document.body.addEventListener('click', () => reached++);
    const click = new at.window.MouseEvent('click', { bubbles: true, cancelable: true });
    at.entry().dispatchEvent(click);
    await tick();
    assert.equal(click.defaultPrevented, true);
    assert.equal(reached, 0);
    assert.equal(at.panel().hasAttribute('open'), true);
    assert.deepEqual(at.asked, ['sms/definitions?$page=1&$pageSize=50']);
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
    assert.equal(at.asked.at(-1), 'push/definitions?$page=1&$pageSize=50');
    const cells = [...rows(at)].map((row) => [...row.cells].map((cell) => cell.textContent));
    assert.deepEqual(cells, [
        ['name of receipt', 'receipt', 'Active', '2026-01-02T03:04:00', '2026-01-03T03:04:00'],
        ['name of alert', 'alert', 'Active', '2026-01-02T03:04:00', '2026-01-03T03:04:00'],
    ]);
    assert.deepEqual(
        [...at.panel().querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Key', 'Status', 'Created', 'Modified'],
    );
    await tab(at, 'ott');
    assert.equal(at.asked.at(-1), 'ott/definitions?$page=1&$pageSize=50');
    assert.match(at.text(), /no transactional OTT messages/);
});

test('a long list is read page by page, and a count that is too high does not keep it reading', async () => {
    const full = Array.from({ length: 50 }, (_, index) => ROW(`first-${index}`));
    const at = page(MENU, (path) => ({
        // the count claims more rows than there are
        body: { definitions: path.includes('$page=1&') ? full : [ROW('last')], count: 999 },
    }));
    await at.open();
    assert.deepEqual(at.asked, [
        'sms/definitions?$page=1&$pageSize=50',
        'sms/definitions?$page=2&$pageSize=50',
    ]);
    assert.equal(rows(at).length, 51);
});

test('a full page that is the whole list ends the reading by its count', async () => {
    const full = Array.from({ length: 50 }, (_, index) => ROW(`row-${index}`));
    const at = page(MENU, () => ({ body: { definitions: full, count: 50 } }));
    await at.open();
    assert.equal(at.asked.length, 1);
});

// a page of a list that is as long as a page can be
const full = (name) => Array.from({ length: 50 }, (_, index) => ROW(`${name}-${index}`));

test('full pages without a count end when the rows repeat or run out', async () => {
    // the page asked for is ignored: always the same 50 rows, and no count
    const same = page(MENU, () => ({ body: { definitions: full('same') } }));
    await same.open();
    assert.equal(same.asked.length, 2);
    assert.equal(rows(same).length, 50);
    // the same with a count that is never reached
    const counted = page(MENU, () => ({ body: { definitions: full('same'), count: 999 } }));
    await counted.open();
    assert.equal(counted.asked.length, 2);
    // two full pages of different rows, then nothing more
    const pages = { 1: full('a'), 2: full('b'), 3: [] };
    const ends = page(MENU, (path) => ({
        body: { definitions: pages[/\$page=(\d+)/.exec(path)[1]] },
    }));
    await ends.open();
    assert.equal(ends.asked.length, 3);
    assert.equal(rows(ends).length, 100);
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
        ['no key', '', '', '', ''],
    );
    row.click();
    await tick();
    assert.equal(at.asked.at(-1), 'sms/definitions/we%2Flcome');
    const names = [...at.panel().querySelectorAll('dt')].map((item) => item.textContent);
    assert.ok(!names.includes('requestId'));
    assert.deepEqual(names.slice(-5), [
        'content',
        'message',
        'subscriptions',
        'shortCode',
        'keyword',
    ]);
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
    assert.equal(at.asked.at(-1), 'sms/definitions?$page=1&$pageSize=50');
});

/**
 * Opens the panel on the details of the SMS definition "welcome".
 *
 * @param {(path: string, method: string) => object} [answer] what the API answers to anything but the list and the first read of the details
 * @param {object} [definition] what the first read of the details returns
 * @returns {Promise.<object>} the page, with a way to click a button of the details by its text
 */
async function details(answer = () => ({ body: DEFINITION }), definition = DEFINITION) {
    let reads = 0;
    const at = page(MENU, (path, method) => {
        if (path.startsWith('sms/definitions?')) {
            return { body: { definitions: [ROW('welcome')], count: 1 } };
        }
        // the first read fills the details; what comes after is the test's business
        return method === 'GET' && reads++ === 0 ? { body: definition } : answer(path, method);
    });
    await at.open();
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
    assert.equal(at.calls.length, 2);
    for (const call of at.calls) {
        assert.equal(call.credentials, 'same-origin');
        assert.equal(call.redirect, 'error');
        assert.equal(call.method, 'GET');
        assert.ok(call.url.startsWith('/cloud/fuelapi/messaging/v1/sms/definitions'), call.url);
    }
    assert.ok(at.calls[0].url.endsWith('?$page=1&$pageSize=50&$filter=status%20neq%20deleted'));
    assert.ok(at.calls[1].url.endsWith('/definitions/welcome'));
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
        assert.equal(at.calls.at(-2).method, 'DELETE');
        assert.equal(at.calls.at(-2).credentials, 'same-origin');
        // the list was read again
        assert.equal(at.asked.at(-1), 'sms/definitions?$page=1&$pageSize=50');
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
    assert.equal(at.asked.at(-1), 'sms/definitions?$page=1&$pageSize=50');
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
    return [...at.field(path).list.children].map((item) => [item.value, item.label]);
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
            // the text of the message as typed; what was left empty is not sent
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
    assert.equal(at.asked.at(-1), 'ott/definitions?$page=1&$pageSize=50');
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
    assert.deepEqual(sms.looked, ['legacy/v1/beta/mobile/code/', 'legacy/v1/beta/mobile/keyword/']);
    // only what can be chosen: a code that is no text is left out
    assert.deepEqual(options(sms, 'subscriptions.shortCode'), [['4912312345678', 'DE']]);
    assert.deepEqual(options(sms, 'subscriptions.keyword'), [['ORDER', '4912312345678']]);
    const push = await form('push', answer);
    await tick();
    assert.deepEqual(push.looked, ['push/v1/application']);
    // names are shown as text, whatever they contain
    assert.deepEqual(options(push, 'applicationId'), [['app-1', 'Shop <b>app</b>']]);
    assert.equal(push.panel().querySelector('b'), null);
    // lists that cannot be read leave the fields as they are
    const down = await form('sms', (path) =>
        path.startsWith('legacy/') ? { isDown: true } : { body: { definitions: [] } },
    );
    await tick();
    assert.deepEqual(options(down, 'subscriptions.shortCode'), []);
    down.type('subscriptions.shortCode', '12345');
    assert.equal(down.field('subscriptions.shortCode').value, '12345');
    assert.equal(down.panel().querySelector('form') !== null, true);
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
    // the page may only load that one file of the extension
    assert.deepEqual(manifest.web_accessible_resources, [
        { resources: ['icons/icon16.png'], matches: ['https://*.exacttarget.com/*'] },
    ]);
    assert.equal(manifest.icons['16'], 'icons/icon16.png');
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
    assert.deepEqual(entry.css, ['transactional-messages.css']);
    // the rule that makes a key from a name comes first, for the form of a new message
    assert.deepEqual(entry.js, ['key-rule.js', 'transactional-messages.js']);
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
