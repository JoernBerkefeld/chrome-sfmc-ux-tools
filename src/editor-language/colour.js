/*
 * SFMC UX Tools — colours code in the boxes of the language features the way the editor does.
 */
import { AMPSCRIPT, report } from './shared.js';

// languages of code blocks that are coloured as JavaScript
const SCRIPT_LANGUAGES = new Set(['typescript', 'javascript', 'js', 'ssjs']);
const NAME = /^[A-Za-z_$][\w$]*$/;
// styles of CodeMirror that are never a name
const NOT_A_NAME = /\b(?:string|comment|number|atom)\b/;
const FUNCTION_STYLE = 'sfmc-function';
const TYPE_STYLE = 'type';

/**
 * Tells whether a piece of code is a name that may be recoloured.
 *
 * @param {{text: string, style: string}} piece piece of a line
 * @returns {boolean} true for an identifier outside strings and comments
 */
function isName(piece) {
    return NAME.test(piece.text) && !NOT_A_NAME.test(piece.style);
}

/**
 * Gives the pieces of a line of script the colours VS Code gives them in a hover, where
 * CodeMirror's JavaScript rules know less: the name of a function that is called or declared,
 * and, in a signature, the types.
 *
 * @param {{text: string, style: string}[]} pieces pieces of one line, changed in place
 * @param {boolean} isSignature true for TypeScript, which the language service uses for signatures
 */
function refine(pieces, isSignature) {
    const next = (index) => pieces.slice(index + 1).find((piece) => piece.text.trim() !== '');
    for (const [index, piece] of pieces.entries()) {
        if (isName(piece) && piece.style !== 'keyword' && next(index)?.text.startsWith('(')) {
            piece.style = FUNCTION_STYLE;
        }
    }
    if (!isSignature) {
        return;
    }
    // "function Platform.Response.Write(": the whole dotted name is the function's name
    const declared = pieces.findIndex(
        (piece) => piece.text === 'function' && piece.style === 'keyword',
    );
    if (declared !== -1) {
        const after = pieces.slice(declared + 1);
        for (const piece of after) {
            if (piece.text.startsWith('(')) {
                break;
            }
            if (isName(piece) || piece.text === '.') {
                piece.style = FUNCTION_STYLE;
            }
        }
    }
    // what follows a colon is a type, up to the next comma, bracket or equals sign
    let isType = false;
    for (const piece of pieces) {
        const text = piece.text.trim();
        if (text === ':') {
            isType = true;
        } else if (/^[,)=]/.test(text)) {
            isType = false;
        } else if (isType && isName(piece)) {
            piece.style = TYPE_STYLE;
        }
    }
}

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
        const isScript = SCRIPT_LANGUAGES.has(language);
        const mode = isScript
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
            const pieces = [];
            while (!stream.eol()) {
                const style = mode.token(stream, state);
                const text = stream.current();
                if (!text) {
                    // rules that do not move on would never end
                    return null;
                }
                stream.start = stream.pos;
                pieces.push({ text, style: style ?? '' });
            }
            if (isScript) {
                refine(pieces, language === 'typescript');
            }
            for (const { text, style } of pieces) {
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
