/*
 * Writes src/ampscript-keywords.js from the ampscript-data package, the single source of
 * truth for AMPscript language data. Run with `npm run generate` after updating ampscript-data.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { AMPSCRIPT_KEYWORDS } from 'ampscript-data';

const target = fileURLToPath(new URL('../src/ampscript-keywords.js', import.meta.url));

/**
 * Builds the content of the generated keyword file.
 *
 * @returns {string} javascript source
 */
export function renderKeywords() {
    const names = AMPSCRIPT_KEYWORDS.map((keyword) => `    '${keyword.name.toLowerCase()}',`);
    return [
        '/*',
        ' * GENERATED FILE - do not edit by hand.',
        ' * Source of truth: AMPSCRIPT_KEYWORDS of the ampscript-data package.',
        ' * Regenerate with `npm run generate`.',
        ' */',
        '// eslint-disable-next-line unicorn/no-global-object-property-assignment -- shared with editor-highlight.js, both are classic scripts',
        'globalThis.sfmcUxToolsAmpscriptKeywords = [',
        ...names,
        '];',
        '',
    ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    writeFileSync(target, renderKeywords());
}
