import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const script = read('../src/key-rule.js') + read('../src/journey-builder.js');
const settings = read('../src/journey-settings.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// stands in for the bubble of a field's message, which jsdom does not draw
const showNothing = () => {};
// time for a question to the server, its answer and what the script draws after it
const settle = async () => {
    await tick();
    await tick();
    await tick();
};
const KEYS = 'data-sfmc-ux-tools-readable-keys';
const NAMES = 'data-sfmc-ux-tools-journey-name-check';
const RANDOM_JOURNEY = 'fa501d7e-54b2-5a57-a91b-ea60afba369a';
const RANDOM_EVENT = 'APIEvent-1bce0f25-d8bc-aba6-5843-65de08c72431';
const JOURNEYS = '/fuelapi/interaction/v1/interactions/';
const EVENTS = '/fuelapi/interaction/v1/eventDefinitions';
const CANVAS =
    '<div class="name-editor"><div class="readonly-text">NAME</div><span class="edit-icon"></span>' +
    '<input class="editable-text" /></div>' +
    '<button id="control-save" class="control-save">Save</button>' +
    '<button class="control-activate">Activate</button><button id="other">Other</button>';
const EVENT_PANEL =
    '<div class="api-event-hub-view"><div id="activity-name"><input id="activity-name-input" value="Order placed" /></div>' +
    `<div id="activity-description">${RANDOM_EVENT}</div></div>`;

/**
 * Runs the Journey Builder script in a page and records what it lets through to the server.
 *
 * @param {string} [html] content of the page
 * @param {string} [hash] route of the page
 * @returns {{window: Window, document: Document, post: (url: string, body: object | string, method?: string) => object | string, sent: unknown[]}} the page, a way to send a request as the page would, and what was sent
 */
function page(html = '', hash = '') {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
        url: `https://jbinteractions.s7.marketingcloudapps.com/${hash}`,
    });
    const sent = [];
    // what the script wraps: nothing leaves the test
    window.XMLHttpRequest.prototype.open = () => {};
    window.XMLHttpRequest.prototype.abort = () => {};
    window.XMLHttpRequest.prototype.send = (body) => {
        sent.push(body);
    };
    // the server's answer to the question whether a key is free: journeys and events differ
    const taken = new Set();
    const asked = [];
    const server = { taken, asked, status: null, holder: null, options: null };
    window.fetch = (url, options) => {
        const key = decodeURIComponent(url.split('/key:', 2)[1]);
        asked.push(url);
        server.options = options;
        const free = url.includes('eventDefinitions') ? 400 : 404;
        // what is found names its key
        const found = server.holder ?? key;
        return Promise.resolve({
            status: server.status ?? (taken.has(key) ? 200 : free),
            json: () => Promise.resolve({ key: found, eventDefinitionKey: found }),
        });
    };
    window.eval(script);
    return {
        window,
        document: window.document,
        sent,
        server,
        post: async (url, body, method = 'POST') => {
            const request = new window.XMLHttpRequest();
            request.open(method, url, true);
            request.send(typeof body === 'string' ? body : JSON.stringify(body));
            // one question to the server, with its answer read, for every key that is tried
            for (let turn = 0; turn <= 2 * taken.size + 2; turn++) {
                await tick();
            }
            const last = sent.at(-1);
            return typeof body === 'string' ? last : JSON.parse(last);
        },
    };
}

test('a key that is taken gets a number, so that no journey becomes a version of another', async () => {
    const { post, server } = page();
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    server.taken.add('Welcome_series');
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series_2');
    assert.deepEqual(server.asked, [
        '/fuelapi/interaction/v1/interactions/key:Welcome_series',
        '/fuelapi/interaction/v1/interactions/key:Welcome_series_2',
    ]);
    server.taken.add('Welcome_series_2');
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series_3');
    // the number fits into the longest key there is
    const long = 'a'.repeat(200);
    server.taken.add(long);
    assert.equal((await post(JOURNEYS, { ...journey, name: long })).key, `${'a'.repeat(198)}_2`);
    // events are asked for at their own address, with a different answer for a free key
    const event = { name: 'Order placed', eventDefinitionKey: RANDOM_EVENT };
    server.taken.add('Order_placed');
    assert.equal((await post(EVENTS, event)).eventDefinitionKey, 'Order_placed_2');
    assert.equal(
        server.asked.at(-1),
        '/fuelapi/interaction/v1/eventDefinitions/key:Order_placed_2',
    );
});

test('if the server does not say whether a key is free, the request goes out as the page wrote it', async () => {
    const { window, post, server, sent } = page();
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    server.status = 500;
    assert.equal((await post(JOURNEYS, journey)).key, RANDOM_JOURNEY);
    window.fetch = () => Promise.reject(new Error('offline'));
    assert.equal((await post(JOURNEYS, journey)).key, RANDOM_JOURNEY);
    // a request the page waits for cannot wait for that question
    const request = new window.XMLHttpRequest();
    request.open('POST', JOURNEYS, false);
    request.send(JSON.stringify(journey));
    assert.equal(JSON.parse(sent.at(-1)).key, RANDOM_JOURNEY);
});

test('the question whether a key is free is asked with care, and only an answer that names the key counts', async () => {
    const { post, server } = page();
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    await post(JOURNEYS, journey);
    // a login page instead of an answer, or no answer at all, ends the question
    assert.equal(server.options.redirect, 'error');
    assert.equal(server.options.credentials, 'same-origin');
    assert.ok(server.options.signal);
    // "found", but something else than what was asked for: the key is not counted up for ever
    server.status = 200;
    server.holder = 'something else';
    assert.equal((await post(JOURNEYS, journey)).key, RANDOM_JOURNEY);
    // what is found under a key that differs in upper and lower case only has that key
    server.status = null;
    server.holder = 'WELCOME_SERIES';
    server.taken.add('Welcome_series');
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series_2');
    server.holder = null;
    // a request to another server is none of this page's journeys
    const asked = server.asked.length;
    assert.equal((await post(`https://example.com${JOURNEYS}`, journey)).key, RANDOM_JOURNEY);
    assert.equal(server.asked.length, asked);
});

test('a request the page gave up or opened again while the key was asked for is not sent', async () => {
    const { window, sent } = page();
    const journey = JSON.stringify({ name: 'Welcome', id: null, version: 1, key: RANDOM_JOURNEY });
    const given = new window.XMLHttpRequest();
    given.open('POST', JOURNEYS, true);
    given.send(journey);
    given.abort();
    const reopened = new window.XMLHttpRequest();
    reopened.open('POST', JOURNEYS, true);
    reopened.send(journey);
    reopened.open('GET', '/fuelapi/other', true);
    await tick();
    await tick();
    await tick();
    assert.deepEqual(sent, []);
});

test('a new journey is created with a key derived from its name', async () => {
    const { post } = page();
    const journey = { name: 'Welcome series (2026)', id: null, version: 1, key: RANDOM_JOURNEY };
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series_2026');
    // the address without the slash at its end, and one that names the host
    assert.equal((await post(JOURNEYS.slice(0, -1), journey)).key, 'Welcome_series_2026');
    assert.equal(
        (await post(`https://jbinteractions.s7.marketingcloudapps.com${JOURNEYS}`, journey)).key,
        'Welcome_series_2026',
    );
    // everything else in the request stays
    assert.deepEqual(await post(JOURNEYS, { ...journey, activities: [{ key: 'EMAILV2-1' }] }), {
        ...journey,
        key: 'Welcome_series_2026',
        activities: [{ key: 'EMAILV2-1' }],
    });
});

test('what is no new journey keeps the key it is sent with', async () => {
    const { post } = page();
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    const cases = {
        'a later version of a journey': { ...journey, version: 2 },
        'a journey that exists': { ...journey, id: 'efeafe99-e620-4e8d-aacc-cc7eee177ae5' },
        'a key that is not a random one': { ...journey, key: 'my_own_key' },
        'a name that gives no key': { ...journey, name: '日本語' },
        'a journey without a name': { ...journey, name: undefined },
    };
    for (const [what, body] of Object.entries(cases)) {
        assert.equal((await post(JOURNEYS, body)).key, body.key, what);
    }
    // other methods and other addresses
    assert.equal((await post(`${JOURNEYS}?versionNumber=1`, journey, 'PUT')).key, RANDOM_JOURNEY);
    assert.equal((await post(`${JOURNEYS}publishAsync/abc`, journey)).key, RANDOM_JOURNEY);
    assert.equal((await post('/fuelapi/other/v1/things/', journey)).key, RANDOM_JOURNEY);
});

test('what is no request of that kind goes out untouched', async () => {
    const { window, sent, post } = page();
    assert.equal(await post(JOURNEYS, 'not json'), 'not json');
    const form = new window.FormData();
    const request = new window.XMLHttpRequest();
    request.open('POST', JOURNEYS);
    request.send(form);
    assert.equal(sent.at(-1), form);
    // a request that was never opened
    new window.XMLHttpRequest().send('{}');
    assert.equal(sent.at(-1), '{}');
});

test('a new API event gets a key from its name; events of other kinds keep theirs', async () => {
    const { post } = page();
    const event = { name: 'Order placed', type: 'APIEvent', eventDefinitionKey: RANDOM_EVENT };
    assert.equal((await post(EVENTS, event)).eventDefinitionKey, 'Order_placed');
    const audience = `DEAudience-${RANDOM_JOURNEY}`;
    assert.equal(
        (await post(EVENTS, { ...event, eventDefinitionKey: audience })).eventDefinitionKey,
        audience,
    );
    assert.equal((await post(EVENTS, { ...event, id: 'abc' })).eventDefinitionKey, RANDOM_EVENT);
});

test('the key of a new API event is a field that follows the name until the user types a key', async () => {
    const { window, document, post } = page('<div id="app"></div>');
    document.querySelector('#app').innerHTML = EVENT_PANEL;
    // the server is asked first whether the event was ever saved
    await settle();
    const field = document.querySelector('#activity-description input');
    assert.equal(field.value, 'Order_placed');
    assert.equal(field.maxLength, 200);
    const name = document.querySelector('#activity-name-input');
    name.value = 'Order shipped';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(field.value, 'Order_shipped');
    const event = { name: 'Order shipped', eventDefinitionKey: RANDOM_EVENT };
    // a key of the user's own is kept, also when the page draws the settings again
    field.value = 'orders.shipped';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    name.value = 'Order shipped today';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(field.value, 'orders.shipped');
    document.querySelector('#app').innerHTML = EVENT_PANEL;
    await settle();
    assert.equal(document.querySelector('#activity-description input').value, 'orders.shipped');
    assert.equal((await post(EVENTS, event)).eventDefinitionKey, 'orders.shipped');
    // an emptied field follows the name again
    const redrawn = document.querySelector('#activity-description input');
    redrawn.value = '';
    redrawn.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal((await post(EVENTS, event)).eventDefinitionKey, 'Order_shipped');
});

test('the key of an event that exists stays the text it was', async () => {
    const { document } = page('<div id="app"></div>');
    document.querySelector('#app').innerHTML = EVENT_PANEL.replace(RANDOM_EVENT, 'Order_placed');
    await tick();
    assert.equal(document.querySelector('#activity-description').textContent, 'Order_placed');
    assert.equal(document.querySelector('#activity-description input'), null);
    // also an event that was saved under the key Journey Builder made up
    const saved = page('<div id="app"></div>');
    saved.server.taken.add(RANDOM_EVENT);
    saved.document.querySelector('#app').innerHTML = EVENT_PANEL;
    await settle();
    assert.equal(saved.document.querySelector('#activity-description').textContent, RANDOM_EVENT);
    // and one that was saved under that key a moment ago, as its name gave no readable one
    const fresh = page('<div id="app"></div>');
    fresh.document.querySelector('#app').innerHTML = EVENT_PANEL;
    await settle();
    assert.notEqual(fresh.document.querySelector('.sfmc-ux-tools-event-key'), null);
    await fresh.post(EVENTS, { name: '日本語', eventDefinitionKey: RANDOM_EVENT });
    fresh.document.querySelector('#app').innerHTML = EVENT_PANEL;
    await settle();
    assert.equal(fresh.document.querySelector('.sfmc-ux-tools-event-key'), null);
    // and one the server gives no answer for
    const unknown = page('<div id="app"></div>');
    unknown.server.status = 500;
    unknown.document.querySelector('#app').innerHTML = EVENT_PANEL;
    await settle();
    assert.equal(unknown.document.querySelector('.sfmc-ux-tools-event-key'), null);
});

test('the key a transactional journey asks for is filled from the name of the journey, once', async () => {
    const { window, document } = page(
        `${CANVAS.replace('NAME', 'Password reset')}<div id="app"></div>`,
        '#simple/transactional/email',
    );
    const panel =
        '<div class="transactional-summary-view"><input class="event-key" maxlength="36" /></div>';
    const heard = [];
    document.addEventListener('keyup', () => {
        heard.push('keyup');
    });
    document.querySelector('#app').innerHTML = panel;
    await tick();
    const field = document.querySelector('.event-key');
    assert.equal(field.value, 'Password_reset');
    assert.deepEqual(heard, ['keyup']);
    // a field the user emptied is left alone
    field.value = '';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('#app').append(document.createElement('span'));
    await tick();
    assert.equal(field.value, '');
    // a field that comes with a key keeps it
    document.querySelector('#app').innerHTML = panel.replace('<input', '<input value="mine"');
    await tick();
    assert.equal(document.querySelector('.event-key').value, 'mine');
    // a journey that was saved has an address of its own; its key field is left empty
    const saved = page(
        `${CANVAS.replace('NAME', 'Password reset')}<div id="app"></div>`,
        '#a0dca65b/1',
    );
    saved.document.querySelector('#app').innerHTML = panel;
    await tick();
    assert.equal(saved.document.querySelector('.event-key').value, '');
});

/**
 * Opens the page that starts a journey, lets it show the name Journey Builder made up, and moves
 * on to the canvas.
 *
 * @param {string} [name] name the journey gets on the canvas
 * @param {string} [typed] name the user gives the journey on the page that starts it
 * @returns {Promise.<{window: Window, document: Document, click: (selector: string) => boolean}>} the page and a way to click, which tells whether the click got through to the page
 */
async function canvas(name, typed) {
    const made = 'New Journey - 18 November 2026 at 11.03';
    // the page is drawn before its address changes, and with the name of the journey before
    const { window, document } = page('<div id="app"></div>', '#dashboard/view/all-journeys');
    const app = document.querySelector('#app');
    app.innerHTML =
        '<div id="journey-name-input"><div id="journey-name-input_text"><label class="sr-only">Journey Name</label><span>The journey before</span></div></div>';
    await tick();
    window.location.hash = '#start';
    app.querySelector('span').textContent = made;
    await tick();
    if (typed) {
        // the user names the journey right there
        const text = app.querySelector('#journey-name-input_text');
        text.innerHTML = '<input />';
        text.firstChild.value = typed;
        text.firstChild.dispatchEvent(new window.Event('input', { bubbles: true }));
        text.innerHTML = `<label class="sr-only">Journey Name</label><span>${typed}</span>`;
        await tick();
    }
    window.location.hash = '#00000000-0000-0000-0000-000000000000/1';
    app.innerHTML = CANVAS.replace('NAME', () => name ?? typed ?? made);
    await tick();
    let isThrough = false;
    // only the click on a button counts, not the one that opens the name for editing
    document.querySelector('#app').addEventListener('click', (event) => {
        if (event.target.matches('button')) {
            isThrough = !event.defaultPrevented;
        }
    });
    // jsdom has no bubble to show
    window.HTMLInputElement.prototype.reportValidity = showNothing;
    return {
        window,
        document,
        click: (selector) => {
            isThrough = false;
            document
                .querySelector(selector)
                .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
            return isThrough;
        },
    };
}

test('a journey that still has the name Journey Builder made up is not saved; the name is asked for', async () => {
    const { window, document, click } = await canvas();
    let isEditing = false;
    document.querySelector('.edit-icon').addEventListener('click', () => {
        isEditing = true;
    });
    assert.equal(click('#control-save'), false);
    assert.equal(isEditing, true);
    const field = document.querySelector('.name-editor input');
    assert.match(field.validationMessage, /name of its own/);
    assert.equal(click('.control-activate'), false);
    // other buttons work
    assert.equal(click('#other'), true);
    // typing takes the message away, and a journey with a name of its own is saved
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(field.validationMessage, '');
    document.querySelector('.readonly-text').textContent = 'Welcome series';
    assert.equal(click('#control-save'), true);
});

test('a journey with a name of its own is saved, and the check can be switched off', async () => {
    const named = await canvas('Welcome series');
    assert.equal(named.click('#control-save'), true);
    // also when the name was given on the page that starts the journey
    const early = await canvas(undefined, 'Welcome series');
    assert.equal(early.click('#control-save'), true);
    const off = await canvas();
    off.document.documentElement.setAttribute(NAMES, 'off');
    assert.equal(off.click('#control-save'), true);
    // a journey that was not started in this page has no made-up name to compare with
    const { window, document } = page(CANVAS.replace('NAME', 'New Journey - 1 May 2026 at 9.00'));
    let isThrough = false;
    document.body.addEventListener('click', () => {
        isThrough = true;
    });
    document
        .querySelector('#control-save')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(isThrough, true);
});

const UNSAVED = '#00000000-0000-0000-0000-000000000000/1';
const SAVED_ID = 'efeafe99-e620-4e8d-aacc-cc7eee177ae5';
const DETAILS =
    '<span class="toggle-detail-icon"></span><ul class="slds-page-header__detail-row">' +
    '<li class="description-block">Description</li><li>Status</li></ul>';

/**
 * Lets the server answer a request of the page for journeys.
 *
 * @param {Window} window page the script runs in
 * @param {string} url address the page asks
 * @param {object} answer what the server says
 */
function answerJourneys(window, url, answer) {
    const request = new window.XMLHttpRequest();
    request.open('GET', url, true);
    Object.defineProperty(request, 'responseText', { value: JSON.stringify(answer) });
    request.send();
    request.dispatchEvent(new window.Event('load'));
}

test('a journey that was never saved shows its key as a field that follows the name until the user types a key', async () => {
    const { window, document, post } = page('<div id="app"></div>', UNSAVED);
    let opened = 0;
    document.addEventListener('click', (event) => {
        opened += event.target.matches('.toggle-detail-icon') ? 1 : 0;
    });
    const draw = async () => {
        document.querySelector('#app').innerHTML =
            CANVAS.replace('NAME', 'Welcome series') + DETAILS;
        await tick();
        return document.querySelector('.sfmc-ux-tools-journey-key input');
    };
    let field = await draw();
    assert.equal(field.value, 'Welcome_series');
    assert.equal(field.maxLength, 200);
    // right after the description, in a row that was opened for it
    assert.ok(field.closest('li').previousElementSibling.matches('.description-block'));
    assert.equal(opened, 1);
    // it follows the name while the name is typed
    const name = document.querySelector('.name-editor input');
    name.focus();
    name.value = 'Welcome series 2026';
    name.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(field.value, 'Welcome_series_2026');
    // a key of the user's own is kept, also when the page draws the journey again, and the row
    // is not opened a second time: the user may have closed it
    field.value = 'welcome-2026';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    field = await draw();
    assert.equal(field.value, 'welcome-2026');
    assert.equal(opened, 1);
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    assert.equal((await post(JOURNEYS, journey)).key, 'welcome-2026');
    // an emptied field follows the name again
    field.value = '';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series');
    // a key typed for a journey that is left unsaved is not carried over to the next one
    field.value = 'left-behind';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    window.location.hash = '#dashboard/view/all-journeys';
    document.querySelector('#app').innerHTML = '<p>Journeys Dashboard</p>';
    await tick();
    assert.equal((await post(JOURNEYS, journey)).key, 'Welcome_series');
    window.location.hash = UNSAVED;
    field = await draw();
    assert.equal(field.value, 'Welcome_series');
    assert.equal(opened, 2);
});

test('a saved journey shows its key as text, as soon as the server has told it', async () => {
    const { window, document } = page('<div id="app"></div>', UNSAVED);
    document.querySelector('#app').innerHTML = CANVAS + DETAILS;
    await tick();
    assert.notEqual(document.querySelector('.sfmc-ux-tools-journey-key input'), null);
    // the journey is saved: the page moves to its address and the server answers with its key
    window.location.hash = `#${SAVED_ID}/1`;
    answerJourneys(window, JOURNEYS, { id: SAVED_ID.toUpperCase(), key: 'Welcome_series_2' });
    const entry = document.querySelector('.sfmc-ux-tools-journey-key');
    assert.equal(entry.querySelector('input'), null);
    assert.equal(entry.lastElementChild.textContent, 'Welcome_series_2');
    assert.equal(document.querySelectorAll('.sfmc-ux-tools-journey-key').length, 1);
    // a journey that is opened is asked for by its id; lists of journeys tell keys as well
    const other = '11111111-2222-3333-4444-555555555555';
    answerJourneys(window, `${JOURNEYS}${other}?extras=all`, { key: 'By_address' });
    answerJourneys(window, `${JOURNEYS}?$page=1`, {
        items: [{ id: 'aaaaaaaa-2222-3333-4444-555555555555', key: 'From_a_list' }],
    });
    window.location.hash = `#${other}/2`;
    document.querySelector('#app').innerHTML = CANVAS + DETAILS;
    await tick();
    assert.equal(
        document.querySelector('.sfmc-ux-tools-journey-key').lastElementChild.textContent,
        'By_address',
    );
    window.location.hash = '#aaaaaaaa-2222-3333-4444-555555555555/1';
    document.querySelector('#app').innerHTML = CANVAS + DETAILS;
    await tick();
    assert.equal(
        document.querySelector('.sfmc-ux-tools-journey-key').lastElementChild.textContent,
        'From_a_list',
    );
    // a journey whose key the server has not told shows none
    window.location.hash = '#99999999-2222-3333-4444-555555555555/1';
    document.querySelector('#app').innerHTML = CANVAS + DETAILS;
    await tick();
    assert.equal(document.querySelector('.sfmc-ux-tools-journey-key'), null);
});

test('the key of a journey is shown where the details cannot be opened, and a saved key also with readable keys switched off', async () => {
    const simple = page('<div id="app"></div>', '#simple/transactional/email');
    const row = DETAILS.replace('<span class="toggle-detail-icon"></span>', '');
    simple.document.querySelector('#app').innerHTML = CANVAS.replace('NAME', 'Receipt') + row;
    await tick();
    assert.equal(
        simple.document.querySelector('.sfmc-ux-tools-journey-key').lastElementChild
            .firstElementChild.value,
        'Receipt',
    );
    assert.ok(
        simple.document
            .querySelector('.slds-page-header__detail-row')
            .classList.contains('detail-visible'),
    );
    const off = page('<div id="app"></div>', UNSAVED);
    off.document.documentElement.setAttribute(KEYS, 'off');
    off.document.querySelector('#app').innerHTML = CANVAS + DETAILS;
    await tick();
    assert.equal(off.document.querySelector('.sfmc-ux-tools-journey-key'), null);
    off.window.location.hash = `#${SAVED_ID}/1`;
    answerJourneys(off.window, `${JOURNEYS}${SAVED_ID}`, { id: SAVED_ID, key: 'Kept' });
    assert.equal(
        off.document.querySelector('.sfmc-ux-tools-journey-key').lastElementChild.textContent,
        'Kept',
    );
});

test('the key field of a new API event looks like the name field next to it', async () => {
    const { document } = page('<div id="app"></div>');
    const panel =
        '<div class="api-event-hub-view">' +
        '<div class="slds-form-element__control slds-border_bottom"><svg class="pencil"></svg>' +
        '<div id="activity-name"><input id="activity-name-input" class="slds-input slds-input_bare" value="Order placed" /></div></div>' +
        `<div class="slds-form-element__control slds-m-top_x-small"><div id="activity-description">${RANDOM_EVENT}</div></div></div>`;
    document.querySelector('#app').innerHTML = panel;
    await settle();
    const field = document.querySelector('.sfmc-ux-tools-event-key');
    const control = field.closest('.slds-form-element__control');
    assert.ok(field.classList.contains('slds-input_bare'));
    assert.ok(control.classList.contains('slds-border_bottom'));
    assert.ok(!control.classList.contains('slds-m-top_x-small'));
    assert.equal(control.querySelectorAll('svg.pencil[aria-hidden="true"]').length, 1);
    // once the page shows a key as text there again, its surroundings are as they were
    document.querySelector('#activity-description').textContent = 'Order_placed';
    await tick();
    assert.ok(!control.classList.contains('slds-border_bottom'));
    assert.ok(control.classList.contains('slds-m-top_x-small'));
    assert.equal(control.querySelector('svg'), null);
});

test('with readable keys switched off, requests and key fields are left alone', async () => {
    const { document, post } = page('<div id="app"></div>');
    document.documentElement.setAttribute(KEYS, 'off');
    const journey = { name: 'Welcome series', id: null, version: 1, key: RANDOM_JOURNEY };
    assert.equal((await post(JOURNEYS, journey)).key, RANDOM_JOURNEY);
    document.querySelector('#app').innerHTML =
        `${EVENT_PANEL}${CANVAS}<div class="transactional-summary-view"><input class="event-key" /></div>`;
    await tick();
    assert.equal(document.querySelector('#activity-description input'), null);
    assert.equal(document.querySelector('.event-key').value, '');
});

test('the settings reach the page, and the manifest runs both scripts on Journey Builder only', async () => {
    const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const listeners = [];
    window.chrome = {
        storage: {
            sync: { get: (defaults) => Promise.resolve({ ...defaults, journeyNameCheck: 'off' }) },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    window.eval(settings);
    const root = window.document.documentElement;
    assert.equal(root.getAttribute(KEYS), 'on');
    assert.equal(root.getAttribute(NAMES), 'on');
    await tick();
    assert.equal(root.getAttribute(NAMES), 'off');
    listeners[0]({ readableKeys: { newValue: 'off' }, editorTheme: { newValue: 'dark' } }, 'sync');
    assert.equal(root.getAttribute(KEYS), 'off');
    listeners[0]({ readableKeys: { newValue: 'on' } }, 'local');
    assert.equal(root.getAttribute(KEYS), 'off');

    const options = new JSDOM(read('../src/options.html')).window.document;
    assert.deepEqual(
        [...options.querySelectorAll('input[name="journeyNameCheck"]')].map((input) => input.value),
        ['on', 'off'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((item) =>
        item.js.some((file) => file.startsWith('journey-')),
    );
    assert.deepEqual(
        entries.map((item) => [
            item.js,
            item.world,
            item.include_globs,
            item.run_at,
            item.all_frames,
        ]),
        [
            [
                ['journey-settings.js'],
                undefined,
                ['https://jbinteractions.*'],
                'document_start',
                true,
            ],
            [
                ['key-rule.js', 'journey-builder.js'],
                'MAIN',
                ['https://jbinteractions.*'],
                'document_start',
                true,
            ],
        ],
    );
});
