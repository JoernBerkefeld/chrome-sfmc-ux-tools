import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderLanguageData } from '../scripts/generate-language-data.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const codeMirrorSources = [
    'codemirror/lib/codemirror.js',
    'codemirror/mode/xml/xml.js',
    'codemirror/mode/javascript/javascript.js',
    'codemirror/mode/css/css.js',
    'codemirror/mode/htmlmixed/htmlmixed.js',
].map((id) => readFileSync(require.resolve(id), 'utf8'));
const dataScript = read('../src/language-data.js');
const highlightScript = read('../src/editor-highlight.js');
const BASE_MODE = 'ampScriptHtmlMixed';

/**
 * Creates a page that has CodeMirror 5 the way Marketing Cloud ships it: with an
 * "ampScriptHtmlMixed" mode (here plain HTML) and without a global `CodeMirror`.
 *
 * @returns {{window: object, CodeMirror: object}} the page and its CodeMirror constructor
 */
function page() {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    for (const source of codeMirrorSources) {
        window.eval(source);
    }
    const CodeMirror = window.CodeMirror;
    delete window.CodeMirror;
    CodeMirror.defineMode(BASE_MODE, (config) => CodeMirror.getMode(config, 'htmlmixed'));
    return { window, CodeMirror };
}

/**
 * Adds an editor to the page.
 *
 * @param {{window: object, CodeMirror: object}} context page from `page()`
 * @param {string} value editor content
 * @param {string} [mode] mode option
 * @returns {object} CodeMirror instance
 */
function addEditor({ window, CodeMirror }, value, mode = BASE_MODE) {
    return new CodeMirror(window.document.body, { value, mode });
}

/**
 * Runs the extension's scripts in the page.
 *
 * @param {object} window page window
 */
function runExtension(window) {
    window.eval(dataScript);
    window.eval(highlightScript);
}

/**
 * Lists the styled tokens of an editor as "text:style". Plain AMPscript text (sfmc-text) is left out.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} tokens of all lines, unstyled text left out
 */
function styled(editor) {
    const result = [];
    for (let line = 0; line < editor.lineCount(); line++) {
        let previous;
        for (const token of editor.getLineTokens(line, true)) {
            if (!token.type || token.type === 'sfmc-text') {
                continue;
            }
            // the base mode may split what is one token to us; show such pieces as one
            const isContinuation =
                token.type.startsWith('sfmc-') &&
                previous?.type === token.type &&
                previous.end === token.start;
            const text = isContinuation
                ? result.pop().split(':sfmc-', 1)[0] + token.string
                : token.string;
            result.push(`${text}:${token.type}`);
            previous = token;
        }
    }
    return result;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 80));

test('colours an AMPscript block inside HTML and keeps the HTML colours', () => {
    const context = page();
    const editor = addEditor(context, `<b>%%[ SET @name = Concat('a', 12) ]%%</b>`);
    runExtension(context.window);
    assert.deepEqual(styled(editor), [
        '<:tag bracket',
        'b:tag',
        '>:tag bracket',
        '%%[:sfmc-delimiter',
        'SET:sfmc-keyword',
        '@name:sfmc-variable',
        '=:sfmc-operator',
        'Concat:sfmc-function',
        "'a':sfmc-string",
        '12:sfmc-number',
        ']%%:sfmc-delimiter',
        '</:tag bracket',
        'b:tag',
        '>:tag bracket',
    ]);
});

test('recognises keywords in any letter case', () => {
    const context = page();
    const editor = addEditor(context, '%%[ IF @a THEN Set @b = 1 EndIf ]%%');
    runExtension(context.window);
    const keywords = styled(editor).filter((token) => token.endsWith(':sfmc-keyword'));
    assert.deepEqual(keywords, [
        'IF:sfmc-keyword',
        'THEN:sfmc-keyword',
        'Set:sfmc-keyword',
        'EndIf:sfmc-keyword',
    ]);
});

test('colours inline expressions, also inside an HTML attribute', () => {
    const context = page();
    const editor = addEditor(context, '<a href="%%=RedirectTo(@url)=%%">x</a> %%=v(@@count)=%%');
    runExtension(context.window);
    const tokens = styled(editor);
    for (const expected of [
        '%%=:sfmc-delimiter',
        'RedirectTo:sfmc-function',
        '@url:sfmc-variable',
        '=%%:sfmc-delimiter',
        'v:sfmc-function',
        '@@count:sfmc-variable',
    ]) {
        assert.ok(tokens.includes(expected), `${expected} missing in ${tokens.join(' | ')}`);
    }
    assert.ok(tokens.includes('a:tag'));
});

test('keeps comments, strings and blocks open across lines', () => {
    const context = page();
    const editor = addEditor(
        context,
        ['%%[ /* note', 'set @x */ var @y', '', 'set @y = "two', 'lines" ]%%', 'set @z'].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(styled(editor), [
        '%%[:sfmc-delimiter',
        '/* note:sfmc-comment',
        'set @x */:sfmc-comment',
        'var:sfmc-keyword',
        '@y:sfmc-variable',
        'set:sfmc-keyword',
        '@y:sfmc-variable',
        '=:sfmc-operator',
        '"two:sfmc-string',
        'lines":sfmc-string',
        ']%%:sfmc-delimiter',
    ]);
});

test('HTML colours never show through AMPscript code', () => {
    const context = page();
    const inline = '%%=Concat(@a, foo)=%%';
    const block = '%%[ if @a < @b then set @c = name endif <!-- x --> ]%%';
    const editor = addEditor(context, `<a href="${inline}">x</a>\n${block}`);
    runExtension(context.window);
    const inlineStart = '<a href="'.length;
    const types = [
        ...editor
            .getLineTokens(0, true)
            .filter(
                (token) => token.start >= inlineStart && token.end <= inlineStart + inline.length,
            ),
        ...editor.getLineTokens(1, true),
    ].map((token) => token.type);
    assert.ok(types.length > 20);
    for (const type of types) {
        assert.match(String(type), /^sfmc-/);
    }
});

test('colours AMPscript inside server-side script tags', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server" language="ampscript">',
            'SET @a = Lookup("de", "f", "k", 1) /* note',
            'more */ var @b',
            '</script><b>',
            "<SCRIPT Language=AMPscript RunAt='server'>set @c = 2</SCRIPT>",
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(styled(editor), [
        '<:tag bracket',
        'script:tag',
        'runat:attribute',
        '"server":string',
        'language:attribute',
        '"ampscript":string',
        '>:tag bracket',
        'SET:sfmc-keyword',
        '@a:sfmc-variable',
        '=:sfmc-operator',
        'Lookup:sfmc-function',
        '"de":sfmc-string',
        '"f":sfmc-string',
        '"k":sfmc-string',
        '1:sfmc-number',
        '/* note:sfmc-comment',
        'more */:sfmc-comment',
        'var:sfmc-keyword',
        '@b:sfmc-variable',
        '</:tag bracket',
        'script:tag',
        '>:tag bracket',
        '<:tag bracket',
        'b:tag',
        '>:tag bracket',
        '<:tag bracket',
        'SCRIPT:tag',
        'Language:attribute',
        'AMPscript:string',
        'RunAt:attribute',
        "'server':string",
        '>:tag bracket',
        'set:sfmc-keyword',
        '@c:sfmc-variable',
        '=:sfmc-operator',
        '2:sfmc-number',
        '</:tag bracket',
        'SCRIPT:tag',
        '>:tag bracket',
    ]);
});

test('a script tag ends its AMPscript even inside an open comment or string', () => {
    const context = page();
    const open = '<script language="ampscript" runat="server">';
    const editor = addEditor(
        context,
        `${open}set @a /* open</script><i>set</i>\n${open}set @b = "open</script><i>set</i>`,
    );
    runExtension(context.window);
    const afterScript = [
        '</:tag bracket',
        'script:tag',
        '>:tag bracket',
        '<:tag bracket',
        'i:tag',
        '>:tag bracket',
        '</:tag bracket',
        'i:tag',
        '>:tag bracket',
    ];
    const tokens = styled(editor);
    const firstLine = tokens.slice(0, tokens.length / 2);
    assert.deepEqual(firstLine.slice(-10), ['/* open:sfmc-comment', ...afterScript]);
    assert.deepEqual(tokens.slice(-10), ['"open:sfmc-string', ...afterScript]);
});

test('leaves scripts that run in the browser alone', () => {
    const context = page();
    const editor = addEditor(
        context,
        '<script>var set = 1; Platform.Load("core", "1");</script>\n<script language="ampscript">var set = 2;</script>',
    );
    runExtension(context.window);
    const tokens = styled(editor);
    assert.equal(tokens.filter((token) => token.includes(':sfmc-')).length, 0);
    assert.equal(tokens.filter((token) => token === 'var:keyword').length, 2);
});

test('adds Marketing Cloud colours to server-side JavaScript and keeps the JavaScript colours', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server">',
            'Platform.Load("core", "1.1.5");',
            'var de = DataExtension.Init("x"), n = 5;',
            'var v = Platform.Function.Lookup("de", "f", "k", n);',
            'Write(Stringify(v)); Variable.SetValue("@v", HTTP.Get("u")); Recipient.x();',
            '</script>',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        [
            'Platform:sfmc-ssjs-object',
            'DataExtension:sfmc-ssjs-object',
            'Platform:sfmc-ssjs-object',
            'Lookup:sfmc-ssjs-function',
            'Write:sfmc-ssjs-function',
            'Stringify:sfmc-ssjs-function',
            'Variable:sfmc-ssjs-object',
            'HTTP:sfmc-ssjs-object',
        ],
    );
    const tokens = styled(editor);
    for (const expected of ['var:keyword', 'de:def', 'core":string', '5:number', 'Load:property']) {
        assert.ok(tokens.includes(expected), expected + ' missing in ' + tokens.join(' | '));
    }
});

test('does not colour SSJS names in strings, comments, member positions or plain JavaScript built-ins', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server" language="javascript">',
            String.raw`var a = "Platform \" Variable"; // Platform Write(`,
            "var b = 'DataExtension'; /* Request",
            'Subscriber */ foo.Platform.Lookup(); my.Function.Nope();',
            'var Write = 1; new Error(String(a)); Lookup(1);',
            '</script>',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        [],
    );
});

test('SSJS object names are only coloured in front of a dot', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server">',
            'var o = { Email: { ID: 1 }, List: [], Send: 1 }; var Folder = o ? Email : List;',
            'function Write() {} DataExtension .Init("x");',
            '</script>',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        ['DataExtension:sfmc-ssjs-object'],
    );
});

test('SSJS regular expressions do not hide the code after them', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server">',
            String.raw`var a = s.replace(/\/*$/, ""); Platform.Load("core", "1");`,
            'if (/["\']/.test(a)) { Variable.SetValue("@a", a / 2 / 1); }',
            'var b = a / 2; /* Platform */ HTTP.Get(a);',
            '</script>',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        ['Platform:sfmc-ssjs-object', 'Variable:sfmc-ssjs-object', 'HTTP:sfmc-ssjs-object'],
    );
});

test('personalisation strings are coloured inside SSJS, also within strings', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<script runat="server">',
            'var e = "%%emailaddr%%"; var f = \'Hi %%First Name%%, 50%% off\'; Platform.Load("core", "1");',
            'var g = "open %%jobid%%',
            'Variable.SetValue("@a", %%memberid%%);',
            '</script>',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        [
            '%%emailaddr%%:sfmc-personalization',
            '%%First Name%%:sfmc-personalization',
            'Platform:sfmc-ssjs-object',
            '%%jobid%%:sfmc-personalization',
            'Variable:sfmc-ssjs-object',
            '%%memberid%%:sfmc-personalization',
        ],
    );
});

test('doubled percent signs in text are not a personalisation string', () => {
    const context = page();
    const editor = addEditor(context, '50%% off and then %%=v(@a)=%% and 20%% more');
    runExtension(context.window);
    assert.deepEqual(styled(editor), [
        '%%=:sfmc-delimiter',
        'v:sfmc-function',
        '@a:sfmc-variable',
        '=%%:sfmc-delimiter',
    ]);
});

test('percent signs next to quotes or tags are not a personalisation string', () => {
    const context = page();
    const editor = addEditor(context, '<td width="100%%">%%=v(@a)=%%</td>');
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        ['%%=:sfmc-delimiter', 'v:sfmc-function', '@a:sfmc-variable', '=%%:sfmc-delimiter'],
    );
});

test('an inline expression that is never closed ends at a script tag or a blank-looking line', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '50%%= off',
            '<script runat="server">Platform.Load("core", "1");</script>',
            '20%%= off',
            ' '.repeat(3),
            'set @b <b>',
        ].join('\n'),
    );
    runExtension(context.window);
    const tokens = styled(editor);
    assert.ok(tokens.includes('Platform:sfmc-ssjs-object'), tokens.join(' | '));
    assert.ok(tokens.includes('script:tag'));
    assert.deepEqual(tokens.slice(-4), [
        '%%=:sfmc-delimiter',
        '<:tag bracket',
        'b:tag',
        '>:tag bracket',
    ]);
});

test('refreshes open editors that use the mode through a MIME type', () => {
    const context = page();
    context.CodeMirror.defineMIME('text/x-ampscript-html', BASE_MODE);
    const editor = addEditor(context, '%%[ set @a = 1 ]%%', 'text/x-ampscript-html');
    runExtension(context.window);
    assert.ok(styled(editor).includes('set:sfmc-keyword'));
    assert.equal(editor.getOption('mode'), 'text/x-ampscript-html');
});

test('SSJS ends at the closing script tag even inside an open string or comment', () => {
    const context = page();
    const open = '<script runat="server">';
    const editor = addEditor(
        context,
        [
            open + 'var a = "open</script><p>Platform Email List</p>',
            open + '/* open</script><p>Platform Email List</p>',
            open + '// Platform</script><p>Platform Email List</p>%%=v(@a)=%%',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        ['%%=:sfmc-delimiter', 'v:sfmc-function', '@a:sfmc-variable', '=%%:sfmc-delimiter'],
    );
});

test('colours personalisation strings and leaves plain text alone', () => {
    const context = page();
    const editor = addEditor(context, 'Hello %%firstname%%, set 100% var');
    runExtension(context.window);
    assert.deepEqual(styled(editor), ['%%firstname%%:sfmc-personalization']);
});

test('the end of a personalisation string never opens AMPscript', () => {
    const context = page();
    const editor = addEditor(
        context,
        [
            '<a href="x?e=%%emailaddr%%=1&k=%%_subscriberkey%%">go</a>',
            '<td>%%First Name%%[x] set @a</td>',
            '<i>%%MSG(0).NOUN(2)%%=1 %%microsite_base_url[default]1[/default]%%[x]</i>',
            '%%=v(@a)=%%%%=v(@b)=%% %%[ set @c = 1 ]%%',
        ].join('\n'),
    );
    runExtension(context.window);
    assert.deepEqual(
        styled(editor).filter((token) => token.includes(':sfmc-')),
        [
            '%%emailaddr%%:sfmc-personalization',
            '%%_subscriberkey%%:sfmc-personalization',
            '%%First Name%%:sfmc-personalization',
            '%%MSG(0).NOUN(2)%%:sfmc-personalization',
            '%%microsite_base_url[default]1[/default]%%:sfmc-personalization',
            '%%=:sfmc-delimiter',
            'v:sfmc-function',
            '@a:sfmc-variable',
            // two expressions back to back: the helper shows the touching delimiters as one
            '=%%%%=:sfmc-delimiter',
            'v:sfmc-function',
            '@b:sfmc-variable',
            '=%%:sfmc-delimiter',
            '%%[:sfmc-delimiter',
            'set:sfmc-keyword',
            '@c:sfmc-variable',
            '=:sfmc-operator',
            '1:sfmc-number',
            ']%%:sfmc-delimiter',
        ],
    );
});

test('does not change the content, the mode name or the clean state', () => {
    const context = page();
    const value = '<p>%%[ set @a = 1 ]%%</p>';
    const editor = addEditor(context, value);
    runExtension(context.window);
    assert.equal(editor.getValue(), value);
    assert.equal(editor.getOption('mode'), BASE_MODE);
    assert.equal(editor.isClean(), true);
});

test('colours editors that are opened or switched to the mode later', async () => {
    const context = page();
    runExtension(context.window);
    const late = addEditor(context, '%%[ set @a = 1 ]%%', 'htmlmixed');
    await tick();
    assert.deepEqual(styled(late), []);
    const first = addEditor(context, '%%[ set @a = 1 ]%%');
    await tick();
    assert.ok(styled(first).includes('set:sfmc-keyword'));
    late.setOption('mode', BASE_MODE);
    assert.ok(styled(late).includes('set:sfmc-keyword'));
    const swapped = addEditor(context, '', 'htmlmixed');
    swapped.swapDoc(new context.CodeMirror.Doc('%%=v(@a)=%%', BASE_MODE));
    assert.ok(styled(swapped).includes('v:sfmc-function'));
});

test('keeps colouring after the page registers its mode again', async () => {
    const context = page();
    const first = addEditor(context, '%%[ set @a = 1 ]%%');
    runExtension(context.window);
    context.CodeMirror.defineMode(BASE_MODE, (config) =>
        context.CodeMirror.getMode(config, 'htmlmixed'),
    );
    const second = addEditor(context, '%%[ set @b = 2 ]%%');
    assert.deepEqual(styled(second), []);
    await tick();
    assert.ok(styled(second).includes('set:sfmc-keyword'));
    assert.ok(styled(first).includes('set:sfmc-keyword'));
});

test('re-colours correctly after an edit inside a multi-line comment', () => {
    const context = page();
    const editor = addEditor(context, '%%[ /* one\ntwo\nthree */ set @a = 1 ]%%');
    runExtension(context.window);
    editor.replaceRange(' */ var @x /* ', { line: 1, ch: 3 });
    assert.deepEqual(styled(editor), [
        '%%[:sfmc-delimiter',
        '/* one:sfmc-comment',
        'two */:sfmc-comment',
        'var:sfmc-keyword',
        '@x:sfmc-variable',
        '/* :sfmc-comment',
        'three */:sfmc-comment',
        'set:sfmc-keyword',
        '@a:sfmc-variable',
        '=:sfmc-operator',
        '1:sfmc-number',
        ']%%:sfmc-delimiter',
    ]);
});

test('an inline expression that is never closed ends at the next block or empty line', () => {
    const context = page();
    const editor = addEditor(context, '100%%= off\n%%[ set @a = 1 ]%%\n50%%= off\n\nset @b <b>');
    runExtension(context.window);
    assert.deepEqual(styled(editor), [
        '%%=:sfmc-delimiter',
        '%%[:sfmc-delimiter',
        'set:sfmc-keyword',
        '@a:sfmc-variable',
        '=:sfmc-operator',
        '1:sfmc-number',
        ']%%:sfmc-delimiter',
        '%%=:sfmc-delimiter',
        '<:tag bracket',
        'b:tag',
        '>:tag bracket',
    ]);
});

test('does not leave its language data on the page', () => {
    const context = page();
    runExtension(context.window);
    assert.equal(context.window.sfmcUxToolsLanguageData, undefined);
});

test('the manifest runs the editor scripts in the page world, language data first', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((script) =>
        script.js.includes('editor-highlight.js'),
    );
    assert.equal(entry.world, 'MAIN');
    assert.equal(entry.all_frames, true);
    // the language features come last and in files of their own, so that they can never break the colouring
    assert.deepEqual(entry.js, [
        'language-data.js',
        'editor-highlight.js',
        'editor-language.js',
        'editor-format.js',
    ]);
    assert.deepEqual(entry.css, ['editor-highlight.css']);
    assert.deepEqual(entry.matches, ['https://*.marketingcloudapps.com/*']);
    // a match pattern cannot express "content-builder.<stack>", so a glob narrows it to that app
    assert.deepEqual(entry.include_globs, ['https://content-builder.*']);
    // 111 for scripts in the page world, 122 for the iterator helpers the scripts use
    assert.equal(manifest.minimum_chrome_version, '122');
});

test('two copies of the extension in one page do not wrap each other', async () => {
    const context = page();
    const editor = addEditor(context, '%%[ set @a = 1 ]%%');
    runExtension(context.window);
    runExtension(context.window);
    for (let round = 0; round < 3; round++) {
        context.window.document.body.append(context.window.document.createElement('i'));
        await tick();
    }
    const state = editor.getStateAfter(0, true);
    assert.ok(state.ampscript, 'the mode is wrapped');
    assert.equal(state.base.ampscript, undefined, 'the mode is wrapped only once');
    assert.ok(styled(editor).includes('set:sfmc-keyword'));
});

test('leaves editors with other modes untouched', () => {
    const context = page();
    const other = addEditor(context, '%%[ set @a = 1 ]%%', 'htmlmixed');
    addEditor(context, '');
    runExtension(context.window);
    assert.deepEqual(styled(other), []);
    assert.equal(other.getOption('mode'), 'htmlmixed');
});

test('does nothing on pages without a matching editor', () => {
    const context = page();
    context.window.document.body.innerHTML = '<div class="CodeMirror"></div>';
    assert.doesNotThrow(() => runExtension(context.window));
});

test('falls back to the plain base colours if the AMPscript tokenizer breaks', () => {
    const context = page();
    const editor = addEditor(context, '<b>%%[ set @a = 1\nset @b = 2 ]%%</b>');
    context.window.eval(dataScript);
    // a keyword lookup that throws stands in for any unexpected tokenizer failure
    context.window.eval('Set.prototype.has = () => { throw new Error("broken"); };');
    context.window.eval(highlightScript);
    const tokens = styled(editor);
    assert.deepEqual(tokens, [
        '<:tag bracket',
        'b:tag',
        '>:tag bracket',
        '</:tag bracket',
        'b:tag',
        '>:tag bracket',
    ]);
});

test('the generated language data is up to date with ampscript-data and ssjs-data', () => {
    assert.equal(dataScript.replaceAll('\r\n', '\n'), renderLanguageData());
});
