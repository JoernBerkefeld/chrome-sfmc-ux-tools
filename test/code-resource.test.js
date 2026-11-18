import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

// CloudPages' code resources: files of their own kind in Content Builder's code editor.
// These tests run the built extension; "npm test" builds it first (pretest)
const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const codeMirrorSources = [
    'codemirror/lib/codemirror.js',
    'codemirror/addon/hint/show-hint.js',
    'codemirror/mode/xml/xml.js',
    'codemirror/mode/javascript/javascript.js',
    'codemirror/mode/css/css.js',
    'codemirror/mode/htmlmixed/htmlmixed.js',
].map((id) => readFileSync(require.resolve(id), 'utf8'));
// in the order of the manifest
const extensionScripts = [
    'language-data.js',
    'editor-highlight.js',
    'editor-language.js',
    'editor-format.js',
].map((file) => read(`../dist/extension/${file}`));
const kindScript = read('../dist/extension/editor-file-kind.js');
const css = read('../dist/extension/editor-highlight.css');
const manifest = JSON.parse(read('../dist/extension/manifest.json'));
const BASE_MODE = 'ampScriptHtmlMixed';
const ATTRIBUTE = 'data-sfmc-ux-tools-file-kind';
const CLOUD_PAGES = 'https://cloud-pages.s7.marketingcloudapps.com';
const NOTICE = '.sfmc-notice';
// longer than the extension waits before it looks at a changed page
const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
const formatPause = () => new Promise((resolve) => setTimeout(resolve, 1000));

/**
 * Creates a page that has CodeMirror 5 the way Marketing Cloud ships it: with an
 * "ampScriptHtmlMixed" mode (here plain HTML) and without a global `CodeMirror`.
 *
 * @param {object} t test context, which closes the page
 * @param {string | null} [kind] the kind of file the page's editors show, as the isolated script notes it
 * @returns {{window: object, CodeMirror: object}} the page and its CodeMirror constructor
 */
function page(t, kind = null) {
    const { window } = new JSDOM('<!doctype html><body></body>', {
        runScripts: 'outside-only',
        pretendToBeVisual: true,
    });
    t.after(() => window.close());
    // jsdom has no layout; CodeMirror only needs these to exist
    window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    window.Range.prototype.getClientRects = () => [];
    for (const source of codeMirrorSources) {
        window.eval(source);
    }
    const CodeMirror = window.CodeMirror;
    delete window.CodeMirror;
    CodeMirror.defineMode(BASE_MODE, (config) => CodeMirror.getMode(config, 'htmlmixed'));
    if (kind) {
        window.document.documentElement.setAttribute(ATTRIBUTE, kind);
    }
    return { window, CodeMirror };
}

/**
 * Adds an editor to the page, with the cursor where the content has a "|", and runs the
 * extension.
 *
 * @param {{window: object, CodeMirror: object}} context page from `page()`
 * @param {string} content editor content; a "|" marks the cursor and is removed
 * @returns {object} CodeMirror instance
 */
function open({ window, CodeMirror }, content) {
    const offset = content.indexOf('|');
    const value = offset === -1 ? content : content.slice(0, offset) + content.slice(offset + 1);
    const editor = new CodeMirror(window.document.body, { value, mode: BASE_MODE });
    if (offset !== -1) {
        editor.setCursor(editor.posFromIndex(offset));
    }
    for (const script of extensionScripts) {
        window.eval(script);
    }
    return editor;
}

/**
 * Lists the styled tokens of an editor as "text:style".
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} tokens of all lines, unstyled text and plain AMPscript text left out
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

/**
 * The names the completion popup offers after Ctrl-Space.
 *
 * @param {object} editor CodeMirror instance
 * @returns {string[]} names; empty if nothing is offered
 */
function offered(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Ctrl-Space' in map);
    keyMap['Ctrl-Space'](editor);
    return Array.from(
        editor.state.completionActive?.data?.list ?? [],
        (entry) => entry.displayText,
    );
}

/**
 * Presses Shift-Alt-F the way CodeMirror would: through the key map the extension registered.
 *
 * @param {object} editor CodeMirror instance
 * @returns {unknown} what the key binding returned
 */
function pressFormat(editor) {
    const keyMap = editor.state.keyMaps.find((map) => 'Shift-Alt-F' in map);
    return keyMap['Shift-Alt-F'](editor);
}

/**
 * Runs the isolated script in a frame and sends the frame messages.
 *
 * @param {object} t test context, which closes the page
 * @param {boolean} [isFramed] false for a page that is no frame of another one
 * @returns {{kind: () => string | null, send: (data: unknown, origin?: string, isFromParent?: boolean) => void}} the kind the script noted, and what sends a message
 */
function frame(t, isFramed = true) {
    const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    t.after(() => window.close());
    const parent = {};
    if (isFramed) {
        Object.defineProperty(window, 'parent', { value: parent });
    }
    window.eval(kindScript);
    return {
        kind: () => window.document.documentElement.getAttribute(ATTRIBUTE),
        send: (data, origin = CLOUD_PAGES, isFromParent = true) => {
            const event = new window.MessageEvent('message', { data, origin });
            Object.defineProperty(event, 'source', { value: isFromParent ? parent : {} });
            window.dispatchEvent(event);
        },
    };
}

/**
 * The message CloudPages sets the editor frame up with.
 *
 * @param {string} name asset type
 * @returns {object} the message
 */
function setup(name) {
    return {
        instanceId: '0.1',
        type: 'HANDSHAKE',
        origin: CLOUD_PAGES,
        payload: { asset: { id: 1, assetType: { id: 240, name } } },
    };
}

test('code resource: the kind of file is read from the message that sets the editor frame up', (t) => {
    const kinds = {
        jscoderesource: 'javascript',
        csscoderesource: 'css',
        jsoncoderesource: 'json',
        xmlcoderesource: 'xml',
        rsscoderesource: 'xml',
        textcoderesource: 'text',
    };
    const { kind, send } = frame(t);
    assert.equal(kind(), null);
    for (const [name, expected] of Object.entries(kinds)) {
        send(setup(name));
        assert.equal(kind(), expected, name);
    }
    // content that is no code resource has no kind
    send(setup('landingpage'));
    assert.equal(kind(), null);
});

test('code resource: other messages, senders and pages are not listened to', (t) => {
    const { kind, send } = frame(t);
    const others = {
        'another message': { ...setup('jscoderesource'), type: 'getContent' },
        'no asset': { type: 'HANDSHAKE', payload: { provider: 'cloudpages' } },
        'a text': JSON.stringify(setup('jscoderesource')),
        nothing: null,
    };
    for (const [name, data] of Object.entries(others)) {
        send(data);
        assert.equal(kind(), null, name);
    }
    send(setup('jscoderesource'), 'https://cloud-pages.marketingcloudapps.com.example.org');
    // eslint-disable-next-line unicorn/prefer-https -- an address without encryption is what is refused here
    send(setup('jscoderesource'), 'http://cloud-pages.s7.marketingcloudapps.com');
    send(setup('jscoderesource'), 'null');
    assert.equal(kind(), null, 'not one of Marketing Cloud apps');
    send(setup('jscoderesource'), CLOUD_PAGES, false);
    assert.equal(kind(), null, 'not from the page around the frame');
    send(setup('jscoderesource'));
    assert.equal(kind(), 'javascript');
    // a message without an asset type leaves what is known
    send({ type: 'HANDSHAKE', payload: {} });
    assert.equal(kind(), 'javascript');

    const top = frame(t, false);
    top.send(setup('jscoderesource'));
    assert.equal(top.kind(), null, 'a page that is no frame');

    const scripts = manifest.content_scripts.filter((entry) =>
        entry.js.includes('editor-file-kind.js'),
    );
    assert.equal(scripts.length, 1);
    assert.deepEqual(scripts[0].include_globs, ['https://content-builder.*']);
    assert.equal(scripts[0].world, undefined, 'isolated from the page');
    assert.equal(scripts[0].run_at, 'document_start');
});

test('code resource: a JavaScript file has the colours of JavaScript, and its AMPscript and SSJS keep theirs', (t) => {
    const editor = open(
        page(t, 'javascript'),
        'var a = "x"; // note\n%%[ set @b = 1 ]%%\n<script runat="server">Platform.Load("core", "1");</script>',
    );
    const tokens = styled(editor);
    for (const token of [
        'var:keyword',
        'a:def',
        '"x":string',
        '// note:comment',
        '%%[:sfmc-delimiter',
        'set:sfmc-keyword',
        '@b:sfmc-variable',
        '1:sfmc-number',
        ']%%:sfmc-delimiter',
        'Platform:sfmc-ssjs-object',
    ]) {
        assert.ok(tokens.includes(token), `${token} in ${tokens.join(' | ')}`);
    }
    assert.equal(editor.getOption('mode'), BASE_MODE, 'the editor keeps the name of its mode');
});

test('code resource: CSS, JSON and XML files have their own colours, and content without a kind stays HTML', (t) => {
    const cssTokens = styled(open(page(t, 'css'), 'a.b { color: red; }'));
    assert.ok(cssTokens.includes('color:property'), cssTokens.join(' | '));
    assert.ok(cssTokens.includes('a:tag'), cssTokens.join(' | '));

    const jsonTokens = styled(open(page(t, 'json'), '{ "a": true, "b": "%%=v(@c)=%%" }'));
    assert.ok(jsonTokens.includes('"a":string property'), jsonTokens.join(' | '));
    assert.ok(jsonTokens.includes('true:atom'), jsonTokens.join(' | '));
    assert.ok(jsonTokens.includes('@c:sfmc-variable'), jsonTokens.join(' | '));

    const xmlTokens = styled(open(page(t, 'xml'), '<rss version="2.0"></rss>'));
    assert.ok(xmlTokens.includes('rss:tag'), xmlTokens.join(' | '));

    const textTokens = styled(open(page(t, 'text'), 'var a = 1; %%first%%'));
    assert.deepEqual(textTokens, ['%%first%%:sfmc-personalization']);

    const html = styled(open(page(t), 'var a = "x";<b></b>'));
    assert.ok(html.includes('b:tag'));
    assert.ok(!html.includes('var:keyword'), 'HTML, as before');
});

test('code resource: an open editor is coloured anew when its kind of file becomes known', async (t) => {
    const context = page(t);
    const editor = open(context, 'var a = 1;');
    assert.deepEqual(styled(editor), []);
    context.window.document.documentElement.setAttribute(ATTRIBUTE, 'javascript');
    await pause();
    assert.ok(styled(editor).includes('var:keyword'));
    context.window.document.documentElement.removeAttribute(ATTRIBUTE);
    await pause();
    assert.deepEqual(styled(editor), []);
});

test('code resource: a JavaScript file is completed like a browser script, its server-side script like SSJS', (t) => {
    const names = offered(
        open(page(t, 'javascript'), 'var totalRows = 1;\nfunction render() {}\nto|'),
    );
    assert.ok(names.includes('totalRows'), names.join(' '));
    assert.ok(
        names.every((name) => !name.startsWith('Platform')),
        'no server-side names',
    );
    const globals = offered(open(page(t, 'javascript'), 'doc|'));
    assert.ok(globals.includes('document'));

    const server = offered(
        open(
            page(t, 'javascript'),
            'var totalRows = 1;\n<script runat="server">\nvar inServer = 1;\nPlat|\n</script>',
        ),
    );
    assert.deepEqual(server.slice(0, 1), ['Platform']);
    // the names of the server-side script are none of the browser's, and neither are its tags
    const browser = offered(
        open(
            page(t, 'javascript'),
            'var totalRows = 1;\n<script runat="server">\nvar inServer = 1;\n</script>\n|',
        ),
    );
    assert.ok(browser.includes('totalRows'));
    for (const name of ['inServer', 'script', 'runat', 'server']) {
        assert.ok(!browser.includes(name), name);
    }
    // AMPscript inside the file stays AMPscript
    const ampscript = offered(open(page(t, 'javascript'), 'var a = 1;\n%%[ set @b = Loo| ]%%'));
    assert.ok(ampscript.includes('Lookup'));
    // and content without a kind offers nothing for plain text, as before
    const plain = offered(open(page(t), 'var totalRows = 1;\nto|'));
    assert.deepEqual(plain, []);
});

test('code resource: JavaScript, CSS and JSON files are formatted as what they are', async (t) => {
    const cases = {
        javascript: ['var a=1;if(a){b(a)}', 'var a = 1;\nif (a) {\n    b(a);\n}\n'],
        css: ['a{color:red;margin:0}', 'a {\n    color: red;\n    margin: 0;\n}\n'],
        json: ['{"a":[1,2],"b":{"c":null}}', '{ "a": [1, 2], "b": { "c": null } }\n'],
    };
    const editors = Object.entries(cases).map(([kind, [messy, tidy]]) => {
        const context = page(t, kind);
        const editor = open(context, messy);
        assert.equal(pressFormat(editor), undefined, kind);
        return { kind, context, editor, tidy };
    });
    // a code resource that is one server-side script is read like the content of Content Builder
    const serverContext = page(t, 'json');
    const server = open(
        serverContext,
        '<script runat="server">\nvar a=Stringify({a:1});Write(a)\n</script>',
    );
    pressFormat(server);
    await formatPause();
    for (const { kind, context, editor, tidy } of editors) {
        assert.equal(editor.getValue(), tidy, kind);
        assert.equal(context.window.document.querySelector(NOTICE), null, kind);
    }
    assert.equal(
        server.getValue(),
        '<script runat="server">\n    var a = Stringify({ a: 1 });\n    Write(a);\n</script>',
    );
    assert.equal(serverContext.window.document.querySelector(NOTICE), null);
});

test('code resource: a file that mixes its own code with AMPscript or a server-side script is not formatted', async (t) => {
    const mixed = {
        'AMPscript block in JavaScript': ['javascript', 'var a=1;\n%%[ set @b=1 ]%%'],
        'AMPscript expression in CSS': ['css', 'a{color:%%=v(@colour)=%%}'],
        'server-side script after JSON': [
            'json',
            '{"a":1}\n<script language="javascript" runat=server>Write(1)</script>',
        ],
        'its own code between two server-side scripts': [
            'javascript',
            '<script runat="server">\nvar a = 1;\n</script>\n// keep this comment\nvar x = 1;\nif (x < 2 && y > 1) { go(); }\n<script runat="server">\nWrite(a);\n</script>',
        ],
        'its own code after many server-side scripts': [
            'javascript',
            '<script runat="server">Write(1)</script>\n'.repeat(40) + 'var x=1',
        ],
        'server-side script in upper case': [
            'javascript',
            'var a=1;\n<SCRIPT RUNAT="SERVER">Write(1)</SCRIPT>',
        ],
    };
    const opened = Object.entries(mixed).map(([name, [kind, content]]) => {
        const context = page(t, kind);
        const editor = open(context, content);
        pressFormat(editor);
        return { name, context, editor, content };
    });
    // server-side scripts alone are formatted, whatever the order of their attributes
    const server = open(
        page(t, 'javascript'),
        '\n<script language="javascript" runat=server>\nvar a=1\n</script>\n<SCRIPT RUNAT="SERVER">\nWrite(a)\n</SCRIPT>\n',
    );
    pressFormat(server);
    // a personalisation string is no code of the server's
    const personal = open(page(t, 'javascript'), 'var a="%%emailaddr%%";b(a)');
    pressFormat(personal);
    await formatPause();
    for (const { name, context, editor, content } of opened) {
        assert.equal(editor.getValue(), content, name);
        assert.match(
            context.window.document.querySelector(NOTICE).textContent,
            /^Not formatted: this file mixes/,
            name,
        );
    }
    assert.match(
        server.getValue(),
        /^<script language="javascript" runat="server">\n {4}var a = 1;/,
    );
    assert.match(server.getValue(), /\n {4}Write\(a\);\n<\/script>\n?$/i);
    assert.equal(personal.getValue(), "var a = '%%emailaddr%%';\nb(a);\n");
});

test('code resource: XML and text files are not formatted and have no format button', async (t) => {
    for (const kind of ['xml', 'text']) {
        const context = page(t, kind);
        const editor = open(context, '<a><b>x</b></a>   <c/>');
        const { Pass } = context.CodeMirror;
        assert.equal(pressFormat(editor), Pass, kind);
        context.window.document.querySelector('.sfmc-format-button').click();

        await formatPause();
        assert.equal(editor.getValue(), '<a><b>x</b></a>   <c/>', kind);
        assert.ok(
            css.includes(`html[data-sfmc-ux-tools-file-kind='${kind}'] .sfmc-format-button`),
            kind,
        );
    }
});
