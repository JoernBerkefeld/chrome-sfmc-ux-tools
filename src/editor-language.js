/*
 * SFMC UX Tools — language features for Marketing Cloud's code editor.
 *
 * Source of the language script. `npm run build` bundles it together with the files in
 * ./editor-language and with sfmc-language-lsp into one classic script, which takes this file's
 * place in dist/extension. What the editor is told comes from that language service; the files
 * in ./editor-language connect it to CodeMirror 5.
 *
 * Like the colouring, it has to run in the page's own script world, and it is a file of its own
 * so that a failure in here can never break the colouring.
 */
import { registerCompletions } from './editor-language/completions.js';
import { registerDiagnostics } from './editor-language/diagnostics.js';
import { registerHover } from './editor-language/hover.js';
import { registerSignature } from './editor-language/signature.js';
import { isInMode, report } from './editor-language/shared.js';

const EDITOR_SELECTOR = '.CodeMirror';
const SCAN_DELAY = 50;
// each one sets a feature up for an editor
const FEATURES = [registerCompletions, registerHover, registerSignature, registerDiagnostics];
// marks editors that are set up; a registered symbol, so that a second copy of this script recognises it too
const REGISTERED = Symbol.for('sfmcUxTools.language');
const state = { isScanPending: false };

/**
 * Sets up every feature for one editor; a feature that fails does not keep the others away.
 *
 * @param {object} cm CodeMirror instance
 */
function register(cm) {
    cm[REGISTERED] = true;
    for (const feature of FEATURES) {
        try {
            feature(cm);
        } catch (ex) {
            report(ex);
        }
    }
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
