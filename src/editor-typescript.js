/*
 * SFMC UX Tools — SPIKE: the TypeScript-based SSJS language service of the VS Code extension, in
 * the page. It is here to be measured, not to stay as it is.
 *
 * `npm run build` bundles this file, ./editor-typescript/ts-service.ts (a copy of the server's
 * file) and TypeScript into one minified classic script. The language script looks the service up
 * when it needs it and works as before without it.
 */
import { bundleStarted } from './editor-typescript/start.js';
import {
    getSsjsCompletionInfo,
    getSsjsHover,
    getSsjsSignatureHelp,
    updateSsjsDocument,
} from './editor-typescript/ts-service.ts';

// the one document the service knows: the SSJS of the editor that asked last
const URI = 'inmemory://editor.ssjs';
const KEPT_CALLS = 200;
const round = (milliseconds) => Math.round(milliseconds * 10) / 10;

const timings = {
    // start of the first script of the extension to the end of this one; undefined without that script
    scriptsToReady: undefined,
    // first to last statement of this bundle
    bundleEval: undefined,
    // the last durations by name of the call, in milliseconds
    calls: {},
    // how often each call ran, and how long its first run took
    counts: {},
    firsts: {},
    /**
     * Sums up the calls so far.
     *
     * @returns {Object.<string, {count: number, first: number, median: number, max: number}>} milliseconds by name of the call
     */
    summary() {
        const result = {};
        for (const [name, durations] of Object.entries(timings.calls)) {
            const sorted = durations.toSorted((a, b) => a - b);
            const middle = sorted.length / 2;
            const median =
                sorted.length % 2
                    ? sorted[Math.floor(middle)]
                    : (sorted[middle - 1] + sorted[middle]) / 2;
            result[name] = {
                count: timings.counts[name],
                first: round(timings.firsts[name]),
                median: round(median),
                max: round(sorted.at(-1)),
            };
        }
        return result;
    },
};

/**
 * Runs a call of the service and notes how long it took.
 *
 * @template T
 * @param {string} name name of the call
 * @param {() => T} run the call
 * @returns {T} what the call returned
 */
function timed(name, run) {
    const started = performance.now();
    try {
        return run();
    } finally {
        const duration = performance.now() - started;
        const durations = (timings.calls[name] ??= []);
        durations.push(duration);
        if (durations.length > KEPT_CALLS) {
            durations.shift();
        }
        timings.counts[name] = (timings.counts[name] ?? 0) + 1;
        timings.firsts[name] ??= duration;
    }
}

// eslint-disable-next-line unicorn/no-global-object-property-assignment -- how the language script, another classic script, finds the service
globalThis[Symbol.for('sfmcUxTools.typescript')] = {
    update: (text) => timed('update', () => updateSsjsDocument(URI, text)),
    completions: (position) => timed('completions', () => getSsjsCompletionInfo(URI, position)),
    hover: (position) => timed('hover', () => getSsjsHover(URI, position)),
    signatureHelp: (position) => timed('signatureHelp', () => getSsjsSignatureHelp(URI, position)),
    timings,
};

const ready = performance.now();
const started = globalThis[Symbol.for('sfmcUxTools.started')];
timings.scriptsToReady = typeof started === 'number' ? round(ready - started) : undefined;
timings.bundleEval = round(ready - bundleStarted);
// eslint-disable-next-line no-console -- the spike is measured by reading this in each frame
console.debug('SFMC UX Tools: TypeScript ready', {
    href: location.href,
    scriptsToReady: timings.scriptsToReady,
    bundleEval: timings.bundleEval,
});
