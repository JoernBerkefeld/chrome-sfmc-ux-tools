import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askMarketingCloud, readAnswer } from '../src/editor-language/ace/sql-check.js';

const ERRORS = 'An error occurred while checking the query syntax. Errors: ';
const UNKNOWN =
    ' is not a known data extension or system data view. You can only query existing data extensions or system data views.';

/**
 * Wraps lines of errors as Marketing Cloud answers them.
 *
 * @param {...string} lines what is wrong with the query
 * @returns {{queryValid: boolean, errors: {message: string}[], warnings: object[]}} the answer
 */
function failed(...lines) {
    return {
        queryValid: false,
        errors: [{ message: ERRORS + lines.map((line) => `${line}\r\n`).join('') }],
        warnings: [],
    };
}

/**
 * Reads an answer and lists what it marks in the query.
 *
 * @param {unknown} body the answer
 * @param {string} text the query
 * @returns {string[]} kind, place and marked text of each diagnostic, and its message
 */
function marked(body, text) {
    const lines = text.split('\n');
    return readAnswer(body, text).diagnostics.map(({ range, severity, message }) => {
        const { start, end } = range;
        assert.equal(start.line, end.line);
        const piece = lines[start.line].slice(start.character, end.character);
        const kind = { 1: 'error', 2: 'warning' }[severity];
        return `${kind} ${start.line}:${start.character} "${piece}" ${message}`;
    });
}

test('sql check: an unknown column is marked wherever the query names it', () => {
    const text =
        "SELECT nofield, a.NoField, [nofield], 'nofield', nofields\nFROM x a -- nofield\nWHERE nofield = 1 /* nofield */";
    const message = "Invalid column name 'nofield'.";
    assert.deepEqual(marked(failed(message), text), [
        `error 0:7 "nofield" ${message}`,
        `error 0:18 "NoField" ${message}`,
        `error 0:28 "nofield" ${message}`,
        `error 2:6 "nofield" ${message}`,
    ]);
    // of a system data view, written with an alias: the message names the bare column
    assert.deepEqual(marked(failed(message), 'SELECT s.nofield FROM _Subscribers s'), [
        `error 0:9 "nofield" ${message}`,
    ]);
    // a column with a space in its name
    assert.deepEqual(
        marked(failed("Invalid column name 'no field'."), 'SELECT [no field] FROM x'),
        [`error 0:8 "no field" Invalid column name 'no field'.`],
    );
});

test('sql check: unknown data extensions and data views are marked as they are written', () => {
    const text =
        'SELECT a.x\nFROM no_such_de a\nJOIN [nope one] b ON a.x = b.x\nJOIN ENT.no_such_shared c ON a.x = c.x\nJOIN _NoView d ON a.x = d.x\nJOIN no_such_de_2 e ON a.x = e.x';
    assert.deepEqual(
        marked(
            failed(
                `no_such_de${UNKNOWN}`,
                `[nope one]${UNKNOWN}`,
                `ENT.no_such_shared${UNKNOWN}`,
                `_noview${UNKNOWN}`,
            ),
            text,
        ),
        [
            `error 1:5 "no_such_de" no_such_de${UNKNOWN}`,
            `error 2:5 "[nope one]" [nope one]${UNKNOWN}`,
            `error 3:5 "ENT.no_such_shared" ENT.no_such_shared${UNKNOWN}`,
            `error 4:5 "_NoView" _noview${UNKNOWN}`,
        ],
    );
});

test('sql check: an error near something is marked on the first such place, every other one on the first character', () => {
    const near = "Incorrect syntax near the keyword 'FROM'.";
    assert.deepEqual(marked(failed(near), "SELECT 'from', fromage\nFROM x\nFROM y"), [
        `error 1:0 "FROM" ${near}`,
    ]);
    const sign = "Incorrect syntax near ')'.";
    assert.deepEqual(marked(failed(sign), 'SELECT COUNT(*) FROM x'), [`error 0:14 ")" ${sign}`]);
    // Marketing Cloud names a sign that an unfinished query does not have
    assert.deepEqual(marked(failed(sign), '\n  SELECT a FROM x WHERE'), [`error 1:2 "S" ${sign}`]);
    const open = 'An unmatched parenthesis occurs in the query.';
    const select = 'Only SELECT queries are valid.  Select must be the first word of the query.';
    assert.deepEqual(marked(failed(open, select), 'DELETE FROM x WHERE (a = 1'), [
        `error 0:0 "D" ${open}`,
        `error 0:0 "D" ${select}`,
    ]);
    // a name the query does not have
    const column = "Invalid column name 'gone'.";
    assert.deepEqual(marked(failed(column), "SELECT 'gone' FROM x"), [`error 0:0 "S" ${column}`]);
});

test('sql check: a warning is marked at the place Marketing Cloud names', () => {
    const advice = 'Use specific column names in your SELECT statement.';
    const body = {
        queryValid: true,
        errors: [],
        warnings: [
            {
                message: `Just a heads-up... \r\n(Line 1, Col 8) ${advice}\r\n(Line 2, Col 6) Name it.\r\n(Line 9, Col 1) Nowhere.\r\nNo place.\r\n`,
            },
        ],
    };
    assert.deepEqual(marked(body, 'SELECT *\nFROM my_data x'), [
        `warning 0:7 "*" ${advice}`,
        'warning 1:5 "my_data" Name it.',
        'warning 0:0 "S" Nowhere.',
        'warning 0:0 "S" No place.',
    ]);
});

test('sql check: an answer of another shape is no answer', () => {
    const text = 'SELECT a FROM x';
    for (const body of [
        null,
        undefined,
        'An error occurred',
        [],
        {},
        { errors: [], warnings: [] },
        // wrong, but nothing says what
        { queryValid: false, errors: [], warnings: [] },
        { queryValid: 'true' },
        { errors: 'Invalid column name', warnings: { message: 'x' } },
        { errors: [null, 1, {}, { message: 7 }, { message: ' \r\n' }, { message: ERRORS }] },
    ]) {
        assert.equal(readAnswer(body, text), null, JSON.stringify(body));
    }
});

test('sql check: an answer tells how many errors and warnings Marketing Cloud named', () => {
    const right = { diagnostics: [], errors: 0, warnings: 0 };
    assert.deepEqual(readAnswer({ queryValid: true }, 'SELECT a FROM x'), right);
    assert.deepEqual(
        readAnswer({ queryValid: true, errors: [], warnings: [] }, 'SELECT a FROM x'),
        right,
    );
    // one error that is marked at three places, and two warnings in one message
    const answer = readAnswer(
        {
            ...failed("Invalid column name 'a'.", 'An unmatched parenthesis occurs in the query.'),
            warnings: [{ message: 'Just a heads-up... \r\n(Line 1, Col 1) One.\r\nTwo.\r\n' }],
        },
        'SELECT a, a, a FROM x',
    );
    assert.equal(answer.errors, 2);
    assert.equal(answer.warnings, 2);
    assert.equal(answer.diagnostics.length, 6);
    // an answer that names something is one, whatever it says about the query as a whole
    assert.equal(readAnswer({ errors: [{ message: 'Wrong.' }] }, 'SELECT 1').errors, 1);
});

test('sql check: Marketing Cloud is asked as its own button asks, and no answer is nothing', async (t) => {
    const calls = [];
    let reply;
    // put back when the test is over
    t.mock.method(globalThis, 'fetch', (address, options) => {
        calls.push({ address, options });
        return reply();
    });
    reply = async () => ({ status: 200, json: async () => ({ queryValid: true }) });
    assert.deepEqual(await askMarketingCloud('SELECT 1'), { queryValid: true });
    assert.deepEqual(calls, [
        {
            address: '/AutomationStudioFuel3/fuelapi/automation/v1/queries/actions/validate/',
            options: {
                method: 'POST',
                credentials: 'same-origin',
                redirect: 'error',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: '{"text":"SELECT 1"}',
            },
        },
    ]);
    reply = async () => ({ status: 401, json: async () => ({ queryValid: false }) });
    assert.equal(await askMarketingCloud('SELECT 1'), null);
    reply = async () => ({
        status: 200,
        json: async () => {
            throw new SyntaxError('not JSON');
        },
    });
    assert.equal(await askMarketingCloud('SELECT 1'), null);
    reply = async () => {
        throw new TypeError('Failed to fetch');
    };
    assert.equal(await askMarketingCloud('SELECT 1'), null);
});
