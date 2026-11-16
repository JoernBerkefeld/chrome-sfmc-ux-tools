/*
 * SPIKE: measures the TypeScript-based SSJS language service of dist/extension/editor-typescript.js
 * outside a browser. Run `npm run build` first, then `node scripts/measure-typescript.mjs`.
 *
 * The bundle runs in a bare `vm` context, which is what it gets in a page: no Node, no file system.
 * The numbers are those of Node's V8 on this machine; a page shares its thread with Marketing Cloud.
 */
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import vm from 'node:vm';

const ITERATIONS = 20;
const BLOCKS = 88;
const bundlePath = fileURLToPath(
    new URL('../dist/extension/editor-typescript.js', import.meta.url),
);
const bundle = readFileSync(bundlePath);
const round = (milliseconds) => Math.round(milliseconds * 10) / 10;

/**
 * Builds a large document of the kind people keep in Content Builder: lookups, data extension
 * calls, functions and loops, about 1,500 lines. Its last lines are where the service is asked.
 *
 * @returns {{text: string, positions: Object.<string, {line: number, character: number}>, marker: number}} the SSJS, where to ask, and the place of a character that may change
 */
function createDocument() {
    const lines = ['Platform.Load("core", "1.1.5");', '// revision 0', 'var total = 0;'];
    const marker = lines.slice(0, 2).join('\n').length - 1;
    for (let block = 0; block < BLOCKS; block++) {
        lines.push(
            `var name${block} = Platform.Function.Lookup("Customers", "Name", "Id", ${block});`,
            `var mail${block} = Platform.Function.Lookup("Customers", "Email", "Id", ${block});`,
            `var de${block} = DataExtension.Init("Orders_${block}");`,
            `var rows${block} = de${block}.Rows.Retrieve({ Property: "Status", SimpleOperator: "equals", Value: "open" });`,
            `function handle${block}(items, label) {`,
            '    var result = [];',
            '    for (var i = 0; i < items.length; i++) {',
            '        var item = items[i];',
            '        if (item && item.Status == "open") {',
            `            result.push({ id: item.Id, name: label + " " + name${block}, mail: mail${block} });`,
            '            total = total + 1;',
            '        }',
            '    }',
            '    return result;',
            '}',
            `de${block}.Rows.Add({ Id: ${block}, Name: name${block}, Created: Platform.Function.Now() });`,
            `Write(Stringify(handle${block}(rows${block}, "order")));`,
        );
    }
    const positions = {};
    lines.push('var probe = DataExtension.Init("probe");');
    positions.hover = { line: lines.length - 1, character: 'var probe = DataExtension.In'.length };
    lines.push('var looked = Platform.Function.Lookup("a", "b", "c", "d");');
    positions.signatureHelp = {
        line: lines.length - 1,
        character: 'var looked = Platform.Function.Lookup("a", '.length,
    };
    lines.push('probe.Rows.');
    positions.completions = { line: lines.length - 1, character: 'probe.Rows.'.length };
    return { text: lines.join('\n'), positions, marker };
}

const context = vm.createContext({
    performance,
    console: { debug: () => {} },
    location: { href: 'node:measure-typescript' },
});
const parseStarted = performance.now();
const script = new vm.Script(bundle.toString('utf8'), { filename: 'editor-typescript.js' });
const evalStarted = performance.now();
script.runInContext(context);
const evalEnded = performance.now();
const service = vm.runInContext("globalThis[Symbol.for('sfmcUxTools.typescript')]", context);

const { text, positions, marker } = createDocument();
const revised = (revision) =>
    text.slice(0, marker) + String(revision % 10) + text.slice(marker + 1);

// cold: the first document and the first question
service.update(text);
const cold = service.completions(positions.completions);
// warm: one character changes before each question, as it does while someone types
let revision = 0;
const answers = {};
for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (const name of ['completions', 'hover', 'signatureHelp']) {
        service.update(revised(++revision));
        answers[name] = service[name](positions[name]);
    }
}

const summary = service.timings.summary();
const gzip = gzipSync(bundle, { level: 9 });
const lineCount = text.split('\n').length;
process.stdout.write(
    [
        `document: ${lineCount} lines, ${text.length} characters`,
        `bundle: ${bundle.length} bytes (${round(bundle.length / 1024 / 1024)} MB), gzip ${gzip.length} bytes (${round(gzip.length / 1024 / 1024)} MB)`,
        `compile (parse) ${round(evalStarted - parseStarted)} ms, run ${round(evalEnded - evalStarted)} ms; bundleEval as the bundle measured itself: ${service.timings.bundleEval} ms`,
        `answers: ${cold.items.length} members (member completion: ${cold.isMemberCompletion}), hover ${answers.hover ? 'yes' : 'no'}, signature ${answers.signatureHelp ? 'yes, parameter ' + answers.signatureHelp.activeParameter : 'no'}`,
        `calls in ms; "first" is the cold call, the other ${ITERATIONS} of each question follow a one-character change:`,
        '',
    ].join('\n'),
);
// eslint-disable-next-line no-console -- a table is what this script is for
console.table(summary);
