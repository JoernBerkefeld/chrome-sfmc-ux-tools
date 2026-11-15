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
const completionsScript = read('../dist/extension/editor-language.js');
const formatScript = read('../dist/extension/editor-format.js');
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
    window.eval(formatScript);
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
    // category and parameters, cut to length; the name is not repeated
    assert.equal(
        entry.querySelector('.sfmc-hint-detail').textContent,
        'Data Extension · dataObject, returnColumn, searchColumn1, s…',
    );
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

test('offers nothing in plain HTML text', () => {
    const context = page();
    const html = addEditor(context, '<p>Hello Loo|</p> %%[ set @a = 1 ]%%');
    runExtension(context.window);
    // the key is passed on, so that a binding of the page still runs
    assert.equal(pressCtrlSpace(html), context.CodeMirror.Pass);
    assert.equal(html.state.completionActive, undefined);
    assert.deepEqual(hints(html), []);
    assert.equal(context.window.document.querySelector(POPUP), null);
});

/**
 * Opens the popup in a server-side script and lists what it offers.
 *
 * @param {object} context page from `page()`
 * @param {string} body content of the script; a "|" marks the cursor
 * @returns {{editor: object, labels: string[], pick: (label: string) => void}} the editor, the names on offer and a way to choose one
 */
function inSsjs(context, body) {
    const editor = addEditor(
        context,
        `<p>%%=v(@a)=%%</p>\n<script runat="server">\n${body}\n</script>`,
    );
    runExtension(context.window);
    pressCtrlSpace(editor);
    return {
        editor,
        labels: hints(editor).map((hint) => hint.displayText),
        pick: (label) => {
            const completion = editor.state.completionActive;
            completion.pick(
                completion.data,
                completion.data.list.findIndex((entry) => entry.displayText === label),
            );
        },
    };
}

test('offers SSJS names in a server-side script, by their objects or by the name alone', () => {
    const chain = inSsjs(page(), 'var a = Platform.Function.Loo|');
    assert.ok(chain.labels.includes('Platform.Function.Lookup'), chain.labels.join(' | '));
    for (const label of chain.labels) {
        assert.match(label, /^Platform\.Function\.Loo/);
    }
    chain.pick('Platform.Function.Lookup');
    assert.equal(chain.editor.getLine(2), 'var a = Platform.Function.Lookup(');

    const word = inSsjs(page(), 'var a = looku|');
    assert.ok(word.labels.includes('Platform.Function.Lookup'), word.labels.join(' | '));
    assert.ok(!word.labels.includes('LookupRows'), 'no AMPscript names');
    word.pick('Platform.Function.LookupRows');
    assert.equal(word.editor.getLine(2), 'var a = Platform.Function.LookupRows(');

    const starts = inSsjs(page(), 'Wr|');
    assert.equal(starts.labels[0], 'Write', 'names that start with the typed text come first');
    const entry = [
        ...starts.editor.getWrapperElement().ownerDocument.querySelector(POPUP).children,
    ][0];
    assert.equal(entry.querySelector('.sfmc-hint-detail').textContent, 'global · text');
});

test('SSJS: objects, own functions, constructors and existing brackets', () => {
    const object = inSsjs(page(), 'var de = DataEx|');
    object.pick('DataExtension');
    assert.equal(object.editor.getLine(2), 'var de = DataExtension');

    const own = inSsjs(page(), 'function greet(name) { return name; }\ngre|');
    assert.deepEqual(own.labels, ['greet']);
    own.pick('greet');
    assert.equal(own.editor.getLine(3), 'greet(');

    const created = inSsjs(page(), 'var req = new Script.Util.HttpR|');
    created.pick('Script.Util.HttpRequest');
    assert.equal(created.editor.getLine(2), 'var req = new Script.Util.HttpRequest(');

    const bracket = inSsjs(page(), 'Platform.Function.Loo|kup("a")');
    bracket.pick('Platform.Function.LookupRows');
    assert.equal(bracket.editor.getLine(2), 'Platform.Function.LookupRows("a")');
});

test('SSJS: nothing for members of unknown values, and AMPscript stays AMPscript', () => {
    const context = page();
    const member = addEditor(context, '<script runat="server">\nvar a = de.Ro|\n</script>');
    const result = addEditor(context, '<script runat="server">\nvar a = get().Wr|\n</script>');
    const browser = addEditor(context, '<script>\nvar a = Platform.Function.Loo|\n</script>');
    const block = addEditor(
        context,
        '<script runat="server">var a = 1;</script>\n%%[ set @a = Loo| ]%%',
    );
    runExtension(context.window);
    assert.equal(pressCtrlSpace(member), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(result), context.CodeMirror.Pass);
    assert.equal(pressCtrlSpace(browser), context.CodeMirror.Pass, 'no SSJS in browser scripts');
    pressCtrlSpace(block);
    assert.ok(
        hints(block)
            .map((hint) => hint.displayText)
            .includes('LookupRows'),
    );
});

test('SSJS: the popup opens while typing, also after a dot, but not in strings or comments', async () => {
    const context = page();
    const open = '<script runat="server">\n';
    const code = addEditor(context, open + 'Platform.Function|\n</script>');
    const string = addEditor(context, open + 'var a = "Platform|";\n</script>');
    const comment = addEditor(context, open + '// Platform|\n</script>');
    const html = addEditor(context, '<p>Platform|</p>');
    runExtension(context.window);
    for (const editor of [code, string, comment, html]) {
        type(context, editor, '.');
    }
    await pause();
    assert.ok(hints(code).length > 0);
    for (const hint of hints(code)) {
        assert.match(hint.displayText, /^Platform\.Function\./);
    }
    assert.equal(string.state.completionActive, undefined);
    assert.equal(comment.state.completionActive, undefined);
    assert.equal(html.state.completionActive, undefined);
});

/**
 * Opens the popup and lists the names it offers.
 *
 * @param {object} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor
 * @returns {{editor: object, labels: string[]}} the editor and the names on offer
 */
function offered(context, content) {
    const editor = addEditor(context, content);
    runExtension(context.window);
    pressCtrlSpace(editor);
    return { editor, labels: hints(editor).map((hint) => hint.displayText) };
}

test('browser scripts get plain JavaScript: their own names, keywords and globals', () => {
    const own = offered(
        page(),
        '<script runat="server">var counterServer = 1;</script>\n' +
            '<script>\nvar counterTotal = 1; // counterComment "counterString"\n' +
            'function countUp(step) { item.counterMember = step; }\ncou|\n</script>',
    );
    assert.deepEqual(own.labels, ['counterTotal', 'countUp']);

    const words = offered(page(), '<script>\nco|\n</script>');
    assert.deepEqual(words.labels, ['console', 'continue', 'const']);

    const module = offered(page(), '<script type="module">\nconst total = 1;\nto|\n</script>');
    assert.deepEqual(module.labels, ['total']);

    const member = offered(page(), '<script>\nvar total = 1;\ndocument.to|\n</script>');
    assert.deepEqual(member.labels, [], 'nothing is known about members');

    const template = offered(
        page(),
        '<script type="text/x-template">\nvar total = 1;\nto|\n</script>',
    );
    assert.deepEqual(template.labels, [], 'not JavaScript');
});

test('SSJS also gets the names of its own scripts, after those of Marketing Cloud', () => {
    const { labels } = offered(
        page(),
        '<script>var rowsBrowser = 1; let letter;</script>\n' +
            '<script runat="server">\nvar rowsFound = 1;\nr|\n</script>',
    );
    assert.ok(labels.includes('rowsFound'), labels.join(' | '));
    assert.ok(labels.includes('return'));
    assert.ok(!labels.includes('rowsBrowser'), 'names of browser scripts stay there');
    assert.ok(labels.indexOf('Request.GetQueryStringParameter') < labels.indexOf('rowsFound'));
    const none = offered(page(), '<script runat="server">\nle|\n</script>');
    assert.ok(!none.labels.includes('let'), 'no keywords that SSJS rejects');
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

const HOVER = '.sfmc-hover';
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 450));

/**
 * Rests the mouse on a character of an editor. jsdom has no layout, so the editor is told
 * which character that is.
 *
 * @param {object} context page from `page()`
 * @param {object} editor CodeMirror instance
 * @param {string} before text that ends right before the character
 * @param {object} [extra] more of what CodeMirror reports for the place, like `outside`
 */
function rest(context, editor, before, extra = {}) {
    const place = editor.posFromIndex(editor.getValue().indexOf(before) + before.length);
    // the gap after the character and "left of it" is what CodeMirror reports for its right half
    editor.coordsChar = () => ({ line: place.line, ch: place.ch + 1, xRel: -1, ...extra });
    editor.charCoords = () => ({ left: 10, right: 20, top: 100, bottom: 115 });
    editor
        .getWrapperElement()
        .dispatchEvent(new context.window.MouseEvent('mousemove', { bubbles: true }));
}

test('resting the mouse on an AMPscript function shows its documentation', async () => {
    const context = page();
    const editor = addEditor(context, '<p>%%[ set @a = Lookup("a", "b", "c", 1) ]%%</p>');
    runExtension(context.window);
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    assert.equal(document.querySelector(HOVER), null, 'waits until the mouse rests');
    await hoverPause();
    const box = document.querySelector(HOVER);
    assert.equal(box.parentNode, document.body);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(dataObject: string/);
    assert.match(box.textContent, /Returns a single field value/);
    assert.ok([...box.querySelectorAll('code')].some((code) => code.textContent === 'dataObject'));
    const link = box.querySelector('a');
    assert.match(link.href, /^https:\/\//);
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    assert.equal(box.querySelector('script'), null);
    assert.doesNotMatch(box.textContent, /\*\*|```/, 'no Markdown marks are left');
    // the code has the editor's colours: the signature as JavaScript, the example as AMPscript
    const [signature, example] = box.querySelectorAll('pre');
    assert.ok(signature.querySelector('span[class^="cm-"]'), signature.textContent);
    assert.match(example.textContent, /^%%=Lookup\(/);
    assert.equal(example.querySelector('.cm-sfmc-function').textContent, 'Lookup');
    assert.equal(example.querySelector('.cm-sfmc-delimiter').textContent, '%%=');

    rest(context, editor, '<');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'gone where there is nothing to say');
    rest(context, editor, 'set @a = Look', { outside: 1 });
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'nothing beside the text');
});

test('hover: SSJS in server-side scripts, nothing in browser scripts, gone on typing', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '<script runat="server">\nvar a = Platform.Function.Lookup("a", "b", "c", 1);\n</script>\n' +
            '<script>\nvar b = Platform.Function.Lookup("a");\n</script>',
    );
    runExtension(context.window);
    const { document } = context.window;
    rest(context, editor, 'var a = Platform.Function.Look');
    await hoverPause();
    assert.match(
        document.querySelector(HOVER + ' pre').textContent,
        /^\(function\) Platform\.Function\.Lookup\(deName: string/,
    );
    editor.replaceRange(' ', { line: 0, ch: 0 });
    assert.equal(document.querySelector(HOVER), null);
    rest(context, editor, 'var b = Platform.Function.Look');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
});

test('boxes go away with their editor', async () => {
    const context = page();
    const { editor, box } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    assert.ok(box());
    assert.ok(document.querySelector(HOVER));
    editor.getWrapperElement().remove();
    await pause();
    assert.equal(box(), null);
    assert.equal(document.querySelector(HOVER), null);
});

test('hover: the box stays while the mouse is on it and goes when it leaves', async () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = Lookup("a", "b", "c", 1) ]%%');
    runExtension(context.window);
    const { document, MouseEvent } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    editor.getWrapperElement().dispatchEvent(new MouseEvent('mouseleave'));
    box.dispatchEvent(new MouseEvent('mouseenter'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), box);
    box.dispatchEvent(new MouseEvent('mouseleave'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
});

const SIGNATURE = '.sfmc-signature';

/**
 * Adds a focused editor and lets the extension react to its cursor. jsdom has no layout and no
 * real focus, so the editor is told both.
 *
 * @param {object} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor
 * @returns {Promise.<{editor: object, box: () => Element | null, moveTo: (before: string) => Promise.<void>}>} the editor, the box of the parameter help and a way to move the cursor behind some text
 */
async function withCursor(context, content) {
    const editor = addEditor(context, content);
    editor.hasFocus = () => true;
    editor.cursorCoords = () => ({ left: 10, right: 10, top: 100, bottom: 115 });
    runExtension(context.window);
    const moveTo = async (before) => {
        editor.setCursor(editor.posFromIndex(editor.getValue().indexOf(before) + before.length));
        await pause();
    };
    // the cursor is "moved" to where it is, which tells the listeners about it
    context.CodeMirror.signal(editor, 'cursorActivity', editor);
    await pause();
    return { editor, box: () => context.window.document.querySelector(SIGNATURE), moveTo };
}

test('parameter help shows the AMPscript function and marks the parameter being typed', async () => {
    const context = page();
    const { box, moveTo } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    assert.equal(box().parentNode, context.window.document.body);
    assert.match(
        box().querySelector('pre').textContent,
        /^Lookup\(dataObject: string, returnColumn/,
    );
    assert.equal(box().querySelector('strong').textContent, 'returnColumn: string');
    assert.match(box().querySelector('p').textContent, /column to return/);
    await moveTo('Lookup("');
    assert.equal(box().querySelector('strong').textContent, 'dataObject: string');
    await moveTo('"field")');
    assert.equal(box(), null, 'gone outside the call');
    await moveTo('%%[ set');
    assert.equal(box(), null);
});

test('parameter help: SSJS by its full name only, nothing in browser scripts or unfocused', async () => {
    const context = page();
    const ssjs = await withCursor(
        context,
        '<p>(</p><script runat="server">\nvar a = Platform.Function.Lookup("de", |"f");\n' +
            'var b = other.Lookup("de", "f");\nfunction add(first, second) {}\nadd(1, 2);\n</script>',
    );
    assert.match(ssjs.box().querySelector('pre').textContent, /^Platform\.Function\.Lookup\(/);
    assert.equal(ssjs.box().querySelector('strong').textContent, 'returnField');
    await ssjs.moveTo('other.Lookup("de", ');
    assert.equal(ssjs.box(), null, 'a method of something else is not the Platform function');
    await ssjs.moveTo('add(1, ');
    assert.equal(ssjs.box().querySelector('strong').textContent, 'second');
    context.CodeMirror.signal(ssjs.editor, 'blur', ssjs.editor);
    assert.equal(ssjs.box(), null, 'gone when the editor loses the focus');

    const other = page();
    const browser = await withCursor(other, '<script>\nvar a = Lookup("de", |"f");\n</script>');
    assert.equal(browser.box(), null);
    const idle = addEditor(other, '%%[ set @a = Lookup("de", |"field") ]%%');
    await pause();
    other.CodeMirror.signal(idle, 'cursorActivity', idle);
    await pause();
    assert.equal(browser.box(), null, 'an editor without the focus shows nothing');
});

test('parameter help closes on Escape and lets the key go on', async () => {
    const context = page();
    const { editor, box } = await withCursor(context, '%%[ set @a = Lookup("de", |"field") ]%%');
    assert.ok(box());
    const keyMap = editor.state.keyMaps.find((map) => 'Esc' in map);
    assert.equal(keyMap.Esc(editor), context.CodeMirror.Pass);
    assert.equal(box(), null);
});

const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} kind of underline and underlined text, in document order
 */
function underlined(editor) {
    // copied, because an array of the page is never deep-equal to one of the test
    return [...editor.getAllMarks()]
        .filter((mark) => mark.className?.includes('sfmc-diagnostic'))
        .map((mark) => {
            const { from, to } = mark.find();
            return `${mark.className.split('sfmc-diagnostic-', 2)[1]}: ${editor.getRange(from, to)}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

test('underlines errors and warnings in AMPscript and SSJS, and not in browser scripts', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '%%[ if @a == 1 then ]%%<p>%%=Lookupx("a")=%%</p>\n' +
            '<script runat="server">\nlet x = 1;\n</script>\n' +
            '<script>\nlet y = Lookupx("a");\n</script>',
    );
    const clean = addEditor(context, '<p>%%=Lowercase("A")=%%</p>');
    runExtension(context.window);
    assert.deepEqual(underlined(editor), [], 'checked after a pause');
    await checkPause();
    const line = '%%[ if @a == 1 then ]%%<p>%%=Lookupx("a")=%%</p>';
    assert.deepEqual(underlined(editor), ['error: let ', 'error: Lookupx', `warning: ${line}`]);
    assert.deepEqual(underlined(clean), []);

    editor.replaceRange('Lookup("a", "b", "c", 1)', { line: 0, ch: 29 }, { line: 0, ch: 41 });
    await checkPause();
    assert.deepEqual(underlined(editor), [
        'error: let ',
        'warning: %%[ if @a == 1 then ]%%<p>%%=Lookup("a", "b", "c", 1)=%%</p>',
    ]);
    editor.setOption('mode', 'htmlmixed');
    await checkPause();
    assert.deepEqual(underlined(editor), [], 'none once the editor is used for something else');
});

test('resting the mouse on an underline says what is wrong, before the documentation', async () => {
    const context = page();
    const editor = addEditor(
        context,
        '%%[ set @a = Lookup("a") ]%%\n<script runat="server">let x;</script>',
    );
    runExtension(context.window);
    await checkPause();
    const { document } = context.window;
    rest(context, editor, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    const problem = box.querySelector('.sfmc-problem');
    assert.equal(box.firstChild, problem);
    assert.ok(problem.classList.contains('sfmc-problem-error'));
    assert.match(problem.textContent, /Lookup/);
    assert.match(problem.querySelector('a.sfmc-problem-rule').href, /^https:\/\//);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(/);

    rest(context, editor, '<script runat="server">l');
    await hoverPause();
    const other = document.querySelector(HOVER);
    assert.match(other.querySelector('.sfmc-problem').textContent, /not supported in SFMC SSJS/);
    assert.equal(other.querySelector('pre'), null, 'a problem alone is shown too');
});

const NOTICE = '.sfmc-notice';
const formatPause = () => new Promise((resolve) => setTimeout(resolve, 1000));

/**
 * Presses Shift-Alt-F the way CodeMirror would: through the key map the extension registered.
 *
 * @param {object} editor CodeMirror instance
 * @returns {unknown} what the key binding returned
 */
function pressFormat(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Shift-Alt-F' in map);
    assert.ok(keyMap, 'Shift-Alt-F is bound');
    return keyMap['Shift-Alt-F'](editor);
}

test('Shift-Alt-F formats AMPscript, SSJS, HTML and CSS in one step that can be undone', async () => {
    const context = page();
    const messy =
        '<p>%%=Lookup("a","b","c",@d)=%%</p>\n%%[ set @a=1 if @a==1 then set @b = 2 endif ]%%\n' +
        '<style>a{color:red}</style>\n<script runat="server">\nvar a=Platform.Function.Lookup("a","b","c",1);if(a){Write(a)}\n</script>';
    const editor = addEditor(context, messy);
    editor.setCursor({ line: 0, ch: 2 });
    runExtension(context.window);
    assert.equal(pressFormat(editor), undefined);
    assert.equal(editor.getValue(), messy, 'formatting takes a moment');
    await formatPause();
    assert.equal(
        editor.getValue(),
        [
            "<p>%%= Lookup('a', 'b', 'c', @d) =%%</p>",
            '%%[',
            '    set @a = 1',
            '    if @a == 1 then',
            '        set @b = 2',
            '    endif',
            ']%%',
            '<style>',
            '    a {',
            '        color: red;',
            '    }',
            '</style>',
            '<script runat="server">',
            "    var a = Platform.Function.Lookup('a', 'b', 'c', 1);",
            '    if (a) {',
            '        Write(a);',
            '    }',
            '</script>',
        ].join('\n'),
    );
    assert.deepEqual({ ...editor.getCursor() }.line, 0);
    assert.equal(editor.getCursor().ch, 2, 'the cursor stays in front of what changed');
    editor.undo();
    assert.equal(editor.getValue(), messy);
    assert.equal(context.window.document.querySelector(NOTICE), null);
});

test('formatting leaves read-only editors, later edits and broken content alone', async () => {
    const context = page();
    const locked = addEditor(context, '%%[ set @a=1 ]%%');
    locked.setOption('readOnly', true);
    const edited = addEditor(context, '%%[ set @a=1 ]%%');
    // Prettier and the plugin put up with any content; an editor that hands out something else
    // than text stands in for a failure
    const broken = addEditor(context, '%%[ set @a=1 ]%%');
    const getValue = broken.getValue.bind(broken);
    broken.getValue = () => 5;
    runExtension(context.window);
    assert.equal(pressFormat(locked), context.CodeMirror.Pass);
    pressFormat(edited);
    edited.replaceRange('<p>x</p>', { line: 0, ch: 0 });
    pressFormat(broken);
    await formatPause();
    assert.equal(locked.getValue(), '%%[ set @a=1 ]%%');
    assert.equal(edited.getValue(), '<p>x</p>%%[ set @a=1 ]%%', 'what was typed meanwhile stays');
    assert.equal(getValue(), '%%[ set @a=1 ]%%');
    const notice = context.window.document.querySelector(NOTICE);
    assert.match(notice.textContent, /^Not formatted: /);
});

const FORMAT_BUTTON = '.sfmc-format-button';
const ON_SAVE = 'data-sfmc-ux-tools-format-on-save';

/**
 * Adds an editor inside the frame Marketing Cloud gives its code editor: a toolbar above it,
 * and a Save button elsewhere on the page.
 *
 * @param {object} context page from `page()`
 * @returns {{editor: object, toolbar: Element, saveButton: Element, saves: string[]}} the editor, its toolbar, the page's Save button and the content at each save the page got to see
 */
function inFrame(context) {
    const { document } = context.window;
    const frame = document.createElement('div');
    frame.className = 'et-codemirror';
    frame.innerHTML =
        '<div class="et-codemirror-toolbar"><ul><li class="toolbar-button"></li></ul></div>' +
        '<div class="et-codemirror-bin"></div>';
    document.body.append(frame);
    const editor = new context.CodeMirror(frame.querySelector('.et-codemirror-bin'), {
        value: '%%[ set @a=1 ]%%',
        mode: BASE_MODE,
    });
    const saveButton = document.createElement('span');
    saveButton.dataset.action = 'editor-save';
    // jsdom has no layout; what is "on show" is what has boxes
    saveButton.getClientRects = () => [{}];
    editor.getWrapperElement().getClientRects = () => [{}];
    document.body.append(saveButton);
    const saves = [];
    saveButton.addEventListener('click', () => {
        saves.push(editor.getValue());
    });
    return { editor, toolbar: frame.querySelector('ul'), saveButton, saves };
}

test('the format button sits in the editor toolbar, names its shortcut and formats', async () => {
    const context = page();
    const { editor, toolbar } = inFrame(context);
    const plain = addEditor(context, '%%[ set @a=1 ]%%');
    runExtension(context.window);
    const button = toolbar.querySelector(`li.toolbar-button > ${FORMAT_BUTTON}`);
    assert.equal(toolbar.querySelectorAll(FORMAT_BUTTON).length, 1);
    assert.equal(button.title, 'Format code (Shift+Alt+F)');
    assert.equal(button.getAttribute('aria-label'), button.title);
    assert.equal(button.type, 'button');
    button.click();
    await formatPause();
    assert.equal(editor.getValue(), '%%[\n    set @a = 1\n]%%');
    // without a toolbar the button floats in the corner of the editor
    const floating = plain.getWrapperElement().querySelector(FORMAT_BUTTON);
    assert.ok(floating.classList.contains('sfmc-format-floating'));
    floating.click();
    await formatPause();
    assert.equal(plain.getValue(), '%%[\n    set @a = 1\n]%%');
    const css = read('../dist/extension/editor-highlight.css');
    assert.ok(css.includes('.sfmc-format-button {'));
    // the button hands the focus back to the editor, whose blinking cursor would keep the test run alive
    context.window.close();
});

test('Ctrl-S and Cmd-S save through the Save button of the page, unformatted by default', async () => {
    const context = page();
    const { editor, saves } = inFrame(context);
    runExtension(context.window);
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-S' in map);
    assert.equal(keyMap['Ctrl-S'](editor), undefined);
    assert.equal(keyMap['Cmd-S'](editor), undefined);
    assert.deepEqual(saves, ['%%[ set @a=1 ]%%', '%%[ set @a=1 ]%%']);
    await formatPause();
    assert.equal(editor.getValue(), '%%[ set @a=1 ]%%');

    const other = page();
    const lonely = addEditor(other, '%%[ set @a=1 ]%%');
    runExtension(other.window);
    const lonelyKeys = lonely.state.keyMaps.find((map) => 'Ctrl-S' in map);
    assert.equal(
        lonelyKeys['Ctrl-S'](lonely),
        other.CodeMirror.Pass,
        'no Save button: the key goes on',
    );
});

test('format on save: the save waits for the formatting, and happens exactly once', async () => {
    const context = page();
    const { editor, saveButton, saves } = inFrame(context);
    const { document } = context.window;
    const exit = document.createElement('a');
    exit.dataset.action = 'editor-save-exit';
    document.body.append(exit);
    const exits = [];
    exit.addEventListener('click', () => {
        exits.push(editor.getValue());
    });
    runExtension(context.window);
    document.documentElement.setAttribute(ON_SAVE, 'on');

    saveButton.click();
    assert.deepEqual(saves, [], 'held back until the code is formatted');
    await formatPause();
    assert.deepEqual(saves, ['%%[\n    set @a = 1\n]%%']);

    editor.setValue('%%[ set @b=2 ]%%');
    editor.state.keyMaps.find((map) => 'Ctrl-S' in map)['Ctrl-S'](editor);
    await formatPause();
    assert.deepEqual(saves.slice(1), ['%%[\n    set @b = 2\n]%%']);

    editor.setValue('%%[ set @c=3 ]%%');
    exit.click();
    await formatPause();
    assert.deepEqual(exits, ['%%[\n    set @c = 3\n]%%']);

    // more clicks while a save is held back do not become more saves
    editor.setValue('%%[ set @e=5 ]%%');
    saveButton.click();
    saveButton.click();
    exit.click();
    await formatPause();
    assert.deepEqual(saves.slice(2), ['%%[\n    set @e = 5\n]%%']);
    assert.equal(exits.length, 1);
    saves.pop();

    // a button the page has redrawn meanwhile is found again
    editor.setValue('%%[ set @f=6 ]%%');
    saveButton.click();
    const redrawn = saveButton.cloneNode(true);
    redrawn.getClientRects = () => [{}];
    let redrawnSaves = 0;
    redrawn.addEventListener('click', () => {
        redrawnSaves++;
    });
    saveButton.replaceWith(redrawn);
    await formatPause();
    assert.equal(redrawnSaves, 1);
    redrawn.replaceWith(saveButton);

    // editors of hidden views are neither formatted nor a reason to wait
    const hidden = addEditor(context, '%%[ set @h=1 ]%%');
    await pause();
    editor.setValue('%%[ set @g=7 ]%%');
    saveButton.click();
    await formatPause();
    assert.equal(hidden.getValue(), '%%[ set @h=1 ]%%');
    assert.equal(saves.pop(), '%%[\n    set @g = 7\n]%%');

    // switched off again, and editors that cannot be formatted, never hold a save back
    document.documentElement.setAttribute(ON_SAVE, 'off');
    editor.setValue('%%[ set @d=4 ]%%');
    saveButton.click();
    assert.equal(saves.at(-1), '%%[ set @d=4 ]%%');
    document.documentElement.setAttribute(ON_SAVE, 'on');
    editor.setOption('readOnly', true);
    saveButton.click();
    assert.equal(saves.length, 4);
    assert.equal(saves.at(-1), '%%[ set @d=4 ]%%');
});

test('the format-on-save setting reaches the page, off by default', async () => {
    const script = read('../src/editor-format-setting.js');
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
        window.eval(script);
        return {
            value: () => window.document.documentElement.getAttribute(ON_SAVE),
            change: (newValue) => {
                for (const listener of listeners) {
                    listener({ editorFormatOnSave: { newValue } }, 'sync');
                }
            },
        };
    };
    const fresh = run({});
    const saved = run({ editorFormatOnSave: 'on' });
    assert.equal(fresh.value(), 'off');
    await pause();
    assert.equal(fresh.value(), 'off');
    assert.equal(saved.value(), 'on');
    saved.change('off');
    assert.equal(saved.value(), 'off');
    saved.change('anything');
    assert.equal(saved.value(), 'off');

    const options = new JSDOM(read('../src/options.html')).window.document;
    assert.deepEqual(
        [...options.querySelectorAll('input[name="editorFormatOnSave"]')].map(
            (input) => input.value,
        ),
        ['off', 'on'],
    );
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) =>
        item.js.includes('editor-format-setting.js'),
    );
    assert.equal(entry.world, undefined);
    assert.equal(entry.run_at, 'document_start');
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
    assert.ok(files.includes('editor-language.js'));
    assert.ok(files.includes('editor-format.js'));
    for (const file of files) {
        assert.ok(
            existsSync(new URL(`../dist/extension/${file}`, import.meta.url)),
            `${file} is missing`,
        );
    }
    assert.equal(highlightScript, read('../src/editor-highlight.js'));
    assert.ok(
        !existsSync(new URL('../dist/extension/editor-language', import.meta.url)),
        'the sources of the bundle are not copied',
    );
});

test('the language bundle is one classic script without eval or new Function', () => {
    assert.deepEqual(findDynamicCode(completionsScript), []);
    assert.doesNotMatch(completionsScript, /^\s*(?:import|export)\s/m);
    assert.match(completionsScript, /includes sfmc-language-lsp \d+\.\d+\.\d+/);
    assert.deepEqual(findDynamicCode(formatScript), []);
    assert.doesNotMatch(formatScript, /^\s*(?:import|export)\s/m);
    assert.match(formatScript, /includes prettier-plugin-sfmc \d+\.\d+\.\d+/);
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
