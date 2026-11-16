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
 * @param {boolean} [isSystemDark] true if the system is in dark mode
 * @returns {{theme: () => string, change: (value: string) => void, setSystemDark: (isDark: boolean) => void}} the page's theme and ways to change the setting and the system's mode
 */
function page(stored = {}, isBroken = false, isSystemDark = false) {
    const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const listeners = [];
    const system = { matches: isSystemDark, listeners: [] };
    // jsdom has no matchMedia
    window.matchMedia = (query) => {
        assert.equal(query, '(prefers-color-scheme: dark)');
        return {
            /**
             * The system's mode at the moment it is asked for.
             *
             * @returns {boolean} true in dark mode
             */
            get matches() {
                return system.matches;
            },
            addEventListener: (type, listener) => {
                system.listeners.push(listener);
            },
        };
    };
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
        setSystemDark: (isDark) => {
            system.matches = isDark;
            for (const listener of system.listeners) {
                listener({ matches: isDark });
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

test('until a theme is chosen the system decides, at once and after the setting was read', async () => {
    const light = page();
    const dark = page({}, false, true);
    assert.equal(light.theme(), 'light');
    assert.equal(dark.theme(), 'dark');
    await tick();
    assert.equal(light.theme(), 'light');
    assert.equal(dark.theme(), 'dark');
    // the system changing its mode while the page is open is followed
    dark.setSystemDark(false);
    assert.equal(dark.theme(), 'light');
    light.setSystemDark(true);
    assert.equal(light.theme(), 'dark');
});

test('a chosen theme wins over the system, and "like the system" hands it back', async () => {
    const { theme, change, setSystemDark } = page({ editorTheme: 'light' }, false, true);
    assert.equal(theme(), 'dark', 'before the setting is read the system decides');
    await tick();
    assert.equal(theme(), 'light');
    setSystemDark(false);
    setSystemDark(true);
    assert.equal(theme(), 'light');
    change('system');
    assert.equal(theme(), 'dark');
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

test('unknown values and unreadable settings follow the system', async () => {
    const unknown = page({ editorTheme: 'neon' });
    const broken = page({}, true, true);
    await tick();
    assert.equal(unknown.theme(), 'light');
    assert.equal(broken.theme(), 'dark');
});

test('both themes define the same colours and every colour in use is defined', () => {
    const light = definedIn(':root');
    const dark = definedIn(`:root[${ATTRIBUTE}='dark']`);
    assert.ok(light.length > 20);
    assert.deepEqual(dark, light);
    const used = new Set(css.matchAll(/var\((--sfmc-[\w-]+)\)/g).map((match) => match[1]));
    assert.deepEqual([...used].toSorted(byName), light);
});

test('the options page offers the system and both themes, the system first, and the manifest loads the script', () => {
    const { document } = new JSDOM(read('../src/options.html')).window;
    assert.deepEqual(
        [...document.querySelectorAll('input[name="editorTheme"]')].map((input) => input.value),
        ['system', 'light', 'dark'],
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
