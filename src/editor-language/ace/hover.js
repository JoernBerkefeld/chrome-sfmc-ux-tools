/*
 * SFMC UX Tools — the box for a place in the Ace editor of Automation Studio's script activity:
 * what is wrong there, how to fix it, and its documentation. It opens where the mouse rests, and
 * at the cursor on Ctrl-. (Cmd-.), as in the CodeMirror editor of Content Builder (../hover.js).
 *
 * The mouse may also rest on the note in the gutter of a line: the box then lists everything
 * that is wrong in that line, at the first such place. Ace's own tooltip for a note is hidden in
 * the editors the extension took (../../editor-highlight.css); it is placed by the window, and
 * the dialog around the editor moves it far from the note.
 *
 * The query activity's editor has the same box for what its SQL check found (./query-activity.js),
 * without the parts that need the language service, which knows no SQL.
 */
import { report } from '../editors.js';
import { hoverAt } from '../core/lookup.js';
import { positionAt } from '../core/text.js';
import { HIDE_DELAY, SHOW_DELAY, renderBox } from '../hover.js';
import { fixesFor } from '../quickfix.js';
import { createTooltip } from '../tooltip.js';
import { colour } from './colour.js';
import { anchorAt, characterAt, followSession, lineAt, textOf } from './shared.js';

const COMMAND = 'sfmcUxToolsQuickFix';
// Ace's column of line numbers and notes
const GUTTER_SELECTOR = '.ace_gutter';

/**
 * Applies a fix to an editor in one step that can be undone.
 *
 * @param {object} editor Ace editor
 * @param {{edits: {from: number, to: number, text: string}[]}} fix fix from `fixesFor`
 * @param {string} text the content the fix was worked out for, which is the editor's
 */
function applyFix(editor, fix, text) {
    const { Range } = globalThis.ace.require('ace/range');
    const session = editor.getSession();
    // from the end of the document backwards, so that earlier places stay right
    const edits = fix.edits.toSorted((a, b) => b.from - a.from);
    // what was typed before stays a step of its own for undo
    session.markUndoGroup();
    for (const edit of edits) {
        const from = positionAt(text, edit.from);
        const to = positionAt(text, edit.to);
        const start = session.remove(new Range(from.line, from.character, to.line, to.character));
        session.insert(start, edit.text);
    }
    session.markUndoGroup();
}

/**
 * Sets up the box for one editor.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isOurs tells whether the editor is, at this moment, one the extension took over
 * @param {{checkNow: () => void, at: (position: object) => object[], onLine: (row: number) => {position: object | null, problems: object[]}}} diagnostics the editor's errors and warnings, from `registerAceDiagnostics` or of the same shape
 * @param {{hasLanguage?: boolean}} [options] false for an editor whose content the language service does not know, as SQL: the box then only says what is wrong, without documentation, fixes and the key for them
 * @returns {() => void} takes the box away
 */
export function registerAceHover(editor, isOurs, diagnostics, { hasLanguage = true } = {}) {
    const { container } = editor;
    const document = container.ownerDocument;
    const tooltip = createTooltip(document, 'sfmc-hover');
    const timers = { show: undefined, hide: undefined };
    let shown = '';
    // the content the fixes on show were worked out for
    let fixedText = '';

    const hide = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        shown = '';
        tooltip.hide();
    };
    const hideSoon = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        timers.hide = setTimeout(hide, HIDE_DELAY);
    };
    const fix = (chosen) => {
        try {
            hide();
            // a fix only fits the content it was worked out for, in an editor that can be edited
            if (isOurs() && !editor.getReadOnly() && textOf(editor) === fixedText) {
                applyFix(editor, chosen, fixedText);
            }
            editor.focus();
        } catch (ex) {
            report(ex);
        }
    };
    /**
     * Gives each problem the fixes the language service offers for it: none in an editor that
     * cannot be edited, and none where the language service is not asked.
     *
     * @param {object[]} problems the problems, each with the diagnostic it comes from
     * @param {string} text the editor's content
     * @returns {object[]} the problems, each with its `fixes` in place of the diagnostic
     */
    const withFixes = (problems, text) => {
        const canFix = hasLanguage && !editor.getReadOnly();
        return problems.map(({ diagnostic, ...problem }) => {
            try {
                return { ...problem, fixes: canFix ? fixesFor(text, diagnostic) : [] };
            } catch (ex) {
                report(ex);
                return { ...problem, fixes: [] };
            }
        });
    };
    /**
     * Lists what is wrong at a place, each problem with the fixes the language service offers.
     * The content is checked first, so that problems and fixes belong to the text as it is now.
     *
     * @param {{row: number, column: number}} position line and column of a character
     * @param {string} text the editor's content
     * @returns {object[]} the problems, each with its `fixes`
     */
    const problemsAt = (position, text) => {
        diagnostics.checkNow();
        return withFixes(diagnostics.at(position), text);
    };
    /**
     * Shows the box with what there is to say, or takes it away if there is nothing.
     *
     * @param {{row: number, column: number}} anchor the place in the text the box belongs to
     * @param {object[]} problems what is wrong, each with its `fixes`
     * @param {string | undefined} markdown the documentation
     * @param {string} text the editor's content, which the fixes were worked out for
     * @param {boolean} [isForFixes] true to only show it if there is something to fix
     * @returns {boolean} true if the box is shown
     */
    const didShow = (anchor, problems, markdown, text, isForFixes = false) => {
        const hasContent = isForFixes
            ? problems.some((problem) => problem.fixes.length > 0)
            : markdown || problems.length > 0;
        if (!hasContent) {
            hide();
            return false;
        }
        const key = JSON.stringify([anchor, problems, markdown]);
        if (key !== shown || !tooltip.isShown()) {
            shown = key;
            fixedText = text;
            tooltip.show(
                renderBox(document, problems, markdown, fix, (code, language) =>
                    colour(editor, code, language),
                ),
                anchorAt(editor, anchor),
            );
        }
        return true;
    };
    /**
     * Shows the box for a place, or takes it away if there is nothing to say about the place.
     *
     * @param {{row: number, column: number} | null} position line and column of a character
     * @param {boolean} [isForFixes] true to only show it if there is something to fix
     * @returns {boolean} true if the box is shown
     */
    const didShowAt = (position, isForFixes = false) => {
        const isUsable = position && isOurs() && container.isConnected;
        const text = isUsable ? textOf(editor) : '';
        const problems = isUsable ? problemsAt(position, text) : [];
        const hover =
            !isUsable || isForFixes || !hasLanguage
                ? null
                : hoverAt(text, { line: position.row, character: position.column });
        const start = hover?.range?.start;
        const anchor = start ? { row: start.line, column: start.character } : position;
        return didShow(anchor, problems, hover?.contents?.value, text, isForFixes);
    };
    /**
     * Shows the box for the note in the gutter of a line: everything that is wrong from that
     * line on, at the first such place. Without a note the box is taken away.
     *
     * @param {number | null} row the line
     * @returns {boolean} true if the box is shown
     */
    const didShowForLine = (row) => {
        if (row === null || !isOurs() || !container.isConnected) {
            hide();
            return false;
        }
        const text = textOf(editor);
        diagnostics.checkNow();
        const { position, problems } = diagnostics.onLine(row);
        return didShow(position, withFixes(problems, text), undefined, text);
    };
    const didShowAtCursor = () => {
        try {
            const cursor = editor.getCursorPosition();
            // the cursor stands between two characters; a problem may end right before it
            const places = [cursor, { row: cursor.row, column: cursor.column - 1 }].filter(
                (place) => place.column >= 0,
            );
            if (editor.getReadOnly() || places.every((place) => !didShowAt(place, true))) {
                return false;
            }
            tooltip.element.querySelector('.sfmc-fix')?.focus();
            return true;
        } catch (ex) {
            hide();
            report(ex);
            return false;
        }
    };

    container.addEventListener('mousemove', (event) => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        // not while something is dragged or selected with the mouse
        if (event.buttons) {
            return;
        }
        const point = { clientX: event.clientX, clientY: event.clientY };
        // in the gutter are the notes, each for everything that is wrong in its line
        const isInGutter = Boolean(event.target?.closest?.(GUTTER_SELECTOR));
        timers.show = setTimeout(() => {
            try {
                if (isInGutter) {
                    didShowForLine(lineAt(editor, point));
                    return;
                }
                didShowAt(characterAt(editor, point));
            } catch (ex) {
                hide();
                report(ex);
            }
        }, SHOW_DELAY);
    });
    container.addEventListener('mouseleave', hideSoon);
    // in the capture phase: a click that goes to a definition does not reach the editor
    container.addEventListener('mousedown', hide, { capture: true });
    // all keys of the editor are pressed in its hidden text field
    container.addEventListener('keydown', hide, { capture: true });
    tooltip.element.addEventListener('mouseenter', () => clearTimeout(timers.hide));
    tooltip.element.addEventListener('mouseleave', hideSoon);
    // with the keyboard in the box: Escape closes it and hands the focus back
    tooltip.element.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }

        hide();
        editor.focus();
    });
    followSession(editor, ['change', 'changeScrollTop', 'changeScrollLeft'], hide);
    editor.on('changeSession', hide);
    if (hasLanguage) {
        // the key of VS Code for quick fixes. Ace does not run it in a read-only editor
        editor.commands.addCommand({
            name: COMMAND,
            description: 'SFMC UX Tools: show quick fixes',
            bindKey: 'Ctrl-.|Command-.',
            // false lets the key go on to whatever else handles it
            exec: didShowAtCursor,
        });
    }
    return hide;
}
