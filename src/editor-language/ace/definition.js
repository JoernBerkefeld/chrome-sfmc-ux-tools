/*
 * SFMC UX Tools — go to definition in the Ace editor of Automation Studio's script activity:
 * Ctrl-click (Cmd-click on a Mac) on a name that the server-side JavaScript of the content
 * declares moves the cursor to the declaration, as in the CodeMirror editor of Content Builder
 * (../definition.js).
 */
import { report } from '../editors.js';
import { definitionAt } from '../core/lookup.js';
import { IS_MAC } from '../definition.js';
import { characterAt, textOf } from './shared.js';

/**
 * Sets up go to definition for one editor.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isOurs tells whether the editor is, at this moment, one the extension took over
 */
export function registerAceDefinition(editor, isOurs) {
    // in the capture phase: the editor itself adds a second cursor on this click
    editor.container.addEventListener(
        'mousedown',
        (event) => {
            try {
                const hasKey = IS_MAC ? event.metaKey : event.ctrlKey;
                if (!hasKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                }
                const place = isOurs() ? characterAt(editor, event) : null;
                const target =
                    place &&
                    definitionAt(textOf(editor), { line: place.row, character: place.column });
                if (!target) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                editor.focus();
                // moves the cursor and scrolls the line into view if it is not; lines count from 1
                editor.gotoLine(target.line + 1, target.character, false);
            } catch (ex) {
                report(ex);
            }
        },
        { capture: true },
    );
}
