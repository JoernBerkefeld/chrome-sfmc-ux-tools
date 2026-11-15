/*
 * SFMC UX Tools — documentation for what the mouse rests on in the code editor.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SSJS, isInMode, languageAt, report, ssjsOnly } from './shared.js';
import { diagnosticsAt } from './diagnostics.js';
import { renderMarkdown } from './markdown.js';
import { createTooltip } from './tooltip.js';

const SHOW_DELAY = 350;
// time to move the mouse from the code onto the box
const HIDE_DELAY = 250;

/**
 * Asks the language service what it knows about a place in the document.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of a character
 * @returns {object | null} hover of the language service, or null if it has nothing to say
 */
function hoverAt(cm, place) {
    const text = cm.getValue();
    const language = languageAt(text, cm.indexFromPos(place));
    if (language !== AMPSCRIPT && language !== SSJS) {
        return null;
    }
    return sfmcLanguageService.getHover(
        {
            text: language === SSJS ? ssjsOnly(text) : text,
            languageId: language,
            uri: DOCUMENT_URI,
        },
        cm.getLine(place.line),
        { line: place.line, character: place.ch },
    );
}

/**
 * Finds the character under the mouse.
 *
 * @param {object} cm CodeMirror instance
 * @param {{clientX: number, clientY: number}} point where the mouse is
 * @returns {{line: number, ch: number} | null} the character, or null beside the text
 */
function characterAt(cm, point) {
    const found = cm.coordsChar({ left: point.clientX, top: point.clientY }, 'window');
    if (found.outside) {
        return null;
    }
    // the nearest gap between two characters is reported; the mouse is on the character before it
    // when it is left of that gap
    const ch = found.xRel < 0 ? found.ch - 1 : found.ch;
    return ch < 0 ? null : { line: found.line, ch };
}

/**
 * Builds the content of the box: first what is wrong at the place, then its documentation.
 *
 * @param {Document} document document of the editor
 * @param {{severity: string, message: string, code: string, address: string}[]} problems errors and warnings at the place
 * @param {string} [markdown] documentation of the language service
 * @returns {DocumentFragment} what to show
 */
function render(document, problems, markdown) {
    const result = document.createDocumentFragment();
    for (const { severity, message, code, address } of problems) {
        const element = document.createElement('p');
        element.className = `sfmc-problem sfmc-problem-${severity}`;
        element.textContent = message;
        if (code) {
            const rule = document.createElement(address.startsWith('https://') ? 'a' : 'span');
            rule.className = 'sfmc-problem-rule';
            rule.textContent = code;
            if (rule.tagName === 'A') {
                rule.href = address;
                rule.target = '_blank';
                rule.rel = 'noopener noreferrer';
            }
            element.append(' ', rule);
        }
        result.append(element);
    }
    if (markdown) {
        result.append(renderMarkdown(document, markdown));
    }
    return result;
}

/**
 * Sets up hovers for one editor.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerHover(cm) {
    const wrapper = cm.getWrapperElement();
    const tooltip = createTooltip(wrapper.ownerDocument, 'sfmc-hover');
    const timers = { show: undefined, hide: undefined };
    let shown = '';

    const hide = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        shown = '';
        tooltip.hide();
    };
    const hideSoon = () => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        timers.hide = setTimeout(hide, HIDE_DELAY);
    };
    const show = (point) => {
        try {
            const place = isInMode(cm) ? characterAt(cm, point) : null;
            const hover = place && hoverAt(cm, place);
            const markdown = hover?.contents?.value;
            const problems = place ? diagnosticsAt(cm, place) : [];
            if (!markdown && !problems.length) {
                hide();
                return;
            }
            const start = hover?.range?.start;
            const anchor = start ? { line: start.line, ch: start.character } : place;
            const key = JSON.stringify([anchor, problems, markdown]);
            if (key === shown && tooltip.isShown()) {
                return;
            }
            shown = key;
            tooltip.show(
                render(wrapper.ownerDocument, problems, markdown),
                cm.charCoords(anchor, 'window'),
            );
        } catch (ex) {
            report(ex);
        }
    };

    wrapper.addEventListener('mousemove', (event) => {
        clearTimeout(timers.show);
        clearTimeout(timers.hide);
        // not while something is dragged or selected with the mouse
        if (event.buttons) {
            return;
        }
        const point = { clientX: event.clientX, clientY: event.clientY };
        timers.show = setTimeout(() => show(point), SHOW_DELAY);
    });
    wrapper.addEventListener('mouseleave', hideSoon);
    wrapper.addEventListener('mousedown', hide);
    tooltip.element.addEventListener('mouseenter', () => clearTimeout(timers.hide));
    tooltip.element.addEventListener('mouseleave', hideSoon);
    cm.on('keydown', hide);
    cm.on('scroll', hide);
    cm.on('change', hide);
}
