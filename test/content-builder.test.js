import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const script = read('../src/key-rule.js') + read('../src/content-builder.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const KEYS = 'data-sfmc-ux-tools-readable-keys';
const ASSETS = '/fuelapi/asset/v1/content/assets/';
const EMAIL = { assetType: { id: 208, name: 'htmlemail' }, name: 'Welcome (DE) 1', views: {} };
const BLOCK = { assetType: { id: 220, name: 'codesnippetblock' }, name: 'Footer v2' };

/**
 * Runs the Content Builder script in a page and records what it lets through to the server.
 *
 * @returns {{window: Window, document: Document, post: (url: string, body: object | string, method?: string) => Promise.<object | string>, sent: unknown[], server: object}} the page, a way to send a request as the page would, what was sent, and the server that says which keys are taken
 */
function page() {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        url: 'https://content-builder.s7.marketingcloudapps.com/',
    });
    const sent = [];
    // what the script wraps: nothing leaves the test
    window.XMLHttpRequest.prototype.open = () => {};
    window.XMLHttpRequest.prototype.abort = () => {};
    window.XMLHttpRequest.prototype.send = (body) => {
        sent.push(body);
    };
    // keys that are taken, as the server spells them
    const taken = new Set();
    const asked = [];
    const server = { taken, asked, status: 200, answer: null, options: null };
    window.fetch = (url, options) => {
        const filter = new URL(url, window.location.href).searchParams.get('$filter');
        const key = /^customerKey eq '(.*)'$/.exec(filter)[1];
        asked.push(key);
        server.options = options;
        const holders = [...taken].filter((holder) => holder.toLowerCase() === key.toLowerCase());
        return Promise.resolve({
            status: server.status,
            json: () =>
                Promise.resolve(
                    server.answer ?? {
                        count: holders.length,
                        items: holders.map((customerKey) => ({ customerKey })),
                    },
                ),
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

test('a new email is sent with a key made from its name, whatever kind of email it is', async () => {
    const { post, server } = page();
    const created = await post(ASSETS, EMAIL);
    assert.equal(created.customerKey, 'Welcome_DE_1');
    // the rest of what the page wrote stays
    assert.deepEqual({ ...created, customerKey: undefined }, { ...EMAIL, customerKey: undefined });
    assert.deepEqual(server.asked, ['Welcome_DE_1']);
    for (const name of ['templatebasedemail', 'textonlyemail']) {
        const other = await post(ASSETS.slice(0, -1), { ...EMAIL, assetType: { name } });
        assert.equal(other.customerKey, 'Welcome_DE_1', name);
    }
    // the key is cut to what Marketing Cloud takes
    const long = await post(ASSETS, { ...EMAIL, name: 'a'.repeat(50) });
    assert.equal(long.customerKey, 'a'.repeat(36));
});

test('a key that is taken gets a number, for an email and for a block whose key was filled in from its name', async () => {
    const { post, server } = page();
    server.taken.add('WELCOME_DE_1');
    assert.equal((await post(ASSETS, EMAIL)).customerKey, 'Welcome_DE_1_2');
    server.taken.add('Welcome_DE_1_2');
    assert.equal((await post(ASSETS, EMAIL)).customerKey, 'Welcome_DE_1_3');
    // the number fits into the longest key there is
    const long = 'a'.repeat(36);
    server.taken.add(long);
    assert.equal((await post(ASSETS, { ...EMAIL, name: long })).customerKey, `${'a'.repeat(34)}_2`);
    // a block comes with the key its dialog was given
    server.taken.add('Footer_v2');
    const block = { ...BLOCK, customerKey: 'Footer_v2' };
    assert.equal((await post(ASSETS, block)).customerKey, 'Footer_v2_2');
    server.taken.clear();
    assert.equal((await post(ASSETS, block)).customerKey, 'Footer_v2');
});

test('what the user decided, and what is not created here, goes out as the page wrote it', async () => {
    const { post, server, document } = page();
    const untouched = [
        // a key the user typed, even one that is taken
        [ASSETS, { ...BLOCK, customerKey: 'my-own-key' }],
        [ASSETS, { ...EMAIL, customerKey: 'my-own-key' }],
        // a block without a key gets the one the server makes up, as before
        [ASSETS, BLOCK],
        // a name that leaves nothing for a key
        [ASSETS, { ...EMAIL, name: '日本語 (!)' }],
        [ASSETS, { ...EMAIL, name: 12 }],
        // what exists already, and other requests
        [ASSETS, { ...EMAIL, id: 12 }],
        [`${ASSETS}12`, EMAIL],
        [`${ASSETS}query`, EMAIL],
        [`https://example.com${ASSETS}`, EMAIL],
    ];
    server.taken.add('my-own-key');
    for (const [url, body] of untouched) {
        assert.deepEqual(await post(url, body), body, url);
    }
    assert.deepEqual(await post(ASSETS, EMAIL, 'PUT'), EMAIL);
    assert.equal(await post(ASSETS, 'no json'), 'no json');
    assert.deepEqual(server.asked, []);
    // with readable keys switched off
    document.documentElement.setAttribute(KEYS, 'off');
    assert.deepEqual(await post(ASSETS, EMAIL), EMAIL);
    document.documentElement.setAttribute(KEYS, 'on');
    assert.equal((await post(ASSETS, EMAIL)).customerKey, 'Welcome_DE_1');
});

test('if the server does not say whether a key is free, the request goes out as the page wrote it', async () => {
    const { window, post, server, sent } = page();
    server.status = 500;
    assert.deepEqual(await post(ASSETS, EMAIL), EMAIL);
    // an answer that lists no content, or content with another key: the key is not counted up
    server.status = 200;
    server.answer = { message: 'nothing' };
    assert.deepEqual(await post(ASSETS, EMAIL), EMAIL);
    server.answer = { count: 1, items: [{ customerKey: 'something else' }] };
    assert.deepEqual(await post(ASSETS, EMAIL), EMAIL);
    server.answer = null;
    // the question is asked with care: a login page instead of an answer ends it
    assert.equal(server.options.redirect, 'error');
    assert.equal(server.options.credentials, 'same-origin');
    assert.ok(server.options.signal);
    window.fetch = () => Promise.reject(new Error('offline'));
    assert.deepEqual(await post(ASSETS, EMAIL), EMAIL);
    // a request the page waits for cannot wait for that question
    const request = new window.XMLHttpRequest();
    request.open('POST', ASSETS, false);
    request.send(JSON.stringify(EMAIL));
    assert.deepEqual(JSON.parse(sent.at(-1)), EMAIL);
});

test('a request the page gave up, or opened for something else, is not sent after the answer', async () => {
    const { window, sent } = page();
    const request = new window.XMLHttpRequest();
    request.open('POST', ASSETS, true);
    request.send(JSON.stringify(EMAIL));
    request.abort();
    await tick();
    await tick();
    await tick();
    assert.deepEqual(sent, []);
    const reused = new window.XMLHttpRequest();
    reused.open('POST', ASSETS, true);
    reused.send(JSON.stringify(EMAIL));
    reused.open('GET', '/elsewhere', true);
    await tick();
    await tick();
    await tick();
    assert.deepEqual(sent, []);
});

test('the manifest runs the script in the pages of Content Builder, in their own world, with the settings next to it', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) => item.js.includes('content-builder.js'));
    // the key rule under a name of its own: a file listed for both worlds of a page runs in the
    // extension's world only, and that world has key-rule.js here; the build makes the copy
    assert.deepEqual(entry.js, ['key-rule-page.js', 'content-builder.js']);
    assert.match(read('../scripts/build.js'), /'key-rule-page\.js': 'key-rule\.js'/);
    for (const item of manifest.content_scripts) {
        const others = manifest.content_scripts.filter(
            (other) => other !== item && other.world !== item.world,
        );
        const shared = others.flatMap((other) =>
            other.js.filter(
                (file) =>
                    item.js.includes(file) &&
                    other.include_globs?.join(',') === item.include_globs?.join(',') &&
                    other.matches.some((match) => item.matches.includes(match)),
            ),
        );
        assert.deepEqual(shared, [], item.js.join(','));
    }
    assert.deepEqual(entry.include_globs, ['https://content-builder.*']);
    assert.equal(entry.world, 'MAIN');
    assert.equal(entry.run_at, 'document_start');
    assert.equal(entry.all_frames, true);
    const settings = manifest.content_scripts.find(
        (item) =>
            item.js.includes('journey-settings.js') &&
            item.include_globs?.includes('https://content-builder.*'),
    );
    assert.deepEqual(settings.js, ['key-rule.js', 'readable-keys.js', 'journey-settings.js']);
    assert.equal(settings.world, undefined);
});
