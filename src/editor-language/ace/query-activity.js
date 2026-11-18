/*
 * SFMC UX Tools — the editor theme for the code editors of Automation Studio's SQL query activity.
 *
 * That dialog edits its query with Ace in SQL mode, which colours SQL well enough. This file only
 * marks those editors as themed, so that they follow the extension's light or dark theme like the
 * editor of the script activity (../../editor-highlight.css); the formatting script takes the
 * same mark as its sign that an editor is one of ours. The page's mode stays, and the language
 * features are not set up: the language service knows no SQL.
 */
import { report, watchPage } from '../editors.js';
import {
    SCRIPT_ACTIVITY_MODE,
    SQL_MODE,
    TAKEN_CLASS,
    followSession,
    isQueryRoute,
} from './shared.js';

const EDITOR_SELECTOR = '.ace_editor';
const marker = Symbol.for('sfmcUxTools.aceQuery');
// the editors that were seen in the dialog, each with whether its mark is from here
const entries = [];

/**
 * Gives an editor the mark while it is a SQL editor of the query activity's dialog, and takes
 * the mark away again otherwise, unless the script activity's code has taken the editor over
 * meanwhile, whose mark it is then.
 *
 * @param {{editor: object, element: Element, isMarked: boolean}} entry an editor that was seen
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
        const entry = { editor, element, isMarked: false };
        editor[marker] = entry;
        entries.push(entry);
        // Ace loads the SQL mode after the editor is there, and the page may give it another session
        followSession(editor, ['changeMode'], () => update(entry));
        editor.on('changeSession', () => update(entry));
        update(entry);
    }
}

/**
 * Themes the editors of Automation Studio's SQL query activity, now and whenever one appears.
 */
export function watchQueryEditors() {
    watchPage(scan);
}
