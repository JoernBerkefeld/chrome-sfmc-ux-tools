import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/mobile-delete.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const DETAILS_BUTTON = '[data-sfmc-ux-tools-mobile-delete="details"]';
const SELECTED_BUTTON = '[data-sfmc-ux-tools-mobile-delete="selected"]';
const ROW_BOX = 'input[data-sfmc-ux-tools-mobile-delete="row"]';
const HOST = 'https://mc.s7.marketingcloudapps.com';
const CONNECT = `${HOST}/MobileConnectFuel3/`;
const PUSH = `${HOST}/mobilepush/`;
const SMS_MESSAGE = 'legacy/v1/beta/mobile/message/';
const SMS_DEFINITIONS = 'messaging/v1/sms/definitions';
const PUSH_MESSAGE = 'push/v1/message/';
const PUSH_DEFINITIONS = 'messaging/v1/push/definitions';
// the id of a transactional definition, and the one a message without any holds
const OWNER = 'a1b2c3d4-0000-4000-8000-000000000001';
const NONE = '00000000-0000-0000-0000-000000000000';

/**
 * Builds a row of MobileConnect's list.
 *
 * @param {string} id id of the message
 * @returns {string} the row
 */
const smsRow = (id) =>
    `<tr><td><a data-id="${id}" data-status="1">name of ${id}</a></td><td>Draft</td></tr>`;
/**
 * Builds MobileConnect's list.
 *
 * @param {...string} ids ids of its messages
 * @returns {string} the list
 */
const smsList = (...ids) =>
    `<div id="messagesGridRepeater"><div class="repeater-header"><div class="repeater-header-left"><span>Messages</span></div></div><table><tbody>${ids.map((id) => smsRow(id)).join('')}</tbody></table></div>`;
/**
 * Builds a row of MobilePush's list.
 *
 * @param {string} id id of the message
 * @returns {string} the row
 */
const pushRow = (id) =>
    `<tr><td><div class="message-name-cell" data-id="${id}">name of ${id}</div></td></tr>`;
/**
 * Builds MobilePush's list.
 *
 * @param {...string} ids ids of its messages
 * @returns {string} the list
 */
const pushList = (...ids) =>
    `<div id="messageGridRepeater"><div class="repeater-header"></div><table><tbody>${ids.map((id) => pushRow(id)).join('')}</tbody></table></div>`;
const DETAILS =
    '<div class="container"><header class="header"><h3 class="title">A message</h3></header><div id="details"></div><div id="activity-log"></div></div>';

/**
 * Builds an SMS message as the API hands it out: a draft made in MobileConnect.
 *
 * @param {string} id its id
 * @param {object} [more] what differs
 * @returns {object} the message
 */
const smsMessage = (id, more) => ({
    id,
    name: `name of ${id}`,
    status: 'Draft',
    sendMethod: 'USER',
    smsTriggeredSendDefinitionId: NONE,
    ...more,
});
/**
 * Builds a push message as the API hands it out: an inactive one sent by hand.
 *
 * @param {string} id its id
 * @param {object} [more] what differs
 * @returns {object} the message
 */
const pushMessage = (id, more) => ({
    id,
    name: `name of ${id}`,
    status: 1,
    sendInitiator: 0,
    messageType: 1,
    ...more,
});

/**
 * Answers like the API of one of the apps.
 *
 * @param {object} has what the business unit holds
 * @param {string} has.message where the messages are
 * @param {string} has.list where the transactional definitions are
 * @param {Object.<string, object>} has.messages the messages by their id; changed by a delete
 * @param {object[]} [has.definitions] the rows of the list of transactional definitions
 * @param {Object.<string, object>} [has.details] what a definition answers by its key: {status, body}
 * @param {Object.<string, object>} [has.deletes] what the delete of a message answers by its id, instead of deleting it
 * @returns {(path: string, method: string) => object} the answer to a request
 */
function api({ message, list, messages, definitions = [], details = {}, deletes = {} }) {
    return (path, method) => {
        if (path.startsWith(message)) {
            const id = decodeURIComponent(path.slice(message.length));
            if (method === 'DELETE') {
                if (Object.hasOwn(deletes, id)) {
                    return deletes[id];
                }
                delete messages[id];
                // seen live: 200 with nothing in it
                return { status: 200 };
            }
            return Object.hasOwn(messages, id)
                ? { body: messages[id] }
                : { status: 404, body: { message: 'no such message' } };
        }
        if (path.startsWith(`${list}?`)) {
            const page = Number(/\$page=(\d+)/.exec(path)[1]);
            const size = Number(/\$pageSize=(\d+)/.exec(path)[1]);
            const rows = definitions.slice((page - 1) * size, page * size);
            // seen live: the answer repeats the size asked for
            return { body: { definitions: rows, count: rows.length, pageSize: size } };
        }
        if (path.startsWith(`${list}/`)) {
            const key = decodeURIComponent(path.slice(list.length + 1));
            return details[key] ?? { status: 500, body: { message: 'no answer set up' } };
        }
        return { status: 500, body: { message: `unexpected ${path}` } };
    };
}
const sms = (has) => api({ message: SMS_MESSAGE, list: SMS_DEFINITIONS, ...has });
const push = (has) => api({ message: PUSH_MESSAGE, list: PUSH_DEFINITIONS, ...has });
/**
 * Builds a transactional definition as its list has it and as it answers by itself.
 *
 * @param {string} key its key
 * @param {string} definitionId its id
 * @param {string} [name] its name
 * @returns {{row: object, detail: object}} both
 */
const definition = (key, definitionId, name = `definition ${key}`) => ({
    row: { name, definitionKey: key, status: 'Active' },
    detail: { body: { name, definitionKey: key, status: 'Active', definitionId } },
});

/**
 * Builds what was read of the transactional push definitions.
 *
 * @param {...string} list the names of those that are not deleted
 * @returns {{isComplete: boolean, names: Set.<string>}} the definitions, read completely
 */
const names = (...list) => ({ isComplete: true, names: new Set(list) });
/**
 * Builds a row of the list of transactional push definitions.
 *
 * @param {string} name its name
 * @param {string} [status] its status
 * @returns {object} the row
 */
const row = (name, status = 'Active') => ({ name, definitionKey: `key of ${name}`, status });

/**
 * Builds a business unit's messages: one SMS message that holds the id of a definition.
 *
 * @returns {Object.<string, object>} the messages by their id
 */
const heldByOwner = () => ({
    1: smsMessage('1', { sendMethod: 'API', smsTriggeredSendDefinitionId: OWNER }),
});

/**
 * Runs the script in a frame of one of the apps.
 *
 * @param {string} url address of the frame
 * @param {string} html content of the page
 * @param {(path: string, method: string) => {status?: number, body?: unknown, isDown?: boolean}} [answer] what the API answers to a path below it
 * @returns {object} the page, every request as "METHOD path", those that change something, and where the script wanted to go
 */
function page(url, html, answer = () => ({ status: 500 })) {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
        url,
    });
    // jsdom has the element but not the two methods the dialog uses
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
    const calls = [];
    const written = [];
    window.fetch = async (address, options) => {
        const base = `${new URL(url).pathname}fuelapi/`;
        const path = address.startsWith(base) ? address.slice(base.length) : address;
        calls.push(`${options.method} ${path}`);
        if (options.method !== 'GET') {
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
    const left = [];
    window.sfmcUxToolsMobileDelete.reload = () => {
        left.push('reload');
    };
    window.sfmcUxToolsMobileDelete.toOverview = () => {
        left.push('overview');
    };
    const { document } = window;
    const dialog = () => document.querySelector('dialog');
    const press = async (part) => {
        dialog().querySelector(`.sfmc-ux-tools-mobile-delete-${part}`).click();
        await tick();
    };
    return {
        window,
        document,
        calls,
        written,
        left,
        dialog,
        press,
        // a copy, because an object of the page is not one of the test
        judge: (...given) => ({ ...window.sfmcUxToolsMobileDelete.judge(...given) }),
        selectedButton: () => document.querySelector(SELECTED_BUTTON),
        detailsButton: () => document.querySelector(DETAILS_BUTTON),
        boxes: () => [...document.querySelectorAll(ROW_BOX)],
        /**
         * Ticks the rows of the given ids and clicks "Delete selected".
         *
         * @param {...string} ids ids of the messages
         */
        choose: async (...ids) => {
            for (const box of document.querySelectorAll(ROW_BOX)) {
                if (ids.includes(box.value)) {
                    box.click();
                }
            }
            document.querySelector(SELECTED_BUTTON).click();
            await tick();
        },
        text: () => dialog().textContent,
    };
}

/**
 * Runs the whole way for one SMS message that is ticked in the list, up to the question.
 *
 * @param {object} has what the business unit holds, see api()
 * @returns {Promise.<object>} the page
 */
async function asked(has) {
    const at = page(CONNECT, smsList(...Object.keys(has.messages)), sms(has));
    await at.choose(...Object.keys(has.messages));
    return at;
}

test('the judgement allows an SMS message without a definition and refuses whatever it cannot be sure of', () => {
    const { judge } = page(CONNECT, '');
    const none = { isComplete: true, ids: new Set() };
    const allowed = (message, definitions) =>
        judge('sms', message?.id ?? '5', message, definitions).isAllowed;

    assert.deepEqual(judge('sms', '5', smsMessage('5')), { isAllowed: true, name: 'name of 5' });
    // "no definition": the empty GUID that was seen live, and a plain zero
    for (const held of [NONE, 0, '0']) {
        assert.equal(allowed(smsMessage('5', { smsTriggeredSendDefinitionId: held })), true);
    }
    // shapes that were never seen are not "no definition"
    for (const held of [null, '', ' ', '\t']) {
        const verdict = judge('sms', '5', smsMessage('5', { smsTriggeredSendDefinitionId: held }));
        assert.equal(verdict.isAllowed, false, JSON.stringify(held));
        assert.match(verdict.reason, /lacks what is needed/, JSON.stringify(held));
        assert.equal(verdict.needs, undefined, JSON.stringify(held));
    }
    // text without a zero, or with blanks in it, is taken as an id and held against the definitions
    for (const held of ['-', '--', '0 0', ' 0']) {
        const message = smsMessage('5', { smsTriggeredSendDefinitionId: held });
        assert.equal(judge('sms', '5', message).isAllowed, false, held);
        assert.equal(judge('sms', '5', message).needs, true, held);
    }
    // an active one that the API triggers, made in MobileConnect
    assert.equal(allowed(smsMessage('5', { sendMethod: 'API', status: 'Active/Scheduled' })), true);
    // an id as a number is the same id
    assert.equal(judge('sms', '5', smsMessage(5)).isAllowed, true);

    // not a message, or not the one asked for
    for (const message of [undefined, null, 'text', [], [smsMessage('5')]]) {
        assert.equal(judge('sms', '5', message, none).isAllowed, false);
    }
    assert.equal(judge('sms', '5', smsMessage('6'), none).isAllowed, false);
    assert.equal(judge('sms', '5', { ...smsMessage('5'), id: undefined }, none).isAllowed, false);
    assert.equal(judge('sms', '', smsMessage(''), none).isAllowed, false);
    // a field that is missing never counts as "not a journey" or as 0
    for (const field of ['name', 'sendMethod', 'smsTriggeredSendDefinitionId']) {
        const message = smsMessage('5');
        delete message[field];
        assert.equal(allowed(message, none), false, field);
    }
    for (const more of [
        { name: '' },
        { name: 7 },
        { sendMethod: '' },
        { sendMethod: 3 },
        { smsTriggeredSendDefinitionId: {} },
        { smsTriggeredSendDefinitionId: true },
        { smsTriggeredSendDefinitionId: undefined },
    ]) {
        assert.equal(allowed(smsMessage('5', more), none), false, JSON.stringify(more));
    }
    // a journey's message, whatever else it holds and however it is spelled
    for (const sendMethod of ['INTERACTION', 'Interaction', ' interaction ']) {
        const verdict = judge('sms', '5', smsMessage('5', { sendMethod }), none);
        assert.equal(verdict.isAllowed, false);
        assert.match(verdict.reason, /journey/i);
    }
    // an unknown kind of app
    assert.equal(judge('email', '5', smsMessage('5'), none).isAllowed, false);
});

test('the judgement holds an SMS message with a definition id against the ids of all definitions', () => {
    const { judge } = page(CONNECT, '');
    const held = (sendMethod = 'API') =>
        smsMessage('5', { sendMethod, smsTriggeredSendDefinitionId: OWNER });
    const owned = { isComplete: true, ids: new Set([OWNER]) };
    const others = { isComplete: true, ids: new Set(['a1b2c3d4-0000-4000-8000-000000000002']) };

    // without the definitions it is refused, and says that it takes them
    const blind = judge('sms', '5', held());
    assert.equal(blind.isAllowed, false);
    assert.equal(blind.needs, true);
    // the send method is no shortcut: the id alone starts the check
    for (const sendMethod of ['API', 'USER', 'SOMETHING']) {
        assert.equal(judge('sms', '5', held(sendMethod)).needs, true);
        const verdict = judge('sms', '5', held(sendMethod), owned);
        assert.equal(verdict.isAllowed, false);
        assert.match(verdict.reason, /transactional SMS message/);
        assert.match(verdict.reason, /Mobile Studio → Transactional Messages/);
        assert.equal(verdict.needs, undefined);
    }
    // the same id in capitals is the same id
    const capitals = smsMessage('5', { smsTriggeredSendDefinitionId: OWNER.toUpperCase() });
    assert.equal(judge('sms', '5', capitals, owned).isAllowed, false);
    // an id no definition has: activated in MobileConnect
    assert.deepEqual(judge('sms', '5', held(), others), { isAllowed: true, name: 'name of 5' });
    // definitions that were not read completely, or come in another shape
    for (const definitions of [
        { isComplete: false },
        { isComplete: false, ids: new Set() },
        { isComplete: true },
        { isComplete: 'yes', ids: new Set() },
        { ids: new Set() },
        { isComplete: true, ids: [] },
    ]) {
        const verdict = judge('sms', '5', held(), definitions);
        assert.equal(verdict.isAllowed, false, JSON.stringify(definitions));
        assert.match(verdict.reason, /could not be read completely/);
    }
});

test('the judgement of a push message', () => {
    const { judge } = page(PUSH, '');

    // sent by hand: nothing else is asked
    assert.deepEqual(judge('push', '5', pushMessage('5')), { isAllowed: true, name: 'name of 5' });
    // an active one is refused whoever starts it, without asking for the definitions
    for (const sendInitiator of [0, 2, 4, '0']) {
        const verdict = judge('push', '5', pushMessage('5', { sendInitiator, status: 2 }));
        assert.equal(verdict.isAllowed, false, String(sendInitiator));
        assert.match(verdict.reason, /^It is active\. Make it inactive first\.$/);
        assert.equal(verdict.needs, undefined);
    }
    // a draft and an inactive one are deleted
    for (const status of [0, 1]) {
        assert.equal(judge('push', '5', pushMessage('5', { status })).isAllowed, true);
    }
    // numbers that come as text are the same numbers
    assert.equal(
        judge('push', '5', pushMessage('5', { sendInitiator: '3', status: '1' })).isAllowed,
        false,
    );
    // a journey's message
    const journey = judge('push', '5', pushMessage('5', { sendInitiator: 3 }), names());
    assert.equal(journey.isAllowed, false);
    assert.match(journey.reason, /journey/i);
    // triggered by the API: the definitions decide, by the name
    const triggered = pushMessage('5', { sendInitiator: 1 });
    assert.equal(judge('push', '5', triggered).needs, true);
    assert.equal(judge('push', '5', triggered).isAllowed, false);
    assert.equal(judge('push', '5', triggered, names('another')).isAllowed, true);
    const owned = judge('push', '5', triggered, names('name of 5'));
    assert.equal(owned.isAllowed, false);
    assert.match(owned.reason, /transactional push message/);
    assert.match(owned.reason, /Mobile Studio → Transactional Messages/);
    assert.equal(
        judge('push', '5', { ...triggered, name: ' Name Of 5 ' }, names('name of 5')).isAllowed,
        false,
    );
    for (const definitions of [{ isComplete: false }, { isComplete: true }, { names: new Set() }]) {
        assert.equal(judge('push', '5', triggered, definitions).isAllowed, false);
    }
    // active and triggered by the API: what MobilePush's own button refuses
    const active = judge('push', '5', { ...triggered, status: 2 }, names());
    assert.equal(active.isAllowed, false);
    assert.match(active.reason, /inactive first/);
    // the other reasons come first where they apply
    const activeJourney = pushMessage('5', { sendInitiator: 3, status: 2 });
    assert.match(judge('push', '5', activeJourney).reason, /journey/i);
    assert.equal(judge('push', '5', { ...triggered, status: 2 }).needs, true);
    assert.match(
        judge('push', '5', { ...triggered, status: 2 }, names('name of 5')).reason,
        /transactional push message/,
    );
    // a field that is missing or no number never counts as "not the API"
    for (const field of ['name', 'sendInitiator', 'status']) {
        const message = pushMessage('5');
        delete message[field];
        assert.equal(judge('push', '5', message, names()).isAllowed, false, field);
    }
    for (const more of [{ sendInitiator: null }, { sendInitiator: 'API' }, { status: 1.5 }]) {
        assert.equal(judge('push', '5', pushMessage('5', more), names()).isAllowed, false);
    }
    assert.equal(judge('push', '5', pushMessage('6'), names()).isAllowed, false);
});

test('the Delete button of a MobileConnect message comes and goes with the route and the header', async () => {
    const at = page(`${CONNECT}#!/overview`, '');
    assert.equal(at.detailsButton(), null);
    // the header of another page gets none
    at.document.body.innerHTML = DETAILS;
    await tick();
    assert.equal(at.detailsButton(), null);
    at.window.location.hash = '#!/message/view/MTo3';
    await tick();
    const button = at.detailsButton();
    assert.equal(button.parentElement, at.document.querySelector('header.header'));
    assert.equal(button.textContent, 'Delete');
    assert.equal(button.value, 'MTo3');
    assert.equal(button.querySelector('img').src, 'chrome-extension://id/icons/icon16.png');
    // other changes of the page do not add a second one
    at.document.body.append(at.document.createElement('div'));
    await tick();
    assert.equal(at.document.querySelectorAll(DETAILS_BUTTON).length, 1);
    // another message: the button is that message's
    at.window.location.hash = '#!/message/view/MTo4';
    await tick();
    assert.equal(at.detailsButton().value, 'MTo4');
    assert.equal(at.document.querySelectorAll(DETAILS_BUTTON).length, 1);
    // a route that is not exactly the page of a message
    at.window.location.hash = '#!/message/view/MTo4/edit';
    await tick();
    assert.equal(at.detailsButton(), null);
    at.window.location.hash = '#!/message/view/MTo4';
    await tick();
    assert.ok(at.detailsButton());
    at.window.location.hash = '#!/overview';
    await tick();
    assert.equal(at.detailsButton(), null);
    assert.deepEqual(at.calls, []);
});

test('the Delete button waits for the header, and a header without a title gets none', async () => {
    const at = page(`${CONNECT}#!/message/view/7`, '');
    assert.equal(at.detailsButton(), null);
    at.document.body.innerHTML = '<div class="container"><header class="header"></header></div>';
    await tick();
    assert.equal(at.detailsButton(), null);
    at.document.body.innerHTML = DETAILS;
    await tick();
    assert.ok(at.detailsButton());
    // MobilePush has a delete button of its own on that page
    const other = page(`${PUSH}#!/message/view/7`, DETAILS);
    await tick();
    assert.equal(other.detailsButton(), null);
});

test('deleting from the page of a message asks first and goes to the overview afterwards', async () => {
    const messages = { 7: smsMessage('7') };
    const at = page(`${CONNECT}#!/message/view/7`, DETAILS, sms({ messages }));
    at.detailsButton().click();
    await tick();
    assert.deepEqual(at.calls, [`GET ${SMS_MESSAGE}7`]);
    assert.match(at.text(), /Will be deleted \(1\)/);
    assert.match(at.text(), /name of 7/);
    assert.match(at.text(), /cannot bring a deleted message back/);
    await at.press('delete');
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}7`]);
    assert.match(at.text(), /1 deleted, 0 failed\./);
    // only once the result was seen
    assert.deepEqual(at.left, []);
    await at.press('cancel');
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.left, ['overview']);
});

test('the Delete button deletes nothing once the route is that of another message', async () => {
    const at = page(`${CONNECT}#!/message/view/7`, DETAILS, sms({ messages: {} }));
    const button = at.detailsButton();
    // the route changed, and the click comes before the page was looked at again
    at.window.history.replaceState(null, '', '#!/message/view/8');
    button.click();
    await tick();
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.calls, []);
});

test('each row of MobileConnect’s list gets a checkbox that does not open the message', async () => {
    const at = page(CONNECT, smsList('1', '2', '3'));
    assert.deepEqual(
        at.boxes().map((box) => box.value),
        ['1', '2', '3'],
    );
    const button = at.selectedButton();
    assert.equal(button.parentElement.className, 'repeater-header-left');
    assert.equal(button.textContent, 'Delete selected (0)');
    assert.equal(button.disabled, true);
    assert.equal(button.querySelector('img').alt, 'SFMC UX Tools');
    let opened = 0;
    for (const row of at.document.querySelector('tbody').rows) {
        row.addEventListener('click', () => opened++);
    }
    at.boxes()[0].click();
    at.boxes()[2].click();
    assert.equal(opened, 0);
    assert.equal(at.boxes()[0].checked, true);
    assert.equal(button.textContent, 'Delete selected (2)');
    assert.equal(button.disabled, false);
    at.boxes()[0].click();
    assert.equal(button.textContent, 'Delete selected (1)');
    // the row itself still opens its message
    at.document.querySelector('a[data-id]').click();
    assert.equal(opened, 1);
    await tick();
    assert.equal(at.document.querySelectorAll(SELECTED_BUTTON).length, 1);
    assert.deepEqual(at.calls, []);
});

test('what is ticked survives a list that is drawn again, and is dropped with its row', async () => {
    const at = page(CONNECT, smsList('1', '2', '3'));
    at.boxes()[0].click();
    at.boxes()[1].click();
    const body = at.document.querySelector('tbody');
    // drawn again in two steps, as after a sort: empty first, the rows later
    body.replaceChildren();
    await tick();
    assert.equal(at.selectedButton().textContent, 'Delete selected (0)');
    assert.equal(at.selectedButton().disabled, true);
    body.innerHTML = smsRow('3') + smsRow('2') + smsRow('1');
    await tick();
    assert.deepEqual(
        at.boxes().map((box) => [box.value, box.checked]),
        [
            ['3', false],
            ['2', true],
            ['1', true],
        ],
    );
    assert.equal(at.selectedButton().textContent, 'Delete selected (2)');
    // another page of the list: 1 is gone, and stays unticked when it comes back
    body.innerHTML = smsRow('2') + smsRow('4');
    await tick();
    assert.equal(at.selectedButton().textContent, 'Delete selected (1)');
    body.innerHTML = smsRow('1') + smsRow('2');
    await tick();
    assert.deepEqual(
        at.boxes().map((box) => [box.value, box.checked]),
        [
            ['1', false],
            ['2', true],
        ],
    );
    // the header drawn again gets its button back, with the count
    at.document.querySelector('.repeater-header').innerHTML =
        '<div class="repeater-header-left"></div>';
    await tick();
    assert.equal(at.selectedButton().textContent, 'Delete selected (1)');
    // a row that names no message gets no checkbox
    body.innerHTML = '<tr><td>No messages</td></tr><tr><td><a data-id="9">x</a></td></tr>';
    await tick();
    assert.deepEqual(at.boxes(), []);
});

test('MobilePush’s list gets the same, and a list without a header gets nothing', async () => {
    const at = page(PUSH, pushList('a', 'b'));
    assert.deepEqual(
        at.boxes().map((box) => box.value),
        ['a', 'b'],
    );
    assert.equal(at.selectedButton().parentElement.className, 'repeater-header');
    // the row of the other app is not one of this app
    const mixed = page(
        PUSH,
        pushList().replace('<tbody>', () => `<tbody>${smsRow('1')}`),
    );
    assert.deepEqual(mixed.boxes(), []);
    const bare = page(
        PUSH,
        `<div id="messageGridRepeater"><table><tbody>${pushRow('a')}</tbody></table></div>`,
    );
    await tick();
    assert.equal(bare.selectedButton(), null);
    assert.deepEqual(bare.boxes(), []);
    // the list of MobileConnect under MobilePush's address is not MobilePush's list
    const wrong = page(PUSH, smsList('1'));
    assert.equal(wrong.selectedButton(), null);
    // another app of Marketing Cloud is left alone
    const elsewhere = page(`${HOST}/AutomationStudioFuel3/`, smsList('1') + pushList('a'));
    assert.equal(elsewhere.selectedButton(), null);
    assert.deepEqual(elsewhere.boxes(), []);
});

test('nothing is sent before the click in the dialog, and Cancel sends nothing', async () => {
    const messages = { 1: smsMessage('1'), 2: smsMessage('2') };
    const at = page(CONNECT, smsList('1', '2', '3'), sms({ messages }));
    await at.choose('1', '2');
    // each chosen message was read, and nothing else
    assert.deepEqual(at.calls, [`GET ${SMS_MESSAGE}1`, `GET ${SMS_MESSAGE}2`]);
    assert.match(at.text(), /Will be deleted \(2\)/);
    assert.match(at.text(), /name of 1/);
    assert.match(at.text(), /name of 2/);
    assert.equal(
        at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete').textContent,
        'Delete 2 messages',
    );
    assert.match(at.text(), /SFMC UX Tools/);
    await at.press('cancel');
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.written, []);
    assert.deepEqual(at.left, []);
    assert.deepEqual(Object.keys(messages), ['1', '2']);
    // a second click while a dialog is open opens no second one
    at.selectedButton().click();
    at.selectedButton().click();
    await tick();
    assert.equal(at.document.querySelectorAll('dialog').length, 1);
});

test('a dialog that is closed while the messages are read asks nothing more', async () => {
    const messages = { 1: smsMessage('1'), 2: smsMessage('2') };
    const at = page(CONNECT, smsList('1', '2'), sms({ messages }));
    for (const box of at.boxes()) {
        box.click();
    }
    at.selectedButton().click();
    // before the first answer is there
    at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-cancel').click();
    await tick();
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.calls, [`GET ${SMS_MESSAGE}1`]);
});

test('refused messages are never sent, and a failure does not stop the others', async () => {
    const messages = {
        1: smsMessage('1'),
        2: smsMessage('2', { sendMethod: 'INTERACTION' }),
        3: smsMessage('3'),
        4: smsMessage('4'),
        // 5 cannot be read at all
        6: smsMessage('6'),
    };
    const deletes = {
        3: { status: 400, body: { message: 'The message is in <b>use</b>.' } },
        6: { isDown: true },
    };
    const at = page(CONNECT, smsList('1', '2', '3', '4', '5', '6'), sms({ messages, deletes }));
    await at.choose('1', '2', '3', '4', '5', '6');
    assert.match(at.text(), /Will be deleted \(4\)/);
    assert.match(at.text(), /Will not be deleted \(2\)/);
    assert.match(at.text(), /name of 2 — A journey made it/);
    assert.match(at.text(), /Message 5 — It could not be read again.*no such message/);
    await at.press('delete');
    assert.deepEqual(at.written, [
        `DELETE ${SMS_MESSAGE}1`,
        `DELETE ${SMS_MESSAGE}3`,
        `DELETE ${SMS_MESSAGE}4`,
        `DELETE ${SMS_MESSAGE}6`,
    ]);
    assert.match(at.text(), /2 deleted, 1 failed, 1 unknown\./);
    // what Marketing Cloud said, as text
    assert.match(at.text(), /name of 3 — Not deleted: The message is in <b>use<\/b>\./);
    assert.equal(at.dialog().querySelector('b'), null);
    assert.match(at.text(), /name of 6 — It is not known whether it was deleted/);
    assert.deepEqual(Object.keys(messages), ['2', '3', '6']);
    await at.press('cancel');
    assert.deepEqual(at.left, ['reload']);
});

test('when nothing may be deleted, the dialog has no button that deletes', async () => {
    const messages = { 1: smsMessage('1', { sendMethod: 'INTERACTION' }) };
    const at = await asked({ messages });
    assert.match(at.text(), /Will not be deleted \(1\)/);
    assert.doesNotMatch(at.text(), /Will be deleted/);
    assert.equal(at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete'), null);
    await at.press('cancel');
    assert.deepEqual(at.written, []);
    assert.deepEqual(at.left, []);
});

test('a name is shown as text, whatever it holds', async () => {
    const messages = { 1: smsMessage('1', { name: '<img src=x onerror=alert(1)><i>x</i>' }) };
    const at = await asked({ messages });
    assert.match(at.text(), /<img src=x onerror=alert\(1\)><i>x<\/i>/);
    assert.equal(at.dialog().querySelector('i'), null);
    assert.equal(
        at.dialog().querySelectorAll('img:not(.sfmc-ux-tools-mobile-delete-icon)').length,
        0,
    );
});

test('an SMS message of a transactional definition is refused, also after the definition was renamed', async () => {
    const one = definition('other', 'a1b2c3d4-0000-4000-8000-000000000009');
    // no name of the definition is that of the message
    const two = definition('welcome', OWNER, 'renamed since');
    const messages = {
        1: smsMessage('1', { sendMethod: 'API', smsTriggeredSendDefinitionId: OWNER }),
        2: smsMessage('2', { sendMethod: 'USER', smsTriggeredSendDefinitionId: OWNER }),
    };
    const at = await asked({
        messages,
        definitions: [one.row, two.row],
        details: { other: one.detail, welcome: two.detail },
    });
    assert.match(at.text(), /Will not be deleted \(2\)/);
    assert.match(at.text(), /name of 1 — It belongs to a transactional SMS message/);
    assert.match(at.text(), /Mobile Studio → Transactional Messages/);
    assert.equal(at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete'), null);
    // every definition was read by itself, once for both messages
    assert.deepEqual(at.calls, [
        `GET ${SMS_MESSAGE}1`,
        `GET ${SMS_DEFINITIONS}?$page=1&$pageSize=100`,
        `GET ${SMS_DEFINITIONS}/other`,
        `GET ${SMS_DEFINITIONS}/welcome`,
        `GET ${SMS_MESSAGE}2`,
    ]);
    assert.deepEqual(at.written, []);
});

test('an SMS message with the name of a definition but another definition id is deleted', async () => {
    const one = definition('welcome', 'a1b2c3d4-0000-4000-8000-000000000009', 'name of 1');
    // listed, but its message is gone: the API cannot find it
    const orphan = definition('orphan', 'unused');
    const messages = {
        1: smsMessage('1', { sendMethod: 'API', smsTriggeredSendDefinitionId: OWNER }),
    };
    const at = await asked({
        messages,
        definitions: [one.row, orphan.row],
        details: {
            welcome: one.detail,
            orphan: {
                status: 404,
                body: { message: 'Unable to find Definition', errorcode: 30003 },
            },
        },
    });
    assert.match(at.text(), /Will be deleted \(1\)/);
    await at.press('delete');
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}1`]);
    assert.match(at.text(), /1 deleted, 0 failed\./);
    // the definitions were read once, not again before the delete
    assert.equal(at.calls.filter((call) => call.includes(`${SMS_DEFINITIONS}?`)).length, 1);
});

/**
 * Makes sure that an SMS message that holds the id of a definition is refused because the
 * definitions were not read whole.
 *
 * @param {string} title what is wrong with the definitions
 * @param {object} has what the business unit holds besides the message, see api()
 * @param {(path: string, method: string) => object} [answer] what the API answers, instead
 */
async function refused(title, has, answer) {
    const messages = heldByOwner();
    const at = page(CONNECT, smsList('1'), answer ?? sms({ messages, ...has }));
    await at.choose('1');
    assert.match(at.text(), /Will not be deleted \(1\)/, title);
    assert.match(at.text(), /could not be read completely/, title);
    assert.equal(at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete'), null, title);
    assert.deepEqual(at.written, [], title);
}

test('an SMS message with a definition id is refused whenever the definitions are not read whole', async () => {
    const one = definition('one', 'a1b2c3d4-0000-4000-8000-000000000009');
    /**
     * Answers like the API, but for the list of definitions.
     *
     * @param {object} list what the list answers
     * @returns {(path: string, method: string) => object} the answer to a request
     */
    const withList = (list) => {
        const rest = sms({ messages: heldByOwner(), details: { one: one.detail } });
        return (path, method) =>
            path.startsWith(`${SMS_DEFINITIONS}?`) ? list : rest(path, method);
    };

    await refused('the list fails', {}, withList({ status: 500, body: { message: 'down' } }));
    await refused('the list does not answer', {}, withList({ isDown: true }));
    await refused('the list is no JSON', {}, withList({ status: 200 }));
    await refused('no array', {}, withList({ body: { count: 0 } }));
    await refused('not an array', {}, withList({ body: { definitions: { 0: one.row } } }));
    await refused('a row without a key', {}, withList({ body: { definitions: [{ name: 'x' }] } }));
    // the page asked for is ignored: the same hundred rows again and again
    const hundred = Array.from({ length: 100 }, (_, index) => ({
        name: `n${index}`,
        definitionKey: `k${index}`,
        status: 'Active',
    }));
    await refused(
        'the same page again',
        {},
        withList({ body: { definitions: hundred, pageSize: 100 } }),
    );
    // a short page is the end only when the answer says that its pages have the size asked for
    for (const pageSize of [undefined, 50, 5, '100', null]) {
        await refused(
            `page size ${pageSize}`,
            {},
            withList({ body: { definitions: [one.row], count: 1, pageSize } }),
        );
    }
    // a list that goes on for ever, every page full and new
    const rest = sms({ messages: heldByOwner() });
    await refused('the list does not end', {}, (path, method) => {
        const page = /\$page=(\d+)/.exec(path)?.[1];
        return path.startsWith(`${SMS_DEFINITIONS}?`)
            ? {
                  body: {
                      definitions: hundred.map((item) => ({
                          ...item,
                          definitionKey: `${page}-${item.definitionKey}`,
                      })),
                      pageSize: 100,
                  },
              }
            : rest(path, method);
    });
    // a definition that cannot be read, for another reason than being gone
    await refused('a detail fails', {
        definitions: [one.row],
        details: { one: { status: 500, body: { message: 'down' } } },
    });
    await refused('a detail is not found, without the code of a gone one', {
        definitions: [one.row],
        details: { one: { status: 404, body: { message: 'Not found' } } },
    });
    await refused('a detail with the code, but another status', {
        definitions: [one.row],
        details: { one: { status: 400, body: { errorcode: 30003 } } },
    });
    await refused('a detail without an id', {
        definitions: [one.row],
        details: { one: { body: { definitionKey: 'one' } } },
    });
    await refused('a detail does not answer', {
        definitions: [one.row],
        details: { one: { isDown: true } },
    });
});

test('a definition on the second page of the list is found', async () => {
    const all = Array.from({ length: 101 }, (_, index) =>
        definition(`k${index}`, `a1b2c3d4-0000-4000-8000-${String(index).padStart(12, '0')}`),
    );
    const owner = all.at(-1).detail.body.definitionId;
    const messages = {
        1: smsMessage('1', { sendMethod: 'API', smsTriggeredSendDefinitionId: owner }),
    };
    const at = await asked({
        messages,
        definitions: all.map((item) => item.row),
        details: Object.fromEntries(all.map((item) => [item.row.definitionKey, item.detail])),
    });
    assert.match(at.text(), /name of 1 — It belongs to a transactional SMS message/);
    assert.ok(at.calls.includes(`GET ${SMS_DEFINITIONS}?$page=2&$pageSize=100`));
    assert.ok(at.calls.includes(`GET ${SMS_DEFINITIONS}/k100`));
    assert.deepEqual(at.written, []);
});

test('an SMS message whose answer lacks a field, or is another message, is refused', async () => {
    const lacking = smsMessage('1');
    delete lacking.smsTriggeredSendDefinitionId;
    const at = await asked({
        messages: { 1: lacking, 2: smsMessage('other'), 3: smsMessage('3') },
    });
    assert.match(at.text(), /Will be deleted \(1\)/);
    assert.match(at.text(), /Will not be deleted \(2\)/);
    assert.match(at.text(), /name of 1 — Marketing Cloud’s answer lacks/);
    assert.match(at.text(), /Message 2 — Marketing Cloud answered with another message/);
    await at.press('delete');
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}3`]);
});

test('right before its delete, a message is read again and left alone if it changed', async () => {
    const messages = {
        1: smsMessage('1'),
        2: smsMessage('2'),
        3: smsMessage('3'),
        4: smsMessage('4'),
        5: smsMessage('5'),
    };
    const at = await asked({ messages });
    assert.match(at.text(), /Will be deleted \(5\)/);
    // while the dialog was open
    messages[1].name = 'another name';
    messages[2].sendMethod = 'INTERACTION';
    delete messages[3];
    delete messages[4].sendMethod;
    const before = at.calls.length;
    await at.press('delete');
    assert.deepEqual(at.calls.slice(before), [
        `GET ${SMS_MESSAGE}1`,
        `GET ${SMS_MESSAGE}2`,
        `GET ${SMS_MESSAGE}3`,
        `GET ${SMS_MESSAGE}4`,
        `GET ${SMS_MESSAGE}5`,
        `DELETE ${SMS_MESSAGE}5`,
    ]);
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}5`]);
    assert.match(at.text(), /1 deleted, 0 failed, 4 not deleted because they changed\./);
    assert.match(at.text(), /name of 1 — Not deleted, because it has another name now/);
    assert.match(at.text(), /name of 2 — Not deleted, because it changed meanwhile.*journey/);
    await at.press('cancel');
    assert.deepEqual(at.left, ['reload']);
});

test('a message that got a definition id while the dialog was open is held against the definitions', async () => {
    const owner = definition('welcome', OWNER);
    const messages = { 1: smsMessage('1') };
    const at = await asked({
        messages,
        definitions: [owner.row],
        details: { welcome: owner.detail },
    });
    assert.deepEqual(at.calls, [`GET ${SMS_MESSAGE}1`]);
    messages[1].smsTriggeredSendDefinitionId = OWNER;
    await at.press('delete');
    assert.deepEqual(at.written, []);
    assert.match(at.text(), /0 deleted, 0 failed, 1 not deleted because they changed\./);
    assert.match(at.text(), /transactional SMS message/);
    await at.press('cancel');
    assert.deepEqual(at.left, []);
});

test('Esc does not close the dialog while messages are being deleted', async () => {
    const messages = { 1: smsMessage('1') };
    const at = await asked({ messages });
    const escape = () => {
        const event = new at.window.Event('cancel', { cancelable: true });
        at.dialog().dispatchEvent(event);
        return event.defaultPrevented;
    };
    assert.equal(escape(), false);
    at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete').click();
    assert.equal(escape(), true);
    await tick();
    assert.equal(escape(), false);
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}1`]);
});

test('a dialog that leaves the page while messages are deleted still loads the list again', async () => {
    const messages = { 1: smsMessage('1'), 2: smsMessage('2') };
    const at = await asked({ messages });
    at.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete').click();
    // closed while the first message is on its way, as a second Esc does in Chrome
    at.dialog().close();
    assert.equal(at.dialog(), null);
    assert.deepEqual(at.left, []);
    await tick();
    // the first was deleted, the second not sent, and the list is read again all the same
    assert.deepEqual(at.written, [`DELETE ${SMS_MESSAGE}1`]);
    assert.deepEqual(Object.keys(messages), ['2']);
    assert.deepEqual(at.left, ['reload']);

    // from the page of a message: to the overview
    const single = { 7: smsMessage('7') };
    const details = page(`${CONNECT}#!/message/view/7`, DETAILS, sms({ messages: single }));
    details.detailsButton().click();
    await tick();
    details.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete').click();
    details.dialog().close();
    await tick();
    assert.deepEqual(details.written, [`DELETE ${SMS_MESSAGE}7`]);
    assert.deepEqual(details.left, ['overview']);

    // nothing was deleted: nothing is loaded again
    const kept = { 1: smsMessage('1') };
    const idle = await asked({
        messages: kept,
        deletes: { 1: { status: 400, body: { message: 'no' } } },
    });
    idle.dialog().querySelector('.sfmc-ux-tools-mobile-delete-delete').click();
    idle.dialog().close();
    await tick();
    assert.deepEqual(idle.left, []);
});

test('push messages: one of a transactional definition, a journey’s and an active one are refused', async () => {
    const messages = {
        a: pushMessage('a', { sendInitiator: 1 }),
        b: pushMessage('b', { sendInitiator: 3 }),
        c: pushMessage('c', { sendInitiator: 1, status: 2 }),
        d: pushMessage('d', { sendInitiator: 1 }),
        e: pushMessage('e', { status: 2 }),
        f: pushMessage('f', { sendInitiator: 1 }),
    };
    const at = page(
        PUSH,
        pushList('a', 'b', 'c', 'd', 'e', 'f'),
        push({
            messages,
            // d's definition was deleted, so nothing holds on to d
            definitions: [row('Name of A'), row('name of d', 'Deleted'), row('else')],
        }),
    );
    await at.choose('a', 'b', 'c', 'd', 'e', 'f');
    assert.match(at.text(), /Will be deleted \(2\)/);
    assert.match(at.text(), /Will not be deleted \(4\)/);
    assert.match(at.text(), /name of a — A transactional push message has the same name/);
    assert.match(at.text(), /name of b — A journey made it/);
    assert.match(at.text(), /name of c — It is active\. Make it inactive first/);
    // active and sent by hand, by location or from a CloudPage: the message does not say which
    assert.match(at.text(), /name of e — It is active\. Make it inactive first/);
    // the list of definitions is read once, and no definition by itself
    assert.deepEqual(
        at.calls.filter((call) => call.includes(PUSH_DEFINITIONS)),
        [`GET ${PUSH_DEFINITIONS}?$page=1&$pageSize=100`],
    );
    await at.press('delete');
    assert.deepEqual(at.written, [`DELETE ${PUSH_MESSAGE}d`, `DELETE ${PUSH_MESSAGE}f`]);
    assert.match(at.text(), /2 deleted, 0 failed\./);
    await at.press('cancel');
    assert.deepEqual(at.left, ['reload']);
});

test('a push message triggered by the API is refused when the definitions cannot be read', async () => {
    for (const list of [
        { status: 500, body: { message: 'down' } },
        { body: {} },
        { body: { definitions: [{ definitionKey: 'k', status: 'Active' }], pageSize: 100 } },
        { body: { definitions: [{ definitionKey: 'k', name: 'n' }], pageSize: 100 } },
        // a list that does not say that its page has the size asked for
        { body: { definitions: [row('else')] } },
        { body: { definitions: [row('else')], pageSize: 5 } },
    ]) {
        const messages = { a: pushMessage('a', { sendInitiator: 1 }), b: pushMessage('b') };
        const rest = push({ messages });
        const at = page(PUSH, pushList('a', 'b'), (path, method) =>
            path.startsWith(`${PUSH_DEFINITIONS}?`) ? list : rest(path, method),
        );
        await at.choose('a', 'b');
        assert.match(at.text(), /name of a — The transactional push messages could not be read/);
        await at.press('delete');
        // the one sent by hand needs no definitions
        assert.deepEqual(at.written, [`DELETE ${PUSH_MESSAGE}b`]);
    }
});

test('an id is sent as one part of the address, and only a delete of a message changes anything', async () => {
    const id = 'MTo3/../x?y';
    const messages = { [id]: smsMessage(id) };
    const at = page(
        CONNECT,
        smsList().replace('<tbody>', '<tbody><tr><td><a data-status="1"></a></td></tr>'),
        sms({ messages }),
    );
    at.document.querySelector('a[data-status]').dataset.id = id;
    at.document.body.append(at.document.createElement('div'));
    await tick();
    await at.choose(id);
    await at.press('delete');
    const address = `${SMS_MESSAGE}${encodeURIComponent(id)}`;
    assert.deepEqual(at.calls, [`GET ${address}`, `GET ${address}`, `DELETE ${address}`]);
    // nothing in the script sends another method, or a delete to another address
    assert.deepEqual(script.match(/'(?:POST|PUT|PATCH|DELETE)'/g), ["'DELETE'"]);
    assert.equal(script.match(/\bask\(/g).length, 5);
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/);
});

test('the manifest runs the script in the frames of both apps, in the extension’s own world', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((entry) =>
        entry.js.includes('mobile-delete.js'),
    );
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0], {
        matches: [
            'https://*.marketingcloudapps.com/MobileConnectFuel3/*',
            'https://*.marketingcloudapps.com/mobilepush/*',
        ],
        js: ['mobile-delete.js'],
        css: ['mobile-delete.css'],
        all_frames: true,
        run_at: 'document_idle',
    });
    // the icon on the buttons and the dialog can be loaded there
    const icons = manifest.web_accessible_resources.find((entry) =>
        entry.resources.includes('icons/icon16.png'),
    );
    assert.ok(icons.matches.includes('https://*.marketingcloudapps.com/*'));
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
});
