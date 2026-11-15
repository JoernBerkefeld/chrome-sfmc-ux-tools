import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { findDynamicCode } from '../scripts/find-dynamic-code.js';

// these tests run the built extension; "npm test" builds it first (pretest)
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
const dataScript = read('../dist/extension/language-data.js');
const highlightScript = read('../dist/extension/editor-highlight.js');
const completionsScript = read('../dist/extension/editor-completions.js');
const BASE_MODE = 'ampScriptHtmlMixed';
const POPUP = '.CodeMirror-hints';

/**
 * Creates a page that has CodeMirror 5 the way Marketing Cloud ships it: with an
 * "ampScriptHtmlMixed" mode (here plain HTML) and without a global `CodeMirror`.
 *
 * @param {{hasShowHint?: boolean}} [options] whether the page's CodeMirror has the hint addon
 * @returns {{window: object, CodeMirror: object}} the page and its CodeMirror constructor
 */
function page({ hasShowHint = true } = {}) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    window.eval(codeMirrorSource);
    for (const source of htmlModeSources) {
        window.eval(source);
    }
    if (hasShowHint) {
        window.eval(showHintSource);
    }
    const CodeMirror = window.CodeMirror;
    delete window.CodeMirror;
    CodeMirror.defineMode(BASE_MODE, (config) => CodeMirror.getMode(config, 'htmlmixed'));
    return { window, CodeMirror };
}

/**
 * Adds an editor to the page, with the cursor where the content has a "|".
 *
 * @param {{window: object, CodeMirror: object}} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor and is removed
 * @param {string} [mode] mode option
 * @returns {object} CodeMirror instance
 */
function addEditor({ window, CodeMirror }, content, mode = BASE_MODE) {
    const offset = content.indexOf('|');
    const value = offset === -1 ? content : content.slice(0, offset) + content.slice(offset + 1);
    const editor = new CodeMirror(window.document.body, { value, mode });
    if (offset !== -1) {
        editor.setCursor(editor.posFromIndex(offset));
    }
    return editor;
}

/**
 * Runs the extension's editor scripts in the page, in the order of the manifest.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    window.eval(dataScript);
    window.eval(highlightScript);
    window.eval(completionsScript);
}

/**
 * Presses Ctrl-Space the way CodeMirror would: through the key map the extension registered.
 *
 * @param {object} editor CodeMirror instance
 * @returns {unknown} what the key binding returned
 */
function pressCtrlSpace(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-Space' in map);
    assert.ok(keyMap, 'Ctrl-Space is bound');
    return keyMap['Ctrl-Space'](editor);
}

/**
 * Types text at the cursor and tells the editor's listeners about it, like real input does.
 *
 * @param {{CodeMirror: object}} context page from `page()`
 * @param {object} editor CodeMirror instance
 * @param {string} text typed text
 */
function type({ CodeMirror }, editor, text) {
    editor.replaceSelection(text, 'end', '+input');
    CodeMirror.signal(editor, 'inputRead', editor, { origin: '+input', text: [text] });
}

/**
 * The suggestions that are currently on offer.
 *
 * @param {object} editor CodeMirror instance
 * @returns {object[]} CodeMirror hints; empty if no popup is open
 */
function hints(editor) {
    // copied, because an array of the page is never deep-equal to one of the test
    return [...(editor.state.completionActive?.data?.list ?? [])];
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

test('offers AMPscript functions that start with the typed word', () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Loo| ]%%</p>');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const labels = hints(editor).map((hint) => hint.displayText);
    assert.ok(labels.includes('Lookup'), labels.join(' | '));
    assert.ok(labels.includes('LookupRows'), labels.join(' | '));
    assert.ok(labels.length < 20, 'only names that start with "Loo"');
    for (const label of labels) {
        assert.match(label, /^loo/i);
    }
    const popup = context.window.document.querySelector(POPUP);
    assert.equal(popup.parentNode, context.window.document.body);
    const entry = [...popup.children].find((item) => item.firstChild.textContent === 'Lookup');
    assert.equal(entry.querySelector('.sfmc-hint-detail').textContent, '(Data Extension) Lookup');
});

test('ignores the letter case of the typed word and offers keywords and variables too', () => {
    const context = page();
    const editor = addEditor(context, '%%[ var @count\nSE| ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    assert.ok(
        hints(editor)
            .map((hint) => hint.displayText)
            .includes('set'),
    );
    editor.state.completionActive.close();
    editor.replaceRange('set @co', { line: 1, ch: 0 }, { line: 1, ch: 2 });
    pressCtrlSpace(editor);
    assert.deepEqual(
        hints(editor).map((hint) => hint.displayText),
        ['@count'],
    );
});

test('offers nothing in plain HTML text or in server-side JavaScript', () => {
    const context = page();
    const html = addEditor(context, '<p>Hello Loo|</p> %%[ set @a = 1 ]%%');
    const ssjs = addEditor(context, '<script runat="server">\nvar a = Pla|\n</script>');
    runExtension(context.window);
    // the key is passed on, so that a binding of the page still runs
    assert.equal(pressCtrlSpace(html), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(ssjs), context.CodeMirror.Pass);
    assert.equal(html.state.completionActive, undefined);
    assert.equal(ssjs.state.completionActive, undefined);
    assert.deepEqual(hints(html), []);
    assert.deepEqual(hints(ssjs), []);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

test('leaves read-only editors and selections alone', () => {
    const context = page();
    const locked = addEditor(context, '%%[ set @a = Loo| ]%%');
    locked.setOption('readOnly', true);
    const selecting = addEditor(context, '%%[ set @a = Loo| ]%%');
    selecting.setSelection({ line: 0, ch: 13 }, { line: 0, ch: 16 });
    runExtension(context.window);
    assert.equal(pressCtrlSpace(locked), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(selecting), context.CodeMirror.Pass);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

test('a pick inside a word replaces the whole word and keeps an existing bracket', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Loo|kup("a") ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const completion = editor.state.completionActive;
    completion.pick(
        completion.data,
        completion.data.list.findIndex((entry) => entry.displayText === 'LookupRows'),
    );
    assert.equal(editor.getValue(), '%%[ set @a = LookupRows("a") ]%%');
});

test('picking a suggestion replaces only the typed word', () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Loo| ]%%</p>');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const completion = editor.state.completionActive;
    completion.pick(
        completion.data,
        hints(editor).findIndex((hint) => hint.displayText === 'Lookup'),
    );
    assert.equal(editor.getValue(), '<p>%%[ set @a = Lookup( ]%%</p>');
    assert.equal(editor.getCursor().ch, '<p>%%[ set @a = Lookup('.length);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

test('inserts keywords and variables as plain text, without snippet placeholders', () => {
    const context = page();
    const editor = addEditor(context, '%%[ var @count\ni| ]%%');
    runExtension(context.window);
    pressCtrlSpace(editor);
    const byLabel = (label) => hints(editor).find((hint) => hint.displayText === label);
    // the language service offers "if ${1:condition} then ..."; the text ends where the cursor belongs
    assert.equal(byLabel('if').text, 'if ');
    editor.state.completionActive.close();
    editor.replaceRange('@', { line: 1, ch: 0 }, { line: 1, ch: 1 });
    pressCtrlSpace(editor);
    assert.equal(byLabel('@count').text, '@count');
    for (const hint of hints(editor)) {
        assert.doesNotMatch(hint.text, /\$\{|\$\d/);
    }
});

test('opens the popup while typing, but not inside strings or comments', async () => {
    const context = page();
    const code = addEditor(context, '%%[ set @a = | ]%%');
    const string = addEditor(context, '%%[ set @a = "| ]%%');
    const comment = addEditor(context, '%%[ /* | */ ]%%');
    const space = addEditor(context, '%%[ set @a =| ]%%');
    runExtension(context.window);
    type(context, code, 'L');
    type(context, code, 'o');
    type(context, string, 'L');
    type(context, comment, 'L');
    type(context, space, ' ');
    assert.deepEqual(hints(code), [], 'waits until typing pauses');
    await pause();
    assert.ok(
        hints(code)
            .map((hint) => hint.displayText)
            .includes('Lookup'),
    );
    assert.equal(string.state.completionActive, undefined);
    assert.equal(comment.state.completionActive, undefined);
    assert.equal(space.state.completionActive, undefined);
    assert.equal(code.getValue(), '%%[ set @a = Lo ]%%', 'typing alone inserts nothing');
});

test('sets up editors that are opened later, each one only once', async () => {
    const context = page();
    runExtension(context.window);
    const late = addEditor(context, '%%[ set @a = Loo| ]%%');
    const other = addEditor(context, '%%[ set @a = Loo| ]%%', 'htmlmixed');
    await pause();
    context.window.eval(completionsScript);
    await pause();
    assert.equal(late.state.keyMaps.filter((map) => 'Ctrl-Space' in map).length, 1);
    assert.equal(other.state.keyMaps.length, 0, 'editors with other modes are left alone');
    pressCtrlSpace(late);
    assert.ok(hints(late).length > 0);
});

test('a failing language service leaves the editor usable and is reported once', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Loo| ]%%');
    runExtension(context.window);
    const reports = [];
    context.window.console.debug = (...parameters) => {
        reports.push(parameters);
    };
    // the language service splits the text into lines first; a failure there stands in for any other
    const split = context.window.String.prototype.split;
    context.window.String.prototype.split = () => {
        throw new Error('broken');
    };
    try {
        assert.doesNotThrow(() => pressCtrlSpace(editor));
        assert.doesNotThrow(() => pressCtrlSpace(editor));
    } finally {
        context.window.String.prototype.split = split;
    }
    assert.deepEqual(hints(editor), []);
    assert.equal(context.window.document.querySelector(POPUP), null);
    assert.equal(reports.length, 1);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    editor.replaceSelection('k');
    assert.equal(editor.getValue(), '%%[ set @a = Look ]%%');
    pressCtrlSpace(editor);
    assert.ok(hints(editor).length > 0, 'works again once the language service does');
});

test('does nothing if the page has no hint addon, and passes the key on', async () => {
    const context = page({ hasShowHint: false });
    const editor = addEditor(context, '%%[ set @a = Loo| ]%%');
    runExtension(context.window);
    assert.equal(pressCtrlSpace(editor), context.CodeMirror.Pass);
    type(context, editor, 'k');
    await pause();
    assert.equal(editor.state.completionActive, undefined);
    assert.equal(editor.getValue(), '%%[ set @a = Look ]%%');
    assert.ok(editor.getLineTokens(0).some((token) => token.type === 'sfmc-keyword'));
});

test('the colouring works with and without the completions script', () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = 1 ]%%');
    context.window.eval(dataScript);
    context.window.eval(highlightScript);
    context.window.eval('document.querySelectorAll = () => { throw new Error("broken"); };');
    assert.doesNotThrow(() => context.window.eval(completionsScript));
    assert.ok(editor.getLineTokens(0).some((token) => token.type === 'sfmc-keyword'));
});

test('the built extension is complete and its manifest references only existing files', () => {
    const manifest = JSON.parse(read('../dist/extension/manifest.json'));
    assert.deepEqual(manifest, JSON.parse(read('../src/manifest.json')));
    const files = [
        ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])]),
        ...Object.values(manifest.icons),
    ];
    assert.ok(files.includes('editor-completions.js'));
    for (const file of files) {
        assert.ok(
            existsSync(new URL(`../dist/extension/${file}`, import.meta.url)),
            `${file} is missing`,
        );
    }
    assert.equal(highlightScript, read('../src/editor-highlight.js'));
});

test('the completions bundle is one classic script without eval or new Function', () => {
    assert.deepEqual(findDynamicCode(completionsScript), []);
    assert.doesNotMatch(completionsScript, /^\s*(?:import|export)\s/m);
    assert.match(completionsScript, /includes sfmc-language-lsp \d+\.\d+\.\d+/);
    // the check itself recognises both, and is not fooled by text that merely mentions them
    assert.deepEqual(findDynamicCode('var a = "eval(1) new Function"; // eval(2)'), []);
    assert.equal(findDynamicCode('eval("1"); var f = new Function("return 1");').length, 2);
});

test('the popup has styles of its own', () => {
    const css = read('../dist/extension/editor-highlight.css');
    for (const selector of ['.CodeMirror-hints', '.CodeMirror-hint', '.CodeMirror-hint-active']) {
        assert.ok(css.includes(selector + ' {'), selector);
    }
    assert.match(css, /\.CodeMirror-hints \{[^}]*z-index: \d{4,}/);
    assert.ok(css.includes('.sfmc-hint-detail'));
});
