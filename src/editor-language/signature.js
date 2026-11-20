/*
 * SFMC UX Tools — parameter help: while the cursor is inside the brackets of a call, a box
 * shows the function's parameters and marks the one that is being typed.
 */
import { isInMode, report } from './shared.js';
import { helpAt as findHelp } from './core/lookup.js';
import { renderMarkdown } from './markdown.js';
import { createTooltip } from './tooltip.js';

export const UPDATE_DELAY = 120;

/**
 * Asks the language service for the call the cursor is in.
 *
 * @param {object} cm CodeMirror instance
 * @returns {{signature: object, active: number} | null} the signature and the number of the parameter that is being typed
 */
function helpAt(cm) {
    const cursor = cm.getCursor();
    return findHelp(cm.getValue(), { line: cursor.line, character: cursor.ch });
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
export function renderSignature(document, signature, active) {
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
    const tooltip = createTooltip(document, 'sfmc-signature', cm.getWrapperElement());
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
                    renderSignature(document, help.signature, help.active),
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
