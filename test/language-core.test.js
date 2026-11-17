import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, checkTypes } from '../src/editor-language/core/diagnostics.js';
import { completionsAt, isTypingName } from '../src/editor-language/core/completions.js';
import { definitionAt, helpAt, hoverAt } from '../src/editor-language/core/lookup.js';
import { lineAt, offsetAt, positionAt } from '../src/editor-language/core/text.js';

// these tests use the editor-independent logic directly: no editor, no page, no bundle

/**
 * Splits a document with a `|` in it into the document and the place of that mark.
 *
 * @param {string} marked document with one `|` where the cursor is
 * @returns {[string, {line: number, character: number}]} the document without the mark, and the place
 */
function at(marked) {
    const text = marked.replace('|', '');
    return [text, positionAt(text, marked.indexOf('|'))];
}

test('core: offsets and places convert into each other, also past the end', () => {
    const text = 'ab\ncde\n\nf';
    assert.equal(offsetAt(text, { line: 0, character: 0 }), 0);
    assert.equal(offsetAt(text, { line: 1, character: 2 }), 5);
    assert.equal(offsetAt(text, { line: 2, character: 0 }), 7);
    assert.equal(offsetAt(text, { line: 3, character: 1 }), 9);
    // past the end of a line: the end of that line
    assert.equal(offsetAt(text, { line: 0, character: 99 }), 2);
    assert.equal(offsetAt(text, { line: 3, character: 99 }), 9);
    // past the end of the document: its end
    assert.equal(offsetAt(text, { line: 99, character: 0 }), 9);
    assert.equal(offsetAt('', { line: 0, character: 5 }), 0);

    assert.deepEqual(positionAt(text, 0), { line: 0, character: 0 });
    assert.deepEqual(positionAt(text, 2), { line: 0, character: 2 });
    assert.deepEqual(positionAt(text, 3), { line: 1, character: 0 });
    assert.deepEqual(positionAt(text, 7), { line: 2, character: 0 });
    assert.deepEqual(positionAt(text, 9), { line: 3, character: 1 });
    for (let offset = 0; offset <= text.length; offset++) {
        assert.equal(offsetAt(text, positionAt(text, offset)), offset);
    }

    assert.equal(lineAt(text, 0), 'ab');
    assert.equal(lineAt(text, 1), 'cde');
    assert.equal(lineAt(text, 2), '');
    assert.equal(lineAt(text, 3), 'f');
    assert.equal(lineAt(text, 4), '');
});

test('core: AMPscript completions at a place', () => {
    const found = completionsAt(...at('<p>x</p>\n%%[ set @a = Loo| ]%%'));
    assert.ok(found.items.length > 1);
    assert.ok(found.items.every((item) => item.label.toLowerCase().startsWith('loo')));
    const [lookup] = found.items;
    assert.equal(lookup.label, 'Lookup');
    assert.equal(lookup.text, 'Lookup(');
    assert.match(lookup.detail, /^Data Extension · dataObject, returnColumn/);
    assert.ok(lookup.detail.length <= 60);
    // the typed word is what is replaced
    assert.deepEqual(found.from, { line: 1, character: 13 });
    assert.deepEqual(found.to, { line: 1, character: 16 });

    // inside a word that is called already, the whole word is replaced and no bracket is added
    const called = completionsAt(...at('%%[ set @a = Loo|kup("a") ]%%'));
    assert.equal(called.items[0].text, 'Lookup');
    assert.deepEqual(called.to, { line: 0, character: 19 });

    assert.equal(completionsAt(...at('%%[ set @a = Zzzzzz| ]%%')), null);
});

test('core: SSJS completions by full path and by bare name', () => {
    const open = '<script runat="server">\nvar a = ';
    const full = completionsAt(...at(open + 'Platform.Function.Loo|\n</script>'));
    assert.equal(full.items[0].label, 'Platform.Function.Lookup');
    assert.equal(full.items[0].text, 'Platform.Function.Lookup(');
    assert.equal(full.items[0].detail, 'deName, returnField, whereFieldNames, whereFieldValues');
    assert.deepEqual(full.from, { line: 1, character: 8 });
    assert.deepEqual(full.to, { line: 1, character: 29 });

    const bare = completionsAt(...at(open + 'Look|\n</script>'));
    assert.equal(bare.items[0].label, 'Platform.Function.Lookup');
    assert.deepEqual(bare.from, { line: 1, character: 8 });
    assert.deepEqual(bare.to, { line: 1, character: 12 });

    // the plain JavaScript names follow those of Marketing Cloud; what only the browser has is left out
    const plain = completionsAt(
        ...at('<script runat="server">\nvar rowsFound = 1;\nr|\n</script>'),
    );
    const labels = plain.items.map((item) => item.label);
    assert.ok(labels.includes('rowsFound'));
    assert.ok(labels.includes('return'));
    assert.ok(labels.indexOf('Redirect') < labels.indexOf('rowsFound'));
    assert.equal(plain.items.find((item) => item.label === 'rowsFound').detail, 'in this content');
    assert.equal(completionsAt(...at('<script runat="server">\nle|\n</script>')), null);

    // nothing is known about the members of a value without TypeScript
    assert.equal(completionsAt(...at(open + 'get().Wr|\n</script>')), null);
});

test('core: plain JavaScript names in a browser script', () => {
    const found = completionsAt(...at('<script>\nconst counter = 1;\nco|\n</script>'));
    assert.deepEqual(
        found.items.map(({ label, text, detail }) => [label, text, detail]),
        [
            ['const', 'const', 'keyword'],
            ['counter', 'counter', 'in this content'],
            ['console', 'console', 'global'],
            ['continue', 'continue', 'keyword'],
        ],
    );
    assert.deepEqual(found.from, { line: 2, character: 0 });
    assert.deepEqual(found.to, { line: 2, character: 2 });
    assert.equal(completionsAt(...at('<script>\nconsole.lo|\n</script>')), null);
});

test('core: a name is being typed outside of strings and comments', () => {
    const [text, position] = at('%%[ set @a = Loo| ]%%');
    assert.equal(isTypingName(text, position, ''), true);
    assert.equal(isTypingName(text, position, 'sfmc-string'), false);
    assert.equal(isTypingName(text, { line: 0, character: 13 }, ''), false);
    // a dot only continues a name in SSJS
    const [script, dot] = at('<script runat="server">\nPlatform.|\n</script>');
    assert.equal(isTypingName(script, dot, ''), true);
    assert.equal(isTypingName(script, dot, 'comment'), false);
    assert.equal(isTypingName(...at('%%[ set @a = Platform.| ]%%'), ''), false);
});

test('core: hover for AMPscript and SSJS', () => {
    const ampscript = hoverAt(...at('<p>x</p>\n%%[ set @a = Look|up("a","b","c",1) ]%%'));
    assert.match(ampscript.contents.value, /\(function\) Lookup\(dataObject: string/);
    assert.deepEqual(ampscript.range.start, { line: 1, character: 13 });

    const ssjs = hoverAt(
        ...at(
            '<p>x</p>\n<script runat="server">\nvar a = Platform.Function.Look|up("a");\n</script>',
        ),
    );
    assert.match(ssjs.contents.value, /\(function\) Platform\.Function\.Lookup\(deName: string/);
    assert.equal(ssjs.range.start.line, 2);

    assert.equal(hoverAt(...at('<script>\nvar a| = 1;\n</script>')), null);
    assert.equal(hoverAt(...at('<p>zz|zz</p>')), null);
});

test('core: parameter help with the active parameter', () => {
    const ampscript = helpAt(...at('%%[ set @a = Lookup("a", |) ]%%'));
    assert.match(ampscript.signature.label, /^Lookup\(dataObject: string/);
    assert.equal(ampscript.active, 1);
    assert.ok(ampscript.signature.parameters.length > 1);

    const ssjs = helpAt(
        ...at(
            '<p>(</p>\n<script runat="server">\nvar a = Platform.Function.Lookup("de", "f", |);\n</script>',
        ),
    );
    assert.equal(
        ssjs.signature.label,
        'Platform.Function.Lookup(deName, returnField, whereFieldNames, whereFieldValues)',
    );
    assert.equal(ssjs.active, 2);

    // the name in front of the bracket has to be that of the signature
    assert.equal(
        helpAt(...at('<script runat="server">\nvar a = anything.Lookup("de", |);\n</script>')),
        null,
    );
    assert.equal(helpAt(...at('<p>|</p>')), null);
    assert.equal(helpAt(...at('<script>\nfetch(|)\n</script>')), null);
});

test('core: definition of a function declared in SSJS', () => {
    const script = '<script runat="server">\nfunction greet(name) { return name; }\n';
    assert.deepEqual(
        definitionAt(...at('<p>greet</p>\n' + script + 'var a = gre|et("x");\n</script>')),
        {
            line: 2,
            character: 9,
        },
    );
    // only in SSJS, and not for the member of a value
    assert.equal(definitionAt(...at('<p>gre|et</p>\n' + script + '</script>')), null);
    assert.equal(definitionAt(...at(script + 'var a = b.gre|et("x");\n</script>')), null);
    assert.equal(definitionAt(...at(script + 'var a = unkn|own("x");\n</script>')), null);
});

test('core: diagnostics for a document with AMPscript and SSJS problems', () => {
    const text =
        '%%[ set @a = Lookupp("a") ]%%\n<script runat="server">\nlet x = 1;\n</script>\n' +
        '<script>\nlet y = 2;\n</script>';
    const found = check(text);
    assert.deepEqual(
        found.map(({ source, code, range }) => [source, code, range.start]),
        [
            ['ampscript', 'sfmc/amp-no-unknown-function', { line: 0, character: 13 }],
            ['ssjs', 'sfmc/ssjs-no-unsupported-syntax', { line: 2, character: 0 }],
        ],
    );
    assert.deepEqual(check('<p>fine</p>'), []);
    // TypeScript is a script of its own, which is not there
    assert.deepEqual(checkTypes(text, found), []);
    assert.deepEqual(checkTypes('<p>fine</p>', []), []);
});
