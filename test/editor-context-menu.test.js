import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/editor-context-menu.js');
const optionsScript = read('../src/options.js');
const optionsPage = read('../src/options.html');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Stand-in for chrome.storage: keeps values in memory and tells listeners about changes.
 *
 * @param {Object.<string, string>} [stored] values that are saved already
 * @param {boolean} [isBroken] true makes every read fail
 * @returns {{storage: object, stored: Object.<string, string>}} the api and its content
 */
function chromeStub(stored = {}, isBroken = false) {
    const listeners = [];
    return {
        stored,
        storage: {
            sync: {
                get: (defaults) =>
                    isBroken
                        ? Promise.reject(new Error('broken'))
                        : Promise.resolve({ ...defaults, ...stored }),
                set: (values) => {
                    for (const [key, newValue] of Object.entries(values)) {
                        stored[key] = newValue;
                        for (const listener of listeners) {
                            listener({ [key]: { newValue } }, 'sync');
                        }
                    }
                    return Promise.resolve();
                },
            },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
}

/**
 * Creates a page with something that looks like a code editor, a page handler that draws its own
 * menu, and the extension's script.
 *
 * @param {object} chrome stand-in from `chromeStub()`
 * @returns {{rightClick: (element: Element) => Event, seen: Element[], inside: Element, outside: Element}} the page
 */
function page(chrome) {
    const { window } = new JSDOM(
        '<!doctype html><body><div class="CodeMirror"><pre id="inside"></pre></div><p id="outside"></p></body>',
        { runScripts: 'outside-only' },
    );
    window.chrome = chrome;
    const seen = [];
    // stands in for the handler that draws Marketing Cloud's own menu
    window.document.addEventListener('contextmenu', (event) => {
        seen.push(event.target);
        event.preventDefault();
    });
    window.eval(script);
    return {
        seen,
        inside: window.document.querySelector('#inside'),
        outside: window.document.querySelector('#outside'),
        rightClick: (element) => {
            const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            element.dispatchEvent(event);
            return event;
        },
    };
}

test('by default a right-click in the editor reaches the browser but not the page', async () => {
    const { seen, inside, outside, rightClick } = page(chromeStub());
    // also before the setting has been read
    assert.equal(rightClick(inside).defaultPrevented, false);
    await tick();
    assert.equal(rightClick(inside).defaultPrevented, false);
    assert.deepEqual(seen, []);
    rightClick(outside);
    assert.deepEqual(seen, [outside]);
});

test('the page keeps its own menu if the user chose that', async () => {
    const { seen, inside, rightClick } = page(chromeStub({ editorContextMenu: 'page' }));
    await tick();
    assert.equal(rightClick(inside).defaultPrevented, true);
    assert.deepEqual(seen, [inside]);
});

test('a change of the setting applies without a reload', async () => {
    const chrome = chromeStub();
    const { seen, inside, rightClick } = page(chrome);
    await tick();
    await chrome.storage.sync.set({ editorContextMenu: 'page' });
    assert.equal(rightClick(inside).defaultPrevented, true);
    await chrome.storage.sync.set({ editorContextMenu: 'browser' });
    assert.equal(rightClick(inside).defaultPrevented, false);
    assert.deepEqual(seen, [inside]);
});

test('the browser menu stays the default if the setting cannot be read', async () => {
    const { seen, inside, rightClick } = page(chromeStub({}, true));
    await tick();
    rightClick(inside);
    assert.deepEqual(seen, []);
});

test('the gear button of the editor goes and comes with the menu', async () => {
    const attribute = 'data-sfmc-ux-tools-context-menu';
    const css = readFileSync(new URL('../src/editor-highlight.css', import.meta.url), 'utf8');
    // hidden only while the browser's menu is chosen, and against the display the page sets itself
    assert.match(
        css,
        /html\[data-sfmc-ux-tools-context-menu='browser'\] \.et-codemirror-footer \.settings-menu \{\s*display: none !important;/,
    );
    const source = readFileSync(new URL('../src/editor-context-menu.js', import.meta.url), 'utf8');
    const run = (stored) => {
        const { window } = new JSDOM('<!doctype html><body></body>', {
            runScripts: 'outside-only',
        });
        const listeners = [];
        window.chrome = {
            storage: {
                sync: { get: (defaults) => Promise.resolve({ ...defaults, ...stored }) },
                onChanged: {
                    addListener: (listener) => {
                        listeners.push(listener);
                    },
                },
            },
        };
        window.eval(source);
        return {
            value: () => window.document.documentElement.getAttribute(attribute),
            change: (newValue) => {
                for (const listener of listeners) {
                    listener({ editorContextMenu: { newValue } }, 'sync');
                }
            },
        };
    };
    const fresh = run({});
    const kept = run({ editorContextMenu: 'page' });
    assert.equal(fresh.value(), 'browser', 'at once, before the setting is read');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fresh.value(), 'browser');
    assert.equal(kept.value(), 'page');
    kept.change('browser');
    assert.equal(kept.value(), 'browser');
    fresh.change('page');
    assert.equal(fresh.value(), 'page');
});

test('the options page shows the saved choice and saves a new one', async () => {
    const chrome = chromeStub();
    const { window } = new JSDOM(optionsPage, { runScripts: 'outside-only' });
    window.chrome = chrome;
    window.eval(optionsScript);
    await tick();
    const radio = (value) =>
        [...window.document.querySelectorAll('input')].find((input) => input.value === value);
    assert.equal(radio('browser').checked, true);
    radio('page').click();
    assert.deepEqual(chrome.stored, { editorContextMenu: 'page' });

    const again = new JSDOM(optionsPage, { runScripts: 'outside-only' }).window;
    again.chrome = chrome;
    again.eval(optionsScript);
    await tick();
    assert.equal(again.document.querySelector('input[value="page"]').checked, true);
});

test('the options page names who holds the copyright and where to get support', () => {
    const { document } = new JSDOM(optionsPage).window;
    const footer = document.querySelector('footer');
    const links = Object.fromEntries(
        [...footer.querySelectorAll('a')].map((link) => [link.textContent.trim(), link]),
    );
    assert.match(footer.textContent, /©\s*\d{4}\s+Jörn Berkefeld/);
    assert.equal(links['Jörn Berkefeld'].href, 'https://joernberkefeld.com/');
    // the same address as "bugs" in package.json, which npm and GitHub show
    const { bugs } = JSON.parse(read('../package.json'));
    assert.equal(links['issues on GitHub'].href, bugs.url);
    for (const link of Object.values(links)) {
        // the options open as a popup too, which a link without a new tab would replace
        assert.equal(link.target, '_blank');
        assert.equal(link.rel, 'noopener noreferrer');
    }
});

test('the manifest declares the options page, its storage and the context menu script', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    assert.ok(manifest.permissions.includes('storage'));
    assert.equal(manifest.options_ui.page, 'options.html');
    const entry = manifest.content_scripts.find((item) =>
        item.js.includes('editor-context-menu.js'),
    );
    // not in the page's world: the setting is only readable from the extension's own
    assert.equal(entry.world, undefined);
    assert.equal(entry.run_at, 'document_start');
    assert.deepEqual(entry.include_globs, ['https://content-builder.*']);
});
