/*
 * SFMC UX Tools — completions for Marketing Cloud's code editor.
 *
 * The suggestions come from sfmc-language-lsp; this file connects it to CodeMirror 5's hint popup.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SSJS, isInMode, languageAt, report, ssjsOnly } from './shared.js';

const TRIGGER_DELAY = 100;
const DETAIL_LENGTH = 60;
// the typed start of an AMPscript name, including the @ or @@ of a variable
const WORD_BEFORE_CURSOR = /@{0,2}\w*$/;
// the typed start of an SSJS name with the objects it belongs to, like "Platform.Function.Loo"
const CHAIN_BEFORE_CURSOR = /(?:[\w$]+\.)*[\w$]*$/;
const TRIGGER_CHARACTER = /[\w@.$]$/;
// characters that only start a name in SSJS
const SSJS_TRIGGER_CHARACTER = /[.$]$/;
const QUIET_STYLES = new Map([
    [AMPSCRIPT, /\bsfmc-(?:string|comment)\b/],
    [SSJS, /\b(?:string|comment)\b/],
]);
// snippet syntax of the language service: $1, ${1} or ${1:name}
const PLACEHOLDER = /\$(?:\d+|\{\d+(?::[^}]*)?\})/;
// a named placeholder of a snippet, which is how the language service lists a function's parameters
const PARAMETER = /\$\{\d+:([^}]*)\}/g;
const KIND_FUNCTION = 3;
// method, function, constructor and class: described by category and parameters
const CALLABLE_KINDS = new Set([2, KIND_FUNCTION, 4, 7]);
const KIND_NAMES = { 3: 'function', 6: 'variable', 14: 'keyword' };
const timers = new WeakMap();

/**
 * Draws one entry of the popup: the name, followed by a short muted description.
 *
 * @param {HTMLElement} element list entry to fill
 * @param {string} label name of the suggestion
 * @param {string} detail description, may be empty
 */
function render(element, label, detail) {
    try {
        element.textContent = label;
        if (detail) {
            const note = element.ownerDocument.createElement('span');
            note.className = 'sfmc-hint-detail';
            note.textContent = detail;
            element.append(note);
        }
    } catch (ex) {
        report(ex);
    }
}

/**
 * Gives the description the language service has for an item, or the kind of the item.
 *
 * @param {object} item completion item of the language service
 * @returns {string} description, may be empty
 */
function describe(item) {
    return String(item.detail ?? KIND_NAMES[item.kind] ?? '');
}

/**
 * Describes something that can be called by its category and the names of its parameters. The
 * language service writes the category as "(Category) Name"; the name is left out, as the entry
 * starts with it.
 *
 * @param {object} item completion item of a function, method or class
 * @returns {string} for example "Data Extension · dataObject, returnColumn"
 */
function signature(item) {
    const detail = describe(item);
    const category = detail.startsWith('(') ? detail.slice(1, detail.indexOf(')')) : '';
    const parameters = String(item.insertText ?? '')
        .matchAll(PARAMETER)
        .map((match) => match[1])
        .toArray()
        .join(', ');
    // without a snippet, the description may be the call itself, like "Math.floor(x)"
    const call = detail.startsWith(item.label + '(') ? detail.slice(item.label.length) : '';
    return [category, parameters || call].filter(Boolean).join(' · ');
}

/**
 * Converts a completion item of the language service into a CodeMirror hint.
 *
 * @param {object} item completion item of the language service
 * @param {string} text what picking the item inserts
 * @returns {object} CodeMirror hint
 */
function toHint(item, text) {
    const full = CALLABLE_KINDS.has(item.kind) ? signature(item) : describe(item);
    const detail = full.length > DETAIL_LENGTH ? full.slice(0, DETAIL_LENGTH - 1) + '…' : full;
    return {
        text,
        displayText: item.label,
        render: (element) => render(element, item.label, detail),
    };
}

/**
 * Cuts a snippet of the language service where its first placeholder would start, which is
 * where the cursor belongs.
 *
 * @param {object} item completion item of the language service
 * @returns {string} text to insert
 */
function untilPlaceholder(item) {
    const text = item.insertText ?? item.label;
    const end = text.search(PLACEHOLDER);
    return end === -1 ? text : text.slice(0, end);
}

/**
 * AMPscript suggestions at the cursor: those that start with the word typed so far. A function
 * is inserted as its name with the opening bracket.
 *
 * @param {string} text whole document
 * @param {{line: number, ch: number}} cursor where the cursor is
 * @param {string} line text of the line of the cursor
 * @returns {{list: object[], typed: string}} hints and the typed text they replace
 */
function ampscriptHints(text, cursor, line) {
    const typed = WORD_BEFORE_CURSOR.exec(line.slice(0, cursor.ch))[0];
    const needle = typed.toLowerCase();
    const list = sfmcLanguageService
        .getCompletions(
            { text, languageId: AMPSCRIPT, uri: DOCUMENT_URI },
            { line: cursor.line, character: cursor.ch },
        )
        .filter((item) => item.label.toLowerCase().startsWith(needle))
        .map((item) =>
            toHint(item, item.kind === KIND_FUNCTION ? item.label + '(' : untilPlaceholder(item)),
        );
    return { list, typed };
}

/**
 * SSJS suggestions at the cursor. The names of the language service carry their objects, like
 * "Platform.Function.Lookup"; they fit if they start with what was typed, objects included, or
 * if a single typed word starts the name itself, so that "Look" finds the entry above.
 *
 * @param {string} text whole document
 * @param {{line: number, ch: number}} cursor where the cursor is
 * @param {string} line text of the line of the cursor
 * @returns {{list: object[], typed: string}} hints and the typed text they replace
 */
function ssjsHints(text, cursor, line) {
    const before = line.slice(0, cursor.ch);
    const typed = CHAIN_BEFORE_CURSOR.exec(before)[0];
    const start = before.slice(0, before.length - typed.length);
    // a member of something that is not a plain name, like the result of a call: nothing is known about it
    if (start.endsWith('.')) {
        return { list: [], typed };
    }
    const needle = typed.toLowerCase();
    const isWord = needle !== '' && !needle.includes('.');
    const hasNew = /\bnew\s+$/.test(start);
    const first = [];
    const second = [];
    const items = sfmcLanguageService.getCompletions(
        { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
        { line: cursor.line, character: cursor.ch },
    );
    for (const item of items) {
        const insert = untilPlaceholder(item);
        const hint = toHint(item, hasNew ? insert.replace(/^new\s+/, '') : insert);
        if (item.label.toLowerCase().startsWith(needle)) {
            first.push(hint);
        } else if (
            isWord &&
            String(item.filterText ?? '')
                .toLowerCase()
                .split(' ')
                .some((word) => word.startsWith(needle))
        ) {
            second.push(hint);
        }
    }
    return { list: [...first, ...second], typed };
}

/**
 * CodeMirror hint function: asks the language service what fits at the cursor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {object | null} hints and the range they replace, or null if there are none
 */
function hint(cm) {
    try {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const text = cm.getValue();
        const language = languageAt(text, cm.indexFromPos(cursor));
        if (language !== AMPSCRIPT && language !== SSJS) {
            return null;
        }
        const found =
            language === SSJS ? ssjsHints(text, cursor, line) : ampscriptHints(text, cursor, line);
        // a name that is being typed is offered as itself; picking it would change nothing
        const list = found.list.filter((entry) => entry.text !== found.typed);
        // with the cursor inside a word, the rest of the word is replaced as well
        const end = cursor.ch + /^[\w$]*/.exec(line.slice(cursor.ch))[0].length;
        if (line[end] === '(') {
            for (const entry of list) {
                const bracket = entry.text.indexOf('(');
                entry.text = bracket === -1 ? entry.text : entry.text.slice(0, bracket);
            }
        }
        if (!list.length) {
            return null;
        }
        return {
            list,
            from: { line: cursor.line, ch: cursor.ch - found.typed.length },
            to: { line: cursor.line, ch: end },
        };
    } catch (ex) {
        report(ex);
        return null;
    }
}

/**
 * Opens the popup, if the page's CodeMirror has the hint addon, the editor can be edited and
 * there is something to suggest at the cursor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true if the hint addon was asked to show the suggestions
 */
function didShow(cm) {
    try {
        const showHint = cm.constructor.showHint;
        if (
            typeof showHint !== 'function' ||
            !isInMode(cm) ||
            cm.isReadOnly() ||
            cm.somethingSelected() ||
            // asked first, because the hint addon stays active after an empty answer
            !hint(cm)
        ) {
            return false;
        }
        showHint(cm, hint, { completeSingle: false });
        return true;
    } catch (ex) {
        report(ex);
        return false;
    }
}

/**
 * Opens the popup after typing has paused, unless one is open already or the cursor is in a
 * string or comment.
 *
 * @param {object} cm CodeMirror instance
 */
function showAfterTyping(cm) {
    try {
        const cursor = cm.getCursor();
        const before = cm.getLine(cursor.line).slice(0, cursor.ch);
        if (!TRIGGER_CHARACTER.test(before) || cm.state.completionActive) {
            return;
        }
        const language = languageAt(cm.getValue(), cm.indexFromPos(cursor));
        if (
            !QUIET_STYLES.has(language) ||
            QUIET_STYLES.get(language).test(cm.getTokenTypeAt(cursor) ?? '') ||
            (language !== SSJS && SSJS_TRIGGER_CHARACTER.test(before))
        ) {
            return;
        }
    } catch (ex) {
        report(ex);
        return;
    }
    didShow(cm);
}

/**
 * Handles typed input: schedules the popup after a character that can be part of a name.
 *
 * @param {object} cm CodeMirror instance
 * @param {object} change the change CodeMirror reports
 */
function onInputRead(cm, change) {
    clearTimeout(timers.get(cm));
    if (change?.origin === 'paste' || !TRIGGER_CHARACTER.test(change?.text?.at(-1) ?? '')) {
        return;
    }
    timers.set(
        cm,
        setTimeout(() => showAfterTyping(cm), TRIGGER_DELAY),
    );
}

/**
 * Sets up completions for one editor: Ctrl-Space, and the popup while typing.
 *
 * @param {object} cm CodeMirror instance
 */
export function registerCompletions(cm) {
    // the key goes on to the editor's own handling whenever there is nothing for us to do
    cm.addKeyMap({
        'Ctrl-Space': (editor) => (didShow(editor) ? undefined : editor.constructor.Pass),
    });
    cm.on('inputRead', onInputRead);
}
