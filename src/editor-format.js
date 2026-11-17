/*
 * SFMC UX Tools — formats the content of Marketing Cloud's code editor.
 *
 * Source of the formatting script. `npm run build` bundles it together with Prettier and
 * prettier-plugin-sfmc into one classic script, which takes this file's place in dist/extension.
 * It is a file of its own so that a failure in here can never break the other features.
 */
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as html from 'prettier/plugins/html';
import * as postcss from 'prettier/plugins/postcss';
import * as sfmc from 'prettier-plugin-sfmc';
import { format } from 'prettier/standalone';
import { isInMode, report, watchEditors } from './editor-language/editors.js';
import { watchAceFormat } from './editor-language/ace/format.js';

// the settings the SFMC Language Service extension for VS Code formats with
const OPTIONS = {
    useTabs: false,
    tabWidth: 4,
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'none',
    // the name makes Prettier read the content as HTML with AMPscript and SSJS
    filepath: 'content.html',
    // the plugin hands HTML, CSS and JavaScript on to these
    plugins: [html, babel, estree, postcss, sfmc],
};
const NOTICE_TIME = 6000;
// the isolated script editor-format-setting.js writes the user's choice to this attribute
const ON_SAVE_ATTRIBUTE = 'data-sfmc-ux-tools-format-on-save';
// Marketing Cloud's buttons that save the content; the attribute is the same in every language
const SAVE_BUTTONS = '[data-action="editor-save"], [data-action="editor-save-exit"]';
const SAVE_BUTTON = '[data-action="editor-save"]';
// where Marketing Cloud's editor keeps its own buttons
const TOOLBAR = '.et-codemirror-toolbar ul';
const EDITOR_FRAME = '.et-codemirror';
// time for the page to take note of the formatted content before it saves
const SETTLE_TIME = 300;
// a save never waits longer than this for the formatting
const FORMAT_TIME_LIMIT = 5000;
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform ?? '');
const SHORTCUT = IS_MAC ? '⇧⌥F' : 'Shift+Alt+F';
const busy = new WeakSet();
const editors = new Set();
const state = { isSaving: false, isPending: false };

/**
 * Tells the user why the content was not formatted, in a box at the top of the editor that
 * goes away by itself.
 *
 * @param {Element} wrapper the editor's element
 * @param {unknown} ex what Prettier objected to
 */
function notify(wrapper, ex) {
    const notice = wrapper.ownerDocument.createElement('div');
    notice.className = 'sfmc-tooltip sfmc-notice';
    // the first line says what is wrong and where; the rest repeats the code
    notice.textContent = `Not formatted: ${String(ex?.message ?? ex).split('\n', 1)[0]}`;
    const { top, right } = wrapper.getBoundingClientRect();
    notice.style.top = `${Math.round(top) + 4}px`;
    notice.style.right = `${Math.round(wrapper.ownerDocument.defaultView.innerWidth - right) + 20}px`;
    wrapper.ownerDocument.body.append(notice);
    setTimeout(() => notice.remove(), NOTICE_TIME);
}

/**
 * Finds the part in which two texts differ.
 *
 * @param {string} before current content
 * @param {string} after new content
 * @returns {{from: number, to: number, text: string}} the part of the current content to replace, by its offsets, and what to put there
 */
function changedPart(before, after) {
    let start = 0;
    while (start < before.length && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (
        end < before.length - start &&
        end < after.length - start &&
        before.at(-1 - end) === after.at(-1 - end)
    ) {
        end++;
    }
    return { from: start, to: before.length - end, text: after.slice(start, after.length - end) };
}

/**
 * Replaces a part of an editor's content in one step that can be undone; the cursor and the
 * view stay where they are.
 *
 * @param {object} cm CodeMirror instance
 * @param {{from: number, to: number, text: string}} change the part to replace and what to put there
 */
function replace(cm, { from, to, text }) {
    const cursor = cm.getCursor();
    const { left, top } = cm.getScrollInfo();
    cm.operation(() => {
        cm.replaceRange(text, cm.posFromIndex(from), cm.posFromIndex(to), '+format');
        cm.setCursor(cursor);
        cm.scrollTo(left, top);
    });
}

/**
 * Formats the content of an editor of any kind, touching only the part that differs.
 *
 * @param {object} key the editor; while it is being formatted, it is not formatted again
 * @param {Element} element the editor's element, where the user is told about a failure
 * @param {() => string} read gives the editor's content
 * @param {(change: {from: number, to: number, text: string}, before: string) => void} write replaces a part of the content that was read
 */
async function formatContent(key, element, read, write) {
    if (busy.has(key)) {
        return;
    }
    busy.add(key);
    try {
        const before = read();
        const after = await format(before, OPTIONS);
        // what was typed in the meantime is never overwritten
        if (after !== before && read() === before) {
            write(changedPart(before, after), before);
        }
    } catch (ex) {
        try {
            notify(element, ex);
        } catch (ex_) {
            report(ex_);
        }
    } finally {
        busy.delete(key);
    }
}

/**
 * Formats the content of an editor.
 *
 * @param {object} cm CodeMirror instance
 * @returns {Promise.<void>} settled when the editor has its formatted content, or was told why not
 */
function formatEditor(cm) {
    return formatContent(
        cm,
        cm.getWrapperElement(),
        () => cm.getValue(),
        (change) => replace(cm, change),
    );
}

/**
 * Tells whether an editor is one whose content may be formatted right now.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for an AMPscript editor on the page that can be edited
 */
function canFormat(cm) {
    return isInMode(cm) && !cm.isReadOnly() && cm.getWrapperElement().isConnected;
}

/**
 * Creates a "format code" button.
 *
 * @param {Document} document document of the editor
 * @param {() => void} onClick what a click does
 * @returns {HTMLButtonElement} the button, not yet on the page
 */
function createButton(document, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sfmc-format-button';
    button.textContent = '{ }';
    button.title = `Format code (${SHORTCUT})`;
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', onClick);
    return button;
}

/**
 * Adds the "format code" button for an editor: next to Marketing Cloud's own editor buttons
 * where there are any, in the corner of the editor otherwise.
 *
 * @param {object} cm CodeMirror instance
 */
function addButton(cm) {
    const wrapper = cm.getWrapperElement();
    const document = wrapper.ownerDocument;
    const button = createButton(document, () => {
        if (canFormat(cm)) {
            formatEditor(cm);
        }
        cm.focus();
    });
    const toolbar = wrapper.closest(EDITOR_FRAME)?.querySelector(TOOLBAR);
    if (toolbar) {
        const item = document.createElement('li');
        item.className = 'toolbar-button sfmc-format-item';
        item.append(button);
        toolbar.append(item);
    } else {
        button.classList.add('sfmc-format-floating');
        wrapper.append(button);
    }
}

/**
 * Tells whether an element is on show, as opposed to being part of a hidden view.
 *
 * @param {Element} element element of the page
 * @returns {boolean} true if it takes up room on the page
 */
function isOnShow(element) {
    return element.getClientRects().length > 0;
}

/**
 * Finds a button of Marketing Cloud that is on show.
 *
 * @param {string} [selector] which button; the Save button if left out
 * @returns {Element | undefined} the button
 */
function saveButton(selector = SAVE_BUTTON) {
    return [...document.querySelectorAll(selector)].find((button) => isOnShow(button));
}

/**
 * Formats the editors of the page and then lets the save go ahead that was held back for it.
 * Whatever happens to the formatting, the save is never lost: it does not wait for a formatter
 * that takes too long, and if the page has redrawn its button meanwhile, the new one is clicked.
 *
 * @param {object[]} targets CodeMirror instances to format
 * @param {Element} button the save button that was clicked
 */
async function formatThenSave(targets, button) {
    try {
        await Promise.race([
            Promise.all(targets.map((cm) => formatEditor(cm))),
            new Promise((resolve) => setTimeout(resolve, FORMAT_TIME_LIMIT)),
        ]);
        await new Promise((resolve) => setTimeout(resolve, SETTLE_TIME));
    } catch (ex) {
        report(ex);
    }
    state.isPending = false;
    state.isSaving = true;
    try {
        const selector = `[data-action="${button.dataset.action}"]`;
        // "Save and Exit" sits in a menu that has closed again by now, so a hidden one will do
        const current = button.isConnected
            ? button
            : (saveButton(selector) ?? document.querySelector(selector));
        current?.click();
    } finally {
        state.isSaving = false;
    }
}

/**
 * Handles a click on the page: with "format on save" switched on, a click on one of Marketing
 * Cloud's save buttons is held back until the editors are formatted.
 *
 * @param {MouseEvent} event the click
 */
function onClick(event) {
    try {
        if (
            state.isSaving ||
            document.documentElement.getAttribute(ON_SAVE_ATTRIBUTE) !== 'on' ||
            !(event.target instanceof Element)
        ) {
            return;
        }
        const button = event.target.closest(SAVE_BUTTONS);
        if (!button) {
            return;
        }
        // a save is being held back already; this click belongs to it and must not become a second save
        if (state.isPending) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        // only what the user sees is saved now; editors of hidden views are left alone
        const targets = [...editors].filter(
            (cm) => canFormat(cm) && isOnShow(cm.getWrapperElement()),
        );
        if (!targets.length) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        state.isPending = true;
        formatThenSave(targets, button);
    } catch (ex) {
        report(ex);
    }
}

/**
 * Saves the content the way a click on Marketing Cloud's Save button does.
 *
 * @param {object} cm CodeMirror instance
 * @returns {unknown} CodeMirror's sign to go on with the key if there is no Save button
 */
function save(cm) {
    const button = saveButton();
    if (!button) {
        return cm.constructor.Pass;
    }
    button.click();
    return;
}

/**
 * Sets up formatting for one editor: the button, Shift-Alt-F as in VS Code, and Ctrl-S or
 * Cmd-S for saving, which Marketing Cloud's editor does not have.
 *
 * @param {object} cm CodeMirror instance
 */
function registerFormat(cm) {
    editors.add(cm);
    cm.addKeyMap({
        'Shift-Alt-F': (editor) => {
            if (!canFormat(editor)) {
                return editor.constructor.Pass;
            }
            formatEditor(editor);
            return;
        },
        'Ctrl-S': save,
        'Cmd-S': save,
    });
    addButton(cm);
}

// in the capture phase, so that the page has not acted on the click yet
document.addEventListener('click', onClick, { capture: true });
watchEditors('format', [registerFormat]);
// Automation Studio's script activity has another editor, Ace, which is formatted in the same way
watchAceFormat({ formatContent, createButton });
