/*
 * SFMC UX Tools — formatting in the Ace editor of Automation Studio's script activity: a button
 * next to the dialog's "Validate Syntax" and Shift-Alt-F, as in the CodeMirror editor of Content
 * Builder. The formatter itself and the button's look come from ../../editor-format.js, which
 * is the only script that bundles Prettier.
 */
import { report, watchPage } from '../editors.js';
import { positionAt } from '../core/text.js';
import { TAKEN_CLASS, isScriptRoute, textOf } from './shared.js';

const EDITOR_SELECTOR = '.ace_editor';
// the dialog's own button, which the format button stands next to
const VALIDATE_BUTTON = '#scriptValidateBtn';
// the looks of the dialog's buttons, and what tells ours apart
const BESIDE_CLASSES = 'btn btn-default pull-right sfmc-format-beside';
const FLOATING_CLASS = 'sfmc-format-floating';
// the dialog, and its button that goes on to the summary ("Next") and saves there ("Finish");
// the classes are the same in every language
const DIALOG = '.modal';
const ACCEPT_BUTTON = '.modal-footer button.accept';
const COMMAND = 'sfmcUxToolsFormat';
const marker = Symbol.for('sfmcUxTools.aceFormat');
// the editors that were set up, each with its element and its button
const entries = [];

/**
 * Tells whether an editor is one whose content may be formatted right now.
 *
 * @param {{editor: object, element: Element}} entry an editor that was set up
 * @returns {boolean} true for an editor of the script activity that the extension took over and that can be edited
 */
function canFormat({ editor, element }) {
    return (
        isScriptRoute() &&
        element.isConnected &&
        element.classList.contains(TAKEN_CLASS) &&
        !editor.getReadOnly()
    );
}

/**
 * Replaces a part of an editor's content in one step that can be undone; the cursor and the
 * view stay where they are.
 *
 * @param {object} editor Ace editor
 * @param {string} before the editor's content, with line feeds between its lines
 * @param {{from: number, to: number, text: string}} change the part to replace, by offsets of that content, and what to put there
 */
function replace(editor, before, { from, to, text }) {
    const { Range } = globalThis.ace.require('ace/range');
    const session = editor.getSession();
    const start = positionAt(before, from);
    const end = positionAt(before, to);
    const cursor = editor.getCursorPosition();
    const top = session.getScrollTop();
    const left = session.getScrollLeft();
    // what was typed before stays a step of its own for undo
    session.markUndoGroup();
    // Ace gives the new lines the line endings of the document
    const place = session.remove(new Range(start.line, start.character, end.line, end.character));
    session.insert(place, text);
    session.markUndoGroup();
    editor.moveCursorToPosition(cursor);
    editor.clearSelection();
    session.setScrollTop(top);
    session.setScrollLeft(left);
}

/**
 * Sets up formatting for the editors of the script activity's dialog.
 *
 * @param {object} tools what the formatting script shares
 * @param {(key: object, element: Element, read: () => string, write: (change: object, before: string) => void) => Promise.<void>} tools.formatContent formats what `read` returns and hands the part that differs to `write`
 * @param {(document: Document, onClick: () => void) => HTMLButtonElement} tools.createButton creates a "format code" button
 * @param {(event: MouseEvent, selector: string, formatsFor: (button: Element) => (() => Promise.<void>)[], clickAgain: (button: Element) => void) => void} tools.formatBeforeClick with "format on save" switched on, holds a click on a button back until the editors it is about are formatted
 * @param {(element: Element) => boolean} tools.isOnShow tells whether an element takes up room on the page
 */
export function watchAceFormat({ formatContent, createButton, formatBeforeClick, isOnShow }) {
    const run = (entry) =>
        formatContent(
            entry.editor,
            entry.element,
            () => textOf(entry.editor),
            (change, before) => replace(entry.editor, before, change),
        );

    /**
     * Gives an editor its button while it can be formatted, and takes it away otherwise.
     *
     * @param {{editor: object, element: Element, button: HTMLButtonElement | null}} entry an editor that was set up
     */
    const updateButton = (entry) => {
        if (!canFormat(entry)) {
            entry.button?.remove();
            entry.button = null;
            return;
        }
        if (entry.button?.isConnected) {
            return;
        }
        const button = createButton(document, () => {
            if (canFormat(entry)) {
                run(entry);
            }
            entry.editor.focus();
        });
        const validate = document.querySelector(VALIDATE_BUTTON);
        if (validate) {
            button.className = BESIDE_CLASSES;
            validate.after(button);
        } else {
            // in the corner of the editor where the dialog has no such button
            button.classList.add(FLOATING_CLASS);
            entry.element.append(button);
        }
        entry.button = button;
    };

    const scan = () => {
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index];
            if (entry.element.isConnected) {
                continue;
            }

            entry.button?.remove();
            entry.button = null;
            entries.splice(index, 1);
        }
        if (isScriptRoute()) {
            for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
                const editor = element.env?.editor;
                if (!editor || !editor.commands?.addCommand) {
                    continue;
                }
                const known = editor[marker];
                if (known) {
                    // an editor that left the page and is back on it gets its button again
                    if (!entries.includes(known)) {
                        entries.push(known);
                    }
                    continue;
                }
                const entry = { editor, element, button: null };
                // kept with the editor, to find it again should the editor come back to the page
                editor[marker] = entry;
                entries.push(entry);
                // the key of VS Code. Ace does not run it in a read-only editor
                editor.commands.addCommand({
                    name: COMMAND,
                    description: 'SFMC UX Tools: format code',
                    bindKey: 'Shift-Alt-F',
                    // false lets the key go on to whatever else handles it
                    exec: () => {
                        if (!canFormat(entry)) {
                            return false;
                        }
                        run(entry);
                        return true;
                    },
                });
            }
        }
        // the language script, which runs first, decides which editors are ours
        for (const entry of entries) {
            try {
                updateButton(entry);
            } catch (ex) {
                report(ex);
            }
        }
    };

    /**
     * Format on save: the dialog takes the script over when its "Next" is clicked and saves it
     * with "Finish", which is the same button. The click waits for the editor that is on show.
     *
     * @param {MouseEvent} event a click on the page
     */
    const onClick = (event) => {
        formatBeforeClick(
            event,
            ACCEPT_BUTTON,
            (button) => {
                const dialog = button.closest(DIALOG);
                return entries
                    .filter(
                        (entry) =>
                            canFormat(entry) &&
                            dialog?.contains(entry.element) &&
                            isOnShow(entry.element),
                    )
                    .map((entry) => () => run(entry));
            },
            (button) => {
                // the dialog may have drawn its button again meanwhile
                const current = button.isConnected
                    ? button
                    : [...document.querySelectorAll(ACCEPT_BUTTON)].find((other) =>
                          isOnShow(other),
                      );
                current?.click();
            },
        );
    };

    // in the capture phase, so that the page has not acted on the click yet
    document.addEventListener('click', onClick, { capture: true });
    watchPage(scan);
}
