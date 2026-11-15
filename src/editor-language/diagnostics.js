/*
 * SFMC UX Tools — errors and warnings: what the language service objects to is underlined in
 * the code editor, and resting the mouse on it says why.
 */
import {
    DEFAULT_SETTINGS,
    getScriptRegions,
    sfmcLanguageService,
    validateMixedDocumentSsjs,
} from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SSJS, isInMode, report } from './shared.js';

const CHECK_DELAY = 500;
// severities of the language service, most serious first
const SEVERITY_NAMES = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };
const found = new WeakMap();

/**
 * Collects what the language service objects to in a document: its AMPscript, and the SSJS of
 * its server-side scripts. Browser scripts are not looked at.
 *
 * @param {string} text whole document
 * @returns {object[]} diagnostics of the language service
 */
function check(text) {
    const list = sfmcLanguageService.validate({
        text,
        languageId: AMPSCRIPT,
        uri: DOCUMENT_URI,
    });
    if (getScriptRegions(text).some((region) => region.kind === SSJS)) {
        list.push(...validateMixedDocumentSsjs(text, DEFAULT_SETTINGS));
    }
    return list.slice(0, DEFAULT_SETTINGS.maxNumberOfProblems);
}

/**
 * Converts a place of the language service into one of CodeMirror.
 *
 * @param {{line: number, character: number}} position place of the language service
 * @returns {{line: number, ch: number}} place of CodeMirror
 */
function toPlace(position) {
    return { line: position.line, ch: position.character };
}

/**
 * Checks an editor's content and underlines what was found.
 *
 * @param {object} cm CodeMirror instance
 */
function update(cm) {
    try {
        const list = isInMode(cm) ? check(cm.getValue()) : [];
        cm.operation(() => {
            const old = found.get(cm) ?? [];
            for (const { mark } of old) {
                mark.clear();
            }
            const entries = list.map((diagnostic) => {
                const from = toPlace(diagnostic.range.start);
                let to = toPlace(diagnostic.range.end);
                // something has to carry the underline
                if (from.line === to.line && from.ch === to.ch) {
                    // the character after the place, or the one before it at the end of a line
                    if (to.ch < cm.getLine(to.line).length) {
                        to = { line: to.line, ch: to.ch + 1 };
                    } else {
                        from.ch = Math.max(0, from.ch - 1);
                    }
                }
                const severity = SEVERITY_NAMES[diagnostic.severity] ?? SEVERITY_NAMES[1];
                const mark = cm.markText(from, to, {
                    className: `sfmc-diagnostic sfmc-diagnostic-${severity}`,
                });
                return { mark, diagnostic, severity };
            });
            found.set(cm, entries);
        });
    } catch (ex) {
        report(ex);
    }
}

/**
 * Lists what was found at a character of an editor.
 *
 * @param {object} cm CodeMirror instance
 * @param {{line: number, ch: number}} place line and column of the character
 * @returns {{severity: string, message: string, code: string, address: string}[]} what to tell about that place
 */
export function diagnosticsAt(cm, place) {
    const result = [];
    const entries = found.get(cm) ?? [];
    for (const { mark, diagnostic, severity } of entries) {
        const range = mark.find();
        if (
            range &&
            cm.indexFromPos(range.from) <= cm.indexFromPos(place) &&
            cm.indexFromPos(place) < cm.indexFromPos(range.to)
        ) {
            result.push({
                severity,
                message: String(diagnostic.message),
                code: String(diagnostic.code ?? ''),
                address: String(diagnostic.codeDescription?.href ?? ''),
            });
        }
    }
    return result;
}

/**
 * Sets up errors and warnings for one editor: checked now and whenever typing pauses.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerDiagnostics(cm) {
    let timer;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => update(cm), CHECK_DELAY);
    };
    cm.on('change', schedule);
    // a change of the mode may make this an editor for something else
    cm.on('optionChange', schedule);
    // another document in the same editor is other content
    cm.on('swapDoc', schedule);
    schedule();
}
