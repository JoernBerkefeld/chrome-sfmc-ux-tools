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
const busy = new WeakSet();

/**
 * Tells the user why the content was not formatted, in a box at the top of the editor that
 * goes away by itself.
 *
 * @param {object} cm CodeMirror instance
 * @param {unknown} ex what Prettier objected to
 */
function notify(cm, ex) {
    const wrapper = cm.getWrapperElement();
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
 * Replaces the content of an editor in one step that can be undone, touching only the part
 * that differs, so that the cursor and the view stay where they are.
 *
 * @param {object} cm CodeMirror instance
 * @param {string} before current content
 * @param {string} after new content
 */
function replace(cm, before, after) {
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
    const cursor = cm.getCursor();
    const { left, top } = cm.getScrollInfo();
    cm.operation(() => {
        cm.replaceRange(
            after.slice(start, after.length - end),
            cm.posFromIndex(start),
            cm.posFromIndex(before.length - end),
            '+format',
        );
        cm.setCursor(cursor);
        cm.scrollTo(left, top);
    });
}

/**
 * Formats the content of an editor.
 *
 * @param {object} cm CodeMirror instance
 */
async function formatEditor(cm) {
    if (busy.has(cm)) {
        return;
    }
    busy.add(cm);
    const before = cm.getValue();
    try {
        const after = await format(before, OPTIONS);
        // what was typed in the meantime is never overwritten
        if (after !== before && cm.getValue() === before) {
            replace(cm, before, after);
        }
    } catch (ex) {
        try {
            notify(cm, ex);
        } catch (ex_) {
            report(ex_);
        }
    } finally {
        busy.delete(cm);
    }
}

/**
 * Sets up formatting for one editor: Shift-Alt-F, as in VS Code.
 *
 * @param {object} cm CodeMirror instance
 */
function registerFormat(cm) {
    cm.addKeyMap({
        'Shift-Alt-F': (editor) => {
            if (!isInMode(editor) || editor.isReadOnly()) {
                return editor.constructor.Pass;
            }
            formatEditor(editor);
            return;
        },
    });
}

watchEditors('format', [registerFormat]);
