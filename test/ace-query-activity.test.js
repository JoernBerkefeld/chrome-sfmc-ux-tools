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
 * @param {{route?: string, mode?: string, content?: string, eol?: string, isReadOnly?: boolean, fetch?: (address: string, options: object) => Promise.<object>}} [options] the page's hash, the editor's mode and content, the line endings of the content, whether the editor is a read-only one, and what answers the page's requests; without it the page can make none
 * @returns {{window: object, document: object, editor: object, element: Element, reports: unknown[][]}} the page, its editor and what the extension wrote to the console
 */
function setup(
    t,
    {
        route = QUERY_ROUTE,
        mode = SQL_MODE,
        content = MESSY,
        eol = '\n',
        isReadOnly = false,
        fetch,
    } = {},
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
    if (fetch) {
        window.fetch = fetch;
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

// longer than the extension waits for typing to pause before it checks the query
const checkPause = () => new Promise((resolve) => setTimeout(resolve, 800));
const VALIDATE = '/AutomationStudioFuel3/fuelapi/automation/v1/queries/actions/validate/';
const NO_FIELD = "Invalid column name 'nofield'.";
const NO_FIELD_ANSWER = {
    queryValid: false,
    errors: [
        {
            message: `An error occurred while checking the query syntax. Errors: ${NO_FIELD}\r\n`,
        },
    ],
    warnings: [],
};

/**
 * Stands in for Marketing Cloud's check of a query.
 *
 * @param {(text: string) => object | Promise.<object>} answer gives the answer for a query
 * @param {number} [status] the status of every answer
 * @returns {{asked: string[], fetch: (address: string, options: object) => Promise.<object>}} the queries that were asked about, and what answers the page's requests
 */
function checker(answer, status = 200) {
    const asked = [];
    return {
        asked,
        fetch: async (address, options) => {
            assert.equal(address, VALIDATE);
            assert.equal(options.method, 'POST');
            assert.equal(options.credentials, 'same-origin');
            const { text } = JSON.parse(options.body);
            asked.push(text);
            const body = await answer(text);
            return { status, json: async () => body };
        },
    };
}

/**
 * Lists what is underlined in an editor and noted in its gutter.
 *
 * @param {object} editor Ace editor
 * @returns {string[]} kind, place and text of every underline, then kind, place and message of every note
 */
function found(editor) {
    const { session } = editor;
    const underlines = Object.values(session.getMarkers(false))
        .filter(({ clazz }) => clazz.startsWith('sfmc-diagnostic '))
        .map(({ clazz, range }) => {
            const kind = clazz.split('sfmc-diagnostic-', 2)[1];
            return `${kind} ${range.start.row}:${range.start.column} ${session.getTextRange(range)}`;
        })
        .toSorted((a, b) => a.localeCompare(b));
    const notes = [...session.getAnnotations()].map(
        ({ type, row, column, text }) => `note ${type} ${row}:${column} ${text}`,
    );
    return [...underlines, ...notes];
}

test('ace query: the query is checked by Marketing Cloud when it is there and after it changed', async (t) => {
    const first = 'SELECT nofield\nFROM [My Data]';
    const { asked, fetch } = checker((text) =>
        text.includes('nofield') ? NO_FIELD_ANSWER : { queryValid: true, errors: [], warnings: [] },
    );
    const { editor, reports } = setup(t, { content: first, eol: '\r\n', fetch });
    assert.deepEqual(asked, [], 'not before typing has paused');
    await checkPause();
    assert.deepEqual(asked, [first]);
    assert.deepEqual(found(editor), ['error 0:7 nofield', `note error 0:7 ${NO_FIELD}`]);

    // the underline stays on its code while the text around it changes
    editor.getSession().insert({ row: 0, column: 0 }, '\n');
    assert.deepEqual(found(editor)[0], 'error 1:7 nofield');
    await checkPause();
    assert.deepEqual(asked, [first, `\n${first}`]);
    assert.deepEqual(found(editor), ['error 1:7 nofield', `note error 1:7 ${NO_FIELD}`]);

    // the same text again is not asked about
    editor.setValue(`\n${first}`, -1);
    await checkPause();
    assert.equal(asked.length, 2);
    assert.equal(found(editor).length, 2);

    editor.setValue('SELECT SubscriberKey FROM [My Data]', -1);
    await checkPause();
    assert.equal(asked.length, 3);
    assert.deepEqual(found(editor), []);

    // a blank query is not asked about and has nothing wrong
    editor.setValue(first, -1);
    await checkPause();
    assert.equal(asked.length, 4);
    assert.equal(found(editor).length, 2);
    editor.setValue('  \n ', -1);
    await checkPause();
    assert.equal(asked.length, 4);
    assert.deepEqual(found(editor), []);
    // and the query from before it is asked about again
    editor.setValue(first, -1);
    await checkPause();
    assert.equal(asked.length, 5);
    assert.equal(found(editor).length, 2);
    assert.deepEqual(reports, []);
});

test('ace query: an answer about a query that is no longer in the editor is dropped', async (t) => {
    const answers = [];
    const { asked, fetch } = checker(
        () =>
            new Promise((resolve) => {
                answers.push(resolve);
            }),
    );
    const { window, editor, element, reports } = setup(t, {
        content: 'SELECT nofield FROM x',
        fetch,
    });
    await checkPause();
    assert.equal(asked.length, 1);
    editor.setValue('SELECT other FROM x', -1);
    answers[0](NO_FIELD_ANSWER);
    await checkPause();
    assert.deepEqual(asked, ['SELECT nofield FROM x', 'SELECT other FROM x']);
    assert.deepEqual(found(editor), [], 'the late answer');
    answers[1]({
        queryValid: true,
        errors: [],
        warnings: [{ message: 'Just a heads-up... \r\n(Line 1, Col 8) Name it.\r\n' }],
    });
    await pause();
    assert.deepEqual(found(editor), ['warning 0:7 other', 'note warning 0:7 Name it.']);

    // an answer that was dropped drew nothing: the query it was about is asked about again
    // once it is back in the editor
    editor.setValue('SELECT nofield FROM z', -1);
    await checkPause();
    assert.equal(asked.length, 3);
    editor.setValue('SELECT nofield FROM zz', -1);
    answers[2](NO_FIELD_ANSWER);
    await pause();
    editor.setValue('SELECT nofield FROM z', -1);
    await checkPause();
    assert.deepEqual(asked.slice(3), ['SELECT nofield FROM z']);
    answers[3](NO_FIELD_ANSWER);
    await pause();
    assert.equal(found(editor).length, 2);

    // the dialog shows another activity: what was found goes, and an answer that comes then too
    editor.setValue('SELECT nofield FROM y', -1);
    await checkPause();
    assert.equal(asked.length, 5);
    window.location.hash = OTHER_ROUTE;
    await pause();
    assert.ok(!element.classList.contains(TAKEN));
    answers[4](NO_FIELD_ANSWER);
    await pause();
    assert.deepEqual(found(editor), []);
    assert.deepEqual(reports, []);
});

test('ace query: without an answer nothing is underlined, and other editors are never asked about', async (t) => {
    const refused = checker(() => NO_FIELD_ANSWER, 401);
    const offline = {
        asked: [],
        fetch: async (address, options) => {
            offline.asked.push(options.body);
            throw new TypeError('Failed to fetch');
        },
    };
    const pages = {
        refused: setup(t, { content: 'SELECT nofield FROM x', fetch: refused.fetch }),
        offline: setup(t, { content: 'SELECT nofield FROM x', fetch: offline.fetch }),
        // no way to ask at all
        none: setup(t, { content: 'SELECT nofield FROM x' }),
    };
    const summary = checker(() => NO_FIELD_ANSWER);
    const others = {
        // the editor of the dialog's summary
        summary: setup(t, {
            isReadOnly: true,
            content: 'SELECT nofield FROM x',
            fetch: summary.fetch,
        }),
        text: setup(t, { mode: 'ace/mode/text', fetch: summary.fetch }),
        other: setup(t, { route: OTHER_ROUTE, fetch: summary.fetch }),
        script: setup(t, { route: SCRIPT_ROUTE, fetch: summary.fetch }),
    };
    await checkPause();
    assert.equal(refused.asked.length, 1);
    assert.equal(offline.asked.length, 1);
    assert.deepEqual(summary.asked, []);
    const all = Object.entries({ ...pages, ...others });
    for (const [name, page] of all) {
        assert.deepEqual(found(page.editor), [], name);
        assert.deepEqual(page.reports, [], name);
    }
    // typing in the summary's editor is not possible; text that the page puts there is not asked about
    others.summary.editor.setValue('SELECT nofield FROM y', -1);
    await checkPause();
    assert.deepEqual(summary.asked, []);
});

const HOVER = '.sfmc-hover';
const LINE_HEIGHT = 20;
const CHARACTER_WIDTH = 10;
// longer than the mouse has to rest, and than a box stays once the mouse left
const hoverPause = () => new Promise((resolve) => setTimeout(resolve, 500));

/**
 * Gives an editor places in the window. jsdom lays nothing out: every character is as wide and
 * every line as high as the next.
 *
 * @param {object} editor Ace editor
 */
function layOut(editor) {
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
}

/**
 * Moves the mouse onto a character of the editor, or onto the gutter next to a line.
 *
 * @param {{window: object, editor: object}} page page from `setup`
 * @param {number} row the line
 * @param {number} [column] the character; without it the mouse is in the gutter
 */
function rest({ window, editor }, row, column) {
    const target = column === undefined ? editor.renderer.$gutter : editor.container;
    target.dispatchEvent(
        new window.MouseEvent('mousemove', {
            bubbles: true,
            clientX: ((column ?? 0) + 0.5) * CHARACTER_WIDTH,
            clientY: (row + 0.5) * LINE_HEIGHT,
        }),
    );
}

test('ace query: resting the mouse on an underline or on its note shows the message in the box, and nothing but the message', async (t) => {
    // the second line would have documentation and a problem if the language service were asked
    const second = '\'%%=Lookupx("a")=%%\' AS x, ';
    const content = `SELECT nofield,\n${second}nofield\nFROM [My Data]`;
    const { fetch } = checker(() => NO_FIELD_ANSWER);
    const page = setup(t, { content, fetch });
    const { document, editor, element, reports } = page;
    layOut(editor);
    await checkPause();
    assert.equal(found(editor).length, 4);
    assert.equal(editor.commands.byName.sfmcUxToolsQuickFix, undefined, 'no key for fixes');

    rest(page, 0, 9);
    assert.equal(document.querySelector(HOVER), null, 'waits until the mouse rests');
    await hoverPause();
    let box = document.querySelector(HOVER);
    assert.equal(box.parentNode, document.body);
    // at the character the mouse is on, as for a problem of the script activity
    assert.equal(box.style.left, `${9 * CHARACTER_WIDTH}px`);
    assert.deepEqual(
        [...box.querySelectorAll('.sfmc-problem')].map((problem) => problem.textContent),
        [NO_FIELD],
    );
    assert.equal(box.querySelector('.sfmc-fix, pre, a'), null, 'no fixes and no documentation');

    // the language service has documentation for this name, and a complaint; it is not asked
    rest(page, 1, 6);
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
    rest(page, 0, 2);
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'nothing to say about SELECT');

    // the note next to the line number: the same box, at the place the note stands for
    rest(page, 1);
    await hoverPause();
    box = document.querySelector(HOVER);
    assert.equal(box.style.left, `${second.length * CHARACTER_WIDTH}px`);
    assert.equal(box.style.top, `${LINE_HEIGHT - 4}px`);
    assert.equal(box.querySelector('.sfmc-problem').textContent, NO_FIELD);
    assert.equal(box.querySelector('.sfmc-fix, pre, a'), null);
    // Ace's own tooltip for the note is an element of the editor, where the stylesheet hides it
    assert.equal(element.querySelector('.ace_tooltip').parentNode, element);
    assert.match(
        read('../src/editor-highlight.css'),
        /\n\.ace_editor\.sfmc-ux-tools-ace > \.ace_tooltip \{\r?\n {4}display: none !important;/,
    );
    rest(page, 2);
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null, 'a line without a note');

    // typing takes the box away
    rest(page, 0);
    await hoverPause();
    assert.ok(document.querySelector(HOVER));
    editor.getSession().insert({ row: 2, column: 0 }, ' ');
    assert.equal(document.querySelector(HOVER), null);
    assert.deepEqual(reports, []);
});

test('ace query: an error without a place is read at the first character of the query and on its note', async (t) => {
    const message = 'The query is not right.';
    const { fetch } = checker(() => ({ errors: [{ message }], warnings: [] }));
    const page = setup(t, { content: '\n  SELECT 1', fetch });
    const { window, document, editor, reports } = page;
    layOut(editor);
    await checkPause();
    assert.deepEqual(found(editor), ['error 1:2 S', `note error 1:2 ${message}`]);
    rest(page, 1, 2);
    await hoverPause();
    assert.equal(document.querySelector(`${HOVER} .sfmc-problem`).textContent, message);
    rest(page, 1, 3);
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
    rest(page, 1);
    await hoverPause();
    const box = document.querySelector(HOVER);
    assert.equal(box.querySelector('.sfmc-problem').textContent, message);
    assert.equal(box.style.left, `${2 * CHARACTER_WIDTH}px`);

    // the dialog shows another activity: the box goes, and none comes for that editor
    window.location.hash = OTHER_ROUTE;
    await pause();
    assert.equal(document.querySelector(HOVER), null);
    rest(page, 1);
    await hoverPause();
    assert.equal(document.querySelector(HOVER), null);
    assert.deepEqual(reports, []);
});
