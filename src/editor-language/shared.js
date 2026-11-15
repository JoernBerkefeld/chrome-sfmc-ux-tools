/*
 * SFMC UX Tools — what the language features of the code editor have in common.
 */
import { extractScriptBodies, getScriptRegions } from 'sfmc-language-lsp';

const BASE_MODE = 'ampScriptHtmlMixed';
export const AMPSCRIPT = 'ampscript';
export const SSJS = 'ssjs';
export const JAVASCRIPT = 'javascript';
// the language service has no name for a whole file; like VS Code's "sfmc" documents it is read as AMPscript
export const DOCUMENT_URI = 'inmemory://editor';
export const BROWSER_KINDS = ['browser-classic', 'browser-module'];
// an opening delimiter and what closes it; inside one, AMPscript wins over a browser script around it
const AMPSCRIPT_DELIMITERS = [
    ['%%[', ']%%'],
    ['%%=', '=%%'],
];
const state = { hasReported: false };

/**
 * Notes the first failure in the console and stays silent afterwards.
 *
 * @param {unknown} ex what was thrown
 */
export function report(ex) {
    if (state.hasReported) {
        return;
    }
    state.hasReported = true;
    // eslint-disable-next-line no-console -- the only trace of a failure that is otherwise swallowed
    console.debug('SFMC UX Tools: a language feature failed', ex);
}

/**
 * Tells whether an editor currently uses Marketing Cloud's AMPscript mode.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for the AMPscript mode, also through a MIME type or another alias
 */
export function isInMode(cm) {
    try {
        return cm.constructor.resolveMode(cm.getOption('mode')).name === BASE_MODE;
    } catch {
        return false;
    }
}

/**
 * Tells which language a place in the document belongs to, the way the language server of the
 * VS Code extension routes its requests: the body of a server-side script is SSJS; the body of
 * any other script is the browser's JavaScript, unless an AMPscript block is open there;
 * everything else is AMPscript, which includes the HTML around it.
 *
 * @param {string} text whole document
 * @param {number} offset place in the document
 * @returns {string} AMPSCRIPT, SSJS or JAVASCRIPT
 */
export function languageAt(text, offset) {
    const region = getScriptRegions(text).find(
        (item) => offset >= item.bodyStart && offset <= item.bodyEnd,
    );
    if (region?.kind === SSJS) {
        return SSJS;
    }
    if (!region || !BROWSER_KINDS.includes(region.kind)) {
        return AMPSCRIPT;
    }
    const before = text.slice(0, offset);
    const isInBlock = AMPSCRIPT_DELIMITERS.some(
        ([open, close]) => before.lastIndexOf(open) > before.lastIndexOf(close),
    );
    return isInBlock ? AMPSCRIPT : JAVASCRIPT;
}

/**
 * Blanks everything but the scripts of some kinds; lines and columns stay as they are.
 *
 * @param {string} text whole document
 * @param {string[]} kinds kinds of scripts to keep, as the language service names them
 * @returns {string} text of the same length that only contains those scripts
 */
export function scriptsOnly(text, kinds) {
    return extractScriptBodies(text, kinds).text;
}

/**
 * Blanks everything but the server-side scripts, so that the SSJS half of the language service
 * sees the same lines and columns as the editor.
 *
 * @param {string} text whole document
 * @returns {string} text of the same length that only contains the SSJS
 */
export function ssjsOnly(text) {
    return scriptsOnly(text, [SSJS]);
}
