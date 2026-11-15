/*
 * SFMC UX Tools — AMPscript and SSJS colouring for Marketing Cloud's code editor.
 *
 * Marketing Cloud edits code with CodeMirror 5 and its own "ampScriptHtmlMixed" mode, which
 * colours the HTML but leaves AMPscript plain. This script wraps that mode so that the code in
 * %%[ ... ]%% blocks, %%= ... =%% expressions and AMPscript script tags is coloured as well.
 * In server-side JavaScript (SSJS) it adds colours for the Marketing Cloud objects and functions.
 *
 * It has to run in the page's own script world, because the editor instance is only reachable there.
 */
(() => {
    'use strict';

    const BASE_MODE = 'ampScriptHtmlMixed';
    const EDITOR_SELECTOR = '.CodeMirror';
    const SCAN_DELAY = 50;
    const DATA = globalThis.sfmcUxToolsLanguageData ?? {};
    delete globalThis.sfmcUxToolsLanguageData;
    const KEYWORDS = new Set(DATA.ampscriptKeywords);
    const SSJS_OBJECTS = new Set(DATA.ssjsObjects);
    const SSJS_GLOBAL_FUNCTIONS = new Set(DATA.ssjsGlobalFunctions);
    const SSJS_PLATFORM_FUNCTIONS = new Set(DATA.ssjsPlatformFunctions);
    const SCRIPT_REGIONS = new Set(['script', 'ssjs']);
    const CLOSING = { block: ']%%', inline: '=%%' };
    const SCRIPT_OPEN = /^<script\b[^>]*>/i;
    const SCRIPT_CLOSE = /^<\/script/i;
    const SCRIPT_CLOSE_AHEAD = /<\/script/i;
    const NEXT_CANDIDATE = /%%|<script\b/i;
    const RUNS_ON_SERVER = /\brunat\s*=\s*["']?server\b/i;
    const AMPSCRIPT_LANGUAGE = /\blanguage\s*=\s*["']?ampscript\b/i;
    // marks our mode factory; a registered symbol, so that a second copy of this script recognises it too
    const WRAPPED = Symbol.for('sfmcUxTools.wrappedMode');

    /**
     * Consumes the pattern if the stream continues with it.
     *
     * @param {object} stream CodeMirror string stream
     * @param {RegExp | string} pattern text or pattern anchored at the current position
     * @returns {boolean} true if something was consumed
     */
    function hasConsumed(stream, pattern) {
        const start = stream.pos;
        stream.match(pattern);
        return stream.pos > start;
    }

    /**
     * Fresh tokenizer state: outside of AMPscript, with no string or comment open.
     *
     * @returns {object} tokenizer state
     */
    function initialState() {
        return { region: null, quote: null, isInComment: false };
    }

    /**
     * Moves behind the end marker of a comment or string. If the marker is not on this line, moves to
     * the end of the line instead, or in a script tag to the closing tag, which always ends the script.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state tokenizer state
     * @param {string} marker text that ends the comment or string
     * @returns {boolean} true if the marker was found and consumed
     */
    function hasReachedEnd(stream, state, marker) {
        const rest = stream.string.slice(stream.pos);
        const end = rest.indexOf(marker);
        const limit = SCRIPT_REGIONS.has(state.region) ? rest.search(SCRIPT_CLOSE_AHEAD) : -1;
        if (limit !== -1 && (end === -1 || end > limit)) {
            stream.pos += limit;
            return false;
        }
        if (end === -1) {
            stream.skipToEnd();
            return false;
        }
        stream.pos += end + marker.length;
        return true;
    }

    /**
     * Reads a block comment up to its end or the end of the line.
     *
     * @param {object} stream CodeMirror string stream, positioned inside the comment
     * @param {object} state tokenizer state
     * @returns {string} token style
     */
    function commentToken(stream, state) {
        state.isInComment = !hasReachedEnd(stream, state, '*/');
        return 'sfmc-comment';
    }

    /**
     * Reads a string up to its closing quote or the end of the line.
     *
     * @param {object} stream CodeMirror string stream, positioned inside the string
     * @param {object} state tokenizer state
     * @returns {string} token style
     */
    function stringToken(stream, state) {
        if (hasReachedEnd(stream, state, state.quote)) {
            state.quote = null;
        }
        return 'sfmc-string';
    }

    /**
     * Tells which language a script tag contains, as far as this script colours it.
     * Only opening tags that fit on one line are recognised.
     *
     * @param {string} tag the opening tag
     * @returns {string | null} region name, or null for scripts that run in the browser
     */
    function scriptRegion(tag) {
        if (!RUNS_ON_SERVER.test(tag)) {
            return null;
        }
        return AMPSCRIPT_LANGUAGE.test(tag) ? 'script' : 'ssjs';
    }

    /**
     * Reads the next token of server-side JavaScript. The base mode colours the JavaScript itself;
     * this only adds styles for Marketing Cloud's own objects and functions and returns null otherwise.
     * Strings and comments are skipped so that names inside them stay untouched.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state tokenizer state
     * @returns {string | null} token style, or null for text that keeps its JavaScript colouring
     */
    function ssjsToken(stream, state) {
        if (state.isInComment || hasConsumed(stream, '/*')) {
            state.isInComment = !hasReachedEnd(stream, state, '*/');
            return null;
        }
        if (stream.eatSpace()) {
            return null;
        }
        if (hasConsumed(stream, '//')) {
            hasReachedEnd(stream, state, '\n');
            return null;
        }
        if (hasConsumed(stream, /^["']/)) {
            // JavaScript strings end with the line at the latest
            const pattern = stream.current() === '"' ? /^(?:[^"\\]|\\.)*"?/ : /^(?:[^'\\]|\\.)*'?/;
            const rest = stream.string.slice(stream.pos);
            const limit = rest.search(SCRIPT_CLOSE_AHEAD);
            stream.pos += pattern.exec(limit === -1 ? rest : rest.slice(0, limit))[0].length;
            return null;
        }
        if (!hasConsumed(stream, /^[a-z_$][\w$]*/i)) {
            stream.next();
            return null;
        }
        const name = stream.current();
        const before = stream.string.slice(0, stream.start);
        if (/\.\s*$/.test(before)) {
            const isPlatformFunction =
                /\bFunction\s*\.\s*$/.test(before) && SSJS_PLATFORM_FUNCTIONS.has(name);
            return isPlatformFunction ? 'sfmc-ssjs-function' : null;
        }
        if (SSJS_OBJECTS.has(name)) {
            return 'sfmc-ssjs-object';
        }
        const isCall = /^\s*\(/.test(stream.string.slice(stream.pos));
        return isCall && SSJS_GLOBAL_FUNCTIONS.has(name) ? 'sfmc-ssjs-function' : null;
    }

    /**
     * Reads the next token outside of AMPscript: an opening delimiter, or the text up to the next candidate.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state tokenizer state
     * @returns {string | null} token style, or null for text that keeps its HTML colouring
     */
    function outsideToken(stream, state) {
        if (hasConsumed(stream, '%%[')) {
            state.region = 'block';
            return 'sfmc-delimiter';
        }
        if (hasConsumed(stream, '%%=')) {
            state.region = 'inline';
            return 'sfmc-delimiter';
        }
        if (hasConsumed(stream, SCRIPT_OPEN)) {
            // the tag itself keeps its HTML colours; only its content is ours
            state.region = scriptRegion(stream.current());
            return null;
        }
        stream.next();
        const distance = stream.string.slice(stream.pos).search(NEXT_CANDIDATE);
        if (distance === -1) {
            stream.skipToEnd();
        } else {
            stream.pos += distance;
        }
        return null;
    }

    /**
     * Reads the next AMPscript token. Inside AMPscript every token gets a style of its own, so
     * that the HTML colouring of the base mode never shows through the code.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state tokenizer state: region, quote, isInComment
     * @returns {string | null} token style, or null for text that keeps its HTML colouring
     */
    function ampscriptToken(stream, state) {
        if (SCRIPT_REGIONS.has(state.region) && stream.match(SCRIPT_CLOSE, false)) {
            // like the browser, end the script here even inside a comment or string
            Object.assign(state, initialState());
        }
        if (!state.region) {
            return outsideToken(stream, state);
        }
        if (state.region === 'ssjs') {
            return ssjsToken(stream, state);
        }
        if (state.isInComment) {
            return commentToken(stream, state);
        }
        if (state.quote) {
            return stringToken(stream, state);
        }
        const closing = CLOSING[state.region];
        if (closing && hasConsumed(stream, closing)) {
            state.region = null;
            return 'sfmc-delimiter';
        }
        if (state.region === 'inline' && hasConsumed(stream, '%%[')) {
            // an inline expression that was never closed must not swallow the next block
            state.region = 'block';
            return 'sfmc-delimiter';
        }
        if (stream.eatSpace()) {
            return 'sfmc-text';
        }
        if (hasConsumed(stream, '/*')) {
            return commentToken(stream, state);
        }
        if (hasConsumed(stream, /^["']/)) {
            state.quote = stream.current();
            return stringToken(stream, state);
        }
        if (hasConsumed(stream, /^@@?[a-z_]\w*/i)) {
            return 'sfmc-variable';
        }
        if (hasConsumed(stream, /^\d+(\.\d+)?/)) {
            return 'sfmc-number';
        }
        if (hasConsumed(stream, /^[a-z_]\w*/i)) {
            if (KEYWORDS.has(stream.current().toLowerCase())) {
                return 'sfmc-keyword';
            }
            return /^\s*\(/.test(stream.string.slice(stream.pos)) ? 'sfmc-function' : 'sfmc-text';
        }
        if (hasConsumed(stream, /^(==|!=|<=|>=|<|>|=)/)) {
            return 'sfmc-operator';
        }
        stream.next();
        return 'sfmc-text';
    }

    /**
     * Runs the AMPscript tokenizer for one token. If it ever throws or fails to advance, AMPscript
     * colouring is switched off for the rest of the document so that the editor itself keeps working.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state combined mode state
     * @returns {string | null} token style
     */
    function safeAmpscriptToken(stream, state) {
        if (!state.hasFailed) {
            try {
                const style = ampscriptToken(stream, state.ampscript);
                if (stream.pos > stream.start) {
                    return style;
                }
            } catch {
                // handled below
            }
            state.hasFailed = true;
        }
        stream.pos = stream.start;
        stream.skipToEnd();
        return null;
    }

    /**
     * Builds a mode that colours like the base mode, except where the AMPscript tokenizer
     * returns a style of its own.
     *
     * @param {object} CodeMirror the page's CodeMirror constructor
     * @param {object} base mode object of the original "ampScriptHtmlMixed" mode
     * @returns {object} CodeMirror mode object
     */
    function combinedMode(CodeMirror, base) {
        return {
            /**
             * Initial state of a document.
             *
             * @returns {object} combined mode state
             */
            startState() {
                return {
                    base: CodeMirror.startState(base),
                    ampscript: initialState(),
                    hasFailed: false,
                    basePos: 0,
                    baseStyle: null,
                    ampscriptPos: 0,
                    ampscriptStyle: null,
                    stream: null,
                };
            },
            /**
             * Copies a state so that CodeMirror can keep one per line.
             *
             * @param {object} state combined mode state
             * @returns {object} independent copy
             */
            copyState(state) {
                return {
                    base: CodeMirror.copyState(base, state.base),
                    ampscript: { ...state.ampscript },
                    hasFailed: state.hasFailed,
                    basePos: state.basePos,
                    baseStyle: null,
                    ampscriptPos: state.ampscriptPos,
                    ampscriptStyle: null,
                    stream: null,
                };
            },
            /**
             * Runs both tokenizers over the same text; the AMPscript style wins where it has one.
             *
             * @param {object} stream CodeMirror string stream
             * @param {object} state combined mode state
             * @returns {string | null} token style
             */
            token(stream, state) {
                if (
                    stream !== state.stream ||
                    Math.min(state.basePos, state.ampscriptPos) < stream.start
                ) {
                    state.stream = stream;
                    state.basePos = stream.start;
                    state.ampscriptPos = stream.start;
                }
                if (stream.start === state.basePos) {
                    state.baseStyle = base.token(stream, state.base);
                    state.basePos = stream.pos;
                }
                if (stream.start === state.ampscriptPos) {
                    stream.pos = stream.start;
                    state.ampscriptStyle = safeAmpscriptToken(stream, state);
                    state.ampscriptPos = stream.pos;
                }
                stream.pos = Math.min(state.basePos, state.ampscriptPos);
                return state.ampscriptStyle ?? state.baseStyle;
            },
            indent: base.indent && ((state, ...rest) => base.indent(state.base, ...rest)),
            electricChars: base.electricChars,
            innerMode: (state) => ({ state: state.base, mode: base }),
            /**
             * Forwards empty lines to the base mode. An empty line also ends an inline expression
             * that was never closed, so that it cannot colour the rest of the document.
             *
             * @param {object} state combined mode state
             */
            blankLine(state) {
                base.blankLine?.(state.base);
                if (state.ampscript.region === 'inline') {
                    state.ampscript = initialState();
                }
            },
        };
    }

    /**
     * Replaces the page's "ampScriptHtmlMixed" mode with the combined mode. The mode keeps its name,
     * so every editor that asks for it from now on gets the AMPscript colouring automatically.
     *
     * @param {object} CodeMirror the page's CodeMirror constructor
     * @param {object} original the page's own mode factory
     */
    function patchMode(CodeMirror, original) {
        const wrapped = (config, parserConfig) =>
            combinedMode(CodeMirror, original(config, parserConfig));
        wrapped.dependencies = original.dependencies;
        wrapped[WRAPPED] = true;
        CodeMirror.defineMode(BASE_MODE, wrapped);
    }

    /**
     * Makes the open editors of a CodeMirror copy pick up the patched mode.
     *
     * @param {object} CodeMirror the page's CodeMirror constructor
     */
    function refreshEditors(CodeMirror) {
        for (const { CodeMirror: editor } of document.querySelectorAll(EDITOR_SELECTOR)) {
            if (editor?.constructor !== CodeMirror) {
                continue;
            }
            try {
                const mode = editor.getOption('mode');
                if ((mode?.name ?? mode) === BASE_MODE) {
                    editor.setOption('mode', mode);
                }
            } catch {
                // one odd editor must not keep the others from being refreshed
            }
        }
    }

    let isScanPending = false;

    /**
     * Patches the mode of every CodeMirror copy that has an editor on the page and whose mode is
     * not patched yet. That is the case for the first editor, and again if the page registers
     * its mode anew later on.
     */
    function scan() {
        isScanPending = false;
        for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
            const CodeMirror = element.CodeMirror?.constructor;
            const original = CodeMirror?.modes?.[BASE_MODE];
            if (!(
                typeof original === 'function' &&
                original[WRAPPED] !== true &&
                typeof CodeMirror.defineMode === 'function'
            )) {
                continue;
            }

            patchMode(CodeMirror, original);
            refreshEditors(CodeMirror);
        }
    }

    /**
     * Runs a scan shortly, however many page changes arrive until then.
     */
    function scheduleScan() {
        if (isScanPending) {
            return;
        }

        isScanPending = true;
        setTimeout(scan, SCAN_DELAY);
    }

    new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
    scan();
})();
