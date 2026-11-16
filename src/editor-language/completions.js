/*
 * SFMC UX Tools — completions for Marketing Cloud's code editor.
 *
 * The suggestions come from sfmc-language-lsp; this file connects it to CodeMirror 5's hint popup.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';
import {
    AMPSCRIPT,
    BROWSER_KINDS,
    DOCUMENT_URI,
    JAVASCRIPT,
    SSJS,
    isInMode,
    languageAt,
    report,
    scriptsOnly,
    ssjsOnly,
} from './shared.js';
import { askTypescript } from './typescript.js';

const TRIGGER_DELAY = 100;
const DETAIL_LENGTH = 60;
// the typed start of an AMPscript name, including the @ or @@ of a variable
const WORD_BEFORE_CURSOR = /@{0,2}\w*$/;
// the typed start of an SSJS name with the objects it belongs to, like "Platform.Function.Loo"
const CHAIN_BEFORE_CURSOR = /(?:[\w$]+\.)*[\w$]*$/;
const TRIGGER_CHARACTER = /[\w@.$]$/;
// the typed start of a plain JavaScript name
const NAME_BEFORE_CURSOR = /[\w$]*$/;
const QUIET_STYLES = new Map([
    [AMPSCRIPT, /\bsfmc-(?:string|comment)\b/],
    [SSJS, /\b(?:string|comment)\b/],
    [JAVASCRIPT, /\b(?:string|comment)\b/],
]);
// what may end the typed text for the popup to open by itself; a dot only continues a name in SSJS
const TYPED_END = new Map([
    [AMPSCRIPT, /[\w@]$/],
    [SSJS, /[\w$.]$/],
    [JAVASCRIPT, /[\w$]$/],
]);
// comments and strings, whose words are no names
const JAVASCRIPT_TEXT =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// a name that is not the member of something
const JAVASCRIPT_NAME = /(?<![\w$.])[A-Za-z_$][\w$]*/g;
// the words every version of JavaScript has, SSJS included
const KEYWORDS = [
    'break',
    'case',
    'catch',
    'continue',
    'default',
    'delete',
    'do',
    'else',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'in',
    'instanceof',
    'new',
    'null',
    'return',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'undefined',
    'var',
    'void',
    'while',
    'with',
];
// what only the browser understands; SSJS rejects these
const BROWSER_KEYWORDS = [
    'async',
    'await',
    'class',
    'const',
    'export',
    'extends',
    'import',
    'let',
    'of',
    'static',
    'super',
    'yield',
];
const BROWSER_GLOBALS = [
    'Array',
    'Boolean',
    'Date',
    'Error',
    'JSON',
    'Map',
    'Math',
    'Number',
    'Object',
    'Promise',
    'RegExp',
    'Set',
    'String',
    'Symbol',
    'clearInterval',
    'clearTimeout',
    'console',
    'decodeURIComponent',
    'document',
    'encodeURIComponent',
    'fetch',
    'isNaN',
    'localStorage',
    'location',
    'navigator',
    'parseFloat',
    'parseInt',
    'sessionStorage',
    'setInterval',
    'setTimeout',
    'window',
];
// snippet syntax of the language service: $1, ${1} or ${1:name}
const PLACEHOLDER = /\$(?:\d+|\{\d+(?::[^}]*)?\})/;
// a named placeholder of a snippet, which is how the language service lists a function's parameters
const PARAMETER = /\$\{\d+:([^}]*)\}/g;
const KIND_FUNCTION = 3;
// method, function, constructor and class: described by category and parameters
const CALLABLE_KINDS = new Set([2, KIND_FUNCTION, 4, 7]);
const KIND_NAMES = { 3: 'function', 6: 'variable', 14: 'keyword' };
// a member access on a dotted name, with what is typed of the member: "de.Rows.Ad"
const RECEIVER_CHAIN = /((?:[\w$]+\s*\.\s*)*[\w$]+)\s*\.\s*[\w$]*$/;
// a member access on any expression, with what is typed of the member
const MEMBER_BEFORE_CURSOR = /\.([\w$]*)$/;
// how members are described that the catalogue does not know
const MEMBER_KIND_NAMES = { 2: 'method', 3: 'function', 5: 'field', 6: 'variable', 10: 'property' };
// the members TypeScript found last, and the document up to their dot, which they belong to
const lastMembers = { upToDot: undefined, items: null };
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
        item,
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
 * Makes a hint for a plain word, which is inserted as it is.
 *
 * @param {string} label the word
 * @param {string} detail what kind of word it is
 * @returns {object} CodeMirror hint
 */
function wordHint(label, detail) {
    return { text: label, displayText: label, render: (element) => render(element, label, detail) };
}

/**
 * Collects the names used in the scripts of some kinds, without the one that is being typed.
 *
 * @param {string} text whole document
 * @param {string[]} kinds kinds of scripts to read, as the language service names them
 * @param {number} from where the typed name starts
 * @param {number} to where the typed name ends
 * @returns {Set.<string>} names in the order of their first use
 */
function namesIn(text, kinds, from, to) {
    const others = text.slice(0, from) + ' '.repeat(to - from) + text.slice(to);
    const code = scriptsOnly(others, kinds).replaceAll(JAVASCRIPT_TEXT, ' ');
    return new Set(code.match(JAVASCRIPT_NAME));
}

/**
 * Plain JavaScript suggestions for a name that is being typed: the names the scripts of the
 * same kind use, the language's own words and, in the browser, its usual globals. Nothing is
 * known about the members of a value, so nothing is offered after a dot.
 *
 * @param {object} cm CodeMirror instance
 * @param {string} text whole document
 * @param {string} line text of the line of the cursor
 * @param {boolean} isBrowser true for a script of the browser, false for SSJS
 * @returns {{list: object[], typed: string}} hints and the typed text they replace
 */
function javascriptHints(cm, text, line, isBrowser) {
    const cursor = cm.getCursor();
    const before = line.slice(0, cursor.ch);
    const typed = NAME_BEFORE_CURSOR.exec(before)[0];
    if (before.slice(0, before.length - typed.length).endsWith('.')) {
        return { list: [], typed };
    }
    const to = cm.indexFromPos(cursor) + /^[\w$]*/.exec(line.slice(cursor.ch))[0].length;
    const from = cm.indexFromPos(cursor) - typed.length;
    const kinds = isBrowser ? BROWSER_KINDS : [SSJS];
    const words = new Map();
    for (const name of namesIn(text, kinds, from, to)) {
        words.set(name, 'in this content');
    }
    const globals = isBrowser ? BROWSER_GLOBALS : [];
    for (const name of globals) {
        words.set(name, 'global');
    }
    const keywords = isBrowser ? [...KEYWORDS, ...BROWSER_KEYWORDS] : KEYWORDS;
    for (const name of keywords) {
        words.set(name, 'keyword');
    }
    const needle = typed.toLowerCase();
    const list = words
        .entries()
        .filter(([name]) => name.toLowerCase().startsWith(needle))
        .map(([name, detail]) => wordHint(name, detail))
        .toArray();
    return { list, typed };
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
 * Finds the dotted name in front of the last dot before the cursor, which is what the catalogue
 * knows members of.
 *
 * @param {string} before the cursor's line up to the cursor
 * @returns {{receiver: string, hasNew: boolean}} the name, empty if the dot follows something else, and whether `new` precedes it
 */
function memberReceiver(before) {
    const match = RECEIVER_CHAIN.exec(before);
    const start = match ? before.slice(0, match.index) : '';
    // "a().b." and "a[0].b.": the name is a member of a value, not one the catalogue describes
    return !match || /[.)\]]\s*$/.test(start)
        ? { receiver: '', hasNew: false }
        : { receiver: match[1], hasNew: /\bnew\s+$/.test(start) };
}

/**
 * Asks TypeScript for the members of the value in front of the cursor's dot. The catalogue
 * describes those it knows. The popup asks twice when it opens and again for every character
 * typed of the member's name, none of which changes the members, so the last answer is kept for
 * as long as the document up to the dot stays the same.
 *
 * @param {string} text whole document
 * @param {{line: number, ch: number}} cursor where the cursor is
 * @param {string} before the cursor's line up to the cursor
 * @param {string} upToDot the document up to and including the dot
 * @returns {object[] | null} completion items named by the member alone; null if TypeScript is not there or knows no members
 */
function typescriptMembers(text, cursor, before, upToDot) {
    if (lastMembers.upToDot === upToDot) {
        return lastMembers.items;
    }
    return askTypescript(text, (service) => {
        const position = { line: cursor.line, character: cursor.ch };
        const info = service.completions(position);
        const items = service.memberCompletions({
            typescriptItems: info.items,
            isMemberAccess: info.isMemberCompletion,
            catalogueItems: sfmcLanguageService.getCompletions(
                { text: ssjsOnly(text), languageId: SSJS, uri: DOCUMENT_URI },
                position,
            ),
            ...memberReceiver(before),
        });
        Object.assign(lastMembers, { upToDot, items });
        return items;
    });
}

/**
 * SSJS suggestions after a dot, for which TypeScript knows the members of the value in front of
 * it: those that start with what is typed of the member's name, which is all that is replaced.
 *
 * @param {string} text whole document
 * @param {{line: number, ch: number}} cursor where the cursor is
 * @param {string} line text of the line of the cursor
 * @param {number} offset place of the cursor in the document
 * @returns {{list: object[], typed: string} | null} hints and the typed text they replace; null where today's suggestions apply
 */
function memberHints(text, cursor, line, offset) {
    const before = line.slice(0, cursor.ch);
    const member = MEMBER_BEFORE_CURSOR.exec(before);
    if (!member) {
        return null;
    }
    const typed = member[1];
    const items = typescriptMembers(text, cursor, before, text.slice(0, offset - typed.length));
    if (!items) {
        return null;
    }
    const needle = typed.toLowerCase();
    const list = items
        .filter((item) => item.label.toLowerCase().startsWith(needle))
        .map((item) =>
            toHint(
                { ...item, detail: item.detail ?? MEMBER_KIND_NAMES[item.kind] },
                untilPlaceholder(item),
            ),
        );
    // no member starts like this: today's suggestions get their turn
    return list.length ? { list, typed } : null;
}

/**
 * Collects the suggestions of a language at the cursor. In SSJS, the plain JavaScript names
 * follow those of Marketing Cloud.
 *
 * @param {object} cm CodeMirror instance
 * @param {string} language language at the cursor
 * @param {string} text whole document
 * @param {string} line text of the line of the cursor
 * @returns {{list: object[], typed: string}} hints and the typed text they replace
 */
function hintsFor(cm, language, text, line) {
    const cursor = cm.getCursor();
    if (language === JAVASCRIPT) {
        return javascriptHints(cm, text, line, true);
    }
    if (language !== SSJS) {
        return ampscriptHints(text, cursor, line);
    }
    const members = memberHints(text, cursor, line, cm.indexFromPos(cursor));
    if (members) {
        return members;
    }
    const found = ssjsHints(text, cursor, line);
    if (found.typed.includes('.')) {
        return found;
    }
    const known = new Set(found.list.map((entry) => entry.displayText));
    const plain = javascriptHints(cm, text, line, false).list.filter(
        (entry) => !known.has(entry.displayText),
    );
    return { list: [...found.list, ...plain], typed: found.typed };
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
        const found = hintsFor(cm, language, text, line);
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
        const data = {
            list,
            from: { line: cursor.line, ch: cursor.ch - found.typed.length },
            to: { line: cursor.line, ch: end },
        };
        return data;
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
        if (cm.state.completionActive) {
            return;
        }
        const language = languageAt(cm.getValue(), cm.indexFromPos(cursor));
        if (
            !TYPED_END.get(language)?.test(before) ||
            QUIET_STYLES.get(language).test(cm.getTokenTypeAt(cursor) ?? '')
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
