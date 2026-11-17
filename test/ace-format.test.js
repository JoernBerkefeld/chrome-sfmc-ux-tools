import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// these tests run the built extension against the Ace that Automation Studio ships;
// "npm test" builds the extension first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const aceSource = readFileSync(require.resolve('ace-builds/src-noconflict/ace.js'), 'utf8');
const javascriptModeSource = readFileSync(
    require.resolve('ace-builds/src-noconflict/mode-javascript.js'),
    'utf8',
);
// in the order of the manifest
const extensionScripts = [
    'language-data.js',
    'editor-highlight.js',
    'editor-language.js',
    'editor-format.js',
].map((file) => read(`../dist/extension/${file}`));
const APP = 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/';
const SCRIPT_ROUTE = '#ActivityModal/423/new';
const OTHER_ROUTE = '#ActivityModal/300/new';
const BESIDE = '.sfmc-format-beside';
const FLOATING = '.sfmc-format-floating';
const BUTTONS = `${BESIDE}, .sfmc-format-button`;
const NOTICE = '.sfmc-notice';
const COMMAND = 'sfmcUxToolsFormat';
const MESSY =
    '<script runat="server">\nvar a=Platform.Function.Lookup("a","b","c",1);if(a){Write(a)}\n</script>\n' +
    '%%[ set @a=1 ]%%';
const TIDY = [
    '<script runat="server">',
    "    var a = Platform.Function.Lookup('a', 'b', 'c', 1);",
    '    if (a) {',
    '        Write(a);',
    '    }',
    '</script>',
    '%%[',
    '    set @a = 1',
    ']%%',
];
// longer than the extension waits before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
const formatPause = () => new Promise((resolve) => setTimeout(resolve, 1000));

/**
 * Creates a page of Automation Studio with Ace, an editor like the script activity's, and the
 * extension.
 *
 * @param {object} t test context, which closes the page
 * @param {string} content the editor's content
 * @param {{route?: string, eol?: string, isReadOnly?: boolean, hasValidate?: boolean}} [options] the page's hash, the line endings of the content, whether the editor is the read-only one and whether the dialog has its "Validate Syntax" button
 * @returns {{window: object, document: object, editor: object, reports: unknown[][]}} the page, its editor and what the extension wrote to the console
 */
function setup(
    t,
    content,
    { route = SCRIPT_ROUTE, eol = '\n', isReadOnly = false, hasValidate = true } = {},
) {
    const { window } = new JSDOM(
        '<!doctype html><body><div id="editor"></div><div id="footer"></div></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true, url: APP + route },
    );
    // a focused editor keeps a timer for its cursor, which would keep the test run alive
    t.after(() => window.close());
    window.eval(aceSource);
    window.eval(javascriptModeSource);
    const reports = [];
    window.console.debug = (...parameters) => {
        reports.push(parameters);
    };
    const { document } = window;
    if (hasValidate) {
        const validate = document.createElement('button');
        validate.id = 'scriptValidateBtn';
        validate.className = 'btn btn-default validate pull-right';
        validate.textContent = 'Validate Syntax';
        document.querySelector('#footer').append(validate);
    }
    // jsdom has no workers; the page's own worker is not what is tested here
    const editor = window.ace.edit(document.querySelector('#editor'), {
        mode: 'ace/mode/javascript',
        useWorker: false,
    });
    editor.setValue(content.split('\n').join(eol), -1);
    editor.setReadOnly(isReadOnly);
    for (const script of extensionScripts) {
        window.eval(script);
    }
    return { window, document, editor, reports };
}

/**
 * Runs the command behind Shift-Alt-F.
 *
 * @param {object} editor Ace editor
 * @returns {unknown} false if the key goes on to the editor
 */
function pressFormat(editor) {
    const command = editor.commands.byName[COMMAND];
    assert.equal(command.bindKey, 'Shift-Alt-F');
    return command.exec(editor);
}

test('ace format: the button stands next to "Validate Syntax" and formats in one step that can be undone', async (t) => {
    const { document, editor, reports } = setup(t, MESSY);
    const buttons = [...document.querySelectorAll(BUTTONS)];
    assert.equal(buttons.length, 1);
    const [button] = buttons;
    assert.equal(button.previousElementSibling.id, 'scriptValidateBtn');
    // the looks of the dialog's own buttons
    assert.equal(button.className, 'btn btn-default pull-right sfmc-format-beside');
    assert.equal(button.type, 'button');
    assert.match(button.title, /^Format code \(.*F\)$/);
    assert.equal(button.getAttribute('aria-label'), button.title);
    editor.moveCursorTo(0, 3);
    button.click();
    assert.equal(editor.getValue(), MESSY, 'formatting takes a moment');
    await formatPause();
    assert.equal(editor.getValue(), TIDY.join('\n'));
    assert.deepEqual({ ...editor.getCursorPosition() }, { row: 0, column: 3 });
    assert.equal(editor.selection.isEmpty(), true);
    editor.undo();
    assert.equal(editor.getValue(), MESSY);
    // the page changing does not add a second button
    document.body.append(document.createElement('p'));
    await pause();
    assert.equal(document.querySelectorAll(BUTTONS).length, 1);
    assert.equal(document.querySelector(NOTICE), null);
    assert.deepEqual(reports, []);
});

test('ace format: Shift-Alt-F formats and keeps Windows line endings', async (t) => {
    const { editor, reports } = setup(t, MESSY, { eol: '\r\n' });
    assert.ok(editor.getValue().includes('\r\n'));
    assert.equal(pressFormat(editor), true);
    await formatPause();
    assert.equal(editor.getValue(), TIDY.join('\r\n'));
    assert.deepEqual(reports, []);
});

test('ace format: tidy content, later edits and broken content are left alone', async (t) => {
    const tidy = setup(t, TIDY.join('\n'));
    // loading the content is no step to undo
    tidy.editor.session.getUndoManager().reset();
    pressFormat(tidy.editor);
    const edited = setup(t, MESSY);
    pressFormat(edited.editor);
    edited.editor.session.insert({ row: 0, column: 0 }, '<p>x</p>');
    // Prettier and the plugin put up with any content; a document that hands out something else
    // than lines of text stands in for a failure
    const broken = setup(t, MESSY);
    const lines = broken.editor.session.getDocument();
    const { getAllLines } = lines;
    lines.getAllLines = () => ({ join: () => 5 });
    pressFormat(broken.editor);
    await formatPause();
    lines.getAllLines = getAllLines;
    assert.equal(tidy.editor.getValue(), TIDY.join('\n'));
    assert.equal(tidy.editor.session.getUndoManager().hasUndo(), false, 'nothing to undo');
    assert.equal(edited.editor.getValue(), `<p>x</p>${MESSY}`, 'what was typed meanwhile stays');
    assert.equal(broken.editor.getValue(), MESSY);
    assert.match(broken.document.querySelector(NOTICE).textContent, /^Not formatted: /);
    assert.equal(tidy.document.querySelector(NOTICE), null);
    assert.equal(edited.document.querySelector(NOTICE), null);
});

test('ace format: without "Validate Syntax" the button sits in the corner of the editor', async (t) => {
    const { document, editor } = setup(t, MESSY, { hasValidate: false });
    const button = document.querySelector(FLOATING);
    assert.equal(button.parentNode, editor.container);
    assert.ok(button.classList.contains('sfmc-format-button'));
    button.click();
    await formatPause();
    assert.equal(editor.getValue(), TIDY.join('\n'));
});

test('ace format: the read-only editor has no button and is not formatted', async (t) => {
    const { document, editor, reports } = setup(t, MESSY, { isReadOnly: true });
    assert.equal(document.querySelector(BUTTONS), null);
    assert.equal(pressFormat(editor), false);
    await formatPause();
    assert.equal(editor.getValue(), MESSY);
    // an editor that can be edited later gets its button with the next change of the page
    editor.setReadOnly(false);
    document.body.append(document.createElement('p'));
    await pause();
    assert.equal(document.querySelectorAll(BUTTONS).length, 1);
    assert.deepEqual(reports, []);
});

test('ace format: editors of other activities are left alone, and the button goes with the dialog', async (t) => {
    const other = setup(t, MESSY, { route: OTHER_ROUTE });
    assert.equal(other.document.querySelector(BUTTONS), null);
    assert.equal(other.editor.commands.byName[COMMAND], undefined);

    const { window, document, editor, reports } = setup(t, MESSY);
    assert.equal(document.querySelectorAll(BUTTONS).length, 1);
    window.location.hash = OTHER_ROUTE;
    await pause();
    assert.equal(document.querySelector(BUTTONS), null, 'the dialog shows another activity');
    assert.equal(pressFormat(editor), false);
    window.location.hash = SCRIPT_ROUTE;
    await pause();
    assert.equal(document.querySelectorAll(BUTTONS).length, 1);
    const { container } = editor;
    container.remove();
    await pause();
    assert.equal(document.querySelector(BUTTONS), null, 'the editor left the page');
    document.body.append(container);
    await pause();
    assert.equal(document.querySelectorAll(BUTTONS).length, 1, 'and came back');
    container.remove();
    await pause();
    assert.equal(document.querySelector(BUTTONS), null);
    await formatPause();
    assert.equal(editor.getValue(), MESSY);
    assert.deepEqual(reports, []);
});

test('ace format: the button next to "Validate Syntax" has a style of its own', () => {
    const css = read('../dist/extension/editor-highlight.css');
    assert.ok(css.includes('.sfmc-format-beside {'));
});
