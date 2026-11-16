/*
 * SFMC UX Tools — the link to the TypeScript script, which knows the types of server-side
 * JavaScript. That script is loaded on demand and may come late, fail to load or be left out, so
 * it is looked up at every use, and every use has today's behaviour to fall back to.
 */
import { report, ssjsOnly } from './shared.js';

// where editor-typescript.js publishes its API
const API = Symbol.for('sfmcUxTools.typescript');
const NEED_EVENT = 'sfmc-ux-tools:need-typescript';
// the extension's answer if it could not load the script
const FAILED_EVENT = 'sfmc-ux-tools:typescript-failed';
export const READY_EVENT = 'sfmc-ux-tools:typescript-ready';
const state = { isRequested: false };

/**
 * Tells whether the TypeScript script has been loaded into this frame.
 *
 * @returns {boolean} true once its API is there
 */
export function hasTypescript() {
    return globalThis[API] !== undefined;
}

/**
 * Asks the TypeScript script about the SSJS of a document.
 *
 * @template T
 * @param {string} text whole document
 * @param {(service: object) => T} ask what to ask the script, once it knows the document
 * @returns {T | null} the answer; null without the script, or if it failed
 */
export function askTypescript(text, ask) {
    try {
        const service = globalThis[API];
        if (!service) {
            return null;
        }
        // the script ignores text it knows already
        service.update(ssjsOnly(text));
        return ask(service) ?? null;
    } catch {
        // today's behaviour takes over
        return null;
    }
}

/**
 * Asks the extension for the TypeScript script, once per frame: the first editor that is set up
 * says that this frame has use for it. If the extension could not load it, the next editor that
 * is set up asks again.
 */
export function requestTypescript() {
    try {
        if (state.isRequested || hasTypescript()) {
            return;
        }
        state.isRequested = true;
        document.addEventListener(
            FAILED_EVENT,
            () => {
                state.isRequested = false;
            },
            { once: true },
        );
        document.dispatchEvent(new CustomEvent(NEED_EVENT));
    } catch (ex) {
        report(ex);
    }
}
