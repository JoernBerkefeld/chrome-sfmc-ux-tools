/*
 * SFMC UX Tools — colours code in the boxes of the language features on a page whose editor is
 * Ace. The code is read with the page's Ace and gets the classes CodeMirror would give it, so
 * that the boxes look the same as in Content Builder (../colour.js) with the same styles.
 */
import { AMPSCRIPT, report } from '../shared.js';
import { refine } from '../colour.js';

// languages of code blocks that are coloured as JavaScript
const SCRIPT_LANGUAGES = new Set(['typescript', 'javascript', 'js', 'ssjs']);
/*
 * Token types of Ace, those of ./highlight-rules.js first, and the style CodeMirror has for the
 * same thing. A type stands for the types that continue it, so the more specific ones come first.
 */
const STYLES = [
    ['meta.delimiter.ampscript', 'sfmc-delimiter'],
    ['keyword.control.ampscript', 'sfmc-keyword'],
    ['support.function.ampscript', 'sfmc-function'],
    ['variable.personalization', 'sfmc-personalization'],
    ['variable.ampscript', 'sfmc-variable'],
    ['string.ampscript', 'sfmc-string'],
    ['constant.numeric.ampscript', 'sfmc-number'],
    ['comment.ampscript', 'sfmc-comment'],
    ['keyword.operator.ampscript', 'sfmc-operator'],
    ['paren.lparen.ampscript', 'sfmc-text'],
    ['paren.rparen.ampscript', 'sfmc-text'],
    ['text.ampscript', 'sfmc-text'],
    ['support.class.ssjs', 'sfmc-ssjs-object'],
    ['support.function.ssjs', 'sfmc-ssjs-function'],
    ['meta.tag.punctuation', 'tag bracket'],
    ['meta.tag.name', 'tag'],
    ['entity.other.attribute-name', 'attribute'],
    ['keyword.operator.attribute-equals', ''],
    ['string.regexp', 'string-2'],
    ['string', 'string'],
    ['comment', 'comment'],
    ['constant.numeric', 'number'],
    ['constant.language', 'atom'],
    ['storage', 'keyword'],
    ['keyword.operator', 'operator'],
    ['keyword', 'keyword'],
    ['entity.name.function', 'def'],
    ['variable.parameter', 'def'],
    ['support.type', 'type'],
    ['identifier', 'variable'],
    ['variable', 'variable'],
    ['support', 'variable'],
];
// Ace joins neighbours of these types to one token; the refinements look at single characters
const SPLIT_TYPE = /^(?:paren|punctuation)\b/;
// by Ace object: its tokenizer for JavaScript
const scriptTokenizers = new WeakMap();

/**
 * Converts the type of an Ace token into the style of CodeMirror for the same thing.
 *
 * @param {string} type token type, like "string.ampscript"
 * @returns {string} the style, may be empty or several words
 */
export function styleOf(type) {
    const found = STYLES.find(([name]) => type === name || type.startsWith(name + '.'));
    return found ? found[1] : '';
}

/**
 * The page's rules for JavaScript, ready to read code with.
 *
 * @param {object} ace the page's Ace
 * @returns {object} Ace tokenizer
 */
function scriptTokenizer(ace) {
    if (!scriptTokenizers.has(ace)) {
        const { Tokenizer } = ace.require('ace/tokenizer');
        const { JavaScriptHighlightRules } = ace.require('ace/mode/javascript_highlight_rules');
        // without JSX, as in the editor
        const rules = new JavaScriptHighlightRules({ jsx: false }).getRules();
        scriptTokenizers.set(ace, new Tokenizer(rules));
    }
    return scriptTokenizers.get(ace);
}

/**
 * Colours code with the rules of the page's Ace: the mode of the script activity's editor for
 * AMPscript, which is this extension's, and Ace's JavaScript rules for signatures and SSJS
 * examples.
 *
 * @param {object} editor Ace editor that the extension has taken over
 * @param {string} code the code
 * @param {string} language language named by the documentation
 * @returns {DocumentFragment | null} the code in coloured pieces, or null if there are no rules for the language
 */
export function colour(editor, code, language) {
    try {
        const isScript = SCRIPT_LANGUAGES.has(language);
        let tokenizer = null;
        if (isScript) {
            tokenizer = scriptTokenizer(globalThis.ace);
        } else if (language === AMPSCRIPT) {
            tokenizer = editor.getSession().getMode().getTokenizer();
        }
        if (!tokenizer) {
            return null;
        }
        const document = editor.container.ownerDocument;
        const result = document.createDocumentFragment();
        let state = 'start';
        for (const [number, line] of code.split('\n').entries()) {
            if (number) {
                result.append('\n');
            }
            const read = tokenizer.getLineTokens(line, state);
            ({ state } = read);
            const pieces = read.tokens.flatMap(({ type, value }) => {
                const style = styleOf(type);
                const texts = SPLIT_TYPE.test(type) ? [...value] : [value];
                return texts.map((text) => ({ text, style }));
            });
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
