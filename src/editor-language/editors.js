/*
 * SFMC UX Tools — finds Marketing Cloud's code editors on the page and sets features up for them.
 */

const BASE_MODE = 'ampScriptHtmlMixed';
const EDITOR_SELECTOR = '.CodeMirror';
const SCAN_DELAY = 50;
const state = { hasReported: false };

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
 * @param {((cm: object) => void)[]} features each one sets a feature up for an editor
 */
export function watchEditors(name, features) {
    const marker = Symbol.for(`sfmcUxTools.${name}`);
    let isScanPending = false;

    const scan = () => {
        isScanPending = false;
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
                    feature(cm);
                } catch (ex) {
                    report(ex);
                }
            }
        }
    };

    new MutationObserver(() => {
        // one scan, however many page changes arrive until then
        if (isScanPending) {
            return;
        }

        isScanPending = true;
        setTimeout(scan, SCAN_DELAY);
    }).observe(document.documentElement, { childList: true, subtree: true });
    try {
        scan();
    } catch (ex) {
        report(ex);
    }
}
