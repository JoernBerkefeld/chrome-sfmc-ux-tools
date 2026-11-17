/*
 * SFMC UX Tools — errors and warnings of a document, without an editor.
 */
import {
    DEFAULT_SETTINGS,
    getScriptRegions,
    sfmcLanguageService,
    validateMixedDocumentSsjs,
} from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SSJS } from '../shared.js';
import { askTypescript } from '../typescript.js';
import { offsetAt } from './text.js';

/**
 * Collects what the language service objects to in a document: its AMPscript, and the SSJS of
 * its server-side scripts. Browser scripts are not looked at.
 *
 * @param {string} text whole document
 * @returns {object[]} diagnostics of the language service
 */
export function check(text) {
    const list = sfmcLanguageService.validate({
        text,
        languageId: AMPSCRIPT,
        uri: DOCUMENT_URI,
    });
    if (hasSsjs(text)) {
        list.push(...validateMixedDocumentSsjs(text, DEFAULT_SETTINGS));
    }
    return list;
}

/**
 * Tells whether a document has a server-side script.
 *
 * @param {string} text whole document
 * @returns {boolean} true if there is SSJS to check
 */
function hasSsjs(text) {
    return getScriptRegions(text).some((region) => region.kind === SSJS);
}

/**
 * Names the place of a diagnostic, to find the ones that are about the same piece of code.
 *
 * @param {object} diagnostic diagnostic of the language service
 * @returns {string} equal for diagnostics with the same range
 */
function key(diagnostic) {
    const { range } = diagnostic;
    return JSON.stringify([range.start, range.end]);
}

/**
 * Collects what TypeScript objects to in the server-side scripts of a document, like type errors
 * and unknown members. As in the VS Code extension, only what lies inside such a script counts.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {object[]} known diagnostics of the language service; what TypeScript says about the same piece of code is left out, as the language service says it with a remedy
 * @returns {object[]} further diagnostics; empty without the TypeScript script or without SSJS
 */
export function checkTypes(text, known) {
    if (!hasSsjs(text)) {
        return [];
    }
    const seen = new Set(known.map((diagnostic) => key(diagnostic)));
    const list =
        askTypescript(text, (service) =>
            service
                .diagnostics()
                .filter((diagnostic) =>
                    service.isInSsjsRegion(text, offsetAt(text, diagnostic.range.start)),
                ),
        ) ?? [];
    return list.filter((diagnostic) => {
        const isNew = !seen.has(key(diagnostic));
        seen.add(key(diagnostic));
        return isNew;
    });
}
