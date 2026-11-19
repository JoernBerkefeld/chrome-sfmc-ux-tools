import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';

// these tests run the built extension in a page like Marketing Cloud Next's content editor;
// "npm test" builds it first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const codeMirrorSource = readFileSync(require.resolve('codemirror/lib/codemirror.js'), 'utf8');
const showHintSource = readFileSync(require.resolve('codemirror/addon/hint/show-hint.js'), 'utf8');
const htmlModeSources = [
    'codemirror/mode/xml/xml.js',
    'codemirror/mode/javascript/javascript.js',
    'codemirror/mode/css/css.js',
    'codemirror/mode/htmlmixed/htmlmixed.js',
].map((id) => readFileSync(require.resolve(id), 'utf8'));
const languageScript = read('../dist/extension/editor-language.js');
const formatScript = read('../dist/extension/editor-format.js');
const NEXT_URL = 'https://example.lightning.force.com/cmsAuthor/contentEditor.app?id=1';
const ENGAGEMENT_URL = 'https://content-builder.s1.marketingcloudapps.com/';
const NEXT_MODE = 'ampscript-handlebars';
const HOVER = '.sfmc-hover';
const SIGNATURE = '.sfmc-signature';
const FIX = '.sfmc-fix';
// the features that are set up for an editor, by a key each of them binds
const KEYS = {
    hover: 'Ctrl-.',
    signature: 'Esc',
    format: 'Shift-Alt-F',
    completions: 'Ctrl-Space',
};
// longer than the page is looked at for its CodeMirror, and for editors that are known
const libraryPause = () => new Promise((resolve) => setTimeout(resolve, 1200));
// longer than a scan of the page is put off
const scanPause = () => new Promise((resolve) => setTimeout(resolve, 150));
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 450));
const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

// the pages of a test; each keeps looking for CodeMirror until it is closed
const pages = [];
afterEach(() => {
    for (const window of pages.splice(0)) {
        window.close();
    }
});

/**
 * Creates a page without CodeMirror, as Marketing Cloud Next's content editor is until the user
 * opens a code editor.
 *
 * @param {string} [url] address of the page
 * @returns {object} the page's window
 */
function page(url = NEXT_URL) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        url,
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    pages.push(window);
    return window;
}

/**
 * Loads CodeMirror 5 into a page the way Marketing Cloud Next does: as a global, with an
 * "ampscript-handlebars" mode (here plain HTML), its own Ctrl-Space and the hint addon.
 *
 * @param {object} window page window
 */
function loadLibrary(window) {
    window.eval(codeMirrorSource);
    for (const source of htmlModeSources) {
        window.eval(source);
    }
    window.eval(showHintSource);
    window.CodeMirror.defineMode(NEXT_MODE, (config) =>
        window.CodeMirror.getMode(config, 'htmlmixed'),
    );
}

/**
 * Adds a component with a shadow tree to the page, like the Lightning components the content
 * editor is made of.
 *
 * @param {Node} parent where to add it
 * @returns {ShadowRoot} its shadow tree
 */
function addComponent(parent) {
    const host = parent.ownerDocument.createElement('div');
    parent.append(host);
    return host.attachShadow({ mode: 'open' });
}

/**
 * Adds an editor to a place of the page.
 *
 * @param {object} window page window
 * @param {Node} parent where to add it
 * @param {string} value editor content
 * @param {string} [mode] mode option
 * @returns {object} CodeMirror instance
 */
function addEditor(window, parent, value, mode = NEXT_MODE) {
    const editor = new window.CodeMirror(parent, {
        value,
        mode,
        extraKeys: { 'Ctrl-Space': 'autocomplete' },
    });
    editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    return editor;
}

/**
 * Runs the extension's scripts in the page, in the order of the manifest.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    window.eval(languageScript);
    window.eval(formatScript);
}

/**
 * Lists the key maps of an editor that bind a key.
 *
 * @param {object} editor CodeMirror instance
 * @param {string} key name of the key, as CodeMirror writes it
 * @returns {object[]} key maps
 */
function bound(editor, key) {
    return editor.state.keyMaps.filter((map) => Object.hasOwn(map, key));
}

/**
 * Lists the features that are set up for an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} names from `KEYS`
 */
function features(editor) {
    return Object.entries(KEYS)
        .filter(([, key]) => bound(editor, key).length > 0)
        .map(([name]) => name);
}

/**
 * Creates a page of the content editor with one editor in a nested shadow tree and the
 * extension running.
 *
 * @param {string} value editor content
 * @returns {Promise.<{window: object, editor: object}>} the page and its editor, set up
 */
async function withEditor(value) {
    const window = page();
    loadLibrary(window);
    const editor = addEditor(window, addComponent(addComponent(window.document.body)), value);
    runExtension(window);
    await scanPause();
    return { window, editor };
}

/**
 * Rests the mouse on a character of an editor. jsdom has no layout, so the editor is told
 * which character that is.
 *
 * @param {object} window page window
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends right before the character
 */
async function rest(window, editor, before) {
    const place = editor.posFromIndex(editor.getValue().indexOf(before) + before.length);
    editor.coordsChar = () => ({ line: place.line, ch: place.ch + 1, xRel: -1 });
    editor.getWrapperElement().dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }));
    await hoverPause();
}

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} kind of underline and underlined text, sorted
 */
function underlined(editor) {
    return [...editor.getAllMarks()]
        .filter((mark) => mark.className?.includes('sfmc-diagnostic'))
        .map((mark) => {
            const { from, to } = mark.find();
            return `${mark.className.split('sfmc-diagnostic-', 2)[1]}: ${editor.getRange(from, to)}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

const NEXT_FEATURES = ['hover', 'signature', 'format'];

test('Next: editors in shadow trees are found once the page loads CodeMirror, however late', async () => {
    const window = page();
    runExtension(window);
    await libraryPause();
    assert.equal(window.CodeMirror, undefined, 'nothing is loaded for the page');

    // the user opens a code editor: the page loads CodeMirror and creates an editor at once,
    // before the extension has seen the library
    loadLibrary(window);
    const first = addEditor(window, addComponent(addComponent(window.document.body)), '<p></p>');
    assert.equal(window.document.querySelectorAll('.CodeMirror').length, 0, 'out of sight');
    assert.deepEqual(features(first), []);
    await libraryPause();
    assert.deepEqual(features(first), NEXT_FEATURES, 'found by a walk through the shadow trees');

    // from then on, CodeMirror tells about every editor it creates
    const second = addEditor(window, addComponent(window.document.body), '<p></p>');
    await scanPause();
    assert.deepEqual(features(second), NEXT_FEATURES, 'found through the init hook');
    // nothing is set up twice
    await libraryPause();
    assert.equal(bound(first, KEYS.format).length, 1);
    assert.equal(bound(second, KEYS.hover).length, 1);
});

test('Next: an editor is set up when it gets the mode, and one that is added to the page later too', async () => {
    const window = page();
    loadLibrary(window);
    runExtension(window);
    const plain = addEditor(window, addComponent(window.document.body), '<p></p>', 'htmlmixed');
    // created off the page and added later, as in a panel that is built before it is shown
    const holder = window.document.createElement('div');
    const late = addEditor(window, holder.attachShadow({ mode: 'open' }), '<p></p>');
    await scanPause();
    assert.deepEqual(features(plain), [], 'not an editor for AMPscript');
    assert.deepEqual(features(late), [], 'not on the page');

    plain.setOption('mode', NEXT_MODE);
    await scanPause();
    assert.deepEqual(features(plain), NEXT_FEATURES);

    window.document.body.append(holder);
    await libraryPause();
    assert.deepEqual(features(late), NEXT_FEATURES);

    // an editor that leaves the page loses the box it shows
    await rest(window, late, '<');
    late.setValue('%%=Lowercase("A")=%%');
    await rest(window, late, '%%=Lower');
    assert.ok(window.document.querySelector(HOVER));
    holder.remove();
    await libraryPause();
    assert.equal(window.document.querySelector(HOVER), null);
});

test('Next: no suggestions, no save key, no button and nothing of TypeScript are added', async () => {
    const { window, editor } = await withEditor('%%[ set @a = Loo ]%%');
    let wasAsked = false;
    window.document.addEventListener('sfmc-ux-tools:need-typescript', () => {
        wasAsked = true;
    });
    const other = addEditor(window, addComponent(window.document.body), '<p></p>');
    await scanPause();
    for (const cm of [editor, other]) {
        assert.deepEqual(features(cm), NEXT_FEATURES);
        assert.ok(cm.state.keyMaps.every((map) => !('Ctrl-S' in map || 'Cmd-S' in map)));
        assert.equal(cm.getWrapperElement().querySelector('.sfmc-format-button'), null);
    }
    assert.equal(wasAsked, false);
    // the page's own Ctrl-Space is all there is
    assert.equal(editor.getOption('extraKeys')['Ctrl-Space'], 'autocomplete');
    editor.setCursor({ line: 0, ch: 16 });
    window.CodeMirror.signal(editor, 'inputRead', editor, { origin: '+input', text: ['o'] });
    await scanPause();
    assert.equal(editor.state.completionActive, undefined);
    assert.equal(window.document.querySelector('.CodeMirror-hints'), null);
    // the page's own list keeps its look: the stylesheet styles the list only where this is not set
    assert.equal(Object.hasOwn(window.document.documentElement.dataset, 'sfmcUxToolsNext'), true);
    const css = read('../src/editor-highlight.css');
    assert.equal((css.match(/^[^\n{]*\.CodeMirror-hint[^\n{]*\{/gm) ?? []).length, 4);
    assert.equal(
        (
            css.match(
                /^html:not\(\[data-sfmc-ux-tools-next\]\) [^\n{]*\.CodeMirror-hint[^\n{]*\{/gm,
            ) ?? []
        ).length,
        3,
    );
});

test('Next: Handlebars helpers and AMPscript are checked for Marketing Cloud Next, with fixes', async () => {
    const content =
        '<p>{{uppercas name}} {{lowercase name}}</p>\n%%[ set @a = HTTPGet("https://example.com") ]%%';
    const { window, editor } = await withEditor(content);
    await checkPause();
    assert.deepEqual(underlined(editor), ['error: HTTPGet', 'warning: {{uppercas name}}']);

    const { document } = window;
    await rest(window, editor, '{{upper');
    const problem = document.querySelector(`${HOVER} .sfmc-problem-warning`);
    assert.match(problem.textContent, /Unknown Handlebars helper 'uppercas'/);
    assert.equal(
        problem.querySelector('.sfmc-problem-rule').textContent,
        'sfmc/hbs-no-unknown-helper',
    );
    const fix = problem.querySelector(FIX);
    assert.equal(fix.textContent, "Replace 'uppercas' with 'uppercase'");
    fix.click();
    assert.equal(editor.getLine(0), '<p>{{uppercase name}} {{lowercase name}}</p>');
    await checkPause();
    assert.deepEqual(underlined(editor), ['error: HTTPGet']);

    await rest(window, editor, 'set @a = HTTP');
    const box = document.querySelector(HOVER);
    assert.match(
        box.querySelector('.sfmc-problem-error').textContent,
        /'HTTPGet' is not supported in Marketing Cloud Next/,
    );
    assert.match(box.querySelector('.sfmc-problem-rule').textContent, /amp-no-mcn-unsupported/);
    assert.match(box.querySelector('pre').textContent, /^\(function\) HTTPGet\(/);
    assert.equal(box.parentNode, document.body);
});

test('Next: a Handlebars helper is explained, and its parameters while they are typed', async () => {
    const { window, editor } = await withEditor('<p>{{uppercase name}}</p>\n<p>{{add 1 2}}</p>');
    const { document } = window;
    await rest(window, editor, '{{upper');
    const box = document.querySelector(HOVER);
    assert.match(box.querySelector('pre').textContent, /^\(helper\) uppercase\(/);
    assert.match(box.textContent, /MCN helper/);
    assert.equal(box.querySelector('.sfmc-problem'), null);

    editor.hasFocus = () => true;
    editor.setCursor({ line: 1, ch: 11 });
    await scanPause();
    await scanPause();
    const help = document.querySelector(SIGNATURE);
    assert.match(help.querySelector('pre').textContent, /^\(helper\) add\(value1: number/);
    assert.equal(help.querySelector('strong').textContent, 'value2: number');
});

test('Next: server-side JavaScript is said to be unsupported, and nothing else is said about it', async () => {
    const { window, editor } = await withEditor(
        '<script runat="server">\nvar a = Platform.Function.Lookup("a", "b", "c", 1);\n</script>',
    );
    await checkPause();
    const { document } = window;
    await rest(window, editor, 'Platform.Function.Look');
    const box = document.querySelector(HOVER);
    assert.match(box.textContent, /SSJS is not supported in Marketing Cloud Next/);
    assert.equal(box.querySelector('pre'), null, 'no documentation of SSJS');
});

test('Engagement: the same content is checked for Marketing Cloud Engagement, and nothing changes there', async () => {
    const window = page(ENGAGEMENT_URL);
    loadLibrary(window);
    const content =
        '<p>{{uppercas name}}</p>\n%%[ set @a = HTTPGet("https://example.com") ]%%\n<p>{{add 1 2}}</p>';
    const hidden = addEditor(window, addComponent(window.document.body), content);
    // the mode of Marketing Cloud Next is accepted wherever it is found
    const editor = addEditor(window, window.document.body, content);
    runExtension(window);
    await libraryPause();
    assert.deepEqual(
        features(hidden),
        [],
        'shadow trees are only searched in Marketing Cloud Next',
    );
    assert.deepEqual(features(editor), [...NEXT_FEATURES, 'completions']);
    assert.ok(editor.state.keyMaps.some((map) => 'Ctrl-S' in map));
    assert.ok(editor.getWrapperElement().querySelector('.sfmc-format-button'));
    assert.deepEqual(underlined(editor), [], 'no check for Marketing Cloud Next');
    assert.equal(Object.hasOwn(window.document.documentElement.dataset, 'sfmcUxToolsNext'), false);

    const { document } = window;
    await rest(window, editor, '{{add');
    // the AMPscript function of that name, not the Handlebars helper
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /^\(function\) Add\(/);
    editor.hasFocus = () => true;
    editor.setCursor({ line: 2, ch: 11 });
    await scanPause();
    await scanPause();
    assert.equal(document.querySelector(SIGNATURE), null);
});

test('Next: Shift-Alt-F formats HTML, AMPscript and Handlebars in one step that can be undone', async () => {
    const { window, editor } = await withEditor(
        '<div>{{#if x}}<p>Hello {{  uppercase   name }}</p>{{else}}<p>Bye</p>{{/if}}</div>\n' +
            '%%[ set @a = Lowercase("A") ]%%\n<p>{{formatDate d "MMMM d,  yyyy"}} {!$Contact.Name}</p>',
    );
    const [keys] = bound(editor, KEYS.format);
    assert.equal(keys[KEYS.format](editor), undefined);
    await scanPause();
    await scanPause();
    assert.equal(
        editor.getValue(),
        '<div>\n' +
            '    {{#if x}}\n' +
            '    <p>Hello {{uppercase name}}</p>\n' +
            '    {{else}}\n' +
            '    <p>Bye</p>\n' +
            '    {{/if}}\n' +
            '</div>\n' +
            '%%[\n' +
            "    set @a = Lowercase('A')\n" +
            ']%%\n' +
            '<p>{{formatDate d "MMMM d,  yyyy"}} {!$Contact.Name}</p>',
    );
    editor.undo();
    assert.match(editor.getValue(), /^<div>\{\{#if x\}\}<p>Hello \{\{ {2}uppercase/);

    editor.setOption('readOnly', true);
    assert.equal(keys[KEYS.format](editor), window.CodeMirror.Pass);
});

test('the manifest runs the language and formatting scripts in the content editor of Marketing Cloud Next, and nothing else', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entries = manifest.content_scripts.filter((entry) =>
        entry.matches.some((match) => match.includes('force.com')),
    );
    assert.deepEqual(entries, [
        {
            matches: ['https://*.lightning.force.com/cmsAuthor/contentEditor.app*'],
            js: ['editor-language.js', 'editor-format.js'],
            css: ['editor-highlight.css'],
            world: 'MAIN',
            all_frames: true,
            run_at: 'document_idle',
        },
    ]);
    // content scripts need no host permission, and nothing of the extension is loaded by the page
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    assert.ok(
        manifest.web_accessible_resources.every((entry) =>
            entry.matches.every((match) => !match.includes('force.com')),
        ),
    );
});
