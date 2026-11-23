/*
 * SFMC UX Tools — errors and warnings in the Ace editor of Automation Studio's script activity:
 * what the language service objects to is underlined and noted in the gutter, as in the
 * CodeMirror editor of Content Builder (../diagnostics.js). The part that draws is shared with
 * the SQL check of the query activity (./query-activity.js).
 */
import { report } from '../editors.js';
import { check, checkTypes } from '../core/diagnostics.js';
import { CHECK_DELAY, SEVERITY_NAMES } from '../diagnostics.js';
import { READY_EVENT, hasTypescript } from '../typescript.js';
import { followSession, textOf } from './shared.js';

const MARKER_CLASS = 'sfmc-diagnostic';

/**
 * Tells whether a place in the text comes before another one.
 *
 * @param {{row: number, column: number}} a place in the text
 * @param {{row: number, column: number}} b another place
 * @returns {boolean} true if the first one comes first
 */
function isBefore(a, b) {
    return a.row < b.row || (a.row === b.row && a.column < b.column);
}

/**
 * Says what to tell about an underline.
 *
 * @param {{diagnostic: object, severity: string}} entry an underline with its diagnostic
 * @returns {{severity: string, message: string, code: string, address: string, diagnostic: object}} what to tell, with the diagnostic it comes from
 */
function problemOf({ diagnostic, severity }) {
    return {
        severity,
        message: String(diagnostic.message),
        code: String(diagnostic.code ?? ''),
        address: String(diagnostic.codeDescription?.href ?? ''),
        diagnostic,
    };
}

/**
 * Creates what draws errors and warnings into an Ace editor: underlines in the text and notes in
 * the gutter. The script activity's check and the SQL check of the query activity both draw with
 * it, each with its own.
 *
 * @returns {{mark: (session: object, list: object[]) => void, unmark: () => void, at: (position: {row: number, column: number}) => object[], onLine: (row: number) => {position: object | null, problems: object[]}, redraw: (editor: object) => void}} underlines what was found, in place of what was underlined before; takes the underlines and the notes away; lists what was found at a character; lists what the note of a line stands for; draws the underlines again after the text changed
 */
export function createAceMarks() {
    // the session that has the underlines, and each of them with its diagnostic
    let marked = null;
    let entries = [];

    const unmark = () => {
        for (const { id, range } of entries) {
            marked.removeMarker(id);
            range.start.detach();
            range.end.detach();
        }
        if (marked) {
            marked.setAnnotations([]);
        }
        entries = [];
        marked = null;
    };

    /**
     * Underlines what was found, in place of what was underlined before.
     *
     * @param {object} session Ace session of the content that was checked
     * @param {object[]} list diagnostics in the shape of the language service
     */
    const mark = (session, list) => {
        unmark();
        const { Range } = globalThis.ace.require('ace/range');
        const lines = session.getDocument();
        marked = session;
        entries = list.map((diagnostic) => {
            const { start, end } = diagnostic.range;
            const from = { row: start.line, column: start.character };
            const to = { row: end.line, column: end.character };
            // something has to carry the underline
            if (from.row === to.row && from.column === to.column) {
                // the character after the place, or the one before it at the end of a line
                if (to.column < lines.getLine(to.row).length) {
                    to.column++;
                } else {
                    from.column = Math.max(0, from.column - 1);
                }
            }
            const range = new Range(from.row, from.column, to.row, to.column);
            // anchors move with the text around them, so the underline stays on its code
            range.start = lines.createAnchor(from.row, from.column);
            range.end = lines.createAnchor(to.row, to.column);
            // what is typed right behind the underlined code is not part of it
            range.end.$insertRight = true;
            const severity = SEVERITY_NAMES[diagnostic.severity] ?? SEVERITY_NAMES[1];
            const id = session.addMarker(
                range,
                `${MARKER_CLASS} ${MARKER_CLASS}-${severity}`,
                'text',
            );
            return { id, range, diagnostic, severity };
        });
        session.setAnnotations(
            entries.map(({ range, diagnostic, severity }) => ({
                row: range.start.row,
                column: range.start.column,
                text: String(diagnostic.message),
                type: severity,
            })),
        );
    };

    return {
        mark,
        unmark,
        /**
         * Lists what was found at a character.
         *
         * @param {{row: number, column: number}} position line and column of the character
         * @returns {{severity: string, message: string, code: string, address: string, diagnostic: object}[]} what to tell about that place, each with the diagnostic it comes from
         */
        at: (position) =>
            entries
                .filter(
                    ({ range }) =>
                        !isBefore(position, range.start) && isBefore(position, range.end),
                )
                .map((entry) => problemOf(entry)),
        /**
         * Lists what the note in the gutter of a line stands for: what was found that starts in
         * that line.
         *
         * @param {number} row the line
         * @returns {{position: {row: number, column: number} | null, problems: object[]}} where the first of them starts, null if there is none; and what to tell about them, as from `at`
         */
        onLine: (row) => {
            const found = entries
                .filter(({ range }) => range.start.row === row)
                .toSorted((a, b) => a.range.start.column - b.range.start.column);
            return {
                position: found[0] ? { row, column: found[0].range.start.column } : null,
                problems: found.map((entry) => problemOf(entry)),
            };
        },
        /**
         * Draws the underlines again: their anchors have moved or are about to, and Ace draws
         * its markers again when told.
         *
         * @param {object} editor Ace editor that shows the session
         */
        redraw: (editor) => {
            if (entries.length > 0) {
                editor.renderer.updateBackMarkers();
            }
        },
    };
}

/**
 * Sets up errors and warnings for one editor: checked now and whenever typing pauses.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isOurs tells whether the editor is, at this moment, one the extension took over
 * @returns {{checkNow: () => void, at: (position: {row: number, column: number}) => object[], onLine: (row: number) => {position: object | null, problems: object[]}, clear: () => void, schedule: () => void}} checks the content at once; lists what was found at a character; lists what the note in the gutter of a line stands for; takes the underlines away; checks again shortly
 */
export function registerAceDiagnostics(editor, isOurs) {
    // counts the changes of the content, to know content that was checked already
    let generation = 0;
    let timer;
    // what the content was when it was last checked, and what TypeScript found in which content
    let checked = null;
    let typed = null;
    const { mark, unmark, at, onLine, redraw } = createAceMarks();

    /**
     * Checks the editor's content and underlines what was found. TypeScript's check takes long
     * enough to be felt, so it only runs when asked for, which is once typing has paused;
     * otherwise what it found last is kept as long as it belongs to the content as it is.
     *
     * @param {boolean} isWithTypes true to ask TypeScript as well
     */
    const update = (isWithTypes) => {
        try {
            const now = { session: editor.getSession(), generation, isOurs: isOurs() };
            const isSame = (last) =>
                last?.session === now.session &&
                last.generation === now.generation &&
                last.isOurs === now.isOurs;
            const isTypesCurrent = isSame(typed) && typed.hasTypescript === hasTypescript();
            // nothing to do for content that was checked already: the same session, unchanged,
            // ours or not as before, and with or without TypeScript as before
            if (isSame(checked) && (isTypesCurrent || !isWithTypes)) {
                return;
            }
            checked = now;
            const list = [];
            let further = [];
            if (now.isOurs) {
                const text = textOf(editor);
                const known = check(text);
                further = isSame(typed) ? typed.list : [];
                if (isWithTypes && !isTypesCurrent) {
                    further = checkTypes(text, known);
                }
                list.push(...known, ...further);
            }
            if (isWithTypes) {
                typed = { ...now, hasTypescript: hasTypescript(), list: further };
            }
            if (now.isOurs) {
                mark(now.session, list);
            } else {
                unmark();
            }
        } catch (ex) {
            report(ex);
        }
    };

    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => update(true), CHECK_DELAY);
    };

    followSession(editor, ['change'], () => {
        generation++;
        schedule();
        try {
            redraw(editor);
        } catch (ex) {
            report(ex);
        }
    });
    // the page may give the editor another mode, which makes it an editor for something else
    followSession(editor, ['changeMode'], schedule);
    // another session in the same editor is other content
    editor.on('changeSession', schedule);
    if (!hasTypescript()) {
        // the TypeScript script may arrive after the first check
        editor.container.ownerDocument.addEventListener(
            READY_EVENT,
            // later, not while the TypeScript script that says so is still starting
            () => setTimeout(() => update(true), 0),
            { once: true },
        );
    }
    schedule();

    return {
        /**
         * Checks the content at once, for those who need what is found to fit the text as it is
         * now, without waiting for typing to pause. TypeScript is not asked.
         *
         * @returns {void}
         */
        checkNow: () => update(false),
        /**
         * Lists what was found at a character.
         *
         * @param {{row: number, column: number}} position line and column of the character
         * @returns {{severity: string, message: string, code: string, address: string, diagnostic: object}[]} what to tell about that place, each with the diagnostic of the language service it comes from
         */
        at,
        // what the note in the gutter of a line stands for
        onLine,
        /**
         * Takes the underlines and the notes in the gutter away, until the content is checked
         * again.
         */
        clear: () => {
            try {
                clearTimeout(timer);
                checked = null;
                typed = null;
                unmark();
            } catch (ex) {
                report(ex);
            }
        },
        schedule,
    };
}
