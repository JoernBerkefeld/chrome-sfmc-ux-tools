/*
 * SFMC UX Tools — colouring rules for the Ace editor of Automation Studio's script activity.
 *
 * The content is a whole document: text and HTML, server-side JavaScript in
 * <script runat="server">, browser scripts, and AMPscript as in Content Builder. The rules are
 * built from the page's own Ace classes; its JavaScript rules colour the scripts. Where the
 * languages meet, the decisions are those of ../../editor-highlight.js.
 */
import '../../language-data.js';

// the same lists the colouring of Content Builder uses; filled by takeLanguageData
const DATA = {};
const KEYWORDS = new Set();
// %%name%%, the same pattern as in editor-highlight.js
const PERSONALIZATION = String.raw`%%\w(?:[\w .:;~()[\]/-]*[\w)\]])?%%`;
const RUNS_ON_SERVER = /\brunat\s*=\s*["']?server\b/i;
const AMPSCRIPT_LANGUAGE = /\blanguage\s*=\s*["']?ampscript\b/i;
// the parts of an opening script tag behind its name
const TAG_PARTS = /(\s+)|([^\s=<>"'/]+)|(=)|("[^"]*"?|'[^']*'?)|(\/?>)|./g;
const NAME = /^[\w$]+$/;

/*
 * Token types. Ace renders "a.b" as <span class="ace_a ace_b">; editor-highlight.css gives every
 * one of them a colour.
 */
export const TOKENS = {
    tagPunctuation: 'meta.tag.punctuation',
    tagName: 'meta.tag.name',
    attribute: 'entity.other.attribute-name',
    attributeEquals: 'keyword.operator.attribute-equals',
    attributeValue: 'string.attribute-value',
    markupComment: 'comment.markup',
    personalization: 'variable.personalization',
    delimiter: 'meta.delimiter.ampscript',
    ampscriptKeyword: 'keyword.control.ampscript',
    ampscriptFunction: 'support.function.ampscript',
    ampscriptVariable: 'variable.ampscript',
    ampscriptString: 'string.ampscript',
    ampscriptNumber: 'constant.numeric.ampscript',
    ampscriptComment: 'comment.ampscript',
    ampscriptOperator: 'keyword.operator.ampscript',
    ampscriptOpen: 'paren.lparen.ampscript',
    ampscriptClose: 'paren.rparen.ampscript',
    ampscriptText: 'text.ampscript',
    ssjsObject: 'support.class.ssjs',
    ssjsFunction: 'support.function.ssjs',
};

/**
 * Takes the language data from where language-data.js puts it, as editor-highlight.js does with
 * its copy, so that nothing of the extension stays behind in the page's global scope.
 */
export function takeLanguageData() {
    Object.assign(DATA, globalThis.sfmcUxToolsLanguageData);
    delete globalThis.sfmcUxToolsLanguageData;
    const keywords = DATA.ampscriptKeywords ?? [];
    for (const keyword of keywords) {
        KEYWORDS.add(keyword);
    }
}

/**
 * The rule for a personalization string, %%name%%.
 *
 * @returns {object} Ace rule
 */
function personalization() {
    return { token: TOKENS.personalization, regex: PERSONALIZATION };
}

/**
 * Leaves a script for the rest of its closing tag, whatever was open inside the script.
 *
 * @param {string} state current state
 * @param {string[]} stack states to come back to
 * @returns {string} next state
 */
function toTag(state, stack) {
    stack.length = 0;
    return 'tag';
}

/**
 * Turns an inline expression that was never closed into the block that starts inside it.
 *
 * @param {string} state current state
 * @param {string[]} stack states to come back to; the first one is the current region
 * @returns {string} next state
 */
function toBlock(state, stack) {
    if (stack.length) {
        stack[0] = 'amp-block';
    }
    return 'amp-block';
}

/**
 * The rule that ends a script at its closing tag: like the browser, also inside a comment or
 * string. It is written without the case-insensitive flag, which would apply to all rules of a
 * state and so to JavaScript's keywords.
 *
 * @returns {object} Ace rule
 */
function endOfScript() {
    return {
        token: [TOKENS.tagPunctuation, TOKENS.tagName],
        regex: '(</)([sS][cC][rR][iI][pP][tT])',
        next: toTag,
    };
}

/**
 * The rules that start AMPscript. A personalization string comes as one token, so that its
 * closing %% never opens a block or an expression, as in href="?e=%%emailaddr%%=1".
 *
 * @returns {object[]} Ace rules
 */
function ampscriptEntries() {
    return [
        { token: TOKENS.delimiter, regex: String.raw`%%\[`, push: 'amp-block' },
        { token: TOKENS.delimiter, regex: '%%=', push: 'amp-inline' },
        personalization(),
    ];
}

/**
 * The states of one kind of AMPscript region: the code, a comment and the two kinds of strings.
 * Comments and strings may span lines; in a script tag the closing tag ends them as well.
 *
 * @param {string} name 'block', 'inline' or 'script'
 * @param {string} [closing] pattern of the delimiter that ends the region; a script has none
 * @returns {Object.<string, object[]>} Ace rules by state
 */
function ampscriptStates(name, closing) {
    const main = `amp-${name}`;
    const scriptEnd = () => (closing ? [] : [endOfScript()]);
    const code = scriptEnd();
    if (name === 'inline') {
        // an expression that was never closed is given up at a script tag and on an empty line,
        // so that it cannot colour the rest of the document
        code.push(
            { token: TOKENS.ampscriptText, regex: String.raw`(?=</?script\b)`, next: 'pop' },
            { token: TOKENS.ampscriptText, regex: String.raw`^\s*$`, next: 'pop' },
        );
    }
    if (closing) {
        code.push({ token: TOKENS.delimiter, regex: closing, next: 'pop' });
    }
    if (name === 'inline') {
        code.push({ token: TOKENS.delimiter, regex: String.raw`%%\[`, next: toBlock });
    }
    code.push(
        { token: TOKENS.ampscriptText, regex: String.raw`\s+` },
        { token: TOKENS.ampscriptComment, regex: String.raw`/\*`, next: `${main}-comment` },
        { token: TOKENS.ampscriptString, regex: '"', next: `${main}-dq` },
        { token: TOKENS.ampscriptString, regex: "'", next: `${main}-sq` },
        { token: TOKENS.ampscriptVariable, regex: String.raw`@@?[a-z_]\w*` },
        { token: TOKENS.ampscriptNumber, regex: String.raw`\d+(?:\.\d+)?` },
        {
            // a name in front of a bracket
            token: (word) =>
                KEYWORDS.has(word.toLowerCase())
                    ? TOKENS.ampscriptKeyword
                    : TOKENS.ampscriptFunction,
            regex: String.raw`[a-z_]\w*(?=\s*\()`,
        },
        {
            token: (word) =>
                KEYWORDS.has(word.toLowerCase()) ? TOKENS.ampscriptKeyword : TOKENS.ampscriptText,
            regex: String.raw`[a-z_]\w*`,
        },
        { token: TOKENS.ampscriptOperator, regex: '==|!=|<=|>=|<|>|=' },
        { token: TOKENS.ampscriptOpen, regex: String.raw`\(` },
        { token: TOKENS.ampscriptClose, regex: String.raw`\)` },
        { defaultToken: TOKENS.ampscriptText },
    );
    // AMPscript ignores case; the flag of one rule applies to its whole state
    code[0].caseInsensitive = true;
    return {
        [main]: code,
        [`${main}-comment`]: [
            ...scriptEnd(),
            { token: TOKENS.ampscriptComment, regex: String.raw`\*/`, next: main },
            { defaultToken: TOKENS.ampscriptComment },
        ],
        [`${main}-dq`]: [
            ...scriptEnd(),
            { token: TOKENS.ampscriptString, regex: '"', next: main },
            { defaultToken: TOKENS.ampscriptString },
        ],
        [`${main}-sq`]: [
            ...scriptEnd(),
            { token: TOKENS.ampscriptString, regex: "'", next: main },
            { defaultToken: TOKENS.ampscriptString },
        ],
    };
}

/**
 * The states of text and HTML around the scripts: tags, attributes and comments, coloured simply.
 *
 * @param {object} scriptRule the rule for an opening script tag
 * @returns {Object.<string, object[]>} Ace rules by state
 */
function markupStates(scriptRule) {
    return {
        start: [
            ...ampscriptEntries(),
            { token: TOKENS.markupComment, regex: '<!--', next: 'markup-comment' },
            scriptRule,
            {
                token: [TOKENS.tagPunctuation, TOKENS.tagName],
                regex: String.raw`(</?)([a-z][\w:.-]*)`,
                next: 'tag',
            },
            { defaultToken: 'text' },
        ],
        'markup-comment': [
            ...ampscriptEntries(),
            { token: TOKENS.markupComment, regex: '-->', next: 'start' },
            { defaultToken: TOKENS.markupComment },
        ],
        tag: [
            ...ampscriptEntries(),
            { token: TOKENS.tagPunctuation, regex: '/?>', next: 'start' },
            { token: TOKENS.attributeEquals, regex: String.raw`=\s*`, next: 'attr-value' },
            { token: TOKENS.attribute, regex: String.raw`[^\s=<>"'/%]+` },
            // a tag that was never closed ends where the next one starts
            { token: 'text', regex: '(?=<)', next: 'start' },
            { defaultToken: 'text' },
        ],
        'attr-value': [
            ...ampscriptEntries(),
            { token: TOKENS.attributeValue, regex: '"', next: 'attr-dq' },
            { token: TOKENS.attributeValue, regex: "'", next: 'attr-sq' },
            { token: TOKENS.attributeValue, regex: String.raw`[^\s"'<>%/]+|%|/(?!>)` },
            { token: 'text', regex: '', next: 'tag' },
        ],
        'attr-dq': [
            ...ampscriptEntries(),
            { token: TOKENS.attributeValue, regex: '"', next: 'tag' },
            { defaultToken: TOKENS.attributeValue },
        ],
        'attr-sq': [
            ...ampscriptEntries(),
            { token: TOKENS.attributeValue, regex: "'", next: 'tag' },
            { defaultToken: TOKENS.attributeValue },
        ],
    };
}

/**
 * Tells which state colours the content of a script, as editor-highlight.js decides it.
 *
 * @param {string} tag the opening tag
 * @returns {string} state of the AMPscript, of the server-side or of the browser's JavaScript
 */
function scriptState(tag) {
    if (!RUNS_ON_SERVER.test(tag)) {
        return 'js-start';
    }
    return AMPSCRIPT_LANGUAGE.test(tag) ? 'amp-script' : 'ssjs-start';
}

/**
 * Splits an opening script tag into its tokens.
 *
 * @param {string} tag the opening tag, from "<script" to ">"
 * @returns {{type: string, value: string}[]} Ace tokens
 */
function scriptTagTokens(tag) {
    const tokens = [
        { type: TOKENS.tagPunctuation, value: '<' },
        { type: TOKENS.tagName, value: tag.slice(1, 7) },
    ];
    let isValue = false;
    for (const [value, space, word, equals, quoted, end] of tag.slice(7).matchAll(TAG_PARTS)) {
        let type = 'text';
        if (equals) {
            type = TOKENS.attributeEquals;
        } else if (quoted || (word && isValue)) {
            type = TOKENS.attributeValue;
        } else if (word) {
            type = TOKENS.attribute;
        } else if (end) {
            type = TOKENS.tagPunctuation;
        }
        // a value follows its "=", also behind spaces
        isValue = Boolean(equals) || (isValue && Boolean(space));
        tokens.push({ type, value });
    }
    return tokens;
}

/**
 * Joins names to the alternatives of a pattern.
 *
 * @param {string[]} [names] identifiers
 * @returns {string} the alternatives; empty without names
 */
function alternatives(names) {
    return (names ?? []).filter((name) => NAME.test(name)).join('|');
}

/**
 * Adds Marketing Cloud's own names and personalization strings to the rules of server-side
 * JavaScript. Ace's JavaScript rules have a state of their own for what follows a dot, so the
 * rules for objects and global functions never see the member of another object.
 *
 * @param {Object.<string, object[]>} rules all rules by state
 */
function addSsjsNames(rules) {
    const objects = alternatives(DATA.ssjsObjects);
    const globalFunctions = alternatives(DATA.ssjsGlobalFunctions);
    const platformFunctions = alternatives(DATA.ssjsPlatformFunctions);
    const own = [personalization()];
    if (objects) {
        // only as "Name.member": the same words are common as variable names
        own.push({
            token: TOKENS.ssjsObject,
            regex: String.raw`(?:${objects})(?![\w$])(?=\s*\.)`,
        });
    }
    if (globalFunctions) {
        own.push({
            token: TOKENS.ssjsFunction,
            regex: String.raw`(?:${globalFunctions})(?![\w$])(?=\s*\()`,
        });
    }
    rules['ssjs-no_regex']?.unshift(...own);
    if (platformFunctions) {
        rules['ssjs-property']?.unshift({
            token: TOKENS.ssjsFunction,
            regex: String.raw`(?<=\bFunction\s*\.\s*)(?:${platformFunctions})(?![\w$])`,
            next: 'ssjs-no_regex',
        });
    }
    // Marketing Cloud fills personalization strings in before the script runs, also inside strings
    rules['ssjs-qqstring']?.unshift(personalization());
    rules['ssjs-qstring']?.unshift(personalization());
}

/**
 * Builds the class of the colouring rules from the page's own Ace classes.
 *
 * @param {new () => object} TextHighlightRules Ace's base class of all rules
 * @param {new (options: object) => object} JavaScriptHighlightRules Ace's rules for JavaScript
 * @returns {new () => object} class of the rules for a script activity
 */
export function createHighlightRules(TextHighlightRules, JavaScriptHighlightRules) {
    return class ScriptActivityHighlightRules extends TextHighlightRules {
        /**
         * Puts the rules together.
         */
        constructor() {
            super();
            // what the script tag that was just read contains; set as the tag is split into tokens
            let content = 'js-start';
            const scriptRule = {
                // only opening tags that fit on one line are recognised, as in Content Builder
                regex: String.raw`<script\b[^>]*>`,
                caseInsensitive: true,
                onMatch: (tag) => {
                    content = scriptState(tag);
                    return scriptTagTokens(tag);
                },
                next: (state, stack) => {
                    stack.length = 0;
                    return content;
                },
            };
            this.$rules = {
                ...markupStates(scriptRule),
                ...ampscriptStates('block', String.raw`\]%%`),
                ...ampscriptStates('inline', '=%%'),
                ...ampscriptStates('script'),
            };
            // without JSX, which would read the script tag and HTML in strings as elements
            const options = { jsx: false };
            // server-side JavaScript knows no AMPscript blocks, browser scripts do
            this.embedRules(new JavaScriptHighlightRules(options).getRules(), 'ssjs-', [
                endOfScript(),
            ]);
            this.embedRules(new JavaScriptHighlightRules(options).getRules(), 'js-', [
                endOfScript(),
                ...ampscriptEntries(),
            ]);
            addSsjsNames(this.$rules);
            this.normalizeRules();
        }
    };
}
