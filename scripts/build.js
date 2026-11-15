/*
 * Packs ./src into dist/chrome-sfmc-ux-tools-v<version>.zip for the Chrome Web Store.
 * manifest.json ends up at the root of the archive; entry paths always use forward slashes.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { zipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDirectory = path.join(root, 'src');
const outputDirectory = path.join(root, 'dist');

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

const { version } = JSON.parse(readFileSync(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
const target = path.join(outputDirectory, `chrome-sfmc-ux-tools-v${version}.zip`);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(target, zipSync(collect(sourceDirectory), { level: 9 }));
process.stdout.write(`${path.relative(root, target)}\n`);
