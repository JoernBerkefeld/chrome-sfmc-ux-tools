import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const script = read('../src/editor-theme.js');
const css = read('../src/editor-highlight.css');
const ATTRIBUTE = 'data-sfmc-ux-tools-theme';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const byName = (a, b) => a.localeCompare(b);

/**
 * Runs the theme script in a page whose extension storage holds the given values.
 *
 * @param {Object.<string, string>} [stored] saved settings
 * @param {boolean} [isBroken] true makes the read fail
 * @returns {{theme: () => string, change: (value: string) => void}} the page's theme and a way to change the setting
 */
function page(stored = {}, isBroken = false) {
    const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const listeners = [];
    window.chrome = {
        storage: {
            sync: {
                get: (defaults) =>
                    isBroken
                        ? Promise.reject(new Error('broken'))
                        : Promise.resolve({ ...defaults, ...stored }),
            },
            onChanged: {
                addListener: (listener) => {
                    listeners.push(listener);
                },
            },
        },
    };
    window.eval(script);
    return {
        theme: () => window.document.documentElement.getAttribute(ATTRIBUTE),
        change: (newValue) => {
            for (const listener of listeners) {
                listener({ editorTheme: { newValue } }, 'sync');
            }
        },
    };
}

/**
 * Lists the custom properties a rule of the stylesheet defines.
 *
 * @param {string} selector selector of the rule, as written in the file
 * @returns {string[]} sorted property names
 */
function definedIn(selector) {
    const start = css.indexOf(`\n${selector} {`);
    assert.notEqual(start, -1, `rule ${selector}`);
    const body = css.slice(start, css.indexOf('}', start));
    return body
        .matchAll(/(--sfmc-[\w-]+):/g)
        .map((match) => match[1])
        .toArray()
        .toSorted(byName);
}

test('the light theme is the default, at once and after the setting was read', async () => {
    const { theme } = page();
    assert.equal(theme(), 'light');
    await tick();
    assert.equal(theme(), 'light');
});

test('uses the saved theme and follows a change without a reload', async () => {
    const { theme, change } = page({ editorTheme: 'dark' });
    await tick();
    assert.equal(theme(), 'dark');
    change('light');
    assert.equal(theme(), 'light');
    change('dark');
    assert.equal(theme(), 'dark');
});

test('falls back to the light theme for unknown values and unreadable settings', async () => {
    const unknown = page({ editorTheme: 'neon' });
    const broken = page({}, true);
    await tick();
    assert.equal(unknown.theme(), 'light');
    assert.equal(broken.theme(), 'light');
});

test('both themes define the same colours and every colour in use is defined', () => {
    const light = definedIn(':root');
    const dark = definedIn(`:root[${ATTRIBUTE}='dark']`);
    assert.ok(light.length > 20);
    assert.deepEqual(dark, light);
    const used = new Set(css.matchAll(/var\((--sfmc-[\w-]+)\)/g).map((match) => match[1]));
    assert.deepEqual([...used].toSorted(byName), light);
});

test('the options page offers both themes, light first, and the manifest loads the script', () => {
    const { document } = new JSDOM(read('../src/options.html')).window;
    assert.deepEqual(
        [...document.querySelectorAll('input[name="editorTheme"]')].map((input) => input.value),
        ['light', 'dark'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) => item.js.includes('editor-theme.js'));
    assert.equal(entry.world, undefined);
    assert.equal(entry.run_at, 'document_start');
});

test('the toolbar icon is an action of its own and opens the options', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    // without an action Chrome shows the icon greyed out
    assert.equal(manifest.action.default_popup, manifest.options_ui.page);
    assert.deepEqual(manifest.action.default_icon, manifest.icons);
    assert.ok(manifest.action.default_title.startsWith(manifest.name));
});
