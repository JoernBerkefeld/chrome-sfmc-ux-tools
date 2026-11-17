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
const extensionScripts = ['language-data.js', 'editor-highlight.js', 'editor-language.js'].map(
    (file) => read(`../dist/extension/${file}`),
);
const css = read('../src/editor-highlight.css');
const APP = 'https://mc.s7.marketingcloudapps.com/AutomationStudioFuel3/';
const SCRIPT_ROUTE = '#ActivityModal/423/new';
const OUR_MODE = 'sfmc-ux-tools/mode/script-activity';
const PAGE_MODE = 'ace/mode/javascript';
const TAKEN_CLASS = 'sfmc-ux-tools-ace';
const SAMPLE = [
    'Hello <b class="x" id=y>%%FirstName%%</b> <!-- note -->',
    '<script runat="server">',
    '  var rows = Platform.Function.Lookup("de", "f", "k", 1); // find',
    '  Write(Stringify(rows) + "%%name%%");',
    '</script>',
    '%%[ set @a = Lookup("x") /* c */ IF @a == 1 THEN ]%%',
    '<a href="%%=RedirectTo(@a)=%%">50%% off, ask %%emailaddr%%=now</a>',
    '<script>var b = document.title; Write(b);</script>',
    '<script language="ampscript" runat=server>SET @@b = 2</script>',
];
// longer than the extension waits before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

/**
 * Creates a page of Automation Studio that has Ace the way the app ships it.
 *
 * @param {string} [route] the hash of the page's address
 * @param {{hasAce?: boolean}} [options] whether the page has Ace at all
 * @returns {object} the page's window
 */
function page(route = SCRIPT_ROUTE, { hasAce = true } = {}) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        url: APP + route,
    });
    if (hasAce) {
        window.eval(aceSource);
        window.eval(javascriptModeSource);
    }
    return window;
}

/**
 * Adds an editor to the page, set up like the one of the script activity's dialog.
 *
 * @param {object} window page window
 * @param {string[]} [lines] content
 * @param {string} [id] the element's id
 * @returns {object} Ace editor
 */
function addEditor(window, lines = SAMPLE, id = 'scriptEditor') {
    const element = window.document.createElement('div');
    element.id = id;
    window.document.body.append(element);
    // jsdom has no workers; the page's own worker is not what is tested here
    const editor = window.ace.edit(element, { mode: PAGE_MODE, useWorker: false });
    // the dialog's content may come with Windows line endings
    editor.setValue(lines.join('\r\n'), -1);
    return editor;
}

/**
 * Runs the extension's page scripts in the page, in the order of the manifest.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    for (const script of extensionScripts) {
        window.eval(script);
    }
}

/**
 * The tokens of a line.
 *
 * @param {object} editor Ace editor
 * @param {number} row line, counted from 0
 * @returns {string[][]} type and text of every token
 */
function tokens(editor, row) {
    // Ace reads a line with the state the line above left behind, so those come first
    for (let above = 0; above < row; above++) {
        editor.session.getTokens(above);
    }
    // copied, because an array of the page is never deep-equal to one of the test
    return Array.from(editor.session.getTokens(row), (token) => [token.type, token.value]);
}

/**
 * The type of the token with a given text.
 *
 * @param {object} editor Ace editor
 * @param {number} row line, counted from 0
 * @param {string} text the token's whole text
 * @returns {string | undefined} token type; undefined if the line has no such token
 */
function typeOf(editor, row, text) {
    return tokens(editor, row).find(([, value]) => value === text)?.[0];
}

/**
 * Collects what the extension writes to the console.
 *
 * @param {object} window page window
 * @returns {unknown[][]} the arguments of every call, filled as calls happen
 */
function consoleCalls(window) {
    const calls = [];
    window.console.debug = (...parameters) => {
        calls.push(parameters);
    };
    return calls;
}

test('the Ace of the page works without the extension and reads the script as one string', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    assert.equal(editor.session.getMode().$id, PAGE_MODE);
    // what the extension is there to repair: the code of the script is not coloured as code
    assert.equal(typeOf(editor, 2, 'var'), undefined);
    assert.ok(!editor.container.classList.contains(TAKEN_CLASS));
});

test('the editor of a script activity gets the mode of the extension and its class', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.equal(editor.session.getMode().$id, OUR_MODE);
    assert.ok(editor.container.classList.contains(TAKEN_CLASS));
    assert.equal(editor.session.getMode().createWorker(editor.session), null, 'no worker');
    assert.equal(editor.getValue(), SAMPLE.join('\r\n'), 'the content is untouched');
    // the route may also name an existing activity
    const existing = page('#ActivityModal/423/0b1c2d3e-0000-4000-8000-123456789abc');
    t.after(() => existing.close());
    const other = addEditor(existing);
    runExtension(existing);
    assert.equal(other.session.getMode().$id, OUR_MODE);
});

test('text and HTML around the scripts are tokenised as markup', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.deepEqual(tokens(editor, 0), [
        ['text', 'Hello '],
        ['meta.tag.punctuation', '<'],
        ['meta.tag.name', 'b'],
        ['text', ' '],
        ['entity.other.attribute-name', 'class'],
        ['keyword.operator.attribute-equals', '='],
        ['string.attribute-value', '"x"'],
        ['text', ' '],
        ['entity.other.attribute-name', 'id'],
        ['keyword.operator.attribute-equals', '='],
        ['string.attribute-value', 'y'],
        ['meta.tag.punctuation', '>'],
        ['variable.personalization', '%%FirstName%%'],
        ['meta.tag.punctuation', '</'],
        ['meta.tag.name', 'b'],
        ['meta.tag.punctuation', '>'],
        ['text', ' '],
        ['comment.markup', '<!-- note -->'],
    ]);
    assert.deepEqual(tokens(editor, 1), [
        ['meta.tag.punctuation', '<'],
        ['meta.tag.name', 'script'],
        ['text', ' '],
        ['entity.other.attribute-name', 'runat'],
        ['keyword.operator.attribute-equals', '='],
        ['string.attribute-value', '"server"'],
        ['meta.tag.punctuation', '>'],
    ]);
    assert.deepEqual(tokens(editor, 4), [
        ['meta.tag.punctuation', '</'],
        ['meta.tag.name', 'script'],
        ['meta.tag.punctuation', '>'],
    ]);
});

test('a server-side script is coloured as JavaScript, with types of their own for Marketing Cloud names', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.deepEqual(
        tokens(editor, 2).filter(([type]) => type !== 'text'),
        [
            ['storage.type', 'var'],
            ['identifier', 'rows'],
            ['keyword.operator', '='],
            ['support.class.ssjs', 'Platform'],
            ['punctuation.operator', '.'],
            ['identifier', 'Function'],
            ['punctuation.operator', '.'],
            ['support.function.ssjs', 'Lookup'],
            ['paren.lparen', '('],
            ['string', '"de"'],
            ['punctuation.operator', ','],
            ['string', '"f"'],
            ['punctuation.operator', ','],
            ['string', '"k"'],
            ['punctuation.operator', ','],
            ['constant.numeric', '1'],
            ['paren.rparen', ')'],
            ['punctuation.operator', ';'],
            ['comment', '// find'],
        ],
    );
    // the script body is no longer one string token
    for (const row of [2, 3]) {
        const types = new Set(tokens(editor, row).map(([type]) => type));
        assert.ok(types.size > 4, [...types].join(' '));
    }
    assert.equal(typeOf(editor, 3, 'Write'), 'support.function.ssjs');
    assert.equal(typeOf(editor, 3, 'Stringify'), 'support.function.ssjs');
    assert.equal(typeOf(editor, 3, 'rows'), 'identifier');
    // a personalization string is filled in before the script runs, also inside a string
    assert.equal(typeOf(editor, 3, '%%name%%'), 'variable.personalization');
    assert.equal(typeOf(editor, 3, '"'), 'string');
});

test('Marketing Cloud names are only coloured where they mean Marketing Cloud', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window, [
        '<SCRIPT language="javascript" runat=\'server\'>',
        'var Platform = 1, o = {}; Platform + 1;',
        'o.Write(1); o.Lookup("x"); o.Platform.x;',
        'function Write(a) {}',
        'var s = "</b>"; /* Platform.Load */ var t = \'a\';',
        'var u = "open',
        '</SCRIPT>',
        '<p>after</p>',
    ]);
    runExtension(window);
    assert.equal(typeOf(editor, 0, 'SCRIPT'), 'meta.tag.name');
    assert.equal(typeOf(editor, 0, "'server'"), 'string.attribute-value');
    assert.deepEqual(
        tokens(editor, 1).filter(([, value]) => value === 'Platform'),
        [
            ['identifier', 'Platform'],
            ['identifier', 'Platform'],
        ],
    );
    assert.equal(typeOf(editor, 2, 'Write'), 'identifier');
    assert.equal(typeOf(editor, 2, 'Lookup'), 'identifier');
    assert.equal(typeOf(editor, 2, 'Platform'), 'identifier');
    assert.equal(typeOf(editor, 3, 'Write'), 'entity.name.function');
    // HTML inside a string is a string, and names inside a comment are a comment
    assert.equal(typeOf(editor, 4, '"</b>"'), 'string');
    assert.equal(typeOf(editor, 4, '/* Platform.Load */'), 'comment');
    // the closing tag ends the script whatever is open, and markup follows
    assert.equal(typeOf(editor, 6, 'SCRIPT'), 'meta.tag.name');
    assert.equal(typeOf(editor, 7, 'p'), 'meta.tag.name');
    assert.equal(typeOf(editor, 7, 'after'), 'text');
});

test('AMPscript blocks, expressions and script tags are coloured as AMPscript', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.deepEqual(
        tokens(editor, 5).filter(([type]) => type !== 'text.ampscript'),
        [
            ['meta.delimiter.ampscript', '%%['],
            ['keyword.control.ampscript', 'set'],
            ['variable.ampscript', '@a'],
            ['keyword.operator.ampscript', '='],
            ['support.function.ampscript', 'Lookup'],
            ['paren.lparen.ampscript', '('],
            ['string.ampscript', '"x"'],
            ['paren.rparen.ampscript', ')'],
            ['comment.ampscript', '/* c */'],
            // keywords in any case
            ['keyword.control.ampscript', 'IF'],
            ['variable.ampscript', '@a'],
            ['keyword.operator.ampscript', '=='],
            ['constant.numeric.ampscript', '1'],
            ['keyword.control.ampscript', 'THEN'],
            ['meta.delimiter.ampscript', ']%%'],
        ],
    );
    // an expression inside an attribute value, which goes on behind it
    assert.deepEqual(tokens(editor, 6).slice(3, 12), [
        ['entity.other.attribute-name', 'href'],
        ['keyword.operator.attribute-equals', '='],
        ['string.attribute-value', '"'],
        ['meta.delimiter.ampscript', '%%='],
        ['support.function.ampscript', 'RedirectTo'],
        ['paren.lparen.ampscript', '('],
        ['variable.ampscript', '@a'],
        ['paren.rparen.ampscript', ')'],
        ['meta.delimiter.ampscript', '=%%'],
    ]);
    assert.deepEqual(
        tokens(editor, 8).filter(([type]) => type.endsWith('.ampscript')),
        [
            ['keyword.control.ampscript', 'SET'],
            ['text.ampscript', ' '],
            ['variable.ampscript', '@@b'],
            ['text.ampscript', ' '],
            ['keyword.operator.ampscript', '='],
            ['text.ampscript', ' '],
            ['constant.numeric.ampscript', '2'],
        ],
    );
    assert.equal(tokens(editor, 8).at(-2)[1], 'script');
});

test('a personalization string is never the start of AMPscript, and "%%" in text is text', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.deepEqual(tokens(editor, 6).slice(13), [
        ['meta.tag.punctuation', '>'],
        // the closing %% of the name and the "=" behind it do not open an expression
        ['text', '50%% off, ask '],
        ['variable.personalization', '%%emailaddr%%'],
        ['text', '=now'],
        ['meta.tag.punctuation', '</'],
        ['meta.tag.name', 'a'],
        ['meta.tag.punctuation', '>'],
    ]);
});

test('AMPscript that spans lines keeps its colours, and an expression that was never closed is given up', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window, [
        '%%[ /* a comment',
        'set @a */ set @b = "two',
        'lines" ]%% text',
        '%%=v(@a)',
        '',
        '<p>markup again</p>',
        '%%=v(@a) %%[ set @c = 1 ]%% <i>',
    ]);
    runExtension(window);
    assert.deepEqual(tokens(editor, 1).slice(0, 3), [
        ['comment.ampscript', 'set @a */'],
        ['text.ampscript', ' '],
        ['keyword.control.ampscript', 'set'],
    ]);
    assert.deepEqual(tokens(editor, 2), [
        ['string.ampscript', 'lines"'],
        ['text.ampscript', ' '],
        ['meta.delimiter.ampscript', ']%%'],
        ['text', ' text'],
    ]);
    assert.equal(typeOf(editor, 3, 'v'), 'support.function.ampscript');
    assert.equal(typeOf(editor, 5, 'p'), 'meta.tag.name');
    assert.equal(typeOf(editor, 5, 'markup again'), 'text');
    // a block that starts inside an open expression takes over and ends normally
    assert.equal(typeOf(editor, 6, '%%['), 'meta.delimiter.ampscript');
    assert.equal(typeOf(editor, 6, 'set'), 'keyword.control.ampscript');
    assert.equal(typeOf(editor, 6, 'i'), 'meta.tag.name');
});

test('a browser script is coloured as JavaScript, without the Marketing Cloud names', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window, [
        SAMPLE[7],
        '<script type="text/javascript">',
        'var c = "%%=v(@a)=%%" + Platform.x;',
        '</script><em>',
    ]);
    runExtension(window);
    assert.deepEqual(tokens(editor, 0), [
        ['meta.tag.punctuation', '<'],
        ['meta.tag.name', 'script'],
        ['meta.tag.punctuation', '>'],
        ['storage.type', 'var'],
        ['text', ' '],
        ['identifier', 'b'],
        ['text', ' '],
        ['keyword.operator', '='],
        ['text', ' '],
        ['variable.language', 'document'],
        ['punctuation.operator', '.'],
        ['identifier', 'title'],
        ['punctuation.operator', ';'],
        ['text', ' '],
        ['identifier', 'Write'],
        ['paren.lparen', '('],
        ['identifier', 'b'],
        ['paren.rparen', ')'],
        ['punctuation.operator', ';'],
        ['meta.tag.punctuation', '</'],
        ['meta.tag.name', 'script'],
        ['meta.tag.punctuation', '>'],
    ]);
    // AMPscript is filled in before the browser sees the script, also inside its strings
    assert.equal(typeOf(editor, 2, '%%='), 'meta.delimiter.ampscript');
    assert.equal(typeOf(editor, 2, 'v'), 'support.function.ampscript');
    assert.equal(typeOf(editor, 2, 'Platform'), 'identifier');
    assert.equal(typeOf(editor, 3, 'em'), 'meta.tag.name');
});

test('every token type of the sample has a colour of the theme', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    const types = new Set(SAMPLE.flatMap((line, row) => tokens(editor, row).map(([type]) => type)));
    types.delete('text');
    assert.ok(types.size > 25, [...types].join(' '));
    const rules = css
        .replaceAll(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/([^{}]+)\{/g)
        .flatMap((match) => match[1].split(','))
        .map((selector) => selector.trim().replaceAll(/\s+/g, ' '))
        // the underlines of errors and warnings are no colours of a theme
        .filter((selector) => selector.includes('.ace_') && !selector.includes('.sfmc-diagnostic'))
        .toArray();
    const scope = 'html[data-sfmc-ux-tools-theme] .ace_editor.sfmc-ux-tools-ace';
    for (const type of types) {
        // Ace renders "a.b" as class="ace_a ace_b"
        const classes = new Set(type.split('.').map((part) => `ace_${part}`));
        assert.ok(
            rules.some((selector) => {
                const [, token] = /^\S+ \S+ ((?:\.ace_[\w-]+)+)$/.exec(selector) ?? [];
                return (
                    token &&
                    token
                        .slice(1)
                        .split('.')
                        .every((name) => classes.has(name))
                );
            }),
            `no colour for ${type}`,
        );
    }
    // only editors the extension took over are themed
    assert.ok(rules.length > 40);
    for (const selector of rules) {
        assert.ok(selector.startsWith(scope), selector);
    }
});

test('editors that appear later are found, the read-only summary editor included', async (t) => {
    const window = page();
    t.after(() => window.close());
    runExtension(window);
    const editor = addEditor(window);
    const summary = addEditor(window, SAMPLE, 'summaryQueryEditor');
    summary.setReadOnly(true);
    assert.equal(editor.session.getMode().$id, PAGE_MODE);
    await pause();
    for (const found of [editor, summary]) {
        assert.equal(found.session.getMode().$id, OUR_MODE);
        assert.ok(found.container.classList.contains(TAKEN_CLASS));
        assert.equal(typeOf(found, 2, 'var'), 'storage.type');
    }
    assert.equal(summary.getReadOnly(), true);
});

test('Ace editors of other activities are left untouched, also once a script activity is opened next to them', async (t) => {
    const window = page('#ActivityModal/300/new');
    t.after(() => window.close());
    const editor = addEditor(window);
    const mode = editor.session.getMode();
    runExtension(window);
    await pause();
    assert.equal(editor.session.getMode(), mode);
    assert.equal(editor.container.className.includes('sfmc'), false);
    // an editor in another language that is still on the page keeps that language
    const { Mode: TextMode } = window.ace.require('ace/mode/text');
    const sql = new TextMode();
    sql.$id = 'ace/mode/sql';
    editor.session.setMode(sql);
    window.location.hash = SCRIPT_ROUTE;
    const script = addEditor(window);
    await pause();
    assert.equal(script.session.getMode().$id, OUR_MODE);
    assert.equal(editor.session.getMode(), sql);
    assert.ok(!editor.container.classList.contains(TAKEN_CLASS));
});

test('a plain-text editor is only taken over if it is one of the two of the dialog', async (t) => {
    const window = page();
    t.after(() => window.close());
    const add = (id) => {
        const element = window.document.createElement('div');
        element.id = id;
        window.document.body.append(element);
        return window.ace.edit(element, { mode: 'ace/mode/text' });
    };
    const elsewhere = add('notes');
    const script = add('scriptEditor');
    const summary = add('summaryQueryEditor');
    const mode = elsewhere.session.getMode();
    runExtension(window);
    await pause();
    assert.equal(elsewhere.session.getMode(), mode);
    assert.equal(elsewhere.container.className.includes('sfmc'), false);
    assert.equal(script.session.getMode().$id, OUR_MODE);
    assert.equal(summary.session.getMode().$id, OUR_MODE);
    // an editor elsewhere that the page later gives the script's language is taken over then
    elsewhere.session.setUseWorker(false);
    elsewhere.session.setMode(PAGE_MODE);
    assert.equal(elsewhere.session.getMode().$id, OUR_MODE);
});

test('the mode comes back when the page sets its own again or swaps the session, without looping', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    const ours = editor.session.getMode();
    let changes = 0;
    editor.session.on('changeMode', () => changes++);
    editor.session.setMode(PAGE_MODE);
    assert.equal(editor.session.getMode(), ours);
    assert.equal(changes, 2, 'the page set its mode, the extension set its own, and that was it');
    assert.equal(typeOf(editor, 2, 'var'), 'storage.type');

    const session = window.ace.createEditSession(SAMPLE.join('\n'), PAGE_MODE);
    session.setUseWorker(false);
    const before = editor.session;
    editor.setSession(session);
    assert.equal(editor.session.getMode(), ours);
    assert.ok(editor.container.classList.contains(TAKEN_CLASS));
    // the session that left the editor is no longer watched
    before.setMode(PAGE_MODE);
    assert.equal(before.getMode().$id, PAGE_MODE);

    // a page that insists on its mode wins; nothing goes back and forth
    session.on('changeMode', () => {
        if (session.getMode().$id !== PAGE_MODE) {
            session.setMode(PAGE_MODE);
        }
    });
    session.setMode(PAGE_MODE);
    assert.equal(session.getMode().$id, PAGE_MODE);
    assert.ok(!editor.container.classList.contains(TAKEN_CLASS));
});

test('once the dialog shows another activity, an editor that changes its mode keeps the mode of the page', (t) => {
    const window = page();
    t.after(() => window.close());
    const editor = addEditor(window);
    runExtension(window);
    assert.ok(editor.container.classList.contains(TAKEN_CLASS));
    window.location.hash = '#ActivityModal/300/new';
    editor.session.setMode(PAGE_MODE);
    assert.equal(editor.session.getMode().$id, PAGE_MODE);
    assert.ok(!editor.container.classList.contains(TAKEN_CLASS));
});

test('a page without Ace is left alone and nothing is thrown or reported', async (t) => {
    const window = page(SCRIPT_ROUTE, { hasAce: false });
    t.after(() => window.close());
    const calls = consoleCalls(window);
    assert.doesNotThrow(() => runExtension(window));
    window.document.body.append(window.document.createElement('div'));
    await pause();
    assert.deepEqual(calls, []);
});

test('an editor whose Ace cannot be used stays as the page made it, which is reported once', async (t) => {
    const broken = {
        'a require that throws': (window) => {
            window.ace.require = () => {
                throw new Error('no modules');
            };
        },
        'a module that is missing': (window) => {
            const { require: original } = window.ace;
            window.ace.require = (id) =>
                id === 'ace/mode/javascript_highlight_rules' ? undefined : original(id);
        },
        'no ace object': (window) => {
            delete window.ace;
        },
    };
    for (const [name, breakAce] of Object.entries(broken)) {
        const window = page();
        t.after(() => window.close());
        const calls = consoleCalls(window);
        const editor = addEditor(window);
        const second = addEditor(window, SAMPLE, 'summaryQueryEditor');
        const mode = editor.session.getMode();
        breakAce(window);
        assert.doesNotThrow(() => runExtension(window), name);
        window.document.body.append(window.document.createElement('div'));
        await pause();
        for (const untouched of [editor, second]) {
            assert.equal(untouched.session.getMode().$id, PAGE_MODE, name);
            assert.equal(untouched.container.className.includes('sfmc'), false, name);
        }
        assert.equal(editor.session.getMode(), mode, name);
        assert.equal(calls.length, 1, name);
    }
});

test('the manifest runs the editor scripts on Automation Studio as on Content Builder, in every frame', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const matches = ['https://*.marketingcloudapps.com/AutomationStudioFuel3/*'];
    const contentBuilder = manifest.content_scripts.filter((entry) =>
        entry.include_globs?.includes('https://content-builder.*'),
    );
    const automationStudio = manifest.content_scripts.filter(
        (entry) => JSON.stringify(entry.matches) === JSON.stringify(matches),
    );
    assert.equal(contentBuilder.length, 2);
    assert.equal(automationStudio.length, 2);
    // the same scripts and styles, in the same worlds and at the same time
    assert.deepEqual(
        automationStudio.map((entry) => ({ ...entry, matches: null, include_globs: null })),
        contentBuilder.map((entry) => ({ ...entry, matches: null, include_globs: null })),
    );
    const [main, isolated] = automationStudio;
    assert.equal(main.world, 'MAIN');
    assert.deepEqual(main.js, [
        'language-data.js',
        'editor-highlight.js',
        'editor-language.js',
        'editor-format.js',
    ]);
    assert.deepEqual(main.css, ['editor-highlight.css']);
    assert.equal(isolated.world, undefined);
    assert.ok(isolated.js.includes('editor-theme.js'));
    for (const entry of automationStudio) {
        assert.equal(entry.all_frames, true);
        assert.equal(entry.include_globs, undefined);
    }
    // no new permission: the host permission covers the app already
    assert.deepEqual(manifest.host_permissions, ['https://*.marketingcloudapps.com/*']);
    assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
});
