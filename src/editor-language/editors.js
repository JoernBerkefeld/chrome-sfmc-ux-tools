/*
 * SFMC UX Tools — watches the page, finds Marketing Cloud's code editors on it and sets features
 * up for them.
 */

const BASE_MODE = 'ampScriptHtmlMixed';
const EDITOR_SELECTOR = '.CodeMirror';
const SCAN_DELAY = 50;
// the isolated script editor-file-kind.js writes the kind of file the editor shows to this
// attribute, if the content is one of CloudPages' code resources
const KIND_ATTRIBUTE = 'data-sfmc-ux-tools-file-kind';
export const JAVASCRIPT_FILE = 'javascript';
const state = { hasReported: false, isScanPending: false };

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
    }
    scans.push(scan);
    try {
        scan();
    } catch (ex) {
        report(ex);
    }
}

/**
 * Tells whether an editor currently uses Marketing Cloud's AMPscript mode.
 *
 * @param {object} cm CodeMirror instance
 * @returns {boolean} true for the AMPscript mode, also through a MIME type or another alias
 */
export function isInMode(cm) {
    try {
        return cm.constructor.resolveMode(cm.getOption('mode')).name === BASE_MODE;
    } catch {
        return false;
    }
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
        for (const { CodeMirror: cm } of document.querySelectorAll(EDITOR_SELECTOR)) {
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
