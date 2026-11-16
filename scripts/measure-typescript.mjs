/*
 * Developer script: measures the TypeScript script of the extension, dist/extension/editor-typescript.js,
 * outside a browser. Run `npm run build` first, then `node scripts/measure-typescript.mjs`.
 *
 * The script runs in a bare `vm` context, which is what it gets in a page: no Node, no file system.
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
// durations by name of the call, in milliseconds, in the order of the calls
const durations = {};

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
    positions.definition = { line: lines.length, character: 'var looked = pro'.length };
    lines.push(
        'var looked = probe.Rows.Lookup(["a"], ["b"]);',
        'var found = Platform.Function.Lookup("a", "b", "c", "d");',
    );
    positions.signatureHelp = {
        line: lines.length - 1,
        character: 'var found = Platform.Function.Lookup("a", '.length,
    };
    lines.push('probe.Rows.');
    positions.completions = { line: lines.length - 1, character: 'probe.Rows.'.length };
    return { text: lines.join('\n'), positions, marker };
}

/**
 * Runs a call of the service and notes how long it took.
 *
 * @template T
 * @param {string} name name of the call
 * @param {() => T} run the call
 * @returns {T} what the call returned
 */
function timed(name, run) {
    const started = performance.now();
    try {
        return run();
    } finally {
        (durations[name] ??= []).push(performance.now() - started);
    }
}

/**
 * Sums up the calls of one name.
 *
 * @param {number[]} list durations in the order of the calls
 * @returns {{count: number, first: number, median: number, max: number}} milliseconds
 */
function summary(list) {
    const sorted = list.toSorted((a, b) => a - b);
    const middle = sorted.length / 2;
    const median =
        sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {
        count: list.length,
        first: round(list[0]),
        median: round(median),
        max: round(sorted.at(-1)),
    };
}

// what the script uses of a page: it tells the document that it is ready
const context = vm.createContext({
    document: { dispatchEvent: () => true },
    CustomEvent: class CustomEvent {},
});
const parseStarted = performance.now();
const script = new vm.Script(bundle.toString('utf8'), { filename: 'editor-typescript.js' });
const runStarted = performance.now();
script.runInContext(context);
const runEnded = performance.now();
const service = vm.runInContext("globalThis[Symbol.for('sfmcUxTools.typescript')]", context);

const { text, positions, marker } = createDocument();
const revised = (revision) =>
    text.slice(0, marker) + String(revision % 10) + text.slice(marker + 1);
const QUESTIONS = ['completions', 'hover', 'signatureHelp', 'definition'];

// cold: the first document and the first question
timed('update', () => service.update(text));
const cold = timed('completions', () => service.completions(positions.completions));
// warm: one character changes before each question, as it does while someone types
let revision = 0;
const answers = {};
for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    for (const name of QUESTIONS) {
        const changed = revised(++revision);
        timed('update', () => service.update(changed));
        answers[name] = timed(name, () => service[name](positions[name]));
    }
    const changed = revised(++revision);
    timed('update', () => service.update(changed));
    answers.diagnostics = timed('diagnostics', () => service.diagnostics());
}

const gzip = gzipSync(bundle, { level: 9 });
const lineCount = text.split('\n').length;
const megabytes = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100;
process.stdout.write(
    [
        `document: ${lineCount} lines, ${text.length} characters`,
        `bundle: ${bundle.length} bytes (${megabytes(bundle.length)} MB), gzip ${gzip.length} bytes (${megabytes(gzip.length)} MB)`,
        `compile (parse) ${round(runStarted - parseStarted)} ms, run ${round(runEnded - runStarted)} ms`,
        `answers: ${cold.items.length} members (member completion: ${cold.isMemberCompletion}), hover ${answers.hover ? 'yes' : 'no'}, signature ${answers.signatureHelp ? 'yes, parameter ' + answers.signatureHelp.activeParameter : 'no'}, definition ${answers.definition.length ? 'line ' + (answers.definition[0].range.start.line + 1) : 'no'}, ${answers.diagnostics.length} diagnostics`,
        `calls in ms; "first" is the cold call, the others follow a one-character change:`,
        '',
    ].join('\n'),
);
// eslint-disable-next-line no-console -- a table is what this script is for
console.table(
    Object.fromEntries(Object.entries(durations).map(([name, list]) => [name, summary(list)])),
);
