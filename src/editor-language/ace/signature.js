/*
 * SFMC UX Tools — parameter help in the Ace editor of Automation Studio's script activity: while
 * the cursor is inside the brackets of a call, a box shows the function's parameters and marks
 * the one that is being typed, as in the CodeMirror editor of Content Builder (../signature.js).
 */
import { report } from '../editors.js';
import { helpAt } from '../core/lookup.js';
import { UPDATE_DELAY, renderSignature } from '../signature.js';
import { createTooltip } from '../tooltip.js';
import { anchorAt, followSession, textOf } from './shared.js';

/**
 * Sets up parameter help for one editor.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isOurs tells whether the editor is, at this moment, one the extension took over
 * @returns {() => void} takes the box away
 */
export function registerAceSignature(editor, isOurs) {
    const { container } = editor;
    const document = container.ownerDocument;
    const tooltip = createTooltip(document, 'sfmc-signature');
    let timer;

    const hide = () => {
        clearTimeout(timer);
        tooltip.hide();
    };
    const update = () => {
        try {
            const cursor = editor.getCursorPosition();
            const help =
                isOurs() &&
                container.isConnected &&
                editor.isFocused() &&
                !editor.getReadOnly() &&
                editor.selection.isEmpty()
                    ? helpAt(textOf(editor), { line: cursor.row, character: cursor.column })
                    : null;
            if (help) {
                tooltip.show(
                    renderSignature(document, help.signature, help.active),
                    anchorAt(editor, cursor),
                );
            } else {
                tooltip.hide();
            }
        } catch (ex) {
            tooltip.hide();
            report(ex);
        }
    };

    // Ace says this for every move of the cursor, also for those that typing causes
    editor.on('changeSelection', () => {
        clearTimeout(timer);
        timer = setTimeout(update, UPDATE_DELAY);
    });
    editor.on('blur', hide);
    editor.on('changeSession', hide);
    followSession(editor, ['changeScrollTop', 'changeScrollLeft'], hide);
    // Escape closes the box and goes on to whatever else the key does in the editor
    container.addEventListener(
        'keydown',
        (event) => {
            if (event.key === 'Escape') {
                hide();
            }
        },
        { capture: true },
    );
    return hide;
}
