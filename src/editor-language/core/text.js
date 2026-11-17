/*
 * SFMC UX Tools — places in a text, without an editor: offsets, and the lines and characters of
 * the language service.
 */

/**
 * Converts a place in a text into its offset. Lines end with a line feed, as in CodeMirror.
 * A place after the last line, where a fix may want to add a line, is the end of the text, and
 * a place after the end of a line is the end of that line.
 *
 * @param {string} text the text
 * @param {{line: number, character: number}} position place of the language service
 * @returns {number} offset of the place
 */
export function offsetAt(text, position) {
    let offset = 0;
    for (let line = 0; line < position.line; line++) {
        const next = text.indexOf('\n', offset);
        if (next === -1) {
            return text.length;
        }
        offset = next + 1;
    }
    const lineEnd = text.indexOf('\n', offset);
    return Math.min(offset + position.character, lineEnd === -1 ? text.length : lineEnd);
}

/**
 * Converts an offset in a text into a place of the language service.
 *
 * @param {string} text the text
 * @param {number} offset offset in the text
 * @returns {{line: number, character: number}} the place
 */
export function positionAt(text, offset) {
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length - 1, character: offset - lineStart };
}

/**
 * Gives one line of a text, without its line feed.
 *
 * @param {string} text the text
 * @param {number} line number of the line, from zero
 * @returns {string} the line; empty after the last line
 */
export function lineAt(text, line) {
    // the start of a line after the last one is the end of the text
    const start = offsetAt(text, { line, character: 0 });
    const end = text.indexOf('\n', start);
    return text.slice(start, end === -1 ? text.length : end);
}
