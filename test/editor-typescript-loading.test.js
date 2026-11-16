import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const backgroundScript = read('../src/background.js');
const loaderScript = read('../src/editor-typescript-loader.js');
const NEED = 'sfmc-ux-tools:need-typescript';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const FAILED = 'sfmc-ux-tools:typescript-failed';
const EXTENSION = 'this-extension';
const EDITOR_FRAME = {
    id: EXTENSION,
    tab: { id: 7 },
    frameId: 3,
    documentId: 'A1',
    url: 'https://content-builder.s50.marketingcloudapps.com/index.html',
};
const INJECTION = {
    target: { tabId: 7, documentIds: ['A1'] },
    files: ['editor-typescript.js'],
    world: 'MAIN',
};

/**
 * Runs the background script with a stand-in for the extension API.
 *
 * @param {{isFailing: boolean}} [state] `isFailing` makes injections fail while it is true
 * @returns {{send: (message: object, sender: object) => Promise.<object> | false, injections: object[]}} a way to send it a message, which gives the answer or false if none will come, and what it injected
 */
function background(state) {
    const listeners = [];
    const injections = [];
    const chrome = {
        runtime: {
            id: EXTENSION,
            onMessage: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
        scripting: {
            executeScript: (injection) => {
                // copied, because an object of the script's world is never deep-equal to one of the test
                injections.push(structuredClone(injection));
                return state?.isFailing
                    ? Promise.reject(new Error('no such document'))
                    : Promise.resolve([]);
            },
        },
    };
    vm.runInNewContext(backgroundScript, { chrome });
    assert.equal(listeners.length, 1);
    const send = (message, sender) => {
        const { promise, resolve } = Promise.withResolvers();
        // true is how a listener tells Chrome that its answer comes later
        const willAnswer = listeners[0](message, sender, (answer) =>
            resolve(structuredClone(answer)),
        );
        return willAnswer === true && promise;
    };
    return { send, injections };
}

test('the background script injects the TypeScript script into the document that asked, in the page world, once', async () => {
    const { send, injections } = background();
    assert.deepEqual(await send({ type: NEED }, EDITOR_FRAME), { isLoaded: true });
    assert.deepEqual(injections, [INJECTION]);
    assert.deepEqual(await send({ type: NEED }, EDITOR_FRAME), { isLoaded: true });
    assert.equal(injections.length, 1, 'once per document');

    await send({ type: NEED }, { ...EDITOR_FRAME, frameId: 4, documentId: 'B2' });
    assert.deepEqual(injections[1].target, { tabId: 7, documentIds: ['B2'] });
    // the same frame shows another document after a reload
    await send({ type: NEED }, { ...EDITOR_FRAME, documentId: 'C3' });
    assert.deepEqual(injections[2].target, { tabId: 7, documentIds: ['C3'] });
    assert.equal(injections.length, 3);
});

test('the background script ignores other messages, other senders and other frames', () => {
    const { send, injections } = background();
    assert.equal(send({ type: 'something-else' }, EDITOR_FRAME), false);
    assert.equal(send(undefined, EDITOR_FRAME), false);
    const others = [
        { url: 'https://mc.s50.exacttarget.com/cloud/' },
        { url: undefined },
        { id: 'another-extension' },
        // the options page has no tab
        { tab: undefined },
        { frameId: undefined },
        // nothing says which document asked, so none is touched
        { documentId: undefined },
    ];
    for (const other of others) {
        assert.equal(send({ type: NEED }, { ...EDITOR_FRAME, ...other }), false);
    }
    assert.deepEqual(injections, []);
});

test('the background script says when an injection failed, and tries again when asked again', async () => {
    const state = { isFailing: true };
    const { send, injections } = background(state);
    assert.deepEqual(await send({ type: NEED }, EDITOR_FRAME), { isLoaded: false });
    state.isFailing = false;
    assert.deepEqual(await send({ type: NEED }, EDITOR_FRAME), { isLoaded: true });
    assert.deepEqual(injections, [INJECTION, INJECTION]);
});

/**
 * Creates a frame that runs the loader.
 *
 * @param {(message: object) => Promise.<object>} sendMessage stand-in for chrome.runtime.sendMessage
 * @returns {{need: () => void, failures: () => number}} lets the language script ask for the TypeScript script, and counts how often it was told that there is none
 */
function frame(sendMessage) {
    const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    let failed = 0;
    window.document.addEventListener(FAILED, () => failed++);
    window.chrome = { runtime: { sendMessage } };
    window.eval(loaderScript);
    return {
        need: () => window.document.dispatchEvent(new window.CustomEvent(NEED)),
        failures: () => failed,
    };
}

test('the loader passes the request of the page on to the extension, once per frame', async () => {
    const sent = [];
    const { need, failures } = frame((message) => {
        sent.push(message);
        return Promise.resolve({ isLoaded: true });
    });
    assert.deepEqual(sent, [], 'nothing is asked for before an editor is found');
    need();
    need();
    await tick();
    need();
    // copied, because an object of the frame is never deep-equal to one of the test
    assert.deepEqual(structuredClone(sent), [{ type: NEED }]);
    assert.equal(failures(), 0);
});

test('the loader tells the page if the script could not be loaded, and asks again when the page does', async () => {
    const answers = [
        () => Promise.resolve({ isLoaded: false }),
        () => Promise.reject(new Error('no receiver')),
        () => {
            throw new Error('Extension context invalidated.');
        },
        // an extension that does not answer
        () => Promise.resolve(),
        () => Promise.resolve({ isLoaded: true }),
    ];
    let asked = 0;
    const { need, failures } = frame(() => answers[asked++]());
    for (let attempt = 1; attempt < answers.length; attempt++) {
        assert.doesNotThrow(need);
        // a rejection nobody handles would fail the test run
        await tick();
        assert.equal(asked, attempt);
        assert.equal(failures(), attempt);
    }
    need();
    await tick();
    need();
    await tick();
    assert.equal(asked, answers.length, 'not again once it is there');
    assert.equal(failures(), answers.length - 1);
});
test('the manifest loads the TypeScript script on demand only, and may inject it into the editor frames', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const scripts = manifest.content_scripts.flatMap((entry) => entry.js);
    assert.ok(!scripts.includes('editor-typescript.js'), 'too large to run in every frame');
    assert.ok(!scripts.includes('background.js'));
    assert.deepEqual(manifest.background, { service_worker: 'background.js' });
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);

    // the frames the editor scripts run in already, and no others
    const editor = manifest.content_scripts.find((entry) =>
        entry.js.includes('editor-language.js'),
    );
    assert.deepEqual(manifest.host_permissions, editor.matches);
    for (const glob of editor.include_globs) {
        assert.ok(backgroundScript.includes(`'${glob.replace(/\*$/, '')}'`), glob);
    }

    // the loader runs in the extension's own world, in the same frames, before the editor scripts
    const loader = manifest.content_scripts.find((entry) =>
        entry.js.includes('editor-typescript-loader.js'),
    );
    assert.equal(loader.world, undefined);
    assert.equal(loader.all_frames, true);
    assert.equal(loader.run_at, 'document_start');
    assert.equal(editor.run_at, 'document_idle');
    assert.deepEqual(loader.matches, editor.matches);
    assert.deepEqual(loader.include_globs, editor.include_globs);
});
