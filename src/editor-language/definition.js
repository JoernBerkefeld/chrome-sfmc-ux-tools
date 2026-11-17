/*
 * SFMC UX Tools — go to definition: Ctrl-click (Cmd-click on a Mac) on a name that the
 * server-side JavaScript of the content declares moves the cursor to the declaration: any name
 * with the TypeScript script, functions without it.
 */
import { isInMode, report } from './shared.js';
import { definitionAt as findDefinition } from './core/lookup.js';
import { characterAt } from './hover.js';

export const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
// room left around the declaration when it is scrolled into view
const SCROLL_MARGIN = 80;

/**
 * Finds where the name at a place is declared.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of a character
 * @returns {{line: number, ch: number} | null} start of the declaration, or null if the language service knows none
 */
export function definitionAt(cm, place) {
    const found = findDefinition(cm.getValue(), { line: place.line, character: place.ch });
    return found ? { line: found.line, ch: found.character } : null;
}

/**
 * Sets up go to definition for one editor.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerDefinition(cm) {
    const wrapper = cm.getWrapperElement();
    // in the capture phase: the editor itself adds a second cursor on this click
    wrapper.addEventListener(
        'mousedown',
        (event) => {
            try {
                const hasKey = IS_MAC ? event.metaKey : event.ctrlKey;
                if (!hasKey || event.shiftKey || event.altKey || event.button !== 0) {
                    return;
                }
                const place = isInMode(cm) ? characterAt(cm, event) : null;
                const target = place && definitionAt(cm, place);
                if (!target) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                cm.focus();
                cm.setCursor(target);
                cm.scrollIntoView(target, SCROLL_MARGIN);
            } catch (ex) {
                report(ex);
            }
        },
        { capture: true },
    );
}
