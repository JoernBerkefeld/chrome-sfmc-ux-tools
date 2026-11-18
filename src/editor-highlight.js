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
    // %%name%%, the same pattern as in ampscript-parser: the name starts with a word character and
    // may contain spaces and . : ; ~ ( ) [ ] / - (as in %%MSG(0).NOUN(2)%%), so neither
    // "50%% off, 20%% more" nor width="100%%">%%=...=%% is mistaken for one
    const PERSONALIZATION = /^%%\w(?:[\w .:;~()[\]/-]*[\w)\]])?%%/;
    const REGEX_LITERAL = /^\/(?:[^/\\[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[a-z]*/;
    const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};]|\breturn)$/;
    const SCRIPT_OPEN = /^<script\b[^>]*>/i;
    const SCRIPT_CLOSE = /^<\/script/i;
    const SCRIPT_CLOSE_AHEAD = /<\/script/i;
    const NEXT_CANDIDATE = /%%|<script\b/i;
    const RUNS_ON_SERVER = /\brunat\s*=\s*["']?server\b/i;
    const AMPSCRIPT_LANGUAGE = /\blanguage\s*=\s*["']?ampscript\b/i;
    // marks our mode factory; a registered symbol, so that a second copy of this script recognises it too
    const WRAPPED = Symbol.for('sfmcUxTools.wrappedMode');
    // the isolated script editor-file-kind.js writes the kind of file the editor shows to this
    // attribute, if the content is one of CloudPages' code resources
    const KIND_ATTRIBUTE = 'data-sfmc-ux-tools-file-kind';
    // the mode of the page's CodeMirror that colours a kind of file; the page's own mode takes
    // every file for HTML
    const KIND_MODES = new Map([
        ['javascript', 'javascript'],
        ['css', 'css'],
        ['json', { name: 'javascript', json: true }],
        ['xml', 'xml'],
        ['text', 'text/plain'],
    ]);

    /**
     * Tells what kind of file the editors of this page show.
     *
     * @returns {string | null} the kind of a code resource; null for content that is HTML
     */
    function fileKind() {
        return document.documentElement.getAttribute(KIND_ATTRIBUTE);
    }

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
     * Reads on inside a JavaScript string: up to its closing quote, a personalization string,
     * the closing script tag or the end of the line. A string never continues on the next line.
     *
     * @param {object} stream CodeMirror string stream, positioned inside the string
     * @param {object} state tokenizer state; state.quote is the open quote
     * @returns {string | null} token style
     */
    function ssjsStringToken(stream, state) {
        if (hasConsumed(stream, PERSONALIZATION)) {
            // Marketing Cloud fills these in before the script runs, also inside strings
            return 'sfmc-personalization';
        }
        const rest = stream.string.slice(stream.pos);
        const limit = rest.search(SCRIPT_CLOSE_AHEAD);
        const text = limit === -1 ? rest : rest.slice(0, limit);
        let index = 0;
        while (index < text.length) {
            const character = text[index];
            if (character === '\\') {
                index += 2;
            } else if (character === state.quote) {
                index++;
                state.quote = null;
                break;
            } else if (character === '%' && index > 0 && PERSONALIZATION.test(text.slice(index))) {
                break;
            } else {
                index++;
            }
        }
        stream.pos += Math.max(1, Math.min(index, text.length));
        return null;
    }

    /**
     * Reads the next token of server-side JavaScript. The base mode colours the JavaScript itself;
     * this only adds styles for Marketing Cloud's own objects and functions and for personalization
     * strings, and returns null otherwise. Strings, comments and regular expressions are skipped so
     * that names inside them stay untouched.
     *
     * @param {object} stream CodeMirror string stream
     * @param {object} state tokenizer state
     * @returns {string | null} token style, or null for text that keeps its JavaScript colouring
     */
    function ssjsToken(stream, state) {
        if (stream.sol()) {
            state.quote = null;
        }
        if (state.isInComment || hasConsumed(stream, '/*')) {
            state.isInComment = !hasReachedEnd(stream, state, '*/');
            return null;
        }
        if (state.quote) {
            return ssjsStringToken(stream, state);
        }
        if (stream.eatSpace()) {
            return null;
        }
        if (hasConsumed(stream, '//')) {
            hasReachedEnd(stream, state, '\n');
            return null;
        }
        if (hasConsumed(stream, /^["']/)) {
            state.quote = stream.current();
            return null;
        }
        if (hasConsumed(stream, PERSONALIZATION)) {
            return 'sfmc-personalization';
        }
        const before = stream.string.slice(0, stream.start);
        if (BEFORE_REGEX.test(before.trimEnd()) && hasConsumed(stream, REGEX_LITERAL)) {
            return null;
        }
        if (!hasConsumed(stream, /^[a-z_$][\w$]*/i)) {
            stream.next();
            return null;
        }
        return ssjsNameStyle(stream.current(), before, stream.string.slice(stream.pos));
    }

    /**
     * Decides the style of a JavaScript identifier from the text around it.
     *
     * @param {string} name the identifier
     * @param {string} before text of the line in front of it
     * @param {string} after text of the line behind it
     * @returns {string | null} token style, or null for names that are not Marketing Cloud's
     */
    function ssjsNameStyle(name, before, after) {
        if (/\bfunction\s+$/.test(before)) {
            // a function of the script's own that happens to share a name
            return null;
        }
        if (/\.\s*$/.test(before)) {
            const isPlatformFunction =
                /\bFunction\s*\.\s*$/.test(before) && SSJS_PLATFORM_FUNCTIONS.has(name);
            return isPlatformFunction ? 'sfmc-ssjs-function' : null;
        }
        if (SSJS_OBJECTS.has(name)) {
            // only as "Name.member": the same words are common as property and variable names
            return /^\s*\./.test(after) ? 'sfmc-ssjs-object' : null;
        }
        const isCall = /^\s*\(/.test(after);
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
        if (hasConsumed(stream, PERSONALIZATION)) {
            // Marketing Cloud fills in a known %%name%% before it looks for AMPscript, so the
            // closing %% never opens a block or expression, as in href="?e=%%emailaddr%%=1".
            // Whether a name is known depends on the account, so every well-formed one counts.
            return 'sfmc-personalization';
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
     * Tells whether an inline expression that was never closed should be given up here, so that
     * it cannot colour the rest of the document: at a script tag or on a line of whitespace only.
     *
     * @param {object} stream CodeMirror string stream
     * @returns {boolean} true if the expression ends without its closing delimiter
     */
    function hasInlineEnded(stream) {
        return (
            Boolean(stream.match(/^<\/?script\b/i, false)) ||
            (stream.sol() && stream.string.trim() === '')
        );
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
        if (state.region === 'inline' && hasInlineEnded(stream)) {
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
        const wrapped = (config, parserConfig) => {
            // a code resource is a file of its own kind, in which AMPscript and server-side
            // scripts still run; everything else is HTML, which the page's mode colours
            const fileMode = KIND_MODES.get(fileKind());
            // a mode the page's CodeMirror does not have would leave the file without colours
            const hasFileMode =
                fileMode !== undefined &&
                Object.hasOwn(CodeMirror.modes ?? {}, CodeMirror.resolveMode(fileMode).name);
            const base = hasFileMode
                ? CodeMirror.getMode(config, fileMode)
                : original(config, parserConfig);
            return combinedMode(CodeMirror, base);
        };
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
                // resolveMode also follows MIME types and other aliases of the mode
                if (CodeMirror.resolveMode(mode).name === BASE_MODE) {
                    editor.setOption('mode', mode);
                }
            } catch {
                // one odd editor must not keep the others from being refreshed
            }
        }
    }

    let isScanPending = false;
    // the kind of file the open editors are coloured as
    let colouredKind = fileKind();

    /**
     * Patches the mode of every CodeMirror copy that has an editor on the page and whose mode is
     * not patched yet. That is the case for the first editor, and again if the page registers
     * its mode anew later on. Editors that are open when the kind of file becomes known, or
     * changes, are coloured anew.
     */
    function scan() {
        isScanPending = false;
        const kind = fileKind();
        const isNewKind = kind !== colouredKind;
        colouredKind = kind;
        const refreshed = [];
        for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
            const CodeMirror = element.CodeMirror?.constructor;
            const original = CodeMirror?.modes?.[BASE_MODE];
            if (typeof original !== 'function' || refreshed.includes(CodeMirror)) {
                continue;
            }
            const isPatched = original[WRAPPED] === true;
            if (!isPatched && typeof CodeMirror.defineMode === 'function') {
                patchMode(CodeMirror, original);
            } else if (!isPatched || !isNewKind) {
                continue;
            }
            refreshed.push(CodeMirror);
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
        attributes: true,
        attributeFilter: [KIND_ATTRIBUTE],
    });
    scan();
})();
