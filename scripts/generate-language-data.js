/*
 * Writes src/language-data.js from the ampscript-data and ssjs-data packages, the single sources
 * of truth for the language definitions. Run with `npm run generate` after updating either package.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { AMPSCRIPT_KEYWORDS } from 'ampscript-data';
import {
    CONSTRUCTIBLE_BUILTINS,
    CORE_LIBRARY_OBJECTS,
    HTTP_METHODS,
    PLATFORM_FUNCTIONS,
    SSJS_GLOBALS,
} from 'ssjs-data';

const target = fileURLToPath(new URL('../src/language-data.js', import.meta.url));

const firstSegment = (name) => name.split('.', 1)[0];
const isNamespace = (global) => global.type === 'object' || global.name.includes('.');

/**
 * Collects the language data the editor colouring needs.
 *
 * @returns {Object.<string, string[]>} name lists by purpose
 */
function collect() {
    // plain JavaScript built-ins such as String and Error are listed as SSJS globals too; they keep their JavaScript colour
    const builtins = new Set(CONSTRUCTIBLE_BUILTINS.map((builtin) => builtin.name));
    const isOwnName = (name) => !builtins.has(name);
    return {
        ampscriptKeywords: AMPSCRIPT_KEYWORDS.map((keyword) => keyword.name.toLowerCase()),
        // objects that are used as `Name.member`: SSJS globals and Core library classes
        ssjsObjects: [
            ...new Set(
                [
                    ...SSJS_GLOBALS.filter(
                        (global) => isNamespace(global) && !global.notDefinedAtRuntime,
                    ),
                    ...CORE_LIBRARY_OBJECTS,
                    // ssjs-data lists the methods of the global HTTP object, but not the object itself
                    ...(HTTP_METHODS.length > 0 ? [{ name: 'HTTP' }] : []),
                ].map((entry) => firstSegment(entry.name)),
            ),
        ].filter((name) => isOwnName(name)),
        // functions that are called without an object in front
        ssjsGlobalFunctions: SSJS_GLOBALS.filter(
            (global) => !isNamespace(global) && !global.notDefinedAtRuntime,
        )
            .map((global) => global.name)
            .filter((name) => isOwnName(name)),
        // functions that are called as `Platform.Function.Name()`
        ssjsPlatformFunctions: PLATFORM_FUNCTIONS.map((platformFunction) => platformFunction.name),
    };
}

/**
 * Builds the content of the generated file.
 *
 * @returns {string} javascript source
 */
export function renderLanguageData() {
    const lists = Object.entries(collect()).flatMap(([key, names]) => [
        `    ${key}: [`,
        ...names.map((name) => `        '${name}',`),
        '    ],',
    ]);
    return [
        '/*',
        ' * GENERATED FILE - do not edit by hand.',
        ' * Sources of truth: the ampscript-data and ssjs-data packages.',
        ' * Regenerate with `npm run generate`.',
        ' */',
        '// eslint-disable-next-line unicorn/no-global-object-property-assignment -- shared with editor-highlight.js, both are classic scripts',
        'globalThis.sfmcUxToolsLanguageData = {',
        ...lists,
        '};',
        '',
    ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    writeFileSync(target, renderLanguageData());
}
