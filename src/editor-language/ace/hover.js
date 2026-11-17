/*
 * SFMC UX Tools — the box for a place in the Ace editor of Automation Studio's script activity:
 * what is wrong there, how to fix it, and its documentation. It opens where the mouse rests, and
 * at the cursor on Ctrl-. (Cmd-.), as in the CodeMirror editor of Content Builder (../hover.js).
 */
import { report } from '../editors.js';
import { hoverAt } from '../core/lookup.js';
import { positionAt } from '../core/text.js';
import { HIDE_DELAY, SHOW_DELAY, renderBox } from '../hover.js';
import { fixesFor } from '../quickfix.js';
import { createTooltip } from '../tooltip.js';
import { colour } from './colour.js';
import { anchorAt, characterAt, followSession, textOf } from './shared.js';

const COMMAND = 'sfmcUxToolsQuickFix';

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
 * @param {{checkNow: () => void, at: (position: object) => object[]}} diagnostics the editor's errors and warnings, from `registerAceDiagnostics`
 * @returns {() => void} takes the box away
 */
export function registerAceHover(editor, isOurs, diagnostics) {
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
     * Lists what is wrong at a place, each problem with the fixes the language service offers.
     * The content is checked first, so that problems and fixes belong to the text as it is now.
     *
     * @param {{row: number, column: number}} position line and column of a character
     * @param {string} text the editor's content
     * @returns {object[]} the problems, each with its `fixes`
     */
    const problemsAt = (position, text) => {
        diagnostics.checkNow();
        const canFix = !editor.getReadOnly();
        return diagnostics.at(position).map(({ diagnostic, ...problem }) => {
            try {
                return { ...problem, fixes: canFix ? fixesFor(text, diagnostic) : [] };
            } catch (ex) {
                report(ex);
                return { ...problem, fixes: [] };
            }
        });
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
            !isUsable || isForFixes
                ? null
                : hoverAt(text, { line: position.row, character: position.column });
        const markdown = hover?.contents?.value;
        const hasContent = isForFixes
            ? problems.some((problem) => problem.fixes.length > 0)
            : markdown || problems.length > 0;
        if (!hasContent) {
            hide();
            return false;
        }
        const start = hover?.range?.start;
        const anchor = start ? { row: start.line, column: start.character } : position;
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
        timers.show = setTimeout(() => {
            try {
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
    // the key of VS Code for quick fixes. Ace does not run it in a read-only editor
    editor.commands.addCommand({
        name: COMMAND,
        description: 'SFMC UX Tools: show quick fixes',
        bindKey: 'Ctrl-.|Command-.',
        // false lets the key go on to whatever else handles it
        exec: didShowAtCursor,
    });
    return hide;
}
