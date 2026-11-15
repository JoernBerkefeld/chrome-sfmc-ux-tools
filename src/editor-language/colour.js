/*
 * SFMC UX Tools — colours code in the boxes of the language features the way the editor does.
 */
import { AMPSCRIPT, report } from './shared.js';

// languages of code blocks that are coloured as JavaScript
const SCRIPT_LANGUAGES = new Set(['typescript', 'javascript', 'js', 'ssjs']);

/**
 * Colours code with the editor's own rules: its mode for AMPscript, which includes this
 * extension's colouring, and CodeMirror's JavaScript rules for signatures and SSJS examples.
 *
 * @param {object} cm CodeMirror instance
 * @param {string} code the code
 * @param {string} language language named by the documentation
 * @returns {DocumentFragment | null} the code in coloured pieces, or null if there are no rules for the language
 */
export function colour(cm, code, language) {
    try {
        const CodeMirror = cm.constructor;
        const mode = SCRIPT_LANGUAGES.has(language)
            ? CodeMirror.getMode(
                  { indentUnit: 4 },
                  { name: 'javascript', typescript: language === 'typescript' },
              )
            : language === AMPSCRIPT
              ? cm.getMode()
              : null;
        if (!mode?.token || mode.name === 'null') {
            return null;
        }
        const document = cm.getWrapperElement().ownerDocument;
        const result = document.createDocumentFragment();
        const state = CodeMirror.startState(mode);
        for (const [number, line] of code.split('\n').entries()) {
            if (number) {
                result.append('\n');
            }
            if (!line) {
                mode.blankLine?.(state);
            }
            const stream = new CodeMirror.StringStream(line);
            while (!stream.eol()) {
                const style = mode.token(stream, state);
                const text = stream.current();
                if (!text) {
                    // rules that do not move on would never end
                    return null;
                }
                stream.start = stream.pos;
                if (style) {
                    const piece = document.createElement('span');
                    piece.className = style.replaceAll(/\S+/g, 'cm-$&');
                    piece.textContent = text;
                    result.append(piece);
                } else {
                    result.append(text);
                }
            }
        }
        return result;
    } catch (ex) {
        report(ex);
        return null;
    }
}
