/*
 * SFMC UX Tools — the editor theme and the SQL check for the code editors of Automation
 * Studio's SQL query activity.
 *
 * That dialog edits its query with Ace in SQL mode, which colours SQL well enough. This file
 * marks those editors as themed, so that they follow the extension's light or dark theme like the
 * editor of the script activity (../../editor-highlight.css); the formatting script takes the
 * same mark as its sign that an editor is one of ours. The page's mode stays, and the language
 * features are not set up: the language service knows no SQL.
 *
 * What is wrong with the query is underlined and noted in the gutter all the same, while it is
 * typed: Marketing Cloud's own check is asked (./sql-check.js), which also knows the data
 * extensions, fields and data views of the business unit. The editor of the dialog's summary,
 * which cannot be typed in, is not checked.
 *
 * The message is read in the box of the script activity (./hover.js): it opens where the mouse
 * rests on an underline or on the note in the gutter, and says what is wrong and nothing else.
 *
 * Next to the dialog's button "Validate Syntax" a status says, in words, what the check of the
 * text in the editor came to. While the text of an editor is checked, that button of Marketing
 * Cloud is hidden: the status says what a click on it would. The button stays while the query is
 * empty, which is not checked, and it is back whenever a check got no answer, so that there is
 * always a way to check, and when the editor is no longer checked.
 */
import { report, watchPage } from '../editors.js';
import { CHECK_DELAY } from '../diagnostics.js';
import { createAceMarks } from './diagnostics.js';
import { registerAceHover } from './hover.js';
import {
    SCRIPT_ACTIVITY_MODE,
    SQL_MODE,
    TAKEN_CLASS,
    followSession,
    isQueryRoute,
    textOf,
} from './shared.js';
import { askMarketingCloud, readAnswer } from './sql-check.js';
import { createIcon } from '../tooltip.js';

const EDITOR_SELECTOR = '.ace_editor';
const marker = Symbol.for('sfmcUxTools.aceQuery');
// the editors that were seen in the dialog, each with whether its mark is from here
const entries = [];
// the dialog, and its button that asks Marketing Cloud on a click
const DIALOG = '.modal';
const VALIDATE_BUTTON = '#queryValidateBtn';
// marks that button as hidden by the extension; the stylesheet hides it (../../editor-highlight.css)
const REPLACED_ATTRIBUTE = 'data-sfmc-ux-tools-replaced';
// the formatting script's button, which stands right after that button
const FORMAT_BUTTON_CLASS = 'sfmc-format-beside';
// the status: the looks of the dialog's row of buttons, and what tells ours apart
const STATUS_CLASSES = 'pull-right sfmc-check-status';
// the extension's icon in front of the status, and what it says under the mouse
const STATUS_ICON_CLASS = 'sfmc-check-status-icon';
const STATUS_ICON_SAYS =
    'SFMC UX Tools: checks the query while you type and shows the result here, in place of the “Validate Syntax” button.';
// what the status says
const NOTHING = { words: '', kind: '' };
const CHECKING = { words: 'Checking…', kind: '' };
const NO_PROBLEMS = 'No problems found';
const FAILED = { words: 'Could not check', kind: '', isFailed: true };

/**
 * Puts a number before the word for what it counts.
 *
 * @param {number} count how many there are
 * @param {string} word what one of them is called
 * @returns {string} "1 error", "2 errors"
 */
function counted(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Words an answer of Marketing Cloud for the status.
 *
 * @param {{errors: number, warnings: number}} answer how many errors and warnings it named
 * @returns {{words: string, kind: string}} "No problems found", "2 errors, 1 hint"; and the kind of the worst that was found, "ok" for nothing
 */
function wordsOf({ errors, warnings }) {
    const parts = [];
    if (errors > 0) {
        parts.push(counted(errors, 'error'));
    }
    if (warnings > 0) {
        parts.push(counted(warnings, 'hint'));
    }
    let kind = 'ok';
    if (errors > 0) {
        kind = 'error';
    } else if (warnings > 0) {
        kind = 'warning';
    }
    return { words: parts.join(', ') || NO_PROBLEMS, kind };
}

/**
 * Sets up the status of an editor's check: a few words next to the dialog's button "Validate
 * Syntax", which is hidden while the status stands in for it: not for an empty query, about which
 * nothing is said, and not after a check without an answer. A dialog without that button gets no
 * status.
 *
 * @param {object} editor Ace editor
 * @returns {{set: (state: {words: string, kind: string, isFailed?: boolean}) => void, place: () => void, clear: () => void}} says something else; puts the status and the button's mark where they belong, after the page drew its dialog again; takes the status away and shows the button
 */
function createStatus(editor) {
    const { ownerDocument } = editor.container;
    let element = null;
    // the text of the status, after its icon
    let words = null;
    // what the status says; null while the editor is not checked
    let state = null;
    // the button that was marked as hidden last; the page may have taken it out of the document
    let marked = null;

    const place = () => {
        if (!state) {
            return;
        }
        const validate = (editor.container.closest(DIALOG) ?? ownerDocument).querySelector(
            VALIDATE_BUTTON,
        );
        if (!validate) {
            element?.remove();
            return;
        }
        const isSilent = state.words === '';
        // without an answer the user asks Marketing Cloud with its own button, and nothing
        // stands in for it while there is no query to check
        const isReplaced = !state.isFailed && !isSilent;
        if (validate.hasAttribute(REPLACED_ATTRIBUTE) !== isReplaced) {
            validate.toggleAttribute(REPLACED_ATTRIBUTE, isReplaced);
        }
        if (isReplaced) {
            marked = validate;
        }
        if (!element) {
            element = ownerDocument.createElement('span');
            element.setAttribute('role', 'status');
            element.setAttribute('aria-live', 'polite');
            words = ownerDocument.createTextNode('');
            element.append(createIcon(ownerDocument, STATUS_ICON_CLASS, STATUS_ICON_SAYS), words);
        }
        // nothing is written that is there already: the page is looked at again after every change
        const className = state.kind
            ? `${STATUS_CLASSES} sfmc-check-status-${state.kind}`
            : STATUS_CLASSES;
        if (element.className !== className) {
            element.className = className;
        }
        if (words.data !== state.words) {
            words.data = state.words;
        }
        if (element.hidden !== isSilent) {
            element.hidden = isSilent;
        }
        // after the "format code" button, which the formatting script puts right after the
        // dialog's button, whichever of the two comes first
        const next = validate.nextElementSibling;
        const before = next?.classList.contains(FORMAT_BUTTON_CLASS) ? next : validate;
        if (before.nextElementSibling !== element) {
            before.after(element);
        }
    };

    return {
        set: (next) => {
            state = next;
            place();
        },
        place,
        clear: () => {
            state = null;
            element?.remove();
            element = null;
            // also in a dialog that is not in the document at this moment
            marked?.removeAttribute(REPLACED_ATTRIBUTE);
            marked = null;
            for (const validate of ownerDocument.querySelectorAll(
                `${VALIDATE_BUTTON}[${CSS.escape(REPLACED_ATTRIBUTE)}]`,
            )) {
                validate.removeAttribute(REPLACED_ATTRIBUTE);
            }
        },
    };
}

/**
 * Sets the SQL check up for an editor.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isChecked tells whether the editor is, at this moment, one to check
 * @returns {{schedule: () => void, stop: () => void, redraw: () => void, place: () => void}} checks the query once typing has paused; takes away what was found and forgets what was checked; draws the underlines again after the text changed; puts the status back where it belongs
 */
function createCheck(editor, isChecked) {
    const marks = createAceMarks();
    const status = createStatus(editor);
    let timer;
    // the query that was asked about last; null after a check without an answer, so that the
    // same query is asked about again
    let asked = null;
    // the query whose answer is drawn, and what the status says about it
    let answered = null;
    // the box that says what was found at an underline or for a note in the gutter. Marketing
    // Cloud's answer comes later, so there is nothing to check at the moment the box opens, and
    // the language service is not asked: it knows no SQL
    let hideBox = null;
    // a box that cannot be set up does not keep the check away
    try {
        hideBox = registerAceHover(
            editor,
            isChecked,
            { checkNow: () => {}, at: marks.at, onLine: marks.onLine },
            { hasLanguage: false },
        );
    } catch (ex) {
        report(ex);
    }

    const run = async () => {
        try {
            if (!isChecked()) {
                return;
            }
            const session = editor.getSession();
            const text = textOf(editor);
            if (text.trim() === '') {
                // nothing to ask about
                asked = null;
                marks.unmark();
                return;
            }
            if (text === asked) {
                return;
            }
            asked = text;
            const body = await askMarketingCloud(text);
            // an answer about a query that is no longer in the editor says nothing
            if (isChecked() && editor.getSession() === session && textOf(editor) === text) {
                const answer = readAnswer(body, text);
                marks.mark(session, answer?.diagnostics ?? []);
                if (answer) {
                    answered = { text, ...wordsOf(answer) };
                    status.set(answered);
                } else {
                    // no answer that can be read: asked about again when typing next pauses
                    asked = null;
                    answered = null;
                    status.set(FAILED);
                }
            } else if (asked === text) {
                // nothing was drawn for it, so the same query must be asked about when it is back
                asked = null;
            }
        } catch (ex) {
            report(ex);
            // an answer that could not be read or drawn is none: the button is back, and the
            // same query is asked about again when typing next pauses
            asked = null;
            answered = null;
            try {
                if (isChecked()) {
                    status.set(FAILED);
                }
            } catch (ex_) {
                report(ex_);
            }
        }
    };

    // the status is about the text that is in the editor right now: nothing for none, the answer
    // for the text that was answered about, and "Checking…" for every other until its answer is drawn
    const show = () => {
        try {
            const text = textOf(editor);
            if (text.trim() === '') {
                status.set(NOTHING);
            } else if (answered?.text === text) {
                status.set(answered);
            } else {
                status.set(CHECKING);
            }
        } catch (ex) {
            report(ex);
        }
    };

    return {
        schedule: () => {
            show();
            clearTimeout(timer);
            timer = setTimeout(run, CHECK_DELAY);
        },
        stop: () => {
            clearTimeout(timer);
            asked = null;
            answered = null;
            marks.unmark();
            hideBox?.();
            status.clear();
        },
        redraw: () => marks.redraw(editor),
        place: status.place,
    };
}

/**
 * Gives an editor the mark while it is a SQL editor of the query activity's dialog, and takes
 * the mark away again otherwise, unless the script activity's code has taken the editor over
 * meanwhile, whose mark it is then. An editor with the mark that can be typed in is checked.
 *
 * @param {{editor: object, element: Element, isMarked: boolean, isChecked: boolean, check: object}} entry an editor that was seen
 */
function update(entry) {
    try {
        const id = entry.editor.getSession().getMode()?.$id;
        if (id === SQL_MODE && isQueryRoute() && entry.element.isConnected) {
            entry.element.classList.add(TAKEN_CLASS);
            entry.isMarked = true;
        } else if (entry.isMarked) {
            entry.isMarked = false;
            if (id !== SCRIPT_ACTIVITY_MODE) {
                entry.element.classList.remove(TAKEN_CLASS);
            }
        }
        const isChecked = entry.isMarked && !entry.editor.getReadOnly();
        if (isChecked && !entry.isChecked) {
            entry.isChecked = true;
            entry.check.schedule();
        } else if (!isChecked && entry.isChecked) {
            entry.isChecked = false;
            entry.check.stop();
        } else if (isChecked) {
            // the page may have drawn its dialog again
            entry.check.place();
        }
    } catch (ex) {
        report(ex);
    }
}

/**
 * Looks at the editors that were seen, and at those that are new in the query activity's dialog.
 */
function scan() {
    for (let index = entries.length - 1; index >= 0; index--) {
        update(entries[index]);
        if (!entries[index].element.isConnected) {
            entries.splice(index, 1);
        }
    }
    if (!isQueryRoute()) {
        return;
    }
    for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
        const editor = element.env?.editor;
        if (!editor || typeof editor.getSession !== 'function' || typeof editor.on !== 'function') {
            continue;
        }
        const known = editor[marker];
        if (known) {
            // an editor that left the page and is back on it
            if (!entries.includes(known)) {
                entries.push(known);
                update(known);
            }
            continue;
        }
        const entry = { editor, element, isMarked: false, isChecked: false, check: null };
        entry.check = createCheck(editor, () => entry.isChecked);
        editor[marker] = entry;
        entries.push(entry);
        // Ace loads the SQL mode after the editor is there, and the page may give it another session
        followSession(editor, ['changeMode'], () => update(entry));
        editor.on('changeSession', () => {
            update(entry);
            // another session is another query, also when its text is the same: what was found
            // is on the session before it
            if (!entry.isChecked) {
                return;
            }
            entry.check.stop();
            entry.check.schedule();
        });
        followSession(editor, ['change'], () => {
            if (!entry.isChecked) {
                return;
            }
            entry.check.schedule();
            try {
                entry.check.redraw();
            } catch (ex) {
                report(ex);
            }
        });
        update(entry);
    }
}

/**
 * Themes and checks the editors of Automation Studio's SQL query activity, now and whenever one
 * appears.
 */
export function watchQueryEditors() {
    watchPage(scan);
}
