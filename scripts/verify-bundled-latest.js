/*
 * Release-only check: every SFMC package that ends up inside the extension must be the newest
 * version published on npm. The build inlines these packages into the shipped scripts, so one
 * that is fixed upstream but stale in package-lock.json would ship stale.
 *
 * `npm run verify:bundled-latest` asks the npm registry; the release workflow runs it before the
 * build. The comparison itself is tested without the network.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import process from 'node:process';

/**
 * Packages maintained alongside this extension that the build bundles, whether the extension
 * asks for them itself or they come in through another one of them.
 */
export const OWNED_PACKAGES = [
    'sfmc-language-lsp',
    'prettier-plugin-sfmc',
    'ampscript-parser',
    'ampscript-data',
    'ssjs-data',
    'handlebars-data',
    'sfmc-handlebars-parser',
];

/**
 * Lists the versions of the owned packages a lockfile holds. A package can be installed more
 * than once, at the top and below another package.
 *
 * @param {object} lock parsed package-lock.json
 * @returns {{name: string, version: string, location: string}[]} every installed copy
 */
export function lockedVersions(lock) {
    const found = [];
    const installed = Object.entries(lock.packages ?? {});
    for (const [location, entry] of installed) {
        const name = OWNED_PACKAGES.find(
            (owned) =>
                location === `node_modules/${owned}` || location.endsWith(`/node_modules/${owned}`),
        );
        if (name) {
            found.push({ name, version: entry.version, location });
        }
    }
    return found;
}

/**
 * Compares the locked versions of the owned packages with the newest published ones.
 *
 * @param {object} lock parsed package-lock.json
 * @param {Object.<string, string>} latestByName newest published version by package name
 * @returns {string[]} one message per stale copy
 */
export function findOutdated(lock, latestByName) {
    const outdated = [];
    for (const { name, version, location } of lockedVersions(lock)) {
        const latest = latestByName[name];
        assert.ok(latest, `No published version known for ${name}`);
        if (version !== latest) {
            outdated.push(`${location}: ${name} is locked at ${version}, npm has ${latest}`);
        }
    }
    return outdated;
}

/**
 * Asks the public registry for the newest version of a package.
 *
 * @param {string} name package name
 * @returns {Promise.<string>} version
 */
async function latestVersion(name) {
    const response = await fetch(`https://registry.npmjs.org/${name}/latest`);
    assert.ok(response.ok, `npm registry answered ${response.status} for ${name}`);
    const { version } = await response.json();
    assert.equal(typeof version, 'string', `npm registry returned no version for ${name}`);
    return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const names = [...new Set(lockedVersions(lock).map((entry) => entry.name))];
    const latestByName = Object.fromEntries(
        await Promise.all(names.map(async (name) => [name, await latestVersion(name)])),
    );
    assert.deepEqual(
        findOutdated(lock, latestByName),
        [],
        'Bundled SFMC packages are behind npm. Update them (and package-lock.json) before releasing.',
    );
    process.stdout.write(`Bundled SFMC packages are current: ${JSON.stringify(latestByName)}\n`);
}
