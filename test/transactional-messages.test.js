import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/transactional-messages.js');
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
 * @returns {{window: Window, document: Document, asked: string[], written: string[], calls: object[], entry: () => Element, open: () => Promise.<void>, panel: () => Element, text: () => string}} the page, what was read from the API, what was sent to change something, and every request as it was made
 */
function page(html, answer = () => ({ body: { definitions: [], count: 0 } })) {
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
    window.chrome = { runtime: { getURL: (path) => `chrome-extension://id/${path}` } };
    const asked = [];
    const written = [];
    const calls = [];
    window.fetch = async (url, options) => {
        calls.push({ url, ...options });
        const prefix = '/cloud/fuelapi/messaging/v1/';
        // what is read is noted without the filter that every list carries
        const path = url.slice(prefix.length).replace('&$filter=status%20neq%20deleted', '');
        if (options.method === 'GET') {
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
 * @returns {Promise.<object>} the page, with a way to click a button of the details by its text
 */
async function details(answer = () => ({ body: DEFINITION })) {
    let reads = 0;
    const at = page(MENU, (path, method) => {
        if (path.startsWith('sms/definitions?')) {
            return { body: { definitions: [ROW('welcome')], count: 1 } };
        }
        // the first read fills the details; what comes after is the test's business
        return method === 'GET' && reads++ === 0 ? { body: DEFINITION } : answer(path, method);
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
