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

const EDITOR_SELECTOR = '.ace_editor';
const marker = Symbol.for('sfmcUxTools.aceQuery');
// the editors that were seen in the dialog, each with whether its mark is from here
const entries = [];

/**
 * Sets the SQL check up for an editor.
 *
 * @param {object} editor Ace editor
 * @param {() => boolean} isChecked tells whether the editor is, at this moment, one to check
 * @returns {{schedule: () => void, stop: () => void, redraw: () => void}} checks the query once typing has paused; takes away what was found and forgets what was checked; draws the underlines again after the text changed
 */
function createCheck(editor, isChecked) {
    const marks = createAceMarks();
    let timer;
    // the query that was asked about last
    let asked = null;
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
                marks.mark(session, readAnswer(body, text));
            } else if (asked === text) {
                // nothing was drawn for it, so the same query must be asked about when it is back
                asked = null;
            }
        } catch (ex) {
            report(ex);
        }
    };

    return {
        schedule: () => {
            clearTimeout(timer);
            timer = setTimeout(run, CHECK_DELAY);
        },
        stop: () => {
            clearTimeout(timer);
            asked = null;
            marks.unmark();
            hideBox?.();
        },
        redraw: () => marks.redraw(editor),
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
