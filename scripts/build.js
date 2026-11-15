/*
 * Builds the extension:
 * - dist/extension is the complete extension, ready for "Load unpacked": a copy of ./src in which
 *   editor-completions.js is replaced by a bundle of that file and sfmc-language-lsp;
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
const COMPLETIONS = 'editor-completions.js';

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

/**
 * Bundles the completions script and the language service into one classic script.
 *
 * @returns {Promise.<Uint8Array>} the bundle
 */
async function bundleCompletions() {
    // the package does not export its package.json, so it is read by path
    const { version } = JSON.parse(
        readFileSync(path.join(root, 'node_modules/sfmc-language-lsp/package.json'), 'utf8'),
    );
    const result = await build({
        entryPoints: [path.join(sourceDirectory, COMPLETIONS)],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'chrome111',
        minify: false,
        write: false,
        logLevel: 'warning',
        banner: {
            js: `/* SFMC UX Tools - AMPscript completions. Built from src/${COMPLETIONS}; includes sfmc-language-lsp ${version}. */`,
        },
    });
    const [{ contents, text }] = result.outputFiles;
    // Chrome refuses both in the scripts of an extension
    const dynamicCode = findDynamicCode(text);
    if (dynamicCode.length) {
        throw new Error(`the bundle of ${COMPLETIONS} contains ${dynamicCode.join(', ')}`);
    }
    return contents;
}

const { version } = JSON.parse(readFileSync(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
const files = collect(sourceDirectory);
files[COMPLETIONS] = await bundleCompletions();

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
