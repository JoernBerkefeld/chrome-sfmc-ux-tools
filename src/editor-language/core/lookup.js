/*
 * SFMC UX Tools — what the language service knows about a place in a document, without an
 * editor: its documentation, the call it is in, and where its name is declared.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import {
    AMPSCRIPT,
    DOCUMENT_URI,
    IS_NEXT,
    SETTINGS,
    SSJS,
    languageAt,
    ssjsOnly,
} from '../shared.js';
import { lineAt, offsetAt } from './text.js';
import { askTypescript } from '../typescript.js';

// the name in front of a call's bracket, with the objects it belongs to
const CALLED_NAME = /(?:[\w$]+\.)*[\w$]+$/;

/**
 * Tells whether the language service is asked about code of a language. Marketing Cloud Next
 * does not run server-side JavaScript, so nothing is said about it there.
 *
 * @param {string} language language of a place, as `languageAt` names it
 * @returns {boolean} true for AMPscript, and for SSJS in Marketing Cloud Engagement
 */
function isServed(language) {
    return language === AMPSCRIPT || (language === SSJS && !IS_NEXT);
}

/**
 * Tells whether a place is inside a Handlebars expression of its line.
 *
 * @param {string} line the line
 * @param {number} character column of a character
 * @returns {boolean} true after an opening `{{` that is not closed before the place
 */
function isInHandlebars(line, character) {
    const before = line.slice(0, character + 1);
    return before.lastIndexOf('{{') > before.lastIndexOf('}}');
}

/**
 * Asks the language service what it knows about a place in the document. Marketing Cloud Next
 * explains Handlebars itself, so nothing is said about it there.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {{line: number, character: number}} position line and column of a character
 * @returns {object | null} hover of the language service, with its Markdown as `contents.value` and its `range`, or null if it has nothing to say
 */
export function hoverAt(text, position) {
    const language = languageAt(text, offsetAt(text, position));
    if (!isServed(language)) {
        return null;
    }
    if (IS_NEXT && isInHandlebars(lineAt(text, position.line), position.character)) {
        return null;
    }
    const place = { line: position.line, character: position.character };
    // TypeScript knows the types of the content's own code; the catalogue is the fallback
    const typed = language === SSJS ? askTypescript(text, (service) => service.hover(place)) : null;
    if (typed?.contents?.value) {
        return typed;
    }
    return sfmcLanguageService.getHover(
        {
            text: language === SSJS ? ssjsOnly(text) : text,
            languageId: language,
            uri: DOCUMENT_URI,
        },
        lineAt(text, position.line),
        place,
        SETTINGS,
    );
}

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
 * Asks the language service for the call a place is in.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {{line: number, character: number}} position where the cursor is
 * @returns {{signature: object, active: number} | null} the signature and the number of the parameter that is being typed
 */
export function helpAt(text, position) {
    const offset = offsetAt(text, position);
    const language = languageAt(text, offset);
    if (!isServed(language)) {
        return null;
    }
    if (language === SSJS) {
        // TypeScript resolves what is called, so its answer needs no check of the name
        const typed = askTypescript(text, (service) =>
            service.signatureHelp({ line: position.line, character: position.character }),
        );
        const called = typed?.signatures?.[typed.activeSignature ?? 0];
        if (called) {
            return { signature: called, active: typed.activeParameter ?? 0 };
        }
    }
    const source = language === SSJS ? ssjsOnly(text) : text;
    const before = source.slice(0, offset);
    const help = sfmcLanguageService.getSignatureHelp(
        { text: source, languageId: language, uri: DOCUMENT_URI },
        before,
        SETTINGS,
    );
    const signature = help?.signatures?.[help.activeSignature ?? 0];
    return !signature || (language === SSJS && !isCalled(signature.label, before))
        ? null
        : { signature, active: help.activeParameter ?? 0 };
}

/**
 * Finds where the name at a place is declared.
 *
 * @param {string} text whole document, its lines ending with a line feed
 * @param {{line: number, character: number}} position line and column of a character
 * @returns {{line: number, character: number} | null} start of the declaration, or null if the language service knows none
 */
export function definitionAt(text, position) {
    if (languageAt(text, offsetAt(text, position)) !== SSJS) {
        return null;
    }
    // TypeScript also finds variables, parameters and the members of the content's own objects
    const typed = askTypescript(text, (service) =>
        service.definition({ line: position.line, character: position.character }),
    );
    const found = typed?.[0]?.range?.start;
    if (found) {
        return { line: found.line, character: found.character };
    }
    const line = lineAt(text, position.line);
    const before = /[\w$]*$/.exec(line.slice(0, position.character))[0];
    const word = before + /^[\w$]*/.exec(line.slice(position.character))[0];
    // the member of a value is not the function of the same name
    if (!word || line[position.character - before.length - 1] === '.') {
        return null;
    }
    const location = sfmcLanguageService.getDefinition(
        { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
        word,
    );
    const start = location?.range?.start;
    return start ? { line: start.line, character: start.character } : null;
}
