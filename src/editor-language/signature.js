/*
 * SFMC UX Tools — parameter help: while the cursor is inside the brackets of a call, a box
 * shows the function's parameters and marks the one that is being typed.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SSJS, isInMode, languageAt, report, ssjsOnly } from './shared.js';
import { renderMarkdown } from './markdown.js';
import { createTooltip } from './tooltip.js';

const UPDATE_DELAY = 120;
// the name in front of a call's bracket, with the objects it belongs to
const CALLED_NAME = /(?:[\w$]+\.)*[\w$]+$/;

/**
 * Finds the opening bracket of the call the text ends in.
 *
 * @param {string} text document up to the cursor
 * @returns {number} place of the bracket, or -1 outside a call
 */
function openBracket(text) {
    let depth = 0;
    for (let index = text.length - 1; index >= 0; index--) {
        if (text[index] === ')') {
            depth++;
        } else if (text[index] === '(' && depth-- === 0) {
            return index;
        }
    }
    return -1;
}

/**
 * Tells whether a signature belongs to what is called. The SSJS half of the language service
 * goes by the last name alone, so "anything.Get(" would get the help of "HTTP.Get(".
 *
 * @param {string} label signature, like "Platform.Function.Lookup(deName, ...)"
 * @param {string} text document up to the cursor
 * @returns {boolean} true if the name in front of the bracket is that of the signature
 */
function isCalled(label, text) {
    const name = label.slice(0, label.indexOf('(')).toLowerCase();
    const called = CALLED_NAME.exec(text.slice(0, openBracket(text)).trimEnd())?.[0].toLowerCase();
    // the full name, or a shortened one that still names its object, like "Variable.SetValue"
    return (
        Boolean(called) &&
        (called === name || (called.includes('.') && name.endsWith('.' + called)))
    );
}

/**
 * Asks the language service for the call the cursor is in.
 *
 * @param {object} cm CodeMirror instance
 * @returns {{signature: object, active: number} | null} the signature and the number of the parameter that is being typed
 */
function helpAt(cm) {
    const text = cm.getValue();
    const offset = cm.indexFromPos(cm.getCursor());
    const language = languageAt(text, offset);
    if (language !== AMPSCRIPT && language !== SSJS) {
        return null;
    }
    const source = language === SSJS ? ssjsOnly(text) : text;
    const before = source.slice(0, offset);
    const help = sfmcLanguageService.getSignatureHelp(
        { text: source, languageId: language, uri: DOCUMENT_URI },
        before,
    );
    const signature = help?.signatures?.[help.activeSignature ?? 0];
    return !signature || (language === SSJS && !isCalled(signature.label, before))
        ? null
        : { signature, active: help.activeParameter ?? 0 };
}

/**
 * Finds where a parameter stands in the text of its signature.
 *
 * @param {object} signature signature of the language service
 * @param {number} number which parameter
 * @returns {number[]} start and end in the label; equal if it cannot be found
 */
function parameterRange(signature, number) {
    let from = 0;
    let range = [0, 0];
    // parameters given by name are found one after the other, as names can repeat
    const parameters = (signature.parameters ?? []).slice(0, number + 1);
    for (const parameter of parameters) {
        if (Array.isArray(parameter.label)) {
            range = parameter.label;
        } else {
            const name = parameter.label.split(/[?:]/, 1)[0];
            const start = signature.label.indexOf(name, from);
            range = start === -1 ? [0, 0] : [start, start + name.length];
        }
        from = range[1];
    }
    return range;
}

/**
 * Builds the content of the box.
 *
 * @param {Document} document document of the editor
 * @param {object} signature signature of the language service
 * @param {number} active number of the parameter that is being typed
 * @returns {DocumentFragment} the signature with that parameter marked, and what the parameter is for
 */
function render(document, signature, active) {
    const result = document.createDocumentFragment();
    const [start, end] = parameterRange(signature, active);
    const label = document.createElement('pre');
    const marked = document.createElement('strong');
    marked.textContent = signature.label.slice(start, end);
    label.append(signature.label.slice(0, start), marked, signature.label.slice(end));
    result.append(label);
    const documentation = signature.parameters?.[active]?.documentation;
    const text = documentation?.value ?? documentation;
    if (text) {
        result.append(renderMarkdown(document, text));
    }
    return result;
}

/**
 * Sets up parameter help for one editor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {() => void} takes the box away
 */
export function registerSignature(cm) {
    const document = cm.getWrapperElement().ownerDocument;
    const tooltip = createTooltip(document, 'sfmc-signature');
    let timer;

    const hide = () => {
        clearTimeout(timer);
        tooltip.hide();
    };
    const update = () => {
        try {
            const help =
                isInMode(cm) &&
                cm.getWrapperElement().isConnected &&
                cm.hasFocus() &&
                !cm.somethingSelected()
                    ? helpAt(cm)
                    : null;
            if (help) {
                tooltip.show(
                    render(document, help.signature, help.active),
                    cm.cursorCoords(true, 'window'),
                );
            } else {
                tooltip.hide();
            }
        } catch (ex) {
            tooltip.hide();
            report(ex);
        }
    };

    cm.on('cursorActivity', () => {
        clearTimeout(timer);
        timer = setTimeout(update, UPDATE_DELAY);
    });
    cm.on('blur', hide);
    cm.on('scroll', hide);
    // Escape closes the box and goes on to whatever else the key does in the editor
    cm.addKeyMap({
        Esc: (editor) => {
            hide();
            return editor.constructor.Pass;
        },
    });
    return hide;
}
