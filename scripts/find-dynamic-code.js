/*
 * Finds code that Chrome does not allow in an extension: calls of eval and `new Function`.
 * It looks at the code itself, not at text: the language data in the completions bundle
 * documents the SSJS function "eval", so its strings mention it without ever running it.
 */
import { parse } from 'acorn';

/**
 * Lists the places where a script builds code from text.
 *
 * @param {string} source a classic script
 * @returns {string[]} one entry such as "eval( in line 12" per place; empty if the script is clean
 */
export function findDynamicCode(source) {
    const tokens = [];
    parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true,
        onToken: tokens,
    });
    const found = [];
    for (const [index, token] of tokens.entries()) {
        const next = tokens[index + 1];
        const isEvalCall =
            token.type.label === 'name' && token.value === 'eval' && next?.type.label === '(';
        const isNewFunction =
            token.type.label === 'new' && next?.type.label === 'name' && next.value === 'Function';
        if (isEvalCall || isNewFunction) {
            found.push(`${isEvalCall ? 'eval(' : 'new Function'} in line ${token.loc.start.line}`);
        }
    }
    return found;
}
