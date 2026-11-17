import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { styleOf } from '../src/editor-language/ace/colour.js';

// these tests run the built extension against the Ace that Automation Studio ships;
// "npm test" builds the extension first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const aceSource = readFileSync(require.resolve('ace-builds/src-noconflict/ace.js'), 'utf8');
const javascriptModeSource = readFileSync(
    require.resolve('ace-builds/src-noconflict/mode-javascript.js'),
    'utf8',
);
const extensionScripts = ['language-data.js', 'editor-highlight.js', 'editor-language.js'].map(
    (file) => read(`../dist/extension/${file}`),
);
const APP = 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/';
const SCRIPT_ROUTE = '#ActivityModal/423/new';
const OTHER_ROUTE = '#ActivityModal/300/new';
const HOVER = '.sfmc-hover';
const SIGNATURE = '.sfmc-signature';
const BOX = '.sfmc-tooltip';
const FIX = '.sfmc-fix';
const UNDERLINE = 'sfmc-diagnostic';
const LINE_HEIGHT = 20;
const CHARACTER_WIDTH = 10;
const PERIOD = 190;
const ESCAPE = 27;
const CTRL = 1;
// longer than the extension waits after a move of the cursor, and before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
// longer than the mouse has to rest, and than a box stays once the mouse left
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 500));
// longer than typing has to pause before the content is checked
const checkPause = () => new Promise((resolve) => setTimeout(resolve, 650));

/**
 * Creates a page of Automation Studio with Ace, an editor like the script activity's, and the
 * extension.
 *
 * @param {object} t test context, which closes the page
 * @param {string} content the editor's content; a "|" marks the cursor
 * @param {{route?: string, eol?: string, isReadOnly?: boolean}} [options] the page's hash, the line endings of the content and whether the editor is the read-only one
 * @returns {{window: object, document: object, editor: object, reports: unknown[][]}} the page, its editor and what the extension wrote to the console
 */
function setup(t, content, { route = SCRIPT_ROUTE, eol = '\n', isReadOnly = false } = {}) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: APP + route,
    });
    // a focused editor keeps a timer for its cursor, which would keep the test run alive
    t.after(() => window.close());
    window.eval(aceSource);
    window.eval(javascriptModeSource);
    const reports = [];
    window.console.debug = (...parameters) => {
        reports.push(parameters);
    };
    const element = window.document.createElement('div');
    window.document.body.append(element);
    // jsdom has no workers; the page's own worker is not what is tested here
    const editor = window.ace.edit(element, { mode: 'ace/mode/javascript', useWorker: false });
    const cursor = content.includes('|') ? content.indexOf('|') : 0;
    const before = content.slice(0, cursor).split('\n');
    editor.setValue(content.replace('|', '').split('\n').join(eol), -1);
    editor.moveCursorTo(before.length - 1, before.at(-1).length);
    editor.setReadOnly(isReadOnly);
    // jsdom lays nothing out: every character is as wide and every line as high as the next
    const { renderer } = editor;
    renderer.lineHeight = LINE_HEIGHT;
    renderer.textToScreenCoordinates = (row, column) => ({
        pageX: column * CHARACTER_WIDTH,
        pageY: row * LINE_HEIGHT,
    });
    // like Ace: the nearest gap between two characters of the nearest line
    renderer.screenToTextCoordinates = (x, y) => {
        const last = editor.session.getLength() - 1;
        const row = Math.max(0, Math.min(last, Math.floor(y / LINE_HEIGHT)));
        const column = Math.round(x / CHARACTER_WIDTH);
        return { row, column: Math.max(0, Math.min(editor.session.getLine(row).length, column)) };
    };
    for (const script of extensionScripts) {
        window.eval(script);
    }
    return { window, document: window.document, editor, reports };
}

/**
 * Finds the place behind some text of the editor.
 *
 * @param {object} editor Ace editor
 * @param {string} before text that ends right before the place
 * @returns {{row: number, column: number}} the place
 */
function placeAfter(editor, before) {
    const text = editor.session.getDocument().getAllLines().join('\n');
    assert.ok(text.includes(before), before);
    const lines = text.slice(0, text.indexOf(before) + before.length).split('\n');
    return { row: lines.length - 1, column: lines.at(-1).length };
}

/**
 * The middle of a character, as a place in the window.
 *
 * @param {{row: number, column: number}} place the character
 * @returns {{clientX: number, clientY: number}} where the mouse is when it is on that character
 */
function middleOf({ row, column }) {
    return {
        clientX: (column + 0.5) * CHARACTER_WIDTH,
        clientY: (row + 0.5) * LINE_HEIGHT,
    };
}

/**
 * Moves the mouse onto a character of the editor.
 *
 * @param {{window: object, editor: object}} page page from `setup`
 * @param {string | {row: number, column: number}} target text that ends right before the character, or the character's place
 */
function rest({ window, editor }, target) {
    const place = typeof target === 'string' ? placeAfter(editor, target) : target;
    editor.container.dispatchEvent(
        new window.MouseEvent('mousemove', { bubbles: true, ...middleOf(place) }),
    );
}

/**
 * Presses the mouse button on a character of the editor.
 *
 * @param {{window: object, editor: object}} page page from `setup`
 * @param {string} before text that ends right before the character
 * @param {object} keys modifier keys that are held
 * @returns {boolean} false if the click was taken away from the editor
 */
function wasLeftToEditor({ window, editor }, before, keys) {
    const point = middleOf(placeAfter(editor, before));
    const event = new window.MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...point,
        ...keys,
    });
    return editor.container.dispatchEvent(event);
}

/**
 * Presses the key for quick fixes, Ctrl-., in the editor, the way Ace is told about a key.
 *
 * @param {object} editor Ace editor
 * @returns {boolean} true if something in the editor took the key
 */
function didPressFixKey(editor) {
    const { KeyboardEvent } = editor.container.ownerDocument.defaultView;
    const event = new KeyboardEvent('keydown', { cancelable: true });
    return editor.keyBinding.onCommandKey(event, CTRL, PERIOD);
}

/**
 * Presses Escape in the editor's text field, the way the browser tells the page about it.
 *
 * @param {{window: object, editor: object}} page page from `setup`
 * @returns {boolean} false if the key was taken away from the editor
 */
function wasEscapeLeftToEditor({ window, editor }) {
    return editor.textInput.getElement().dispatchEvent(
        new window.KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: ESCAPE,
            bubbles: true,
            cancelable: true,
        }),
    );
}

/**
 * The underlines of an editor.
 *
 * @param {object} editor Ace editor
 * @returns {object[]} Ace markers, in the order they were added
 */
function markers(editor) {
    return Object.values(editor.session.getMarkers(false)).filter((marker) =>
        marker.clazz.includes(UNDERLINE),
    );
}

/**
 * Lists what is underlined in an editor.
 *
 * @param {object} editor Ace editor
 * @returns {string[]} kind of underline, where it starts and the underlined text
 */
function underlined(editor) {
    return markers(editor)
        .map(({ clazz, type, range }) => {
            assert.equal(type, 'text');
            assert.ok(clazz.startsWith(`${UNDERLINE} `), clazz);
            const kind = clazz.split(`${UNDERLINE}-`, 2)[1];
            const text = editor.session.getTextRange(range);
            return `${kind} ${range.start.row}:${range.start.column} ${text}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Lists the notes in the gutter of an editor.
 *
 * @param {object} editor Ace editor
 * @returns {string[]} kind and place of every note
 */
function notes(editor) {
    // a copy: lists of the page are not equal to lists of the test, whatever is in them
    return [...editor.session.getAnnotations()]
        .map(({ type, row, column, text }) => {
            assert.ok(text.length > 0);
            return `${type} ${row}:${column}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
}

/**
 * Lists the coloured names of a code block of a box.
 *
 * @param {Element} block the code block
 * @returns {Object.<string, string>} class of each coloured piece by its text; the last one wins
 */
function coloured(block) {
    return Object.fromEntries(
        [...block.querySelectorAll('span')].map((piece) => [piece.textContent, piece.className]),
    );
}

test('ace language: token types become the styles CodeMirror has for the same thing', () => {
    assert.equal(styleOf('support.function.ampscript'), 'sfmc-function');
    assert.equal(styleOf('meta.delimiter.ampscript'), 'sfmc-delimiter');
    assert.equal(styleOf('string.ampscript'), 'sfmc-string');
    assert.equal(styleOf('string'), 'string');
    assert.equal(styleOf('string.regexp'), 'string-2');
    assert.equal(styleOf('comment.doc'), 'comment');
    assert.equal(styleOf('storage.type'), 'keyword');
    assert.equal(styleOf('keyword.operator'), 'operator');
    assert.equal(styleOf('constant.language.boolean'), 'atom');
    assert.equal(styleOf('identifier'), 'variable');
    assert.equal(styleOf('meta.tag.punctuation'), 'tag bracket');
    for (const type of ['text', 'paren.lparen', 'punctuation.operator', 'stringent', '']) {
        assert.equal(styleOf(type), '', type);
    }
});

test('ace language: resting the mouse on an AMPscript function shows its documentation', async (t) => {
    const page = setup(t, '<p>%%[ set @a = Lookup("a", "b", "c", 1) ]%%</p>');
    const { document, editor, reports } = page;
    rest(page, 'set @a = Look');
    assert.equal(document.querySelector(HOVER), null, 'waits until the mouse rests');
    await hoverPause();
    const box = document.querySelector(HOVER);
    assert.equal(box.parentNode, document.body);
    // at the start of the name
    assert.equal(box.style.left, `${'<p>%%[ set @a = '.length * CHARACTER_WIDTH}px`);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(dataObject: string/);
    assert.match(box.textContent, /Returns a single field value/);
    const link = box.querySelector('a');
    assert.match(link.href, /^https:\/\//);
    assert.equal(link.target, '_blank');
    assert.doesNotMatch(box.textContent, /\*\*|```/, 'no Markdown marks are left');
    // the code has the classes of CodeMirror: the signature as JavaScript, the example as AMPscript
    const [signature, example] = box.querySelectorAll('pre');
    assert.ok(signature.querySelector('span[class^="cm-"]'), signature.textContent);
    assert.match(example.textContent, /^%%=Lookup\(/);
    assert.equal(example.querySelector('.cm-sfmc-function').textContent, 'Lookup');
    assert.equal(example.querySelector('.cm-sfmc-delimiter').textContent, '%%=');
    assert.ok(example.querySelector('.cm-sfmc-string'));

    rest(page, '<');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'gone where there is nothing to say');
    rest(page, 'set @a = Look');
    await hoverPause();
    assert.ok(document.querySelector(HOVER));
    // right of the end of the line, and below the last line
    rest(page, { row: 0, column: editor.session.getLine(0).length + 3 });
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'nothing beside the text');
    rest(page, { row: 3, column: 18 });
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'nothing below the text');
    assert.deepEqual(reports, []);
});

test('ace language: hover on SSJS has the colours of Content Builder, none in a browser script, and goes on typing', async (t) => {
    const page = setup(
        t,
        '<script runat="server">\nPlatform.Response.Write("x");\n</script>\n' +
            '<script>\nvar b = Platform.Function.Lookup("a");\n</script>',
    );
    const { window, document, editor } = page;
    rest(page, 'Platform.Response.Wri');
    await hoverPause();
    const [signature, example] = document.querySelectorAll(`${HOVER} pre`);
    assert.match(signature.textContent, /Platform\.Response\.Write\(content: string\): void$/);
    const declared = coloured(signature);
    assert.equal(declared.function, 'cm-keyword');
    // in a declaration the whole dotted name is the function's name, dots included
    assert.equal(declared.Platform, 'cm-sfmc-function');
    assert.equal(declared.Response, 'cm-sfmc-function');
    assert.equal(declared.Write, 'cm-sfmc-function');
    assert.equal(declared['.'], 'cm-sfmc-function');
    assert.match(declared.content, /^cm-(?:variable|def)/);
    assert.equal(declared.string, 'cm-type');
    assert.equal(declared.void, 'cm-type');
    // in the example only what is called is a function; the objects in front of it are not
    const called = coloured(example);
    assert.equal(called.Write, 'cm-sfmc-function');
    assert.equal(called.Stringify, 'cm-sfmc-function');
    assert.notEqual(called.Platform, 'cm-sfmc-function');
    assert.equal(called.var, 'cm-keyword');
    assert.match(called['"Jane"'], /cm-string/);

    const ways = {
        typing: () => editor.onTextInput(' '),
        'a key': () =>
            editor.textInput
                .getElement()
                .dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true })),
        scrolling: () => editor.session.setScrollTop(40),
        'a click': () =>
            editor.container.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })),
    };
    for (const [name, leave] of Object.entries(ways)) {
        rest(page, 'Platform.Response.Wri');
        await hoverPause();
        assert.ok(document.querySelector(HOVER), name);
        leave();
        assert.equal(document.querySelector(HOVER), null, name);
    }
    rest(page, 'var b = Platform.Function.Look');
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'a browser script');
});

test('ace language: the box stays while the mouse is on it and goes when it leaves', async (t) => {
    const page = setup(t, '%%[ set @a = Lookup("a", "b", "c", 1) ]%%');
    const { window, document, editor } = page;
    rest(page, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    editor.container.dispatchEvent(new window.MouseEvent('mouseleave'));
    box.dispatchEvent(new window.MouseEvent('mouseenter'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), box);
    box.dispatchEvent(new window.MouseEvent('mouseleave'));
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
});

test('ace language: resting the mouse on an underline says what is wrong, before the documentation, without another check', async (t) => {
    const page = setup(t, '%%[ set @a = Lookup("a") ]%%\n<script runat="server">let x;</script>');
    const { document, editor } = page;
    await checkPause();
    const before = markers(editor);
    assert.ok(before.length > 0);
    rest(page, 'set @a = Look');
    await hoverPause();
    const box = document.querySelector(HOVER);
    const problem = box.querySelector('.sfmc-problem');
    assert.equal(box.firstChild, problem);
    assert.ok(problem.classList.contains('sfmc-problem-error'));
    assert.match(problem.textContent, /Lookup/);
    assert.match(problem.querySelector('a.sfmc-problem-rule').href, /^https:\/\//);
    assert.match(box.querySelector('pre').textContent, /^\(function\) Lookup\(/);
    assert.deepEqual(markers(editor), before, 'unchanged content is not checked again');

    rest(page, '<script runat="server">l');
    await hoverPause();
    const other = document.querySelector(HOVER);
    assert.match(other.querySelector('.sfmc-problem').textContent, /not supported in SFMC SSJS/);
    assert.equal(other.querySelector('pre'), null, 'a problem alone is shown too');

    // changed content is checked before the box says what is wrong with it
    editor.session.insert({ row: 0, column: 3 }, ' ');
    rest(page, 'set @a = Look');
    await hoverPause();
    assert.ok(document.querySelector(`${HOVER} .sfmc-problem`));
    assert.notEqual(markers(editor)[0], before[0]);
    assert.equal(markers(editor).length, before.length);
});

test('ace language: parameter help marks the parameter being typed and goes outside a call and on Escape', async (t) => {
    const page = setup(t, '%%[ set @a = Lookup("de", "field") ]%%');
    const { document, editor, reports } = page;
    const box = () => document.querySelector(SIGNATURE);
    const moveTo = async (before) => {
        const { row, column } = placeAfter(editor, before);
        editor.moveCursorTo(row, column);
        await pause();
    };
    await moveTo('Lookup("de", ');
    assert.equal(box(), null, 'an editor without the focus shows nothing');
    editor.focus();
    await moveTo('Lookup("de", "');
    assert.equal(box().parentNode, document.body);
    assert.match(
        box().querySelector('pre').textContent,
        /^Lookup\(dataObject: string, returnColumn/,
    );
    assert.equal(box().querySelector('strong').textContent, 'returnColumn: string');
    assert.match(box().querySelector('p').textContent, /column to return/);
    // above the cursor, or below it where there is no room
    assert.equal(box().style.left, `${'%%[ set @a = Lookup("de", "'.length * CHARACTER_WIDTH}px`);
    await moveTo('Lookup("');
    assert.equal(box().querySelector('strong').textContent, 'dataObject: string');

    assert.equal(wasEscapeLeftToEditor(page), true, 'the key goes on');
    assert.equal(box(), null);
    await moveTo('Lookup("d');
    assert.ok(box(), 'back with the next move of the cursor');
    editor.selection.selectTo(0, 3);
    await pause();
    assert.equal(box(), null, 'none while something is selected');
    editor.clearSelection();
    await moveTo('Lookup("d');
    assert.ok(box());
    editor.session.setScrollTop(40);
    assert.equal(box(), null, 'gone on scrolling');
    await moveTo('Lookup("de');
    assert.ok(box());
    editor.blur();
    assert.equal(box(), null, 'gone when the editor loses the focus');
    editor.focus();
    await moveTo('"field")');
    assert.equal(box(), null, 'gone outside the call');
    await moveTo('%%[ set');
    assert.equal(box(), null);
    assert.deepEqual(reports, []);
});

test('ace language: parameter help for SSJS, and none in a browser script', async (t) => {
    const { document, editor } = setup(
        t,
        '<script runat="server">\nvar a = Platform.Function.Lookup("de", |"f");\n</script>\n' +
            '<script>\nvar b = Lookup("de", "f");\n</script>',
    );
    editor.focus();
    editor.moveCursorTo(1, 40);
    await pause();
    const box = document.querySelector(SIGNATURE);
    assert.match(box.querySelector('pre').textContent, /^Platform\.Function\.Lookup\(/);
    assert.equal(box.querySelector('strong').textContent, 'returnField');
    const { row, column } = placeAfter(editor, 'var b = Lookup("de", ');
    editor.moveCursorTo(row, column);
    await pause();
    assert.equal(document.querySelector(SIGNATURE), null);
});

test('ace language: errors and warnings are underlined and noted in the gutter, not in browser scripts, and follow the text', async (t) => {
    const line = '%%[ if @a == 1 then ]%%<p>%%=Lookupx("a")=%%</p>';
    const { editor, reports } = setup(
        t,
        `${line}\n<script runat="server">\nlet x = 1;\n</script>\n` +
            '<script>\nlet y = Lookupx("a");\n</script>',
    );
    assert.deepEqual(underlined(editor), [], 'checked after a pause');
    await checkPause();
    assert.deepEqual(underlined(editor), [
        'error 0:29 Lookupx',
        'error 2:0 let ',
        `warning 0:0 ${line}`,
    ]);
    assert.deepEqual(notes(editor), ['error 0:29', 'error 2:0', 'warning 0:0']);

    // a line above: the underlines move at once, the notes with the next check
    editor.session.insert({ row: 0, column: 0 }, '<p>first</p>\n');
    assert.deepEqual(underlined(editor), [
        'error 1:29 Lookupx',
        'error 3:0 let ',
        `warning 1:0 ${line}`,
    ]);
    // text in front of an underline moves it, text right behind it does not widen it
    editor.session.insert({ row: 3, column: 0 }, '  ');
    editor.session.insert({ row: 3, column: 6 }, 'y');
    assert.equal(underlined(editor)[1], 'error 3:2 let ');
    assert.equal(editor.session.getLine(3), '  let yx = 1;');
    await checkPause();
    assert.deepEqual(underlined(editor), [
        'error 1:29 Lookupx',
        'error 3:2 let ',
        `warning 1:0 ${line}`,
    ]);
    assert.deepEqual(notes(editor), ['error 1:29', 'error 3:2', 'warning 1:0']);

    // what is repaired loses its underline, and nothing is underlined twice
    editor.session.remove({ start: { row: 1, column: 35 }, end: { row: 1, column: 36 } });
    editor.session.insert({ row: 1, column: 39 }, ', "b", "c", 1');
    await checkPause();
    assert.deepEqual(underlined(editor), [
        'error 3:2 let ',
        'warning 1:0 %%[ if @a == 1 then ]%%<p>%%=Lookup("a", "b", "c", 1)=%%</p>',
    ]);
    assert.deepEqual(notes(editor), ['error 3:2', 'warning 1:0']);
    assert.deepEqual(reports, []);
});

test('ace language: a document with Windows line endings is checked, explained and fixed at the right places', async (t) => {
    const page = setup(
        t,
        'Hello\n<script runat="server">\n  var a = [1].map(String);\n</script>\n%%[ set @a = Lookupx("x") ]%%',
        { eol: '\r\n' },
    );
    const { document, editor } = page;
    assert.ok(editor.getValue().includes('\r\n'));
    await checkPause();
    assert.deepEqual(underlined(editor), ['error 2:14 map', 'error 4:13 Lookupx']);
    assert.deepEqual(notes(editor), ['error 2:14', 'error 4:13']);
    rest(page, 'set @a = Look');
    await hoverPause();
    assert.match(document.querySelector(`${HOVER} .sfmc-problem`).textContent, /Lookupx/);
    rest(page, 'var a = [1].m');
    await hoverPause();
    const box = document.querySelector(HOVER);
    assert.equal(box.style.top, `${2 * LINE_HEIGHT - 4}px`);
    box.querySelector(FIX).click();
    const fixed = editor.getValue();
    assert.match(fixed, /Array\.prototype\.map = Array\.prototype\.map \|\|/);
    // the fix adds its code right behind the script tag, as in Content Builder
    assert.ok(fixed.startsWith('Hello\r\n<script runat="server">/**\r\n'), fixed);
    assert.ok(
        fixed.endsWith('  var a = [1].map(String);\r\n</script>\r\n%%[ set @a = Lookupx("x") ]%%'),
        'the code itself is untouched',
    );
    assert.doesNotMatch(fixed, /[^\r]\n/, 'every line still ends the Windows way');
});

test('ace language: a fix button applies the fix in one step that can be undone, and a stale fix does nothing', async (t) => {
    const page = setup(
        t,
        '<p>%%=v(@a)=%%</p>\n<script runat="server">\nvar a = [1].map(function (b) { return b; });\n</script>',
    );
    const { document, editor, reports } = page;
    await checkPause();
    rest(page, 'var a = [1].m');
    await hoverPause();
    const buttons = [...document.querySelectorAll(`${HOVER} .sfmc-problem ${FIX}`)];
    assert.ok(buttons.length > 0, 'the polyfill is on offer');
    assert.match(buttons[0].textContent, /polyfill/i);
    const before = editor.getValue();
    buttons[0].click();
    const after = editor.getValue();
    assert.equal(document.querySelector(HOVER), null, 'the box closes');
    assert.match(after, /Array\.prototype\.map = Array\.prototype\.map \|\|/);
    assert.ok(
        after.startsWith('<p>%%=v(@a)=%%</p>\n<script runat="server">'),
        'added inside the script, not at the top of the HTML',
    );
    assert.ok(after.includes('var a = [1].map(function (b) { return b; });'));
    editor.undo();
    assert.equal(editor.getValue(), before);

    // a button that is still there when the content has changed must not change it
    rest(page, 'var a = [1].m');
    await hoverPause();
    const stale = document.querySelector(`${HOVER} ${FIX}`);
    editor.session.insert({ row: 0, column: 0 }, ' ');
    assert.equal(document.querySelector(HOVER), null);
    stale.click();
    assert.equal(editor.getValue(), ` ${before}`);
    // nor the content of another session
    rest(page, 'var a = [1].m');
    await hoverPause();
    const other = document.querySelector(`${HOVER} ${FIX}`);
    editor.setSession(page.window.ace.createEditSession('<p>another activity</p>'));
    assert.equal(document.querySelector(HOVER), null);
    other.click();
    assert.equal(editor.getValue(), '<p>another activity</p>');
    assert.deepEqual(reports, []);
});

test('ace language: Ctrl-. opens the fixes at the cursor, for the text as it is now', async (t) => {
    const page = setup(t, '<script runat="server">\nvar a = 1;\n</script>');
    const { document, editor } = page;
    await checkPause();
    editor.moveCursorTo(1, 3);
    assert.equal(didPressFixKey(editor), false, 'nothing to fix: the key goes on');
    assert.equal(document.querySelector(HOVER), null);

    // typed just now; the check that runs when typing pauses has not happened yet
    editor.session.insert({ row: 1, column: 0 }, 'var b = [1].map(String);\n');
    editor.moveCursorTo(1, 14);
    assert.equal(didPressFixKey(editor), true);
    const button = document.querySelector(`${HOVER} ${FIX}`);
    assert.ok(button);
    assert.equal(document.activeElement, button, 'ready for Enter');
    assert.equal(document.querySelector(`${HOVER} pre`), null, 'fixes only, no documentation');
    button.dispatchEvent(
        new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    assert.equal(document.querySelector(HOVER), null);
    // right behind the problem as well
    editor.moveCursorTo(1, 15);
    assert.equal(didPressFixKey(editor), true);
    document.querySelector(`${HOVER} ${FIX}`).click();
    assert.match(editor.getValue(), /Array\.prototype\.map = Array\.prototype\.map \|\|/);
});

test('ace language: the read-only editor explains problems but offers no fixes and no parameter help', async (t) => {
    const page = setup(
        t,
        '<script runat="server">\nvar b = [1].map(String);\nvar a = Platform.Function.Lookup("de", |"f");\n</script>',
        { isReadOnly: true },
    );
    const { document, editor, reports } = page;
    const content = editor.getValue();
    await checkPause();
    assert.deepEqual(underlined(editor), ['error 1:12 map']);
    assert.deepEqual(notes(editor), ['error 1:12']);
    rest(page, 'var b = [1].m');
    await hoverPause();
    assert.ok(document.querySelector(`${HOVER} .sfmc-problem`));
    assert.equal(document.querySelector(`${HOVER} ${FIX}`), null);
    rest(page, 'var a = Platform.Function.Look');
    await hoverPause();
    assert.match(document.querySelector(`${HOVER} pre`).textContent, /Platform\.Function\.Lookup/);

    editor.moveCursorTo(1, 14);
    assert.equal(didPressFixKey(editor), false);
    editor.execCommand('sfmcUxToolsQuickFix');
    assert.equal(document.querySelector(`${HOVER} ${FIX}`), null);
    editor.focus();
    editor.moveCursorTo(2, 40);
    await pause();
    assert.equal(document.querySelector(SIGNATURE), null);

    // a box that was opened while the editor could be edited fixes nothing once it cannot
    editor.setReadOnly(false);
    rest(page, 'var b = [1].m');
    await hoverPause();
    const button = document.querySelector(`${HOVER} ${FIX}`);
    assert.ok(button);
    editor.setReadOnly(true);
    button.click();
    assert.equal(editor.getValue(), content);
    assert.deepEqual(reports, []);
});

test('ace language: Ctrl-click on the name of a function of the content goes to its declaration', (t) => {
    const page = setup(
        t,
        '<p>greet</p>\n<script runat="server">\nfunction greet(name) { return name; }\n' +
            'var a = greet("x");\nvar b = other.greet("y");\nvar c = Stringify(a);\n</script>\n' +
            '<script>\nvar d = greet("z");\n</script>',
    );
    const { editor, reports } = page;
    const cursor = () => ({ ...editor.getCursorPosition() });
    const held = { ctrlKey: true };

    assert.equal(wasLeftToEditor(page, 'var a = gr', held), false, 'taken from the editor');
    assert.deepEqual(cursor(), { row: 2, column: 9 });
    assert.equal(editor.selection.isEmpty(), true);

    editor.moveCursorTo(0, 0);
    assert.equal(wasLeftToEditor(page, 'var a = gr', {}), true, "a plain click is the editor's");
    assert.equal(wasLeftToEditor(page, 'var a = gr', { ctrlKey: true, shiftKey: true }), true);
    assert.equal(wasLeftToEditor(page, 'var a = gr', { ctrlKey: true, button: 2 }), true);
    assert.equal(wasLeftToEditor(page, 'other.gr', held), true, 'a member of something else');
    assert.equal(wasLeftToEditor(page, 'var c = Stri', held), true, 'not declared in the content');
    assert.equal(wasLeftToEditor(page, 'var d = gr', held), true, 'a browser script');
    assert.equal(wasLeftToEditor(page, '<p>gr', held), true, 'plain text');
    assert.deepEqual(cursor(), { row: 0, column: 0 });
    assert.deepEqual(reports, []);
});

test('ace language: boxes and underlines go when the dialog shows another activity or the editor leaves the page', async (t) => {
    const content = '%%[ set @a = Lookupx("de", |"field") ]%%';
    const ways = {
        'another activity': ({ window }) => {
            window.location.hash = OTHER_ROUTE;
        },
        'off the page': ({ editor }) => editor.container.remove(),
    };
    for (const [name, leave] of Object.entries(ways)) {
        const page = setup(t, content.replace('Lookupx', 'Lookup'));
        const { document, editor } = page;
        editor.focus();
        // parameter help comes with a move of the cursor
        editor.moveCursorTo(0, 27);
        await checkPause();
        rest(page, 'set @a = Look');
        await hoverPause();
        assert.ok(document.querySelector(HOVER), name);
        assert.ok(document.querySelector(SIGNATURE), name);
        assert.equal(markers(editor).length, 1, name);
        assert.equal(notes(editor).length, 1, name);
        leave(page);
        await pause();
        assert.equal(document.querySelector(BOX), null, name);
        assert.deepEqual(markers(editor), [], name);
        assert.deepEqual(notes(editor), [], name);
        assert.deepEqual(page.reports, [], name);
    }

    // while the dialog shows something else the editor is left alone, and it is ours again after
    const page = setup(t, content);
    const { window, document, editor } = page;
    await checkPause();
    assert.deepEqual(underlined(editor), ['error 0:13 Lookupx']);
    window.location.hash = OTHER_ROUTE;
    await pause();
    editor.session.insert({ row: 0, column: 0 }, ' ');
    await checkPause();
    assert.deepEqual(underlined(editor), []);
    rest(page, 'set @a = Look');
    await hoverPause();
    assert.equal(document.querySelector(BOX), null);
    assert.equal(didPressFixKey(editor), false);
    assert.equal(wasLeftToEditor(page, 'set @a = Look', { ctrlKey: true }), true);
    window.location.hash = SCRIPT_ROUTE;
    await pause();
    await checkPause();
    assert.deepEqual(underlined(editor), ['error 0:14 Lookupx']);
});

test('ace language: an editor of another activity gets none of it', async (t) => {
    const page = setup(t, '%%[ set @a = Lookupx("de", |"field") ]%%', { route: OTHER_ROUTE });
    const { document, editor } = page;
    editor.focus();
    editor.moveCursorTo(0, 27);
    await checkPause();
    rest(page, 'set @a = Look');
    await hoverPause();
    assert.equal(document.querySelector(BOX), null);
    assert.deepEqual(markers(editor), []);
    assert.deepEqual(notes(editor), []);
    assert.equal(editor.commands.byName.sfmcUxToolsQuickFix, undefined);
});

test('ace language: a failing language service leaves the editor usable and is reported once', async (t) => {
    const page = setup(
        t,
        '<script runat="server">\nfunction greet(name) { return name; }\nvar a = greet([1].map(String), |2);\n</script>',
    );
    const { window, document, editor, reports } = page;
    // the language service splits the text into lines first, which neither Ace nor the page does
    // while the text stays as it is; a failure there stands in for any other
    const { split } = window.String.prototype;
    const repair = () => {
        window.String.prototype.split = split;
    };
    t.after(repair);
    window.String.prototype.split = () => {
        throw new Error('broken');
    };

    // the check after the editor was found
    await checkPause();
    assert.deepEqual(markers(editor), []);
    rest(page, 'var a = gr');
    await hoverPause();
    assert.equal(document.querySelector(BOX), null);
    assert.doesNotThrow(() => didPressFixKey(editor));
    assert.equal(wasLeftToEditor(page, 'var a = gr', { ctrlKey: true }), true);
    editor.focus();
    editor.moveCursorTo(2, 31);
    await pause();
    assert.equal(document.querySelector(BOX), null);
    repair();
    assert.equal(reports.length, 1);
    assert.match(String(reports[0][0]), /SFMC UX Tools/);

    // the editor is as usable as before, and the features work again once the language service does
    editor.onTextInput(' ');
    assert.equal(editor.session.getLine(2), 'var a = greet([1].map(String),  2);');
    await checkPause();
    assert.deepEqual(underlined(editor), ['error 2:18 map']);
    assert.ok(document.querySelector(SIGNATURE));
    rest(page, 'var a = gr');
    await hoverPause();
    assert.ok(document.querySelector(HOVER));
    assert.equal(wasLeftToEditor(page, 'var a = gr', { ctrlKey: true }), false);
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 1, column: 9 });
    assert.equal(reports.length, 1);
});

test('ace language: the underlines have styles of their own, in the colours of Content Builder', () => {
    const css = read('../dist/extension/editor-highlight.css');
    const rule = (selector) =>
        css
            .slice(css.indexOf(`${selector} {`))
            .split('}', 1)[0]
            .replaceAll(/\s+/g, ' ');
    const base = rule('.sfmc-ux-tools-ace .ace_marker-layer .sfmc-diagnostic');
    // Ace places a marker by its inline style, but leaves the positioning to the style sheet
    assert.match(base, /position: absolute;/);
    assert.match(base, /color: var\(--sfmc-error-underline\);/);
    assert.match(base, /background:.*currentColor.*repeat-x/);
    assert.doesNotMatch(base, /url\(/, 'nothing is loaded');
    assert.match(
        rule('.sfmc-ux-tools-ace .ace_marker-layer .sfmc-diagnostic-warning'),
        /color: var\(--sfmc-warning\);/,
    );
    assert.match(
        rule('.sfmc-ux-tools-ace .ace_marker-layer .sfmc-diagnostic-info'),
        /color: var\(--sfmc-info-underline\);/,
    );
});
