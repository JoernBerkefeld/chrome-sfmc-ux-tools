/*
 * SFMC UX Tools — colours and language features for the code editor of Automation Studio's
 * script activity.
 *
 * That dialog edits its script with Ace in JavaScript mode, which reads the script tag as an
 * element and the code inside it as one string. This file gives the dialog's editors a mode of
 * its own instead, built at run time from the Ace of the page. Every other Ace editor of
 * Automation Studio, such as the one for SQL queries, is left alone, and so is the script
 * activity's if anything this needs is missing. The editors that got the mode also get the
 * language features: completions, hover, parameter help, errors and warnings, quick fixes and
 * go to definition (the other files of this folder).
 */
import { report, watchPage } from '../editors.js';
import { registerAceCompletions } from './completions.js';
import { registerAceDefinition } from './definition.js';
import { registerAceDiagnostics } from './diagnostics.js';
import { registerAceHover } from './hover.js';
import { registerAceSignature } from './signature.js';
import { createHighlightRules, takeLanguageData } from './highlight-rules.js';

const EDITOR_SELECTOR = '.ace_editor';
// the dialog of an activity of type 423, "script": #ActivityModal/423/new or #ActivityModal/423/<id>
const ROUTE = /^#ActivityModal\/423\//i;
const MODE_ID = 'sfmc-ux-tools/mode/script-activity';
// what the page uses for the script, and what an editor has before the page chose
const REPLACED_MODES = new Set(['ace/mode/javascript', 'ace/mode/text']);
// marks the editors whose colours are ours; editor-highlight.css themes those
const TAKEN_CLASS = 'sfmc-ux-tools-ace';
const marker = Symbol.for('sfmcUxTools.aceColours');
// by Ace object: its mode, or null if it could not be built
const modes = new WeakMap();
// the editors that have the language features, each with what takes away what they show and
// with what brings it back
const features = [];

/**
 * Reads a class from the Ace of the page.
 *
 * @param {object} ace the page's Ace
 * @param {string} id module name
 * @param {string} name export of the module
 * @returns {new () => object} the class
 */
function need(ace, id, name) {
    const value = ace.require(id)?.[name];
    if (typeof value !== 'function') {
        throw new TypeError(`Ace has no ${id}`);
    }
    return value;
}

/**
 * Builds the mode: plain text with our colouring rules and without a worker, so that nothing
 * marks the script tag as a JavaScript error.
 *
 * @param {object} ace the page's Ace
 * @returns {object} Ace mode
 */
function createMode(ace) {
    const TextMode = need(ace, 'ace/mode/text', 'Mode');
    const Rules = createHighlightRules(
        need(ace, 'ace/mode/text_highlight_rules', 'TextHighlightRules'),
        need(ace, 'ace/mode/javascript_highlight_rules', 'JavaScriptHighlightRules'),
    );
    // folding is a convenience the JavaScript mode had; the colours do not depend on it
    const FoldMode = ace.require('ace/mode/folding/cstyle')?.FoldMode;

    /**
     * Mode of a script activity.
     */
    class ScriptActivityMode extends TextMode {
        /**
         * Sets the rules and what the editor's commands need to know about comments.
         */
        constructor() {
            super();
            this.HighlightRules = Rules;
            this.$id = MODE_ID;
            this.lineCommentStart = '//';
            this.blockComment = { start: '/*', end: '*/' };
            if (typeof FoldMode === 'function') {
                this.foldingRules = new FoldMode();
            }
        }
    }

    const mode = new ScriptActivityMode();
    // compiles the rules, so that a mistake in them shows here and not inside the editor
    mode.getTokenizer();
    return mode;
}

/**
 * The mode for the editors of the page, built on first use.
 *
 * @returns {object | null} Ace mode; null if the page's Ace cannot be used
 */
function pageMode() {
    const { ace } = globalThis;
    const key = ace !== null && typeof ace === 'object' ? ace : globalThis;
    if (!modes.has(key)) {
        let mode = null;
        try {
            if (typeof ace?.require !== 'function') {
                throw new TypeError('the page has an Ace editor but no ace.require');
            }
            mode = createMode(ace);
        } catch (ex) {
            report(ex);
        }
        modes.set(key, mode);
    }
    return modes.get(key);
}

/**
 * Gives an editor our mode and keeps it there: the page may set its own mode again or give the
 * editor another session.
 *
 * @param {Element} element the editor's element
 * @param {object} editor Ace editor
 * @param {object} mode Ace mode
 */
function takeOver(element, editor, mode) {
    let session = null;
    let isApplying = false;

    const apply = () => {
        // setting the mode tells this function again
        if (isApplying) {
            return;
        }
        isApplying = true;
        try {
            if (ROUTE.test(location.hash) && REPLACED_MODES.has(session.getMode()?.$id)) {
                session.setMode(mode);
            }
            element.classList.toggle(TAKEN_CLASS, session.getMode() === mode);
        } catch (ex) {
            report(ex);
        } finally {
            isApplying = false;
        }
    };
    const follow = () => {
        try {
            session?.off('changeMode', apply);
            session = editor.getSession();
            session.on('changeMode', apply);
        } catch (ex) {
            report(ex);
            return;
        }
        apply();
    };

    editor.on('changeSession', follow);
    follow();
}

/**
 * Sets the language features up for an editor that got our mode.
 *
 * @param {Element} element the editor's element
 * @param {object} editor Ace editor
 * @returns {{element: Element, isClosed: boolean, close: () => void, resume: () => void}} what takes the boxes, the popup and the underlines of the editor away, and what has its content checked again
 */
function addFeatures(element, editor) {
    const isOurs = () => ROUTE.test(location.hash) && element.classList.contains(TAKEN_CLASS);
    const closers = [];
    let resume = null;
    const setups = [
        () => {
            closers.push(registerAceCompletions(editor, isOurs));
        },
        () => {
            const diagnostics = registerAceDiagnostics(editor, isOurs);
            closers.push(diagnostics.clear);
            resume = diagnostics.schedule;
            // the box says what is wrong at a place, so it needs to know what was found
            closers.push(registerAceHover(editor, isOurs, diagnostics));
        },
        () => {
            closers.push(registerAceSignature(editor, isOurs));
        },
        () => registerAceDefinition(editor, isOurs),
    ];
    for (const setup of setups) {
        // a feature that fails does not keep the others away
        try {
            setup();
        } catch (ex) {
            report(ex);
        }
    }
    return {
        element,
        isClosed: false,
        close: () => {
            for (const close of closers) {
                close();
            }
        },
        resume: () => resume?.(),
    };
}

/**
 * Takes over the Ace editors of the script activity's dialog that are new on the page.
 */
function scan() {
    const isRoute = ROUTE.test(location.hash);
    // nothing must stay behind when an editor left the page or the dialog shows something else
    for (let index = features.length - 1; index >= 0; index--) {
        const entry = features[index];
        if (isRoute && entry.element.isConnected) {
            if (entry.isClosed) {
                // the dialog shows the script activity again
                entry.isClosed = false;
                entry.resume();
            }
            continue;
        }
        entry.isClosed = true;
        try {
            entry.close();
        } catch (ex) {
            report(ex);
        }
        if (!entry.element.isConnected) {
            features.splice(index, 1);
        }
    }
    if (!isRoute) {
        return;
    }
    for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
        const editor = element.env?.editor;
        if (
            !editor ||
            editor[marker] === true ||
            typeof editor.getSession !== 'function' ||
            typeof editor.on !== 'function'
        ) {
            continue;
        }
        const mode = pageMode();
        if (!mode) {
            // the editors stay as the page made them
            return;
        }
        editor[marker] = true;
        try {
            takeOver(element, editor, mode);
            features.push(addFeatures(element, editor));
        } catch (ex) {
            report(ex);
        }
    }
}

/**
 * Colours the editors of Automation Studio's script activity, now and whenever one appears.
 */
export function watchAceEditors() {
    takeLanguageData();
    watchPage(scan);
}
