/*
 * SFMC UX Tools — what the language features for the Ace editor have in common.
 */
import { report } from '../editors.js';

// marks the editors whose colours are ours; editor-highlight.css themes those
export const TAKEN_CLASS = 'sfmc-ux-tools-ace';
// the dialog of an activity of type 423, "script": #ActivityModal/423/new or #ActivityModal/423/<id>
const ROUTE = /^#ActivityModal\/423\//i;
// the dialog of an activity of type 300, "SQL query"
const QUERY_ROUTE = /^#ActivityModal\/300\//i;
// the mode the extension gives the editors of the script activity
export const SCRIPT_ACTIVITY_MODE = 'sfmc-ux-tools/mode/script-activity';
// the page's mode of the editors of the SQL query activity
export const SQL_MODE = 'ace/mode/sql';

/**
 * Tells whether the page shows the dialog of a SQL query activity.
 *
 * @returns {boolean} true while the address names that dialog
 */
export function isQueryRoute() {
    return QUERY_ROUTE.test(location.hash);
}

/**
 * Tells whether the page shows the dialog of a script activity.
 *
 * @returns {boolean} true while the address names that dialog
 */
export function isScriptRoute() {
    return ROUTE.test(location.hash);
}

/**
 * The content of an editor as the language service wants it: its lines, joined by line feeds,
 * whatever line endings the document was loaded with.
 *
 * @param {object} editor Ace editor
 * @returns {string} the text
 */
export function textOf(editor) {
    return editor.getSession().getDocument().getAllLines().join('\n');
}

/**
 * Listens to the session an editor shows, also after the page gave the editor another one.
 *
 * @param {object} editor Ace editor
 * @param {string[]} events names of events of a session
 * @param {(...parameters: unknown[]) => void} handler what to call for each of them
 */
export function followSession(editor, events, handler) {
    let session = null;
    const follow = () => {
        try {
            for (const name of events) {
                session?.off(name, handler);
            }
            session = editor.getSession();
            for (const name of events) {
                session.on(name, handler);
            }
        } catch (ex) {
            report(ex);
        }
    };
    editor.on('changeSession', follow);
    follow();
}

/**
 * Finds the character under the mouse.
 *
 * @param {object} editor Ace editor
 * @param {{clientX: number, clientY: number}} point where the mouse is
 * @returns {{row: number, column: number} | null} the character, or null beside the text
 */
export function characterAt(editor, point) {
    const { renderer } = editor;
    // the nearest gap between two characters of the nearest line
    const found = renderer.screenToTextCoordinates(point.clientX, point.clientY);
    const gap = renderer.textToScreenCoordinates(found.row, found.column);
    // above the first line or below the last one
    if (point.clientY < gap.pageY || point.clientY >= gap.pageY + renderer.lineHeight) {
        return null;
    }
    // the mouse is on the character before the gap when it is left of the gap
    const column = point.clientX < gap.pageX ? found.column - 1 : found.column;
    // left of the text is the gutter, right of it the rest of the line
    return column < 0 || column >= editor.getSession().getLine(found.row).length
        ? null
        : { row: found.row, column };
}

/**
 * Tells where a box for a place in the text belongs.
 *
 * @param {object} editor Ace editor
 * @param {{row: number, column: number}} position place in the text
 * @returns {{left: number, top: number, bottom: number}} the place in the window
 */
export function anchorAt(editor, position) {
    const { renderer } = editor;
    const start = renderer.textToScreenCoordinates(position.row, position.column);
    return { left: start.pageX, top: start.pageY, bottom: start.pageY + renderer.lineHeight };
}
