import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const SOURCE = `/**
 * Adds two numbers.
 *
 * @param {number} a first number
 * @param {number} b second number
 * @returns {number} the sum
 */
export function add(a, b) {
    return a + b;
}
`;

test('eslint autofix keeps the asterisk prefixes of JSDoc comments', async () => {
    const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)), fix: true });
    const [result] = await eslint.lintText(SOURCE, { filePath: 'scripts/sample.js' });
    assert.equal(result.output ?? SOURCE, SOURCE);
    assert.deepEqual(result.messages, []);
});
