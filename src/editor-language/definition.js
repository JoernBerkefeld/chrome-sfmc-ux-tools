/*
 * SFMC UX Tools — go to definition: Ctrl-click (Cmd-click on a Mac) on the name of a function
 * that the server-side JavaScript of the content declares moves the cursor to the declaration.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import { DOCUMENT_URI, SSJS, isInMode, languageAt, report, ssjsOnly } from './shared.js';
import { characterAt } from './hover.js';

const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
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
    const text = cm.getValue();
    if (languageAt(text, cm.indexFromPos(place)) !== SSJS) {
        return null;
    }
    const line = cm.getLine(place.line);
    const before = /[\w$]*$/.exec(line.slice(0, place.ch))[0];
    const word = before + /^[\w$]*/.exec(line.slice(place.ch))[0];
    // the member of a value is not the function of the same name
    if (!word || line[place.ch - before.length - 1] === '.') {
        return null;
    }
    const location = sfmcLanguageService.getDefinition(
        { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
        word,
    );
    const start = location?.range?.start;
    return start ? { line: start.line, ch: start.character } : null;
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
