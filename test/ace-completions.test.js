import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { styleOf } from '../src/editor-language/ace/completions.js';

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
const COMMAND = 'sfmcUxToolsComplete';
const POPUP = '.CodeMirror-hints';
const LINE_HEIGHT = 20;
const CHARACTER_WIDTH = 10;
const KEY_CODES = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    Space: 32,
    End: 35,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowDown: 40,
};
const CTRL = 1;
// longer than the extension waits after typing, and before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

/**
 * Creates a page of Automation Studio with Ace, an editor like the script activity's, and the
 * extension.
 *
 * @param {object} t test context, which closes the page
 * @param {string} content the editor's content, with "|" where the cursor is
 * @param {{route?: string, eol?: string, isReadOnly?: boolean}} [options] the page's hash, the line endings of the content and whether the editor is the read-only one
 * @returns {{window: object, editor: object, reports: unknown[][]}} the page, its editor and what the extension wrote to the console
 */
function setup(t, content, { route = SCRIPT_ROUTE, eol = '\n', isReadOnly = false } = {}) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: APP + route,
    });
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
    const before = content.slice(0, content.indexOf('|')).split('\n');
    editor.setValue(content.replace('|', '').split('\n').join(eol), -1);
    editor.moveCursorTo(before.length - 1, before.at(-1).length);
    editor.setReadOnly(isReadOnly);
    // jsdom lays nothing out
    editor.renderer.lineHeight = LINE_HEIGHT;
    editor.renderer.textToScreenCoordinates = (row, column) => ({
        pageX: column * CHARACTER_WIDTH,
        pageY: row * LINE_HEIGHT,
    });
    for (const script of extensionScripts) {
        window.eval(script);
    }
    return { window, editor, reports };
}

/**
 * Presses a key in the editor, the way Ace is told about one.
 *
 * @param {object} editor Ace editor
 * @param {string} name name of the key
 * @param {number} [modifiers] Ace's number for the modifier keys that are held
 * @returns {boolean} true if something in the editor took the key
 */
function didPress(editor, name, modifiers = 0) {
    const { KeyboardEvent } = editor.container.ownerDocument.defaultView;
    const event = new KeyboardEvent('keydown', { cancelable: true });
    return editor.keyBinding.onCommandKey(event, modifiers, KEY_CODES[name]);
}

/**
 * The names the popup lists.
 *
 * @param {object} window page window
 * @returns {string[] | null} the names; null if there is no popup
 */
function labels(window) {
    const list = window.document.querySelector(POPUP);
    return list && Array.from(list.children, (entry) => entry.firstChild.textContent);
}

/**
 * The name of the entry that is active in the popup.
 *
 * @param {object} window page window
 * @returns {string | undefined} the name
 */
function activeLabel(window) {
    return window.document.querySelector(`${POPUP} .CodeMirror-hint-active`)?.firstChild
        .textContent;
}

test('ace completions: token types become the styles the core knows strings and comments by', () => {
    assert.equal(styleOf('string'), 'string');
    assert.equal(styleOf('string.regexp'), 'string');
    assert.equal(styleOf('comment.doc'), 'comment');
    assert.equal(styleOf('string.ampscript'), 'sfmc-string');
    assert.equal(styleOf('comment.ampscript'), 'sfmc-comment');
    assert.equal(styleOf('string.attribute-value'), 'string');
    assert.equal(styleOf('comment.markup'), 'comment');
    for (const type of ['identifier', 'support.function.ssjs', 'text.ampscript', '', undefined]) {
        assert.equal(styleOf(type), '', String(type));
    }
});

test('ace completions: Ctrl-Space in a server-side script lists the names that start like the typed chain, and a choice replaces the chain', (t) => {
    const { window, editor, reports } = setup(
        t,
        '<script runat="server">\n  var rows = Platform.Function.Loo|\n</script>',
    );
    assert.equal(labels(window), null);
    assert.equal(didPress(editor, 'Space', CTRL), true);
    const names = labels(window);
    assert.equal(names[0], 'Platform.Function.Lookup');
    const matching = names.filter((name) => name.startsWith('Platform.Function.Loo'));
    assert.ok(matching.length > 1, names.join(' '));
    // those come first
    assert.deepEqual(names.slice(0, matching.length), matching);
    assert.equal(window.document.querySelectorAll(POPUP).length, 1);
    const list = window.document.querySelector(POPUP);
    assert.equal(list.parentElement, window.document.body);
    assert.ok(list.querySelector('.sfmc-hint-detail').textContent.length > 0);
    // below the start of the typed chain
    assert.equal(list.style.left, `${'  var rows = '.length * CHARACTER_WIDTH}px`);
    assert.equal(list.style.top, `${2 * LINE_HEIGHT}px`);
    // nothing is inserted without a choice
    assert.equal(editor.session.getLine(1), '  var rows = Platform.Function.Loo');
    // asking again keeps the one popup
    didPress(editor, 'Space', CTRL);
    assert.equal(window.document.querySelectorAll(POPUP).length, 1);

    assert.equal(didPress(editor, 'Enter'), true);
    assert.equal(labels(window), null);
    assert.equal(editor.session.getLine(1), '  var rows = Platform.Function.Lookup(');
    assert.equal(editor.session.getLength(), 3);
    assert.deepEqual(
        { ...editor.getCursorPosition() },
        { row: 1, column: '  var rows = Platform.Function.Lookup('.length },
    );
    assert.equal(editor.selection.isEmpty(), true);
    // one step for undo
    editor.undo();
    assert.equal(editor.session.getLine(1), '  var rows = Platform.Function.Loo');
    // the keys are the editor's again
    assert.equal(didPress(editor, 'Enter'), false);
    assert.deepEqual(reports, []);
});

test('ace completions: AMPscript inside a block, and a click on an entry', (t) => {
    const { window, editor } = setup(t, 'Hello\n%%[ set @a = Loo| ]%%');
    didPress(editor, 'Space', CTRL);
    const names = labels(window);
    assert.ok(names.includes('Lookup'), names.join(' '));
    assert.ok(names.every((name) => name.toLowerCase().startsWith('loo')));
    const entry = window.document.querySelector(POPUP).children[names.indexOf('LookupRows')];
    const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    entry.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    entry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), 'Hello\n%%[ set @a = LookupRows( ]%%');
});

test('ace completions: a choice does nothing once the content is no longer the one the list was made for', (t) => {
    const { window, editor, reports } = setup(
        t,
        '<script runat="server">\n  var rows = Platform.Function.Loo|\n</script>',
    );
    didPress(editor, 'Space', CTRL);
    assert.equal(labels(window)[0], 'Platform.Function.Lookup');
    // the page gives the editor other content without a key being pressed
    const other = 'line one of other content\nlong enough here to hold the old place\n';
    editor.session.setValue(other);
    const entry = window.document.querySelector(POPUP).firstElementChild;
    entry.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    entry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(editor.getValue(), other);
    assert.equal(labels(window), null);
    assert.deepEqual(reports, []);
});

test('ace completions: with nothing to offer, Ctrl-Space does nothing', (t) => {
    const { window, editor, reports } = setup(t, '%%[ set @a = Zzzzqq| ]%%');
    assert.equal(didPress(editor, 'Space', CTRL), false);
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Zzzzqq ]%%');
    // nor with a selection
    editor.setValue('%%[ set @a = Loo ]%%', -1);
    editor.selection.setRange(new (window.ace.require('ace/range').Range)(0, 13, 0, 16));
    assert.equal(didPress(editor, 'Space', CTRL), false);
    assert.equal(labels(window), null);
    assert.deepEqual(reports, []);
});

test('ace completions: typing opens the popup after a pause', async (t) => {
    const { window, editor } = setup(t, '%%[ set @a = Lo| ]%%');
    editor.onTextInput('o');
    assert.equal(labels(window), null, 'not at once');
    await pause();
    assert.ok(labels(window).includes('Lookup'));
    didPress(editor, 'Escape');

    // server-side JavaScript, also after a dot
    const ssjs = setup(t, '<script runat="server">\nPlatform.Function|\n</script>');
    ssjs.editor.onTextInput('.');
    await pause();
    assert.ok(labels(ssjs.window).includes('Platform.Function.Lookup'));
});

test('ace completions: typing opens nothing inside a string or comment, after a paste, a new line or a character that is no name', async (t) => {
    const quiet = [
        '%%[ set @a = "Lo|" ]%%',
        '%%[ /* Lo| */ ]%%',
        '%%[ /* a\nLo| */ ]%%',
        '<script runat="server">\nvar a = "Lo|";\n</script>',
        '<script runat="server">\n// Lo|\n</script>',
        '<script runat="server">\n/* a\nLo| */\n</script>',
    ];
    for (const content of quiet) {
        const { window, editor } = setup(t, content);
        editor.onTextInput('o');
        await pause();
        assert.equal(labels(window), null, content);
        // on request there are suggestions also there, as in Content Builder
        assert.equal(editor.getValue(), content.replace('|', 'o'));
    }

    const { window, editor } = setup(t, '%%[ set @a = Lo| ]%%');
    editor.onPaste('o');
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    await pause();
    assert.equal(labels(window), null, 'paste');
    // several characters at once are no typing either
    editor.onTextInput('ku');
    await pause();
    assert.equal(labels(window), null, 'two characters');
    editor.onTextInput('\n');
    await pause();
    assert.equal(labels(window), null, 'new line');
    editor.setValue('%%[ set @a = Loo ]%%', -1);
    editor.moveCursorTo(0, 16);
    editor.onTextInput(')');
    await pause();
    assert.equal(labels(window), null, 'bracket');
    // typing that goes on within the pause, with something else: the popup stays away
    editor.setValue('%%[ set @a = Lo ]%%', -1);
    editor.moveCursorTo(0, 15);
    editor.onTextInput('o');
    didPress(editor, 'ArrowLeft');
    await pause();
    assert.equal(labels(window), null, 'moved on');
});

test('ace completions: the arrow keys move the active entry and Enter inserts it', (t) => {
    const { window, editor } = setup(t, '%%[ set @a = Loo| ]%%');
    didPress(editor, 'Space', CTRL);
    const names = labels(window);
    assert.equal(activeLabel(window), names[0]);
    assert.equal(didPress(editor, 'ArrowDown'), true);
    assert.equal(activeLabel(window), names[1]);
    didPress(editor, 'ArrowDown');
    assert.equal(activeLabel(window), names[2]);
    didPress(editor, 'ArrowUp');
    assert.equal(activeLabel(window), names[1]);
    didPress(editor, 'End');
    assert.equal(activeLabel(window), names.at(-1));
    // the cursor of the editor stayed where it was
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 0, column: 16 });
    didPress(editor, 'ArrowUp');
    didPress(editor, 'Tab');
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), `%%[ set @a = ${names.at(-2)}( ]%%`);
});

test('ace completions: Escape closes the popup and leaves the text alone', (t) => {
    const { window, editor } = setup(t, '%%[ set @a = Loo| ]%%');
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window));
    assert.equal(didPress(editor, 'Escape'), true);
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 0, column: 16 });
    // the popup's keys are the editor's again
    didPress(editor, 'End');
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 0, column: 20 });
    assert.equal(didPress(editor, 'Enter'), false);
    assert.equal(didPress(editor, 'Tab'), true);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%    ');
});

test('ace completions: typing more narrows the list, Backspace widens it, and it closes once nothing fits or the cursor leaves the line', (t) => {
    const { window, editor } = setup(t, '%%[ set @a = Loo| ]%%\n');
    didPress(editor, 'Space', CTRL);
    const wide = labels(window);
    didPress(editor, 'ArrowDown');
    for (const character of 'kupr') {
        editor.onTextInput(character);
    }
    const narrow = labels(window);
    assert.deepEqual(narrow, ['LookupRows', 'LookupRowsCS']);
    assert.ok(narrow.length < wide.length, wide.join(' '));
    assert.equal(activeLabel(window), narrow[0]);
    // other keys keep working in the editor while the popup is open
    assert.equal(editor.getValue(), '%%[ set @a = Lookupr ]%%\n');
    didPress(editor, 'Backspace');
    didPress(editor, 'Backspace');
    didPress(editor, 'Backspace');
    didPress(editor, 'Backspace');
    assert.deepEqual(labels(window), wide);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%\n');
    editor.onTextInput('kupr');
    assert.deepEqual(labels(window), narrow);
    didPress(editor, 'Enter');
    assert.equal(editor.getValue(), '%%[ set @a = LookupRows( ]%%\n');

    editor.setValue('%%[ set @a = Loo ]%%\n', -1);
    editor.moveCursorTo(0, 16);
    didPress(editor, 'Space', CTRL);
    editor.onTextInput('zzq');
    assert.equal(labels(window), null, 'nothing fits');

    editor.setValue('%%[ set @a = Loo\nLoo ]%%', -1);
    editor.moveCursorTo(0, 16);
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window));
    editor.execCommand('gotoright');
    assert.equal(labels(window), null, 'another line');
});

test('ace completions: a document with Windows line endings is completed at the right place', (t) => {
    const { window, editor } = setup(
        t,
        'Hello\n<script runat="server">\n  var a = 1;\n  Platform.Function.Loo|("x");\n</script>\n%%[ set @a = Loo ]%%',
        { eol: '\r\n' },
    );
    assert.ok(editor.getValue().includes('\r\n'));
    didPress(editor, 'Space', CTRL);
    assert.equal(labels(window)[0], 'Platform.Function.Lookup');
    assert.equal(window.document.querySelector(POPUP).style.top, `${4 * LINE_HEIGHT}px`);
    didPress(editor, 'Enter');
    // the bracket that is there already is not written again
    assert.equal(
        editor.getValue(),
        'Hello\r\n<script runat="server">\r\n  var a = 1;\r\n  Platform.Function.Lookup("x");\r\n</script>\r\n%%[ set @a = Loo ]%%',
    );
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 3, column: 26 });
    // and the language of a later line is found as well
    editor.moveCursorTo(5, 16);
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window).includes('LookupRows'));
    didPress(editor, 'Enter');
    assert.equal(editor.session.getLine(5), '%%[ set @a = Lookup( ]%%');
});

test('ace completions: the read-only summary editor never shows a popup', async (t) => {
    const { window, editor, reports } = setup(t, '%%[ set @a = Loo| ]%%', { isReadOnly: true });
    // it was taken over for its colours
    assert.ok(editor.container.classList.contains('sfmc-ux-tools-ace'));
    didPress(editor, 'Space', CTRL);
    assert.equal(labels(window), null);
    editor.execCommand(COMMAND);
    assert.equal(labels(window), null);
    editor.onTextInput('k');
    await pause();
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    // an editor that becomes read-only while its popup is open takes no choice
    editor.setReadOnly(false);
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window));
    editor.setReadOnly(true);
    window.document
        .querySelector(`${POPUP} li`)
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
    assert.deepEqual(reports, []);
});

test('ace completions: an editor of another activity is untouched', async (t) => {
    const { window, editor } = setup(t, '%%[ set @a = Lo| ]%%', {
        route: '#ActivityModal/300/new',
    });
    await pause();
    assert.equal(editor.commands.byName[COMMAND], undefined);
    assert.equal(didPress(editor, 'Space', CTRL), false);
    editor.onTextInput('o');
    await pause();
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');
});

test('ace completions: the popup goes when the dialog shows another activity, the editor leaves the page, loses the focus or scrolls', async (t) => {
    const ways = {
        'another activity': ({ window }) => {
            window.location.hash = '#ActivityModal/300/new';
        },
        'off the page': ({ editor }) => editor.container.remove(),
        blur: ({ editor }) => {
            editor.focus();
            editor.blur();
        },
        scroll: ({ editor }) => editor.session.setScrollTop(40),
        'a click elsewhere': ({ window }) =>
            window.document.body.dispatchEvent(
                new window.MouseEvent('mousedown', { bubbles: true }),
            ),
        'another session': ({ window, editor }) =>
            editor.setSession(window.ace.createEditSession('x', 'ace/mode/text')),
    };
    for (const [name, leave] of Object.entries(ways)) {
        const opened = setup(t, '%%[ set @a = Loo| ]%%');
        didPress(opened.editor, 'Space', CTRL);
        assert.ok(labels(opened.window), name);
        leave(opened);
        await pause();
        assert.equal(labels(opened.window), null, name);
        assert.deepEqual(opened.reports, [], name);
    }
    // once the dialog shows something else, the editor is no longer completed in
    const { window, editor } = setup(t, '%%[ set @a = Loo| ]%%');
    window.location.hash = '#ActivityModal/300/new';
    assert.equal(didPress(editor, 'Space', CTRL), false);
    assert.equal(labels(window), null);
});

test('ace completions: a failing language service closes the popup and is reported once', async (t) => {
    const { window, editor, reports } = setup(t, '%%[ set @a = Lo| ]%%');
    // describing a function is something only the completions do, not Ace; a failure there
    // stands in for any other
    const { matchAll } = window.String.prototype;
    const breakIt = () => {
        window.String.prototype.matchAll = () => {
            throw new Error('broken');
        };
    };
    const repair = () => {
        window.String.prototype.matchAll = matchAll;
    };
    t.after(repair);

    breakIt();
    assert.doesNotThrow(() => didPress(editor, 'Space', CTRL));
    assert.doesNotThrow(() => didPress(editor, 'Space', CTRL));
    repair();
    assert.equal(labels(window), null);
    assert.equal(reports.length, 1);

    // while the popup is open
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window));
    breakIt();
    assert.doesNotThrow(() => editor.onTextInput('o'));
    repair();
    assert.equal(labels(window), null);
    assert.equal(editor.getValue(), '%%[ set @a = Loo ]%%');

    // and after typing
    breakIt();
    editor.onTextInput('k');
    await pause();
    repair();
    assert.equal(labels(window), null);
    assert.equal(reports.length, 1);
    // the editor is as usable as before
    didPress(editor, 'Space', CTRL);
    assert.ok(labels(window).includes('Lookup'));
});
