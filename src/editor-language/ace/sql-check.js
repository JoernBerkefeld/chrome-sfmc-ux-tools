/*
 * SFMC UX Tools — the check of the SQL of Automation Studio's query activity.
 *
 * The extension has no SQL parser and no list of data extensions, fields or data views.
 * Marketing Cloud has all of that: the dialog's button "Validate Syntax" asks its server, which
 * answers with what is wrong with the query. This file asks the same question and turns the
 * answer into errors and warnings with a place in the text, in the shape that the editor's
 * drawing takes from the language service (./diagnostics.js), with how many of each there are.
 * An answer that says neither what is wrong nor that the query is right is told apart: it is no
 * answer. The question changes nothing in Marketing Cloud.
 */

// where the dialog's own button asks
const ADDRESS = '/AutomationStudioFuel3/fuelapi/automation/v1/queries/actions/validate/';
const ANSWERED = 200;
// severities of the language service
const ERROR = 1;
const WARNING = 2;
// what Marketing Cloud writes before its errors and before its warnings
const ERROR_PREFIX = 'An error occurred while checking the query syntax. Errors:';
const WARNING_PREFIX = 'Just a heads-up...';
// "(Line 1, Col 8) Use specific column names in your SELECT statement.", both counted from 1
const PLACE = /^\(Line (\d+), Col (\d+)\)\s*(.*)$/;
// "Invalid column name 'nofield'."
const COLUMN = /^Invalid column name '(.+)'\.$/;
// "no_such_de is not a known data extension or system data view. You can only query …"; the name
// is written as it is in the query, with its brackets or its prefix
const SOURCE = /^(.+?) is not a known data extension or system data view\./;
// "Incorrect syntax near the keyword 'FROM'." and "Incorrect syntax near ')'."
const NEAR = /^Incorrect syntax near (?:the keyword )?'(.+)'\.$/;
// what a name in SQL is made of
const NAME_CHARACTER = /[\p{L}\p{N}_@#$]/u;
// the pieces of a query that are read to their end as one: texts and comments, which name
// nothing, and names in brackets or double quotes, in which a quote or a dash starts nothing
const PIECES = [
    { open: "'", close: "'", isCode: false },
    { open: '--', close: '\n', isCode: false },
    { open: '/*', close: '*/', isCode: false },
    { open: '[', close: ']', isCode: true },
    { open: '"', close: '"', isCode: true },
];

/**
 * Finds the texts in single quotes and the comments of a query.
 *
 * @param {string} text the query
 * @returns {number[][]} where each of them starts and where it is over, as offsets
 */
function silentParts(text) {
    const parts = [];
    let index = 0;
    while (index < text.length) {
        const piece = PIECES.find(({ open }) => text.startsWith(open, index));
        if (!piece) {
            index++;
            continue;
        }
        const close = text.indexOf(piece.close, index + piece.open.length);
        // one that is not closed goes on to the end
        const end = close === -1 ? text.length : close + piece.close.length;
        if (!piece.isCode) {
            parts.push([index, end]);
        }
        index = end;
    }
    return parts;
}

/**
 * Tells whether a character is one that names are made of.
 *
 * @param {string | undefined} character the character; undefined before the first and after the last one
 * @returns {boolean} true for a letter, a digit and the signs a name may have
 */
function isNamePart(character) {
    return character !== undefined && NAME_CHARACTER.test(character);
}

/**
 * Prepares the search for places in a query.
 *
 * @param {string} text the query, its lines joined by line feeds
 * @returns {{first: () => object, placed: (line: number, column: number) => object | null, named: (name: string) => object[]}} gives the range of the first character that is not white space; of the character or word at a line and column, both counted from 1, or null if the query has no such place; and of every place that names something
 */
function reader(text) {
    const lines = text.split('\n');
    const silent = silentParts(text);
    const lowered = text.toLowerCase();

    /**
     * Converts an offset into a place of the language service.
     *
     * @param {number} offset offset in the query
     * @returns {{line: number, character: number}} line and character, counted from 0
     */
    const placeOf = (offset) => {
        let line = 0;
        let rest = offset;
        while (line < lines.length - 1 && rest > lines[line].length) {
            rest -= lines[line].length + 1;
            line++;
        }
        return { line, character: rest };
    };
    const rangeOf = (from, to) => ({ start: placeOf(from), end: placeOf(to) });

    return {
        first: () => {
            const offset = Math.max(0, text.search(/\S/));
            return rangeOf(offset, Math.min(text.length, offset + 1));
        },
        placed: (line, column) => {
            const content = lines[line - 1];
            if (content === undefined || column < 1 || column > content.length) {
                return null;
            }
            // the word that starts there, or that one character
            let end = column;
            while (isNamePart(content[column - 1]) && isNamePart(content[end])) {
                end++;
            }
            return {
                start: { line: line - 1, character: column - 1 },
                end: { line: line - 1, character: end },
            };
        },
        named: (name) => {
            const wanted = name.toLowerCase();
            const found = [];
            // lower case of another length would move every place
            if (wanted === '' || lowered.length !== text.length) {
                return found;
            }
            for (
                let at = lowered.indexOf(wanted);
                at !== -1;
                at = lowered.indexOf(wanted, at + 1)
            ) {
                const end = at + wanted.length;
                // a name can hold dots, brackets and spaces; it only must not be a part of a
                // longer one
                const isWhole =
                    (!isNamePart(wanted[0]) || !isNamePart(lowered[at - 1])) &&
                    (!isNamePart(wanted.at(-1)) || !isNamePart(lowered[end]));
                if (isWhole && silent.every(([from, to]) => !(at >= from && at < to))) {
                    found.push(rangeOf(at, end));
                }
            }
            return found;
        },
    };
}

/**
 * Lists the lines of the messages of an answer.
 *
 * @param {unknown} items the errors or the warnings of an answer
 * @param {string} prefix what Marketing Cloud writes before the first of them
 * @returns {string[]} the lines that say something, without that prefix
 */
function linesOf(items, prefix) {
    return Array.isArray(items)
        ? items
              .flatMap((item) =>
                  typeof item?.message === 'string' ? item.message.split(/\r?\n/) : [],
              )
              .map((line) => line.trim())
              .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length).trim() : line))
              .filter((line) => line !== '')
        : [];
}

/**
 * Turns Marketing Cloud's answer about a query into errors and warnings with a place in it.
 * Marketing Cloud only gives its warnings a place. An error that names a column, a data
 * extension or a data view is put on every place of the query that names the same, outside of
 * texts and comments; one that names what it was found near is put on the first such place; every
 * other one, and one whose name the query does not have, is put on the first character, so that
 * none is lost.
 *
 * @param {unknown} body the answer: `{queryValid, errors: [{message}], warnings: [{message}]}`
 * @param {string} text the query that was asked about, its lines joined by line feeds
 * @returns {{diagnostics: {range: {start: {line: number, character: number}, end: {line: number, character: number}}, severity: number, message: string}[], errors: number, warnings: number} | null} what to underline, and how many errors and warnings Marketing Cloud named; null for no answer and for one of another shape, which names nothing and does not say that the query is right either
 */
export function readAnswer(body, text) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return null;
    }
    const errors = linesOf(body.errors, ERROR_PREFIX);
    const warnings = linesOf(body.warnings, WARNING_PREFIX);
    if (errors.length === 0 && warnings.length === 0 && body.queryValid !== true) {
        return null;
    }
    const query = reader(text);
    const list = [];
    for (const message of errors) {
        const name = COLUMN.exec(message)?.[1] ?? SOURCE.exec(message)?.[1];
        const near = NEAR.exec(message)?.[1];
        let ranges = [];
        if (name) {
            ranges = query.named(name);
        } else if (near) {
            ranges = query.named(near).slice(0, 1);
        }
        if (ranges.length === 0) {
            ranges = [query.first()];
        }
        list.push(...ranges.map((range) => ({ range, severity: ERROR, message })));
    }
    for (const line of warnings) {
        const [, row, column, message] = PLACE.exec(line) ?? [];
        const range = (message ? query.placed(Number(row), Number(column)) : null) ?? query.first();
        list.push({ range, severity: WARNING, message: message || line });
    }
    return { diagnostics: list, errors: errors.length, warnings: warnings.length };
}

/**
 * Asks Marketing Cloud what is wrong with a query: the request of the dialog's button "Validate
 * Syntax", sent through the page the user is logged in to. It never fails; without an answer
 * that can be read there is nothing to tell.
 *
 * @param {string} text the query
 * @returns {Promise.<unknown>} the answer for `readAnswer`; null if Marketing Cloud gave none
 */
export async function askMarketingCloud(text) {
    try {
        const answer = await fetch(ADDRESS, {
            method: 'POST',
            credentials: 'same-origin',
            // an answer from elsewhere, as from a login page, is none
            redirect: 'error',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ text }),
        });
        return answer.status === ANSWERED ? await answer.json() : null;
    } catch {
        return null;
    }
}
