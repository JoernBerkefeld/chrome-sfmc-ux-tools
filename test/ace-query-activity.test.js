import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// these tests run the built extension against the Ace that Automation Studio ships;
// "npm test" builds the extension first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const aceSources = ['ace.js', 'mode-javascript.js', 'mode-sql.js'].map((file) =>
    readFileSync(require.resolve(`ace-builds/src-noconflict/${file}`), 'utf8'),
);
// in the order of the manifest
const extensionScripts = [
    'language-data.js',
    'editor-highlight.js',
    'editor-language.js',
    'editor-format.js',
].map((file) => read(`../dist/extension/${file}`));
const APP = 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/';
const QUERY_ROUTE = '#ActivityModal/300/new';
const SCRIPT_ROUTE = '#ActivityModal/423/new';
// an activity that is neither a script (423) nor a SQL query (300)
const OTHER_ROUTE = '#ActivityModal/73/new';
const SQL_MODE = 'ace/mode/sql';
const TAKEN = 'sfmc-ux-tools-ace';
const BUTTONS = '.sfmc-format-beside, .sfmc-format-button';
const FORMAT_COMMAND = 'sfmcUxToolsFormat';
const MESSY = 'select a.SubscriberKey,a.EmailAddress from [My Data] a where a.Status=1';
const TIDY = [
    'SELECT',
    '    a.SubscriberKey,',
    '    a.EmailAddress',
    'FROM',
    '    [My Data] a',
    'WHERE',
    '    a.Status = 1',
    '',
];
// longer than the extension waits before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
const formatPause = () => new Promise((resolve) => setTimeout(resolve, 1000));

/**
 * Creates a page of Automation Studio with Ace, an editor like the SQL query activity's, and the
 * extension.
 *
 * @param {object} t test context, which closes the page
 * @param {{route?: string, mode?: string, content?: string, eol?: string, isReadOnly?: boolean}} [options] the page's hash, the editor's mode and content, the line endings of the content and whether the editor is a read-only one
 * @returns {{window: object, document: object, editor: object, element: Element, reports: unknown[][]}} the page, its editor and what the extension wrote to the console
 */
function setup(
    t,
    { route = QUERY_ROUTE, mode = SQL_MODE, content = MESSY, eol = '\n', isReadOnly = false } = {},
) {
    const { window } = new JSDOM(
        '<!doctype html><body><div class="modal"><div><button type="button" id="queryValidateBtn" class="btn btn-default validate pull-right">Validate Syntax</button></div>' +
            '<div id="queryEditor"></div>' +
            '<div class="modal-footer"><button type="button" class="btn btn-primary accept">Next</button></div></div></body>',
        { runScripts: 'outside-only', pretendToBeVisual: true, url: APP + route },
    );
    // a focused editor keeps a timer for its cursor, which would keep the test run alive
    t.after(() => window.close());
    for (const source of aceSources) {
        window.eval(source);
    }
    const reports = [];
    window.console.debug = (...parameters) => {
        reports.push(parameters);
    };
    const { document } = window;
    const element = document.querySelector('#queryEditor');
    const editor = window.ace.edit(element, { mode, useWorker: false });
    editor.setValue(content.split('\n').join(eol), -1);
    editor.setReadOnly(isReadOnly);
    for (const script of extensionScripts) {
        window.eval(script);
    }
    return { window, document, editor, element, reports };
}

test('ace query: the SQL editor of the query activity follows the editor theme and keeps its mode', async (t) => {
    const { window, element, editor, reports } = setup(t);
    assert.ok(element.classList.contains(TAKEN));
    assert.equal(editor.getSession().getMode().$id, SQL_MODE, 'the page colours the SQL');
    // none of the language features of the script activity
    assert.equal(editor.commands.byName.sfmcUxToolsComplete, undefined);
    // the dialog shows another activity
    window.location.hash = OTHER_ROUTE;
    await pause();
    assert.ok(!element.classList.contains(TAKEN));
    window.location.hash = QUERY_ROUTE;
    await pause();
    assert.ok(element.classList.contains(TAKEN));
    // the page gives the editor another mode
    editor.getSession().setMode('ace/mode/text');
    assert.ok(!element.classList.contains(TAKEN));
    editor.getSession().setMode(SQL_MODE);
    assert.ok(element.classList.contains(TAKEN), 'a mode that comes late');
    // and another session
    editor.setSession(window.ace.createEditSession('x', 'ace/mode/text'));
    assert.ok(!element.classList.contains(TAKEN));
    assert.deepEqual(reports, []);
});

test('ace query: other editors and other dialogs are left alone', async (t) => {
    const text = setup(t, { mode: 'ace/mode/text' });
    const other = setup(t, { route: OTHER_ROUTE });
    // a SQL editor in the script activity's dialog is none of the script's
    const script = setup(t, { route: SCRIPT_ROUTE });
    await pause();
    const pages = Object.entries({ text, other, script });
    for (const [name, page] of pages) {
        assert.ok(!page.element.classList.contains(TAKEN), name);
        assert.equal(page.document.querySelector(BUTTONS), null, name);
        assert.deepEqual(page.reports, [], name);
    }
    assert.equal(script.editor.getSession().getMode().$id, SQL_MODE);
});

test('ace query: the button next to "Validate Syntax" and Shift-Alt-F format the SQL in one step', async (t) => {
    const { document, editor, reports } = setup(t);
    const buttons = [...document.querySelectorAll(BUTTONS)];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].previousElementSibling.id, 'queryValidateBtn');
    assert.equal(buttons[0].className, 'btn btn-default pull-right sfmc-format-beside');
    buttons[0].click();
    await formatPause();
    assert.equal(editor.getValue(), TIDY.join('\n'));
    editor.undo();
    assert.equal(editor.getValue(), MESSY);

    const windows = setup(t, { eol: '\r\n', content: MESSY + '\n' });
    assert.equal(windows.editor.commands.byName[FORMAT_COMMAND].exec(windows.editor), true);
    await formatPause();
    assert.equal(windows.editor.getValue(), TIDY.join('\r\n'));
    assert.deepEqual(reports, []);
    assert.deepEqual(windows.reports, []);
});

test('ace query: a read-only SQL editor is themed but not formatted, and "Next" waits for the formatted query', async (t) => {
    const summary = setup(t, { isReadOnly: true });
    assert.ok(summary.element.classList.contains(TAKEN));
    assert.equal(summary.document.querySelector(BUTTONS), null);
    assert.equal(summary.editor.commands.byName[FORMAT_COMMAND].exec(summary.editor), false);

    const { window, document, editor } = setup(t);
    document.documentElement.dataset.sfmcUxToolsFormatOnSave = 'on';
    // jsdom lays nothing out; everything in this page is on show
    window.Element.prototype.getClientRects = () => [{}];
    const seen = [];
    const next = document.querySelector('.modal-footer button.accept');
    next.addEventListener('click', () => {
        seen.push(editor.getValue());
    });
    next.click();
    assert.deepEqual(seen, [], 'held back');
    await formatPause();
    await formatPause();
    assert.deepEqual(seen, [TIDY.join('\n')]);
    assert.equal(summary.editor.getValue(), MESSY);
});
