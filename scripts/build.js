/*
 * Builds the extension:
 * - dist/extension is the complete extension, ready for "Load unpacked": a copy of ./src in which
 *   editor-language.js is replaced by a bundle of that file, the files in src/editor-language
 *   and sfmc-language-lsp, editor-format.js by a bundle of that file, Prettier and
 *   prettier-plugin-sfmc, and editor-typescript.js by a minified bundle of that file, TypeScript,
 *   the SSJS service of sfmc-language-lsp and the declarations of the SSJS globals of ssjs-data,
 *   and to which key-rule-page.js is added, a copy of key-rule.js;
 * - dist/chrome-sfmc-ux-tools-v<version>.zip is the same folder packed for the Chrome Web Store.
 * manifest.json ends up at the root of the archive; entry paths always use forward slashes.
 */
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { findDynamicCode } from './find-dynamic-code.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDirectory = path.join(root, 'src');
const outputDirectory = path.join(root, 'dist');
const extensionDirectory = path.join(outputDirectory, 'extension');
// scripts that are bundled with a package: what they are for, and the package they are built around
const BUNDLES = {
    'editor-language.js': {
        title: 'language features of the code editor',
        library: 'sfmc-language-lsp',
    },
    'editor-format.js': { title: 'formatting in the code editor', library: 'prettier-plugin-sfmc' },
    // TypeScript is large, so this bundle alone is minified
    'editor-typescript.js': {
        title: 'TypeScript-based language features for SSJS in the code editor',
        library: 'typescript',
        isMinified: true,
        // what the SSJS service reads from the disk elsewhere: the types of Marketing Cloud's names
        define: {
            __SFMC_GLOBALS__: JSON.stringify(
                readFileSync(
                    path.join(root, 'node_modules', 'ssjs-data', 'dist', 'sfmc-globals.d.ts'),
                    'utf8',
                ),
            ),
        },
    },
};
// files that ship twice, by the name of the copy. Seen in Content Builder: where one file is
// listed for both worlds of a page, Chrome runs it in the extension's world only. The key rule is
// needed in both there, so the page's world gets it under a name of its own
const COPIES = { 'key-rule-page.js': 'key-rule.js' };
// sources that only exist inside the bundle
const BUNDLED_DIRECTORY = 'editor-language/';

/**
 * Collects all files below a directory.
 *
 * @param {string} directory absolute directory to read
 * @param {string} prefix archive path of that directory
 * @returns {Object.<string, Uint8Array>} file contents by archive path
 */
function collect(directory, prefix = '') {
    const files = {};
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        const archivePath = prefix + entry.name;
        if (entry.isDirectory()) {
            Object.assign(files, collect(absolute, archivePath + '/'));
        } else {
            files[archivePath] = new Uint8Array(readFileSync(absolute));
        }
    }
    return files;
}

// prettier-plugin-sfmc asks for Prettier's Node build; the browser build has all it needs.
// esbuild's "alias" would also rewrite "prettier/plugins/...", so only the bare name is redirected.
const browserPrettier = {
    name: 'browser-prettier',
    setup: (setup) => {
        setup.onResolve({ filter: /^prettier$/ }, (parameters) =>
            setup.resolve('prettier/standalone', {
                kind: parameters.kind,
                resolveDir: parameters.resolveDir,
            }),
        );
    },
};

/**
 * Bundles a script and the packages it uses into one classic script.
 *
 * @param {string} file name of the script in ./src
 * @returns {Promise.<Uint8Array>} the bundle
 */
async function bundle(file) {
    const { title, library, isMinified = false, define = {} } = BUNDLES[file];
    // the packages do not export their package.json, so it is read by path
    const { version } = JSON.parse(
        readFileSync(path.join(root, 'node_modules', library, 'package.json'), 'utf8'),
    );
    const result = await build({
        entryPoints: [path.join(sourceDirectory, file)],
        plugins: [browserPrettier],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'chrome122',
        minify: isMinified,
        define,
        write: false,
        logLevel: 'warning',
        banner: {
            js: `/* SFMC UX Tools - ${title}. Built from src/${file}; includes ${library} ${version}. */`,
        },
    });
    const [{ contents, text }] = result.outputFiles;
    // Chrome refuses both in the scripts of an extension
    const dynamicCode = findDynamicCode(text);
    if (dynamicCode.length) {
        throw new Error(`the bundle of ${file} contains ${dynamicCode.join(', ')}`);
    }
    return contents;
}

const { version } = JSON.parse(readFileSync(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
const files = Object.fromEntries(
    Object.entries(collect(sourceDirectory)).filter(
        ([archivePath]) => !archivePath.startsWith(BUNDLED_DIRECTORY),
    ),
);
for (const file of Object.keys(BUNDLES)) {
    files[file] = await bundle(file);
}
for (const [copy, original] of Object.entries(COPIES)) {
    files[copy] = files[original];
}

for (const [archivePath, contents] of Object.entries(files)) {
    const target = path.join(extensionDirectory, archivePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
}
// files of an earlier build that are gone from the source
const builtPaths = Object.keys(collect(extensionDirectory));
for (const archivePath of builtPaths) {
    if (!Object.hasOwn(files, archivePath)) {
        unlinkSync(path.join(extensionDirectory, archivePath));
    }
}

const target = path.join(outputDirectory, `chrome-sfmc-ux-tools-v${version}.zip`);
writeFileSync(target, zipSync(files, { level: 9 }));
process.stdout.write(
    `${path.relative(root, extensionDirectory)}\n${path.relative(root, target)}\n`,
);
