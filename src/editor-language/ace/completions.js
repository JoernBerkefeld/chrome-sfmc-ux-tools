/*
 * SFMC UX Tools — completions for the Ace editor of Automation Studio's script activity.
 *
 * The page has no completion feature for Ace, so the suggestions are shown in a popup of the
 * extension (./popup.js). What is suggested, and when, is decided by ../core/completions.js, as
 * for the CodeMirror editor of Content Builder (../completions.js).
 */
import { report } from '../editors.js';
import { completionsAt, isTypingName } from '../core/completions.js';
import { requestTypescript } from '../typescript.js';
import { openPopup } from './popup.js';
import { textOf } from './shared.js';

const TRIGGER_DELAY = 100;
// one typed character that can be part of a name
const TRIGGER_CHARACTER = /^[\w@.$]$/;
const COMMAND = 'sfmcUxToolsComplete';
const TYPING_COMMAND = 'insertstring';
// Ace's names of the keys that go to the popup while it is open, and what the popup calls them
const POPUP_KEYS = new Map([
    ['down', 'ArrowDown'],
    ['up', 'ArrowUp'],
    ['pagedown', 'PageDown'],
    ['pageup', 'PageUp'],
    ['home', 'Home'],
    ['end', 'End'],
    ['return', 'Enter'],
    ['tab', 'Tab'],
    ['esc', 'Escape'],
]);
const QUIET_PARTS = new Set(['string', 'comment']);

/**
 * Converts the type of an Ace token into the style the core knows strings and comments by, which
 * is CodeMirror's: "string" and "comment" in JavaScript and HTML, "sfmc-string" and
 * "sfmc-comment" in AMPscript. Other tokens have no style.
 *
 * @param {string} [type] token type, like "string.ampscript" or "comment.doc"
 * @returns {string} the style, may be empty
 */
export function styleOf(type = '') {
    const parts = type.split('.');
    const prefix = parts.includes('ampscript') ? 'sfmc-' : '';
    return parts
        .filter((part) => QUIET_PARTS.has(part))
        .map((part) => prefix + part)
        .join(' ');
}

/**
 * The style of the code in front of the cursor.
 *
 * @param {object} editor Ace editor
 * @param {number} row line of the cursor
 * @param {number} column character of the cursor
 * @returns {string} style as the core expects it, may be empty
 */
function styleAt(editor, row, column) {
    const session = editor.getSession();
    // Ace reads a line with the state the line above left behind, so those come first
    for (let above = 0; above < row; above++) {
        session.getTokens(above);
    }
    return styleOf(session.getTokenAt(row, column)?.type);
}

/**
 * Sets up completions for one editor: Ctrl-Space, and the popup while typing.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isOurs tells whether the editor is, at this moment, one the extension took over
 * @returns {() => void} closes the editor's popup, if it has one
 */
export function registerAceCompletions(editor, isOurs) {
    // popup: the open popup; found: what it shows; text: the content that was worked out for;
    // row: the line it was opened on; session: the one whose scrolling closes it
    const state = { popup: null, found: null, text: '', row: -1, session: null, timer: undefined };

    const close = () => {
        try {
            clearTimeout(state.timer);
            state.popup?.close();
        } catch (ex) {
            report(ex);
        }
    };

    const keyboard = {
        handleKeyboard: (data, hashId, keyString) => {
            try {
                const key = hashId === 0 ? POPUP_KEYS.get(keyString) : undefined;
                // "null" tells Ace that the key is dealt with
                return key && state.popup?.key(key) ? { command: 'null' } : undefined;
            } catch (ex) {
                close();
                report(ex);
                return;
            }
        },
    };

    const onClosed = () => {
        state.popup = null;
        try {
            editor.keyBinding.removeKeyboardHandler(keyboard);
            state.session?.off('changeScrollTop', close);
            state.session?.off('changeScrollLeft', close);
        } catch (ex) {
            report(ex);
        }
        state.session = null;
    };

    const choose = (item) => {
        try {
            // a pick only fits the content its list was worked out for: the page or the formatter
            // may have changed the content without a key being pressed
            if (
                !state.found ||
                !isOurs() ||
                editor.getReadOnly() ||
                textOf(editor) !== state.text
            ) {
                return;
            }
            const { from, to } = state.found;
            const { Range } = globalThis.ace.require('ace/range');
            const session = editor.getSession();
            // what was typed before stays a step of its own for undo
            session.markUndoGroup();
            const end = session.replace(
                new Range(from.line, from.character, to.line, to.character),
                // eslint-disable-next-line unicorn/no-unsafe-string-replacement -- the session's replace, which takes its text as it is
                item.text,
            );
            session.markUndoGroup();
            editor.moveCursorToPosition(end);
            editor.clearSelection();
        } catch (ex) {
            report(ex);
        }
    };

    /**
     * Shows what fits at the cursor: opens the popup, or gives the open one its new list. Closes
     * it if nothing fits, the cursor left its line or the editor is not to be completed in.
     *
     * @returns {boolean} true if the popup shows suggestions now
     */
    const didShow = () => {
        try {
            const { row, column } = editor.getCursorPosition();
            const text = textOf(editor);
            const found =
                isOurs() &&
                !editor.getReadOnly() &&
                editor.selection.isEmpty() &&
                (!state.popup || row === state.row) &&
                completionsAt(text, { line: row, character: column });
            if (!found) {
                close();
                return false;
            }
            state.found = found;
            state.text = text;
            const { renderer } = editor;
            const start = renderer.textToScreenCoordinates(found.from.line, found.from.character);
            const place = {
                left: start.pageX,
                top: start.pageY,
                bottom: start.pageY + renderer.lineHeight,
            };
            if (state.popup) {
                state.popup.update(found.items, place);
                return true;
            }
            state.row = row;
            state.popup = openPopup({
                ownerDocument: editor.container.ownerDocument,
                items: found.items,
                place,
                onChoose: choose,
                onClose: onClosed,
            });
            editor.keyBinding.addKeyboardHandler(keyboard);
            state.session = editor.getSession();
            state.session.on('changeScrollTop', close);
            state.session.on('changeScrollLeft', close);
            return true;
        } catch (ex) {
            close();
            report(ex);
            return false;
        }
    };

    const showAfterTyping = () => {
        try {
            const { row, column } = editor.getCursorPosition();
            if (
                state.popup ||
                !isOurs() ||
                editor.getReadOnly() ||
                !isTypingName(
                    textOf(editor),
                    { line: row, character: column },
                    styleAt(editor, row, column),
                )
            ) {
                return;
            }
        } catch (ex) {
            report(ex);
            return;
        }
        didShow();
    };

    const onAfterExec = (event) => {
        clearTimeout(state.timer);
        const name = event?.command?.name;
        if (name === COMMAND) {
            return;
        }
        if (state.popup) {
            // typing, Backspace or a move of the cursor: the list is asked for again
            didShow();
            return;
        }
        // a paste is a command of its own, and so is a new line
        if (name === TYPING_COMMAND && TRIGGER_CHARACTER.test(event.args)) {
            state.timer = setTimeout(showAfterTyping, TRIGGER_DELAY);
        }
    };

    // a frame with an editor has use for the TypeScript script, which is loaded on demand
    requestTypescript();
    editor.commands.addCommand({
        name: COMMAND,
        description: 'SFMC UX Tools: suggest completions',
        bindKey: 'Ctrl-Space',
        // false lets the key go on to whatever else handles it
        exec: () => didShow(),
    });
    editor.commands.on('afterExec', onAfterExec);
    editor.on('blur', close);
    editor.on('changeSession', close);
    return close;
}
