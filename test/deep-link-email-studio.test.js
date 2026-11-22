import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const frameScript = read('../src/deep-link-email-studio.js');
const pageScript = read('../src/deep-link-email-studio-page.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const WANTED = 'sfmc-ux-tools:deep-link:email-wanted';
const SHOWN = 'sfmc-ux-tools:deep-link:email-shown';
const STATE = 'sfmc-ux-tools:email-studio:state';
const GO = 'sfmc-ux-tools:email-studio:go';
// the address of Email Studio's frame, as Email Studio writes it
const PATH = '/C12/Default.aspx';
const QUERY = '?entityType=none&entityID=0&ks=ks';
const ADDRESS = `https://members.s7.exacttarget.com${PATH}${QUERY}`;
// the business unit the user is in
const MID = '500';
// a made-up data extension: what Email Studio writes into its state for it, what the page's
// script tells of it, what a link names and the route that opens it
const OBJECT_ID = '0a1b2c3d-0000-4000-8000-00000000abcd';
const OPENED = `de-pages/de/${OBJECT_ID}`;
const VIEW = `r.Subscribers.customobject.${OBJECT_ID}`;
const ROUTE = `Subscribers/customobject/${OBJECT_ID}`;
// a folder of data extensions
const FOLDER_OPENED = 'de-grid/dataextension/4711';
const FOLDER = 'r.Subscribers.CustomObjects.4711';
// the one wait of the frame script: writes to Email Studio's state within it count as one change
const RECORD_DELAY = 250;
// how often the frame script sets the route of a link at most
const MOST_TRIES = 6;
// far longer than anything a script could wait for: neither script does anything by a clock
const LONG = 600_000;

/**
 * Puts the timers of a page into the hands of the test.
 *
 * @param {object} view the page
 * @returns {{jump: (delay: number) => void, pass: (delay?: number) => Promise.<void>, waits: () => number}} two ways to let time pass, the second of which lets the page settle before and after, and the number of timers that are under way
 */
function clock(view) {
    let now = 0;
    let lastTimer = 0;
    const timers = new Map();
    view.setTimeout = (act, delay = 0) => {
        timers.set(++lastTimer, { at: now + delay, act });
        return lastTimer;
    };
    view.clearTimeout = (id) => {
        timers.delete(id);
    };
    /**
     * Lets time pass and runs the timers that are due by then.
     *
     * @param {number} delay milliseconds
     */
    const jump = (delay) => {
        now += delay;
        for (const [id, timer] of timers) {
            if (!(timer.at <= now)) {
                continue;
            }

            timers.delete(id);
            timer.act();
        }
    };
    return {
        jump,
        pass: async (delay = 0) => {
            await tick();
            jump(delay);
            await tick();
        },
        waits: () => timers.size,
    };
}

/**
 * Runs the frame script in Email Studio's frame.
 *
 * @param {object} [has] what the frame and the page around it hold
 * @param {unknown} [has.wanted] the view the page around the frame hands out, or a function that answers in its place
 * @param {string} [has.search] the query the frame was loaded with
 * @param {string} [has.hash] the route inside Email Studio the frame was loaded with
 * @param {string} [has.depth] top for no page around it, nested for a frame inside Email Studio's
 * @param {(message: object) => unknown} [has.written] what the page around the frame answers when it is told a view
 * @returns {object} the frame, what was sent, set and written, and ways to let Email Studio speak, a person click or type, the route change and time pass
 */
function frame({
    wanted = null,
    search = QUERY,
    hash = '#Overview',
    depth = 'frame',
    written = (message) => ({
        parameter: message.target === null ? null : `${MID}.${message.target}`,
    }),
} = {}) {
    const { window: top } = new JSDOM('<!doctype html><body><iframe></iframe></body>', {
        runScripts: 'outside-only',
        url: 'https://mc.s7.exacttarget.com/cloud/',
    });
    let view = depth === 'top' ? top : top.document.querySelector('iframe').contentWindow;
    if (depth === 'nested') {
        view.document.body.append(view.document.createElement('iframe'));
        view = view.document.querySelector('iframe').contentWindow;
    }
    const time = clock(view);
    // the frame of the test has no address of its own: the script gets one that behaves like it
    const place = { pathname: PATH, search, hash };
    const writes = [];
    const state = { kept: true };
    const past = {
        state,
        replaceState: (kept, unused, to) => {
            assert.equal(kept, state);
            assert.equal(unused, '');
            writes.push(to);
            const address = new URL(to, ADDRESS);
            assert.equal(address.pathname, PATH);
            place.search = address.search;
            place.hash = address.hash;
        },
    };
    const sent = [];
    view.chrome = {
        runtime: {
            sendMessage: async (message) => {
                sent.push({ ...message });
                if (message.type !== WANTED) {
                    return written(message);
                }
                return typeof wanted === 'function' ? wanted() : { target: wanted };
            },
        },
    };
    const went = [];
    view.document.addEventListener(GO, (event) => {
        went.push(event.detail);
    });
    // what the script listens to on its window: an event that the test makes up is not trusted,
    // so the test calls the script as the browser does for a person's click or key
    const listeners = [];
    const listen = view.addEventListener.bind(view);
    view.addEventListener = (type, act, how) => {
        listeners.push({ type, act });
        listen(type, act, how);
    };
    /**
     * Finds what the script does for one kind of event on its window.
     *
     * @param {string} type the kind of event
     * @returns {((event: object) => void)[]} its functions
     */
    const heard = (type) => listeners.filter((item) => item.type === type).map((item) => item.act);
    view.place = place;
    view.past = past;
    view.eval(`((location, history) => {${frameScript}\n})(place, past);`);
    return {
        view,
        place,
        sent,
        went,
        writes,
        ...time,
        /**
         * Says what the page's script would say.
         *
         * @param {unknown} text what Email Studio shows
         */
        say: (text) => {
            view.document.dispatchEvent(new view.CustomEvent(STATE, { detail: text }));
        },
        heard,
        /**
         * Clicks or types in the frame, as a person does.
         *
         * @param {string} type pointerdown or keydown
         */
        input: (type) => {
            for (const act of heard(type)) {
                act({ type, isTrusted: true });
            }
        },
        /**
         * Changes the route inside Email Studio, as Email Studio does.
         *
         * @param {string} to the route, from the #
         */
        route: (to) => {
            place.hash = to;
            view.dispatchEvent(new view.Event('hashchange'));
        },
        asked: () => sent.filter((message) => message.type === WANTED).length,
        shown: () => sent.filter((message) => message.type === SHOWN).map((item) => item.target),
        helpers: view.sfmcUxToolsDeepLinkEmailStudio,
    };
}

/**
 * Runs the page's script in the page of Email Studio's frame.
 *
 * @returns {object} the page, what the script told, and ways to let time pass, to give the page its script loader and to ask for a route
 */
function page() {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: `${ADDRESS}#Overview`,
    });
    const time = clock(window);
    const told = [];
    window.document.addEventListener(STATE, (event) => {
        told.push(event.detail);
    });
    window.eval(pageScript);
    return {
        window,
        told,
        ...time,
        hash: () => window.location.hash,
        /**
         * Waits until the page itself was loaded, so that only the test makes the script look.
         *
         * @returns {Promise.<void>} settles once it was
         */
        started: () =>
            window.document.readyState === 'complete'
                ? tick()
                : new Promise((resolve) => {
                      window.addEventListener('load', () => resolve(), { once: true });
                  }),
        /**
         * Gives the page the script loader of Email Studio.
         *
         * @param {object} library the library that the loader hands out
         * @returns {{has: boolean, asked: unknown[][], checked: unknown[]}} whether the loader holds the library, which the test may change; what the loader was asked to hand out or load; and what it was asked whether it holds
         */
        loader: (library) => {
            const held = { has: true, asked: [], checked: [] };
            window.require = Object.assign(
                (...given) => {
                    held.asked.push(given);
                    return library;
                },
                {
                    defined: (name) => {
                        held.checked.push(name);
                        return held.has;
                    },
                },
            );
            return held;
        },
        /**
         * Lets one of the page's scripts be loaded, as the browser tells it.
         */
        scriptLoaded: () => {
            const script = window.document.createElement('script');
            window.document.head.append(script);
            script.dispatchEvent(new window.Event('load'));
            script.remove();
        },
        /**
         * Asks the script for a route, as the frame script does.
         *
         * @param {unknown} route the route
         */
        go: (route) => {
            window.document.dispatchEvent(new window.CustomEvent(GO, { detail: route }));
        },
    };
}

/**
 * Builds a stand-in for the library that keeps Email Studio's state.
 *
 * @param {(self: object) => void} [seen] called with the state for each write to it, before anything else
 * @returns {{library: object, model: object, calls: unknown[][], heard: object[], starts: object[]}} the library, one state of it, what was written to that state, who was said to listen to it, and the calls that started the reading of the routes
 */
function backbone(seen = () => {}) {
    const calls = [];
    const heard = [];
    const starts = [];
    /**
     * A state of Email Studio.
     */
    class Model {
        /**
         * Writes to the state.
         *
         * @param {...unknown} written fields, or the name of one and its value, and how
         * @returns {Model} the state itself, as the library does
         */
        set(...written) {
            calls.push(written);
            seen(this);
            if (written[0] === 'fail') {
                throw new Error('Email Studio’s own error');
            }
            return this;
        }

        /**
         * Listens to the state.
         *
         * @param {...unknown} given what to listen for, and who listens
         * @returns {Model} the state itself, as the library does
         */
        on(...given) {
            heard.push({ name: 'on', given, on: this });
            return this;
        }

        /**
         * Listens to the state, by the older name of the same function.
         *
         * @param {...unknown} given what to listen for, and who listens
         * @returns {Model} the state itself, as the library does
         */
        bind(...given) {
            heard.push({ name: 'bind', given, on: this });
            return this;
        }
    }
    /**
     * What reads the routes of Email Studio.
     */
    class History {
        /**
         * Starts to read the routes.
         *
         * @param {...unknown} given how
         * @returns {string} what the library answers
         */
        start(...given) {
            starts.push({ given, on: this });
            return 'started';
        }
    }
    return {
        library: { Model, History: { started: false }, history: new History() },
        model: new Model(),
        calls,
        heard,
        starts,
    };
}

/**
 * Runs the frame script with a page around it that answers when the test says so.
 *
 * @returns {{at: object, answer: () => void}} the frame, and a way to let the page answer with the view of a link
 */
function late() {
    let answer;
    const at = frame({
        wanted: () =>
            new Promise((resolve) => {
                answer = () => resolve({ target: VIEW });
            }),
    });
    return { at, answer: () => answer() };
}

/**
 * Stands for a part of Email Studio that listens to its state.
 */
const act = () => {};

test('what Email Studio shows becomes a route only for the views it was seen to write, with an id of digits or hex', () => {
    const { targetOf, routeOf } = frame().helpers;
    const SEEN = [
        [OPENED, VIEW, ROUTE],
        [FOLDER_OPENED, FOLDER, 'Subscribers/CustomObjects/4711'],
        ['de-grid/dataextension/0', 'r.Subscribers.CustomObjects.0', 'Subscribers/CustomObjects/0'],
    ];
    for (const [described, target, route] of SEEN) {
        assert.equal(targetOf(described), target);
        assert.equal(routeOf(target), route);
        // seen live: a slash at the end of a route makes Email Studio hang
        assert.equal(route.endsWith('/'), false);
    }
    for (const described of [
        'none',
        'up',
        '',
        'de-pages/de',
        'de-pages/de/',
        'de-pages/de/1/',
        'de-pages/de/1/2',
        'de-pages/de/../x',
        'de-pages/de/<img src=x>',
        'de-pages/de/1.2',
        'de-pages/de/-1',
        'de-pages/de/xyz',
        'de-pages/de/1 ',
        'de-pages/de/%31',
        `de-pages/de/${'1'.repeat(37)}`,
        // views that were not seen, and mixed ones
        'email-grid/email/5',
        'de-pages/list/5',
        'de-grid/de/5',
        'constructor/prototype/5',
        // seen live: the link of a folder of lists opened another list, so it gets none
        'list-grid/list/12',
        undefined,
        null,
        7,
        {},
    ]) {
        assert.equal(targetOf(described), null, String(described));
    }
    for (const target of [
        null,
        undefined,
        '',
        'r.a.b',
        'r.Subscribers.customobject',
        'r.Subscribers.customobject.1.2',
        'r.Subscribers.customobject.1/',
        'r.Subscribers.customobject./',
        'r.Subscribers.customobject.-1',
        'r.Subscribers.customobject.xyz',
        'r.Subscribers.customobject.<b>',
        'r.Subscribers/customobject.x.1',
        // a page instead of a route, which no link may name
        'p.Subscribers.customobject.1',
        'p./Content/Admin.aspx',
        // routes of Email Studio that it does not answer by a view in its state
        'r.Content.email.5',
        'r.Tracking.send.5',
        'r.Admin.users.1',
        // a folder of lists, whose route opened another list
        'r.Subscribers.lists.12',
        `${MID}.${VIEW}`,
        7,
        {},
    ]) {
        assert.equal(routeOf(target), undefined, String(target));
    }
});

test('the field of the view is added to the query of the frame’s address, replaced and taken out again', () => {
    const { withParameter } = frame().helpers;
    const P = `${MID}.${VIEW}`;
    assert.equal(withParameter(QUERY, P), `${QUERY}&ux-tools=${P}`);
    assert.equal(withParameter(`${QUERY}&ux-tools=600.${FOLDER}`, P), `${QUERY}&ux-tools=${P}`);
    assert.equal(withParameter(`?ux-tools=1&a=1&ux-tools=2`, P), `?a=1&ux-tools=${P}`);
    assert.equal(withParameter(`${QUERY}&ux-tools=${P}`, null), QUERY);
    assert.equal(withParameter('', P), `?ux-tools=${P}`);
    assert.equal(withParameter(`?ux-tools=${P}`, null), '');
    assert.equal(withParameter('', null), '');
    // another field is not taken for it
    assert.equal(withParameter('?xux-tools=1&ux-toolsx=2', null), '?xux-tools=1&ux-toolsx=2');
});

test('Email Studio’s frame tells which view is open, and writes the field into its own address', async () => {
    const at = frame();
    await at.pass();
    // no link to follow: from now on it tells, first that nothing is open
    assert.equal(at.asked(), 1);
    assert.deepEqual(at.shown(), [null]);
    assert.deepEqual(at.writes, []);

    at.say(FOLDER_OPENED);
    // not at once: Email Studio may write more
    await tick();
    assert.deepEqual(at.shown(), [null]);
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown(), [null, FOLDER]);
    // what the page around the frame wrote, with the business unit it read
    assert.deepEqual(at.writes, [`${PATH}${QUERY}&ux-tools=${MID}.${FOLDER}#Overview`]);
    // the same view again tells nothing new
    at.say(FOLDER_OPENED);
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown(), [null, FOLDER]);

    // another view, with the route Email Studio has by then
    at.place.hash = `#${ROUTE}`;
    at.say(OPENED);
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown().at(-1), VIEW);
    assert.equal(at.writes.at(-1), `${PATH}${QUERY}&ux-tools=${MID}.${VIEW}#${ROUTE}`);

    // several writes at once: a view among them is what is open, whatever comes around it
    at.say('none');
    at.say(FOLDER_OPENED);
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown().at(-1), FOLDER);
    at.say('de-grid/dataextension/1');
    at.say('de-grid/dataextension/2');
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown().at(-1), 'r.Subscribers.CustomObjects.2');

    // nothing more specific than a section: the field goes at once, without the business unit
    const before = at.writes.length;
    at.say('none');
    await tick();
    assert.equal(at.writes.length, before);
    await at.pass(RECORD_DELAY);
    assert.equal(at.writes.at(-1), `${PATH}${QUERY}#${ROUTE}`);
    assert.deepEqual(at.shown().at(-1), null);
    assert.equal(at.writes.length, before + 1);
    // a view that has no route counts as a section, and "up" says nothing about a view
    at.say(OPENED);
    await at.pass(RECORD_DELAY);
    at.say('up');
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown().at(-1), VIEW);
    at.say('email-grid/email/5');
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.shown().at(-1), null);
    assert.equal(at.place.search, QUERY);
    // what is no text is not heard at all
    for (const detail of [undefined, null, 7, { content: 'de-pages' }]) {
        at.say(detail);
    }
    await at.pass(RECORD_DELAY);
    assert.equal(at.waits(), 0);
    // it never asked for a route, and asked for a link once
    assert.deepEqual(at.went, []);
    assert.equal(at.asked(), 1);
});

test('only the business unit before the told view is taken from the answer of the page', async () => {
    for (const parameter of [
        undefined,
        null,
        '',
        7,
        FOLDER,
        `${MID}.${VIEW}`,
        `5a.${FOLDER}`,
        `.${FOLDER}`,
        `1234567890123456.${FOLDER}`,
        `${MID}.${FOLDER}&x=1`,
        `${MID}&x=1.${FOLDER}`,
        `${MID}.${FOLDER}#x`,
    ]) {
        const at = frame({
            search: `${QUERY}&ux-tools=600.${VIEW}`,
            written: () => ({ parameter }),
        });
        await at.pass();
        at.say(FOLDER_OPENED);
        await at.pass(RECORD_DELAY);
        assert.deepEqual(at.shown(), [null, FOLDER]);
        assert.equal(at.place.search, QUERY, String(parameter));
    }
    // a page that does not answer
    const deaf = frame({
        written: () => {
            throw new Error('Extension context invalidated.');
        },
    });
    await deaf.pass();
    deaf.say(FOLDER_OPENED);
    await deaf.pass(RECORD_DELAY);
    assert.equal(deaf.place.search, QUERY);

    // an answer that comes after another view was opened is not written
    const answers = [];
    const slow = frame({
        written: (message) =>
            new Promise((resolve) => {
                answers.push(() =>
                    resolve({ parameter: message.target && `${MID}.${message.target}` }),
                );
            }),
    });
    await slow.pass();
    slow.say(FOLDER_OPENED);
    await slow.pass(RECORD_DELAY);
    slow.say(OPENED);
    await slow.pass(RECORD_DELAY);
    assert.deepEqual(slow.shown(), [null, FOLDER, VIEW]);
    for (const answer of answers) {
        answer();
    }
    await tick();
    assert.deepEqual(slow.writes, [`${PATH}${QUERY}&ux-tools=${MID}.${VIEW}#Overview`]);
});

test('the route of a link is set once, when Email Studio first says that it listens, and not when it says so again', async () => {
    // the frame was loaded with the field, as the page around it copies it
    const LOADED = `${QUERY}&ux-tools=${MID}.${VIEW}`;
    const at = frame({ wanted: VIEW, search: LOADED, hash: '#Subscribers' });
    await at.pass();
    assert.equal(at.asked(), 1);
    // not when Email Studio is up, not when it writes what is open, and not by a clock
    at.say('up');
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.equal(at.waits(), 0);
    await at.pass(LONG);
    assert.deepEqual(at.went, []);
    at.say('ready');
    assert.deepEqual(at.went, [ROUTE]);
    // seen live: for each route Email Studio builds its page anew, whose parts say again that
    // they listen. Setting the route for that went round in a circle and left the page empty
    for (let times = 0; times < MOST_TRIES * 2; times++) {
        at.say('ready');
    }
    await at.pass(LONG);
    assert.deepEqual(at.went, [ROUTE]);
    // Email Studio shows the view, whatever it writes around it: nothing is set again
    at.say('none');
    at.say(OPENED);
    await at.pass(RECORD_DELAY);
    at.say('ready');
    assert.deepEqual(at.went, [ROUTE]);
    // while the link is followed nothing is told: the section Email Studio starts with does
    // not take the link out of the address
    assert.deepEqual(at.shown(), []);
    assert.deepEqual(at.writes, []);
    assert.equal(at.place.search, LOADED);
    assert.equal(at.waits(), 0);
    assert.equal(at.asked(), 1);
});

test('a link that is handed over after Email Studio began to listen has its route set then, once Email Studio is up', async () => {
    // Email Studio listened and was up before the page around the frame answered
    const first = late();
    first.at.say('ready');
    first.at.say('ready');
    first.at.say('up');
    await first.at.pass(LONG);
    assert.deepEqual(first.at.went, []);
    first.answer();
    await tick();
    assert.deepEqual(first.at.went, [ROUTE]);
    first.at.say('ready');
    first.at.say('up');
    await first.at.pass(LONG);
    assert.deepEqual(first.at.went, [ROUTE]);

    // it listened, but was not up yet: seen live, a route that is set before is never drawn
    const second = late();
    second.at.say('ready');
    second.answer();
    await second.at.pass(LONG);
    assert.deepEqual(second.at.went, []);
    second.at.say('up');
    await tick();
    assert.deepEqual(second.at.went, [ROUTE]);
    second.at.say('ready');
    assert.deepEqual(second.at.went, [ROUTE]);

    // it was up, but did not listen yet: the route is set when it does
    const third = late();
    third.at.say('up');
    third.answer();
    await third.at.pass(LONG);
    assert.deepEqual(third.at.went, []);
    third.at.say('ready');
    assert.deepEqual(third.at.went, [ROUTE]);
    for (const { at } of [first, second, third]) {
        assert.equal(at.waits(), 0);
        assert.deepEqual(at.shown(), []);
    }
});

test('the route is set again only when Email Studio shows another view than the link’s, and no more often than its tries', async () => {
    const at = frame({ wanted: VIEW, search: `${QUERY}&ux-tools=${MID}.${VIEW}` });
    await at.pass();
    // before the route was set for the first time, another view sets nothing
    at.say(FOLDER_OPENED);
    await at.pass(RECORD_DELAY);
    assert.deepEqual(at.went, []);
    at.say('ready');
    assert.equal(at.went.length, 1);
    // seen live: the view is covered by the first list of the section. Not at once: Email
    // Studio may write more
    at.say(FOLDER_OPENED);
    await tick();
    assert.equal(at.went.length, 1);
    await at.pass(RECORD_DELAY - 1);
    assert.equal(at.went.length, 1);
    await at.pass(1);
    assert.equal(at.went.length, 2);
    // the view of the link, alone or among other writes that count as one change: not again
    at.say(OPENED);
    await at.pass(RECORD_DELAY);
    at.say('none');
    at.say(OPENED);
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 2);
    // nothing more specific than a section, and a view that has no route, are something else
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 3);
    at.say('email-grid/email/5');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 4);
    // several writes are one change, and so one try
    at.say('de-grid/dataextension/1');
    at.say('de-grid/dataextension/2');
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 5);
    at.say('none');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, MOST_TRIES);
    assert.deepEqual(
        at.went,
        Array.from({ length: MOST_TRIES }, () => ROUTE),
    );
    // all the while nothing was told
    assert.deepEqual(at.shown(), []);
    assert.deepEqual(at.writes, []);
    // the tries are used up: the link is given up, and the frame tells what is open again
    at.say(FOLDER_OPENED);
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, MOST_TRIES);
    assert.deepEqual(at.shown(), [FOLDER]);
    at.say('none');
    await at.pass(RECORD_DELAY);
    at.say('ready');
    at.route('#Subscribers');
    await at.pass(LONG);
    assert.equal(at.went.length, MOST_TRIES);
    assert.deepEqual(at.shown(), [FOLDER, null]);
    assert.equal(at.place.search, QUERY);
    assert.equal(at.waits(), 0);
});

test('the route is also set again when Email Studio drops it from its address without having shown the view', async () => {
    const at = frame({ wanted: VIEW, hash: '#Subscribers' });
    await at.pass();
    // before the route was set for the first time, a change of the address sets nothing
    at.route('#Overview');
    assert.deepEqual(at.went, []);
    at.say('ready');
    assert.equal(at.went.length, 1);
    // Email Studio takes the route into its address
    at.route(`#${ROUTE}`);
    assert.equal(at.went.length, 1);
    // and out again, with a section in the state
    at.say('none');
    at.route('#Subscribers');
    assert.equal(at.went.length, 2);
    // the view was written last: the route may go
    at.say(OPENED);
    at.route(`#${ROUTE}`);
    at.route('#Subscribers');
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 2);
    assert.deepEqual(at.shown(), []);
});

test('whoever clicks or types in Email Studio ends the following of a link: from then on the frame tells again', async () => {
    const LOADED = `${QUERY}&ux-tools=${MID}.${VIEW}`;
    const at = frame({ wanted: VIEW, search: LOADED });
    await at.pass();
    at.say('ready');
    // what a script of the page makes up is nobody's click or key
    for (const type of ['pointerdown', 'keydown']) {
        at.view.dispatchEvent(new at.view.Event(type, { bubbles: true }));
    }
    at.say(FOLDER_OPENED);
    await at.pass(RECORD_DELAY);
    assert.equal(at.went.length, 2);
    assert.deepEqual(at.shown(), []);
    assert.equal(at.place.search, LOADED);
    // a click: what is open is told at once, and the link no longer pulls back
    at.input('pointerdown');
    await tick();
    assert.deepEqual(at.shown(), [FOLDER]);
    at.say('none');
    await at.pass(RECORD_DELAY);
    at.say('ready');
    at.route('#Overview');
    at.say('de-grid/dataextension/1');
    await at.pass(RECORD_DELAY);
    await at.pass(LONG);
    assert.equal(at.went.length, 2);
    assert.deepEqual(at.shown(), [FOLDER, null, 'r.Subscribers.CustomObjects.1']);
    assert.equal(at.waits(), 0);

    // a key, while writes are still counted: told once they are
    const typed = frame({ wanted: VIEW, search: LOADED });
    await typed.pass();
    typed.say('ready');
    typed.say(FOLDER_OPENED);
    typed.input('keydown');
    await tick();
    assert.deepEqual(typed.shown(), []);
    await typed.pass(RECORD_DELAY);
    assert.deepEqual(typed.shown(), [FOLDER]);
    assert.deepEqual(typed.went, [ROUTE]);
    // other input ends nothing
    const moved = frame({ wanted: VIEW });
    await moved.pass();
    moved.say('ready');
    assert.equal(moved.heard('pointermove').length + moved.heard('wheel').length, 0);
    moved.say('none');
    await moved.pass(RECORD_DELAY);
    assert.equal(moved.went.length, 2);
    assert.deepEqual(moved.shown(), []);
});

test('the frame never follows its own address: without a view from the page around it, nothing is opened', async () => {
    // the link belongs to another business unit, or was decided already: the page hands out
    // nothing, whatever the address of the frame says
    const at = frame({
        wanted: null,
        search: `${QUERY}&ux-tools=600.${VIEW}`,
        hash: `#${ROUTE}`,
    });
    at.say('up');
    at.say('ready');
    at.say('none');
    await at.pass();
    await at.pass(RECORD_DELAY);
    at.say('ready');
    at.route('#Subscribers');
    await at.pass(LONG);
    assert.deepEqual(at.went, []);
    // and the field of the other business unit goes out of the address
    assert.deepEqual(at.writes, [`${PATH}${QUERY}#${ROUTE}`]);
    assert.deepEqual(at.shown(), [null]);
    assert.equal(at.waits(), 0);

    // what the page hands out is followed only when it is a route that can be followed
    for (const wanted of [
        undefined,
        '',
        7,
        {},
        'r.a.b',
        'p.Subscribers.customobject.1',
        'r.Content.email.5',
        'r.Subscribers.customobject.1/',
        'r.Subscribers.customobject.../x',
        `${MID}.${VIEW}`,
        ROUTE,
    ]) {
        const odd = frame({ wanted });
        odd.say('up');
        odd.say('ready');
        odd.say('none');
        await odd.pass();
        odd.say('ready');
        await odd.pass(LONG);
        assert.deepEqual(odd.went, [], String(wanted));
        assert.equal(odd.waits(), 0);
    }
    // a page that does not answer
    const deaf = frame({
        wanted: () => {
            throw new Error('Could not establish connection');
        },
    });
    deaf.say('up');
    deaf.say('ready');
    deaf.say('none');
    await deaf.pass(LONG);
    assert.deepEqual(deaf.went, []);
    assert.equal(deaf.waits(), 0);
});

test('only Email Studio’s own document, directly below the Marketing Cloud page, talks to that page', async () => {
    for (const depth of ['top', 'nested']) {
        const at = frame({ wanted: VIEW, search: `${QUERY}&ux-tools=${MID}.${VIEW}`, depth });
        at.say('up');
        at.say('ready');
        at.say(OPENED);
        await at.pass(RECORD_DELAY);
        await at.pass(LONG);
        assert.deepEqual(at.sent, [], depth);
        assert.deepEqual(at.went, []);
        assert.deepEqual(at.writes, []);
        assert.equal(at.waits(), 0);
    }
});

test('the page’s script takes the library only once the loader holds it, and never asks the loader to load anything', async () => {
    // each of the things that make the script look: a script of the page was loaded, the page
    // was read, the page was loaded, and the loader's own notice of a loaded script
    const LOOKS = {
        script: (at) => at.scriptLoaded(),
        read: (at) => at.window.document.dispatchEvent(new at.window.Event('DOMContentLoaded')),
        loaded: (at) => at.window.dispatchEvent(new at.window.Event('load')),
        notice: (at) => at.window.require.onResourceLoad({}, { name: 'some/script' }, []),
    };
    for (const [name, look] of Object.entries(LOOKS)) {
        const at = page();
        await at.started();
        const { library } = backbone();
        const original = library.Model.prototype.set;
        const held = at.loader(library);
        held.has = false;
        // seen live: asking the loader to load the library stopped Email Studio from starting.
        // While the loader does not hold it, the loader is only asked whether it does
        for (const other of Object.values(LOOKS)) {
            at.scriptLoaded();
            other(at);
        }
        await at.pass(LONG);
        assert.deepEqual(held.asked, [], name);
        assert.deepEqual([...new Set(held.checked)], ['backbone']);
        assert.equal(library.Model.prototype.set, original);
        // the loader holds it: taken at the next look, by its name alone, which hands out what
        // is there. Never by a list of names or with a function to call, which would load
        held.has = true;
        look(at);
        assert.deepEqual(held.asked, [['backbone']], name);
        assert.notEqual(library.Model.prototype.set, original);
        // once
        const watched = library.Model.prototype.set;
        for (const other of Object.values(LOOKS)) {
            other(at);
        }
        assert.deepEqual(held.asked, [['backbone']]);
        assert.equal(library.Model.prototype.set, watched);
        // and nothing is looked for on a clock
        assert.equal(at.waits(), 0);
        assert.deepEqual(at.told, []);
    }
    assert.doesNotMatch(pageScript, /require\s*\(\s*\[|requirejs\s*\(|\bdefine\s*\(/);

    // whoever listened to the loader's notice before still hears it, as it was given
    const kept = page();
    await kept.started();
    kept.loader(backbone().library).has = false;
    const before = [];
    /**
     * Stands for whoever listened to the loader's notice before.
     *
     * @param {...unknown} given what the loader passes
     * @returns {string} an answer by which the test knows it
     */
    kept.window.require.onResourceLoad = function (...given) {
        // eslint-disable-next-line unicorn/no-this-outside-of-class -- the test looks at the object the loader's function was called on
        before.push({ given, on: this });
        return 'heard';
    };
    kept.scriptLoaded();
    assert.equal(kept.window.require.onResourceLoad(1, 2), 'heard');
    assert.deepEqual(before, [{ given: [1, 2], on: kept.window.require }]);
    // a loader that goes by its other name too is listened to under that one
    const named = page();
    await named.started();
    named.window.requirejs = {};
    named.loader(backbone().library).has = false;
    named.scriptLoaded();
    assert.equal(typeof named.window.requirejs.onResourceLoad, 'function');
    assert.equal(named.window.require.onResourceLoad, undefined);
    assert.equal(named.window.requirejs.onResourceLoad(), undefined);

    // a page without that loader, or with another one, or whose loader throws: left alone
    let calls = 0;
    for (const loader of [
        undefined,
        () => {
            calls++;
            return {};
        },
        Object.assign(() => ({}), {
            defined: () => {
                throw new Error('not that loader');
            },
        }),
        Object.assign(
            () => {
                throw new Error('no such module');
            },
            { defined: () => true },
        ),
        Object.assign(() => ({ Model: {} }), { defined: () => true }),
        Object.assign(() => null, { defined: () => true }),
    ]) {
        const other = page();
        await other.started();
        other.window.require = loader;
        other.scriptLoaded();
        other.window.dispatchEvent(new other.window.Event('load'));
        await other.pass(LONG);
        assert.deepEqual(other.told, []);
        assert.equal(other.waits(), 0);
    }
    // a loader that cannot say what it holds is not asked for anything
    assert.equal(calls, 0);
});

test('the page’s script tells each write to Email Studio’s state that says what is open, as one text', async () => {
    const at = page();
    await at.started();
    const { library, model, calls } = backbone();
    const original = library.Model.prototype.set;
    at.loader(library);
    at.scriptLoaded();
    assert.notEqual(library.Model.prototype.set, original);

    // an opened data extension, written in both ways; Email Studio's own function runs with
    // what was written and its result is handed back
    const opened = {
        contentType: 'legacy',
        content: 'de-pages',
        object: 'de',
        job: 'properties',
        id: OBJECT_ID,
        info: { name: 'Customers' },
    };
    const options = { silent: true };
    assert.equal(model.set({ carbonContent: opened }, options), model);
    assert.equal(model.set('carbonContent', opened, options), model);
    assert.deepEqual(calls, [
        [{ carbonContent: opened }, options],
        ['carbonContent', opened, options],
    ]);
    assert.deepEqual(at.told, [OPENED, OPENED]);
    // folders, whose id may be a number
    model.set({ carbonContent: { content: 'de-grid', object: 'dataextension', categoryId: 4711 } });
    model.set({ carbonContent: { content: 'list-grid', object: 'list', categoryId: '12' } });
    assert.deepEqual(at.told.slice(2), [FOLDER_OPENED, 'list-grid/list/12']);
    // a page of the older kind, and a choice in the menu: nothing more specific than a section
    model.set({ carbonContent: null });
    model.set('carbonContent', null);
    model.set({
        curNavItem: 'Subscribers',
        curSubNavItem: { nodeId: 1, name: 'Data Extensions', href: '#', isLegacy: false },
        sectionId: 3,
    });
    model.set('curNavItem', 'Admin');
    assert.deepEqual(at.told.slice(4), ['none', 'none', 'none', 'none']);
    // a view in the same write as the choice in the menu is the view
    model.set({ curNavItem: 'Subscribers', carbonContent: opened });
    assert.equal(at.told.at(-1), OPENED);
    // what is no id, or no name of a kind, is not passed on
    const count = at.told.length;
    const ODD = [
        { content: 'de-pages', object: 'de' },
        { content: 'de-pages', object: 'de', id: '../x' },
        { content: 'de-pages', object: 'de', id: '<img src=x>' },
        { content: 'de-pages', object: 'de', id: 1.5 },
        { content: 'de-pages', object: 'de', id: -1 },
        { content: 'de-pages', object: 'de', id: { toString: () => '1' } },
        { content: 'de-pages', object: 'de', id: '1'.repeat(37) },
        { content: 'de/pages', object: 'de', id: 1 },
        { content: 'de-pages', object: '<b>', id: 1 },
        { content: 7, object: 'de', id: 1 },
        { content: 'de-pages', id: 1 },
        'de-pages/de/1',
        7,
    ];
    for (const view of ODD) {
        model.set({ carbonContent: view });
        assert.equal(at.told.at(-1), 'none', JSON.stringify(view));
    }
    assert.equal(at.told.length, count + ODD.length);
    // other writes say nothing
    model.set({ name: 'x' });
    model.set('name', 'x');
    model.set();
    model.set(null);
    model.set('sectionId', 3);
    assert.equal(at.told.length, count + ODD.length);
    // only texts ever leave the script, never anything of Email Studio
    for (const text of at.told) {
        assert.equal(typeof text, 'string');
    }

    // nothing of the script reaches Email Studio: what it cannot read is skipped
    const odd = {
        /**
         * Stands for a field of Email Studio that cannot be read.
         */
        get carbonContent() {
            throw new Error('not for you');
        },
    };
    assert.equal(model.set(odd), model);
    assert.equal(at.told.length, count + ODD.length);
    // and an error of Email Studio's own function stays what it is
    assert.throws(() => model.set('fail', { carbonContent: null }), /Email Studio’s own error/);
    assert.equal(at.told.length, count + ODD.length);
    assert.equal(at.waits(), 0);
});

test('the page’s script says once when Email Studio is up, and each time a part of it starts to listen for what is open', async () => {
    const at = page();
    await at.started();
    const { library, model, heard, starts } = backbone();
    at.loader(library);
    at.scriptLoaded();
    assert.deepEqual(at.told, []);
    // Email Studio starts to read its routes: its library's own function runs on the object
    // it was called on, with what it was given, and its result is handed back
    assert.equal(library.history.start({ pushState: false }), 'started');
    assert.deepEqual(starts, [{ given: [{ pushState: false }], on: library.history }]);
    assert.deepEqual(at.told, ['up']);
    // once
    library.history.start();
    assert.deepEqual(at.told, ['up']);

    // a part of Email Studio listens for changes of what is open, under either name of the
    // library's function, alone or among other changes
    assert.equal(model.on('change:carbonContent', act, model), model);
    assert.equal(model.bind('change:curNavItem change:carbonContent', act), model);
    assert.deepEqual(heard, [
        { name: 'on', given: ['change:carbonContent', act, model], on: model },
        { name: 'bind', given: ['change:curNavItem change:carbonContent', act], on: model },
    ]);
    assert.deepEqual(at.told, ['up', 'ready', 'ready']);
    // for anything else it says nothing
    model.on('change:curNavItem', act);
    model.on('change', act);
    model.bind('all', act);
    model.on({ 'change:carbonContent': act });
    model.on();
    assert.deepEqual(at.told, ['up', 'ready', 'ready']);
    assert.equal(heard.length, 7);

    // a library that is found when Email Studio is up already
    const ready = page();
    await ready.started();
    const second = backbone();
    second.library.History.started = true;
    ready.loader(second.library);
    ready.scriptLoaded();
    assert.deepEqual(ready.told, ['up']);
    second.library.history.start();
    assert.deepEqual(ready.told, ['up']);

    // a library that has only one of the two names, and nothing to start
    const bare = page();
    await bare.started();
    const third = backbone();
    delete third.library.Model.prototype.bind;
    delete third.library.history;
    bare.loader(third.library);
    bare.scriptLoaded();
    assert.equal(third.library.Model.prototype.bind, undefined);
    third.model.on('change:carbonContent', act);
    third.model.set({ carbonContent: null });
    assert.deepEqual(bare.told, ['ready', 'none']);
});

test('before the page’s script sets a route, it makes Email Studio forget a view that it took into its state but did not draw', async () => {
    const DRAWN_IN = ['carbon-legacy-dynamic', 'carbon-dynamic'];
    const at = page();
    await at.started();
    const written = [];
    const { library, model, calls } = backbone((self) => {
        written.push({ on: self, hash: at.hash() });
    });
    at.loader(library);
    at.scriptLoaded();
    // no state is known yet: the route is set, nothing is written
    at.go(ROUTE);
    assert.equal(at.hash(), `#${ROUTE}`);
    assert.deepEqual(calls, []);

    /**
     * Asks for the route of the link while Email Studio is in its section.
     *
     * @returns {unknown[][]} what was written to Email Studio's state for it
     */
    const again = () => {
        at.window.location.hash = 'Subscribers';
        calls.length = 0;
        written.length = 0;
        at.go(ROUTE);
        assert.equal(at.hash(), `#${ROUTE}`);
        return structuredClone(calls);
    };
    // seen live: Email Studio took the view of a route that came too early into its state
    // without drawing it, and writing the same view again changed nothing for it
    model.set({ carbonContent: { content: 'de-pages', object: 'de', id: OBJECT_ID } });
    const told = at.told.length;
    // forgotten through Email Studio's own function, on the state that holds what is open,
    // without telling its views, and before the route is set
    const FORGET = [[{ carbonContent: null }, { silent: true }]];
    assert.deepEqual(again(), FORGET);
    assert.deepEqual(written, [{ on: model, hash: '#Subscribers' }]);
    // the two places for such a view are there, but empty: the same
    at.window.document.body.innerHTML = DRAWN_IN.map((id) => `<div id="${id}"></div>`).join('');
    assert.deepEqual(again(), FORGET);
    // what this script writes itself is not told as a change of what is open
    assert.equal(at.told.length, told);
    // a view is drawn in one of them: nothing is forgotten, the route is set as before
    for (const id of DRAWN_IN) {
        const place = at.window.document.querySelector(`#${id}`);
        place.innerHTML = '<div>a view</div>';
        assert.deepEqual(again(), [], id);
        place.replaceChildren();
        assert.deepEqual(again(), FORGET, id);
    }
    // what is no route forgets nothing and sets nothing
    calls.length = 0;
    for (const route of ['Subscribers', `${ROUTE}/`, 'Admin/users/7', undefined]) {
        at.go(route);
    }
    assert.deepEqual(calls, []);
    assert.equal(at.hash(), `#${ROUTE}`);

    // a state that cannot be written to breaks nothing: the route is set all the same
    const broken = page();
    await broken.started();
    const second = backbone(() => {
        throw new Error('Email Studio’s own error');
    });
    broken.loader(second.library);
    broken.scriptLoaded();
    assert.throws(() => second.model.set({ carbonContent: null }), /Email Studio’s own error/);
    broken.go(ROUTE);
    assert.equal(broken.hash(), `#${ROUTE}`);
});

test('a route that is in the address already is set by way of its section, because Email Studio only acts on a change', async () => {
    const at = page();
    await at.started();
    at.go(ROUTE);
    assert.equal(at.hash(), `#${ROUTE}`);
    // the section this time, the route with the next try
    at.go(ROUTE);
    assert.equal(at.hash(), '#Subscribers');
    at.go(ROUTE);
    assert.equal(at.hash(), `#${ROUTE}`);
    // another route is a change by itself
    at.go('Subscribers/CustomObjects/4711');
    assert.equal(at.hash(), '#Subscribers/CustomObjects/4711');
    at.go('Subscribers/CustomObjects/4711');
    assert.equal(at.hash(), '#Subscribers');
    // the page was not left
    assert.equal(at.window.location.href, `${ADDRESS}#Subscribers`);
});

test('the page’s script sets only the listed routes of Email Studio, with an id of digits or hex and no slash at the end', async () => {
    const at = page();
    await at.started();
    const LISTED = [
        'Subscribers/customobject',
        'Subscribers/CustomObjects',
        'Subscribers/list',
        'Subscribers/lists',
        'Subscribers/group',
        'Subscribers/groups',
        'Subscribers/filters',
        'Content/email',
        'Content/template',
        'Content/contentarea',
        'Content2/email',
        'Content2/asset',
        'Tracking/send',
        'Tracking/sends',
        'Tracking/report',
        'Tracking/reports',
    ];
    for (const listed of LISTED) {
        for (const id of ['7', OBJECT_ID, '123456789012345', 'ABCDEF']) {
            at.go(`${listed}/${id}`);
            assert.equal(at.hash(), `#${listed}/${id}`);
        }
    }
    const last = at.hash();
    for (const route of [
        '',
        'Overview',
        'Admin',
        'Subscribers',
        'Subscribers/customobject',
        // seen live: a slash at the end makes Email Studio hang
        'Subscribers/customobject/',
        'Subscribers/customobject/7/',
        '/Subscribers/customobject/7',
        '#Subscribers/customobject/7',
        // a step inside the view, and anything further
        'Subscribers/customobject/7/properties',
        'Subscribers/customobject/7/properties/1',
        'Subscribers/customobject/7?x=1',
        'Subscribers/customobject/7#x',
        // routes that are not listed
        'Admin/users/7',
        'Subscribers/customObject/7',
        'subscribers/customobject/7',
        'Interactions/send/7',
        // no id
        'Subscribers/customobject/-7',
        'Subscribers/customobject/xyz',
        'Subscribers/customobject/7.5',
        'Subscribers/customobject/..',
        'Subscribers/customobject/%37',
        'Subscribers/customobject/<img src=x>',
        `Subscribers/customobject/${'1'.repeat(37)}`,
        'Subscribers/customobject/7 ',
        // an address is never a route
        'javascript:alert(1)',
        'https://example.org/Subscribers/customobject/7',
        '//example.org/Subscribers/customobject/7',
        '/Content/Admin.aspx',
        String.raw`Subscribers\customobject\7`,
        undefined,
        null,
        7,
        { toString: () => 'Subscribers/customobject/7' },
        ['Subscribers/customobject/7'],
    ]) {
        at.go(route);
        assert.equal(at.hash(), last, String(route));
    }
    // the page was not left
    assert.equal(at.window.location.href, `${ADDRESS}${last}`);
});

test('the two scripts load no address into anything, ask nothing of Marketing Cloud and write no markup', () => {
    for (const script of [frameScript, pageScript]) {
        assert.doesNotMatch(script, /\bfetch\(|XMLHttpRequest|sendBeacon/);
        assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML/);
        assert.doesNotMatch(script, /location\.(?:assign|replace|href)\b/);
        assert.doesNotMatch(script, /\.src\b|\.open\(|contentWindow|fraContent/);
        assert.doesNotMatch(script, /\.click\(\)/);
    }
    // the frame script only writes its own address, with the route and path it has; the
    // page's script only sets the route, in one place
    assert.doesNotMatch(frameScript, /location\.hash\s*=[^=]/);
    assert.deepEqual(frameScript.match(/replaceState\(/g), ['replaceState(']);
    assert.match(
        frameScript,
        /history\.replaceState\(history\.state, '', location\.pathname \+ search \+ location\.hash\)/,
    );
    assert.deepEqual(pageScript.match(/location\.hash\s*=[^=]/g)?.length, 1);
    assert.doesNotMatch(pageScript, /replaceState|pushState|chrome\./);
    // nothing is done by a clock: the frame script only counts several writes as one change,
    // and the page's script waits for nothing
    assert.deepEqual(frameScript.match(/setTimeout\(/g), ['setTimeout(']);
    assert.match(frameScript, /setTimeout\(count, RECORD_DELAY\)/);
    assert.doesNotMatch(frameScript, /setInterval|clearTimeout|requestAnimationFrame/);
    assert.doesNotMatch(pageScript, /setTimeout|setInterval|requestAnimationFrame/);
    // and nothing that was only there to look at Email Studio is left
    assert.doesNotMatch(frameScript + pageScript, /TEMP-DEBUG|uxLinkDebug|\btrace\(/);
    // no page of Email Studio is named by a link: only routes
    assert.doesNotMatch(frameScript, /\.aspx/);
    assert.doesNotMatch(pageScript, /\.aspx/);
});

test('the manifest runs the two scripts in Email Studio’s frame, without a new permission, and the probe is gone', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = (file) => manifest.content_scripts.filter((item) => item.js.includes(file));
    assert.deepEqual(entry('deep-link-email-studio.js'), [
        {
            matches: ['https://*.exacttarget.com/C12/Default.aspx*'],
            js: ['deep-link-email-studio.js'],
            all_frames: true,
            run_at: 'document_start',
        },
    ]);
    // in the page's own world, and before Email Studio's scripts
    assert.deepEqual(entry('deep-link-email-studio-page.js'), [
        {
            matches: ['https://*.exacttarget.com/C12/Default.aspx*'],
            js: ['deep-link-email-studio-page.js'],
            world: 'MAIN',
            all_frames: true,
            run_at: 'document_start',
        },
    ]);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    // the scripts that were used to look at Email Studio are not shipped
    for (const file of ['probe-email-studio.js', 'probe-email-studio-page.js']) {
        assert.equal(existsSync(new URL(`../src/${file}`, import.meta.url)), false, file);
    }
    assert.doesNotMatch(JSON.stringify(manifest), /probe/);
    for (const item of manifest.content_scripts) {
        assert.notDeepEqual(item.matches, ['https://*/*']);
    }
});
