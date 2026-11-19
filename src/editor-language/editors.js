/*
 * SFMC UX Tools — watches the page, finds Marketing Cloud's code editors on it and sets features
 * up for them.
 */

const BASE_MODE = 'ampScriptHtmlMixed';
// the mode of Marketing Cloud Next's content editor
const NEXT_MODE = 'ampscript-handlebars';
// Marketing Cloud Next runs in Salesforce's Lightning pages
const NEXT_HOST = '.lightning.force.com';
const NEXT_ATTRIBUTE = 'data-sfmc-ux-tools-next';
const EDITOR_SELECTOR = '.CodeMirror';
const SCAN_DELAY = 50;
// how often Marketing Cloud Next's page is looked at; a look costs next to nothing
const LIBRARY_INTERVAL = 1000;
// the isolated script editor-file-kind.js writes the kind of file the editor shows to this
// attribute, if the content is one of CloudPages' code resources
const KIND_ATTRIBUTE = 'data-sfmc-ux-tools-file-kind';
export const JAVASCRIPT_FILE = 'javascript';
const state = { hasReported: false, isScanPending: false, hooked: undefined };
// decided once per page: true in Marketing Cloud Next, false in Marketing Cloud Engagement and
// where there is no page
export const IS_NEXT = String(globalThis.location?.hostname ?? '').endsWith(NEXT_HOST);
// editors that a search of the page does not find, as Marketing Cloud Next keeps them in shadow
// trees, each with whether it has been on the page yet
const known = new Map();
// noted editors that tell about what happens to them
const watched = new WeakSet();

/**
 * Tells what kind of file the editors of this page show.
 *
 * @returns {string | null} "javascript", "css", "json", "xml" or "text" for a code resource; null for content that is HTML, and where there is no page
 */
export function fileKind() {
    return globalThis.document?.documentElement?.getAttribute(KIND_ATTRIBUTE) ?? null;
}
// what looks at the page whenever it changes
const scans = [];

/**
 * Notes the first failure in the console and stays silent afterwards.
 *
 * @param {unknown} ex what was thrown
 */
export function report(ex) {
    if (state.hasReported) {
        return;
    }
    state.hasReported = true;
    // eslint-disable-next-line no-console -- the only trace of a failure that is otherwise swallowed
    console.debug('SFMC UX Tools: a language feature failed', ex);
}

/**
 * Runs every scan; one that fails does not keep the others away.
 */
function runScans() {
    state.isScanPending = false;
    for (const scan of scans) {
        try {
            scan();
        } catch (ex) {
            report(ex);
        }
    }
}

/**
 * Runs the scans shortly: once, however many page changes arrive until then.
 */
function scheduleScans() {
    if (state.isScanPending) {
        return;
    }

    state.isScanPending = true;
    setTimeout(runScans, SCAN_DELAY);
}

/**
 * Calls a function now and whenever the page changes: its elements or the route in its address.
 * All callers share one observer.
 *
 * @param {() => void} scan looks at the page; called often, so it has to be cheap
 */
export function watchPage(scan) {
    if (scans.length === 0) {
        new MutationObserver(scheduleScans).observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
        addEventListener('hashchange', scheduleScans);
        if (IS_NEXT) {
            // for the stylesheet, which leaves the page's own list of suggestions as it is
            document.documentElement.setAttribute(NEXT_ATTRIBUTE, '');
            watchLibrary();
            setInterval(watchLibrary, LIBRARY_INTERVAL);
        }
    }
    scans.push(scan);
    try {
        scan();
    } catch (ex) {
        report(ex);
    }
}

/**
 * Tells whether an editor currently uses one of Marketing Cloud's AMPscript modes.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for the AMPscript mode of Marketing Cloud Engagement or Marketing Cloud Next, also through a MIME type or another alias
 */
export function isInMode(cm) {
    try {
        const { name } = cm.constructor.resolveMode(cm.getOption('mode'));
        return name === BASE_MODE || name === NEXT_MODE;
    } catch {
        return false;
    }
}

/**
 * Notes an editor that a search of the page may not find, and looks at the page again now and
 * whenever something happens to the editor that can make it one to set up.
 *
 * @param {object} cm CodeMirror instance
 */
function note(cm) {
    if (typeof cm?.getWrapperElement !== 'function') {
        return;
    }
    if (!known.has(cm)) {
        known.set(cm, false);
    }
    scheduleScans();
    if (watched.has(cm)) {
        return;
    }
    watched.add(cm);
    // it may get its mode, its content or its place on the page later, also after it was forgotten
    for (const event of ['optionChange', 'swapDoc', 'focus']) {
        cm.on(event, () => note(cm));
    }
}

/**
 * Notes the editors below a node, including those in the shadow trees below it, which a search
 * of the document does not reach.
 *
 * @param {Document | ShadowRoot} root where to look
 */
function noteEditorsIn(root) {
    for (const element of root.querySelectorAll('*')) {
        if (element.CodeMirror) {
            note(element.CodeMirror);
        }
        if (element.shadowRoot) {
            noteEditorsIn(element.shadowRoot);
        }
    }
}

/**
 * Looks for the page's CodeMirror, which Marketing Cloud Next only loads once the user opens a
 * code editor, and may never load. When it is there, it is asked to tell about every editor it
 * creates, and the editors it has created by then are looked up once. Editors that are known are
 * looked at again every time, as this page says little about what happens to them.
 */
function watchLibrary() {
    try {
        const library = globalThis.CodeMirror;
        if (typeof library?.defineInitHook === 'function' && library !== state.hooked) {
            state.hooked = library;
            library.defineInitHook((cm) => {
                try {
                    note(cm);
                } catch (ex) {
                    report(ex);
                }
            });
            noteEditorsIn(document);
        }
        if (known.size > 0) {
            scheduleScans();
        }
    } catch (ex) {
        report(ex);
    }
}

/**
 * Lists the editors of the page: those a search of the document finds, and those that were noted
 * because it does not find them. A noted editor that has left the page is forgotten.
 *
 * @returns {Set.<object>} CodeMirror instances; what the page keeps under that name, so it may hold something else
 */
export function editorsOnPage() {
    const list = new Set();
    for (const { CodeMirror: cm } of document.querySelectorAll(EDITOR_SELECTOR)) {
        list.add(cm);
    }
    for (const [cm, wasOnPage] of known) {
        const isOnPage = cm.getWrapperElement().isConnected;
        if (isOnPage) {
            known.set(cm, true);
            list.add(cm);
        } else if (wasOnPage) {
            known.delete(cm);
        }
    }
    return list;
}

/**
 * Sets features up for every AMPscript editor of the page, now and whenever one is added.
 *
 * @param {string} name names this set of features; editors that have it are not set up again, also not by a second copy of the script
 * @param {((cm: object) => void | (() => void))[]} features each one sets a feature up for an editor; what it returns is called when the editor is found off the page, to take away what the feature shows outside of it
 */
export function watchEditors(name, features) {
    const marker = Symbol.for(`sfmcUxTools.${name}`);
    const cleanups = [];

    const scan = () => {
        for (const { wrapper, cleanup } of cleanups) {
            try {
                if (!wrapper.isConnected) {
                    cleanup();
                }
            } catch (ex) {
                report(ex);
            }
        }
        for (const cm of editorsOnPage()) {
            try {
                if (
                    !cm ||
                    cm[marker] === true ||
                    typeof cm.addKeyMap !== 'function' ||
                    !isInMode(cm)
                ) {
                    continue;
                }
                cm[marker] = true;
            } catch {
                // one odd editor must not keep the others from being set up
                continue;
            }
            for (const feature of features) {
                // a feature that fails does not keep the others away
                try {
                    const cleanup = feature(cm);
                    if (cleanup) {
                        cleanups.push({ wrapper: cm.getWrapperElement(), cleanup });
                    }
                } catch (ex) {
                    report(ex);
                }
            }
        }
    };

    watchPage(scan);
}
