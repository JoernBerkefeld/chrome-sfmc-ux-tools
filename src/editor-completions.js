/*
 * SFMC UX Tools — AMPscript completions for Marketing Cloud's code editor.
 *
 * Source of the completions script. `npm run build` bundles it together with sfmc-language-lsp
 * into one classic script, which takes this file's place in dist/extension. The suggestions come
 * from that language service; this file only connects it to CodeMirror 5's hint popup.
 *
 * Like the colouring, it has to run in the page's own script world, and it is a file of its own
 * so that a failure in here can never break the colouring.
 */
import { sfmcLanguageService } from 'sfmc-language-lsp';

const BASE_MODE = 'ampScriptHtmlMixed';
const EDITOR_SELECTOR = '.CodeMirror';
const SCAN_DELAY = 50;
const TRIGGER_DELAY = 100;
const DETAIL_LENGTH = 60;
// the typed start of a name, including the @ or @@ of a variable
const WORD_BEFORE_CURSOR = /@{0,2}\w*$/;
const TRIGGER_CHARACTER = /[\w@]$/;
const QUIET_STYLES = /\bsfmc-(?:string|comment)\b/;
// snippet syntax of the language service: $1, ${1} or ${1:name}
const PLACEHOLDER = /\$(?:\d+|\{\d+(?::[^}]*)?\})/;
// a named placeholder of a snippet, which is how the language service lists a function's parameters
const PARAMETER = /\$\{\d+:([^}]*)\}/g;
const KIND_FUNCTION = 3;
const KIND_NAMES = { 3: 'function', 6: 'variable', 14: 'keyword' };
// marks editors that are set up; a registered symbol, so that a second copy of this script recognises it too
const REGISTERED = Symbol.for('sfmcUxTools.completions');
const timers = new WeakMap();
const state = { hasReported: false, isScanPending: false };

/**
 * Notes the first failure in the console and stays silent afterwards.
 *
 * @param {unknown} ex what was thrown
 */
function report(ex) {
    if (state.hasReported) {
        return;
    }
    state.hasReported = true;
    // eslint-disable-next-line no-console -- the only trace of a failure that is otherwise swallowed
    console.debug('SFMC UX Tools: completions failed', ex);
}

/**
 * Tells whether an editor currently uses Marketing Cloud's AMPscript mode.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for the AMPscript mode, also through a MIME type or another alias
 */
function isInMode(cm) {
    try {
        return cm.constructor.resolveMode(cm.getOption('mode')).name === BASE_MODE;
    } catch {
        return false;
    }
}

/**
 * Turns a snippet of the language service into the plain text to insert: a function becomes its
 * name with the opening bracket, everything else is cut where its first placeholder would start,
 * which is where the cursor belongs.
 *
 * @param {object} item completion item of the language service
 * @returns {string} text to insert
 */
function insertText(item) {
    if (item.kind === KIND_FUNCTION) {
        return item.label + '(';
    }
    const text = item.insertText ?? item.label;
    const end = text.search(PLACEHOLDER);
    return end === -1 ? text : text.slice(0, end);
}

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
 * Describes a function by its category and the names of its parameters. The language service
 * writes the category as "(Category) Name"; the name is left out, as the entry starts with it.
 *
 * @param {object} item completion item of a function
 * @returns {string} for example "Data Extension · dataObject, returnColumn"
 */
function signature(item) {
    const detail = describe(item);
    const category = detail.startsWith('(') ? detail.slice(1, detail.indexOf(')')) : detail;
    const parameters = String(item.insertText ?? '')
        .matchAll(PARAMETER)
        .map((match) => match[1])
        .toArray()
        .join(', ');
    return [category, parameters].filter(Boolean).join(' · ');
}

/**
 * Converts a completion item of the language service into a CodeMirror hint.
 *
 * @param {object} item completion item of the language service
 * @returns {object} CodeMirror hint
 */
function toHint(item) {
    const full = item.kind === KIND_FUNCTION ? signature(item) : describe(item);
    const detail = full.length > DETAIL_LENGTH ? full.slice(0, DETAIL_LENGTH - 1) + '…' : full;
    return {
        text: insertText(item),
        displayText: item.label,
        render: (element) => render(element, item.label, detail),
    };
}

/**
 * CodeMirror hint function: asks the language service what fits at the cursor and keeps the
 * suggestions that start with the word typed so far.
 *
 * @param {object} cm CodeMirror instance
 * @returns {object | null} hints and the range they replace, or null if there are none
 */
function hint(cm) {
    try {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const typed = WORD_BEFORE_CURSOR.exec(line.slice(0, cursor.ch))[0];
        const needle = typed.toLowerCase();
        // with the cursor inside a word, the rest of the word is replaced as well
        const end = cursor.ch + /^\w*/.exec(line.slice(cursor.ch))[0].length;
        const hasBracket = line[end] === '(';
        const list = sfmcLanguageService
            .getCompletions(
                { text: cm.getValue(), languageId: 'ampscript', uri: 'inmemory://editor' },
                { line: cursor.line, character: cursor.ch },
            )
            .filter((item) => item.label.toLowerCase().startsWith(needle))
            .map((item) => toHint(item))
            // a variable that is being typed is offered as itself; picking it would change nothing
            .filter((entry) => entry.text !== typed);
        if (hasBracket) {
            for (const entry of list) {
                entry.text = entry.text.replace(/\($/, '');
            }
        }
        if (!list.length) {
            return null;
        }
        return {
            list,
            from: { line: cursor.line, ch: cursor.ch - typed.length },
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
        const isStillTyped = TRIGGER_CHARACTER.test(cm.getLine(cursor.line).slice(0, cursor.ch));
        if (
            !isStillTyped ||
            cm.state.completionActive ||
            QUIET_STYLES.test(cm.getTokenTypeAt(cursor) ?? '')
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
 * Handles typed input: schedules the popup after a word character or @.
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
function register(cm) {
    cm[REGISTERED] = true;
    // the key goes on to the editor's own handling whenever there is nothing for us to do
    cm.addKeyMap({
        'Ctrl-Space': (editor) => (didShow(editor) ? undefined : editor.constructor.Pass),
    });
    cm.on('inputRead', onInputRead);
}

/**
 * Sets up every AMPscript editor on the page that is not set up yet.
 */
function scan() {
    state.isScanPending = false;
    for (const { CodeMirror: cm } of document.querySelectorAll(EDITOR_SELECTOR)) {
        try {
            if (
                cm &&
                cm[REGISTERED] !== true &&
                typeof cm.addKeyMap === 'function' &&
                isInMode(cm)
            ) {
                register(cm);
            }
        } catch {
            // one odd editor must not keep the others from being set up
        }
    }
}

/**
 * Runs a scan shortly, however many page changes arrive until then.
 */
function scheduleScan() {
    if (state.isScanPending) {
        return;
    }

    state.isScanPending = true;
    setTimeout(scan, SCAN_DELAY);
}

new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
});
try {
    scan();
} catch (ex) {
    report(ex);
}
