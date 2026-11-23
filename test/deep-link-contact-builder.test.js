import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const frameScript = read('../src/deep-link-contact-builder.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const SHOWN = 'sfmc-ux-tools:deep-link:contact-shown';
// what the Marketing Cloud page asks of the frame, and how Chrome describes the background script
// that passes it on
const OPEN = 'sfmc-ux-tools:deep-link:contact-open';
const EXTENSION = 'this-extension';
const BACKGROUND = { id: EXTENSION };
// the address of Contact Builder's frame, as Marketing Cloud loads it
const PATH = '/contactsmeta/admin.html';
const QUERY = '?hub=1&ks=ks';
// a made-up data extension as Contact Builder's route names it, and the list of data extensions
const OPENED = 'admin/data-extension/0a1b2c3d-0000-4000-8000-00000000abcd/properties/';
const LISTED = 'admin/data-extension/';
// the longest route that is taken for one
const MOST_ROUTE = 200;
// what is no route: anything with a sign that Contact Builder's routes were not seen to have
const HOSTILE = [
    'admin/data extension',
    'admin/data-extension?x=1',
    'admin/data-extension&x=1',
    'admin#other',
    'admin%2Fdata-extension',
    'admin%23x',
    String.raw`admin\x`,
    'admin:x',
    'javascript:alert(1)',
    'https://example.com/',
    '<img src=x onerror=alert(1)>',
    'admin"x',
    "admin'x",
    'admin\nx',
    'admin/ü',
    'a'.repeat(MOST_ROUTE + 1),
];

/**
 * Runs the frame script in Contact Builder's frame.
 *
 * @param {object} [has] what the frame and the extension hold
 * @param {string} [has.hash] the route the frame was loaded with, from the #
 * @param {string} [has.depth] top for no page around it, nested for a frame inside Contact Builder's
 * @param {string} [has.pathname] the path of the frame's address
 * @param {boolean} [has.isDown] true when the extension cannot be reached
 * @returns {object} the frame, what was sent, how many timers were started, a way to change the route as Contact Builder does, a way to send the script a message, the routes it wrote over the frame's own, and the script's function
 */
function frame({ hash = '', depth = 'frame', pathname = PATH, isDown = false } = {}) {
    const { window: top } = new JSDOM('<!doctype html><body><iframe></iframe></body>', {
        runScripts: 'outside-only',
        url: 'https://mc.s7.exacttarget.com/cloud/',
    });
    let view = depth === 'top' ? top : top.document.querySelector('iframe').contentWindow;
    if (depth === 'nested') {
        view.document.body.append(view.document.createElement('iframe'));
        view = view.document.querySelector('iframe').contentWindow;
    }
    let timers = 0;
    for (const name of ['setTimeout', 'setInterval']) {
        view[name] = () => ++timers;
    }
    // the frame of the test has no address of its own: the script gets one that behaves like it
    const place = { pathname, search: QUERY, hash };
    // the routes the script wrote over the one in the frame's address. As in the browser, that
    // adds no entry to the history and tells the frame of the change
    const replaced = [];
    place.replace = (to) => {
        replaced.push(to);
        place.hash = to;
        view.dispatchEvent(new view.Event('hashchange'));
    };
    const sent = [];
    const listeners = [];
    view.chrome = {
        runtime: {
            id: EXTENSION,
            onMessage: {
                addListener: (item) => {
                    listeners.push(item);
                },
            },
            sendMessage: async (message) => {
                sent.push({ ...message });
                if (isDown) {
                    throw new Error('Extension context invalidated.');
                }
                return {};
            },
        },
    };
    view.place = place;
    // what the script listens for in the frame, so that a test can click or type as a person
    // does: the page of a test cannot make up an event that the browser trusts
    const heard = [];
    const listen = view.addEventListener.bind(view);
    view.addEventListener = (type, act, options) => {
        heard.push({ type, act });
        listen(type, act, options);
    };
    view.eval(`((location) => {${frameScript}\n})(place);`);
    return {
        view,
        sent,
        /**
         * Clicks or types in the frame, as a person does.
         *
         * @param {string} type pointerdown or keydown
         */
        input: (type) => {
            for (const item of heard) {
                if (item.type === type) {
                    item.act({ type, isTrusted: true });
                }
            }
        },
        timers: () => timers,
        /**
         * Changes the route inside Contact Builder, as Contact Builder does.
         *
         * @param {string} to the route, from the #
         */
        route: (to) => {
            place.hash = to;
            view.dispatchEvent(new view.Event('hashchange'));
        },
        routes: () => sent.map((message) => message.route),
        replaced,
        /**
         * Sends the script a message, as the background script does unless said otherwise.
         *
         * @param {object} message the message
         * @param {object} [sender] who sent it
         * @returns {boolean[]} what each of the script's listeners returned
         */
        receive: (message, sender = BACKGROUND) =>
            listeners.map((item) => item(message, sender, () => {})),
        helpers: view.sfmcUxToolsDeepLinkContactBuilder,
    };
}

test('a route of Contact Builder is letters, digits and four signs, up to a longest length, and nothing else', () => {
    const { routeOf } = frame().helpers;
    for (const route of [
        OPENED,
        LISTED,
        'admin',
        'a',
        'A_b-c.d/1',
        'contacts/all-contacts',
        'a'.repeat(MOST_ROUTE),
    ]) {
        assert.equal(routeOf(`#${route}`), route);
        // as it stands in an address, and by itself
        assert.equal(routeOf(route), route);
    }
    for (const route of HOSTILE) {
        assert.equal(routeOf(`#${route}`), null, route);
    }
    for (const nothing of ['', '#', '##admin', undefined, null, 7, {}, ['#admin']]) {
        assert.equal(routeOf(nothing), null, String(nothing));
    }
});

test('Contact Builder’s frame tells its route when it starts and on each change of it, and nothing by a clock', async () => {
    const at = frame({ hash: `#${OPENED}` });
    await tick();
    assert.deepEqual(at.sent, [{ type: SHOWN, route: OPENED }]);
    at.route(`#${LISTED}`);
    at.route('');
    at.route('#');
    at.route(`#${OPENED}`);
    await tick();
    assert.deepEqual(at.routes(), [OPENED, LISTED, null, null, OPENED]);
    // what is no route is told as none
    for (const route of HOSTILE) {
        at.sent.length = 0;
        at.route(`#${route}`);
        assert.deepEqual(at.sent, [{ type: SHOWN, route: null }], route);
    }
    assert.equal(at.timers(), 0);
    assert.doesNotMatch(frameScript, /setTimeout|setInterval|requestAnimationFrame/);

    // started without a route: told as none, so that the address is Contact Builder's plain one
    const plain = frame();
    await tick();
    assert.deepEqual(plain.routes(), [null]);

    // an extension that was updated or switched off under the page breaks nothing
    const lost = frame({ hash: `#${OPENED}`, isDown: true });
    lost.route(`#${LISTED}`);
    await tick();
    assert.deepEqual(lost.routes(), [OPENED, LISTED]);
});

test('only Contact Builder’s own document, directly below the Marketing Cloud page, tells its route', async () => {
    for (const has of [
        // Contact Builder opened by itself, and a frame inside Contact Builder's frame
        { depth: 'top' },
        { depth: 'nested' },
        // another document under the same path: the address names this one document only
        { pathname: '/contactsmeta/other.html' },
        { pathname: '/contactsmeta/' },
        { pathname: '/contactsmeta/admin.html/x' },
    ]) {
        const at = frame({ hash: `#${OPENED}`, ...has });
        at.route(`#${LISTED}`);
        await tick();
        assert.deepEqual(at.sent, [], JSON.stringify(has));
        assert.equal(at.helpers, undefined);
    }
});

test('the script asks nothing of Marketing Cloud, clicks nothing and writes nothing but a route over the one of its frame', () => {
    assert.doesNotMatch(frameScript, /\bfetch\(|XMLHttpRequest|sendBeacon/);
    assert.doesNotMatch(frameScript, /innerHTML|outerHTML|insertAdjacentHTML|createElement/);
    assert.doesNotMatch(frameScript, /location\.(?:assign|href|hash\s*=)|history\./);
    // the one place that changes the frame's address writes over it, a route after a #
    assert.deepEqual(frameScript.match(/location\.replace\([^)]*\)/g), [
        'location.replace(`#${route}`)',
    ]);
    assert.doesNotMatch(frameScript, /\.click\(\)/);
    assert.deepEqual(frameScript.match(/sendMessage\(/g), ['sendMessage(']);
    assert.deepEqual(frameScript.match(/onMessage/g), ['onMessage']);
});

test('Contact Builder’s frame shows the route that the page asks for by writing it over its own, and tells it as nobody’s click', async () => {
    const at = frame({ hash: `#${OPENED}` });
    await tick();
    at.sent.length = 0;
    // a click before the step, on the browser's Back for one, is not what opened the route
    at.input('pointerdown');
    assert.deepEqual(at.receive({ type: OPEN, route: LISTED }), [false]);
    assert.deepEqual(at.replaced, [`#${LISTED}`]);
    assert.deepEqual(at.sent, [{ type: SHOWN, route: LISTED }]);
    // the route that is shown already is left alone
    at.receive({ type: OPEN, route: LISTED });
    assert.equal(at.replaced.length, 1);
    assert.equal(at.sent.length, 1);
    // and a click of the user after it still counts for what the user opens next
    at.input('pointerdown');
    at.receive({ type: OPEN, route: LISTED });
    at.route(`#${OPENED}`);
    assert.deepEqual(at.sent.at(-1), { type: SHOWN, route: OPENED, byUser: true });
    // what is no route of the form is not written, with or without a # before it
    for (const route of [...HOSTILE, `#${LISTED}`, '', undefined, null, 7, {}, [LISTED]]) {
        at.receive({ type: OPEN, route });
    }
    // from anyone but the background script, and for any other message, nothing is written
    at.receive({ type: OPEN, route: LISTED }, { id: 'another-extension' });
    at.receive({ type: OPEN, route: LISTED }, { id: EXTENSION, tab: { id: 7 } });
    at.receive({ type: SHOWN, route: LISTED });
    at.receive(null);
    assert.equal(at.replaced.length, 1);
    // a frame without a route yet is given one
    const plain = frame();
    plain.receive({ type: OPEN, route: LISTED });
    assert.deepEqual(plain.replaced, [`#${LISTED}`]);
    assert.equal(at.timers(), 0);

    // a document that is not Contact Builder's own does not listen
    for (const has of [{ depth: 'top' }, { depth: 'nested' }, { pathname: '/contactsmeta/' }]) {
        const other = frame({ hash: `#${OPENED}`, ...has });
        assert.deepEqual(other.receive({ type: OPEN, route: LISTED }), [], JSON.stringify(has));
        assert.deepEqual(other.replaced, []);
    }
});

test('the manifest runs the script in Contact Builder’s frame, in the extension’s own world, without a new permission', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    assert.deepEqual(
        manifest.content_scripts.filter((item) => item.js.includes('deep-link-contact-builder.js')),
        [
            {
                matches: ['https://*.marketingcloudapps.com/contactsmeta/*'],
                js: ['deep-link-contact-builder.js'],
                all_frames: true,
                run_at: 'document_idle',
            },
        ],
    );
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    // the three scripts that take a route take the same form of it
    const FORM = String.raw`[A-Za-z\d/_.-]{1,${'${MOST_ROUTE}'}}`;
    for (const file of ['deep-link-contact-builder.js', 'deep-link-shell.js', 'background.js']) {
        const script = read(`../src/${file}`);
        assert.equal(script.includes(FORM), true, file);
        assert.match(script, new RegExp(`const MOST_ROUTE = ${MOST_ROUTE};`), file);
    }
});

test('Contact Builder’s frame says with its route whether the user clicked or typed, and only then', async () => {
    const at = frame({ hash: `#${OPENED}` });
    await tick();
    for (const type of ['pointerdown', 'keydown']) {
        at.input(type);
        at.route(`#${LISTED}`);
        // said once: the route that follows is not the user's doing
        at.route(`#${OPENED}`);
        assert.deepEqual(
            at.sent.slice(-2),
            [
                { type: SHOWN, route: LISTED, byUser: true },
                { type: SHOWN, route: OPENED },
            ],
            type,
        );
    }
    // what a script of the page makes up is nobody's click or key
    for (const type of ['pointerdown', 'keydown']) {
        at.view.dispatchEvent(new at.view.Event(type, { bubbles: true }));
    }
    at.route(`#${LISTED}`);
    assert.deepEqual(at.sent.at(-1), { type: SHOWN, route: LISTED });
    // a click before the frame was reached is used up by what it tells, also when that fails
    const lost = frame({ hash: `#${OPENED}`, isDown: true });
    lost.input('pointerdown');
    lost.route(`#${LISTED}`);
    lost.route(`#${OPENED}`);
    await tick();
    assert.deepEqual(lost.sent.slice(1), [
        { type: SHOWN, route: LISTED, byUser: true },
        { type: SHOWN, route: OPENED },
    ]);
    assert.equal(at.timers(), 0);
});
