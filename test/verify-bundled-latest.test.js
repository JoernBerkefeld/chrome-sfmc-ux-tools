import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OWNED_PACKAGES, findOutdated, lockedVersions } from '../scripts/verify-bundled-latest.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const lock = {
    packages: {
        '': { name: 'chrome-sfmc-ux-tools' },
        'node_modules/sfmc-language-lsp': { version: '4.4.1' },
        'node_modules/prettier-plugin-sfmc': { version: '2.2.1' },
        'node_modules/prettier-plugin-sfmc/node_modules/ampscript-data': { version: '4.0.0' },
        'node_modules/ampscript-data': { version: '4.2.0' },
        'node_modules/not-ampscript-data': { version: '1.0.0' },
        'node_modules/esbuild': { version: '0.28.2' },
    },
};

test('finds every copy of our own packages in the lockfile, and nothing else', () => {
    assert.deepEqual(
        lockedVersions(lock).map(({ name, version }) => `${name}@${version}`),
        [
            'sfmc-language-lsp@4.4.1',
            'prettier-plugin-sfmc@2.2.1',
            'ampscript-data@4.0.0',
            'ampscript-data@4.2.0',
        ],
    );
});

test('reports each copy that is behind npm, with where it sits', () => {
    const latest = {
        'sfmc-language-lsp': '4.5.0',
        'prettier-plugin-sfmc': '2.2.1',
        'ampscript-data': '4.2.0',
    };
    assert.deepEqual(findOutdated(lock, latest), [
        'node_modules/sfmc-language-lsp: sfmc-language-lsp is locked at 4.4.1, npm has 4.5.0',
        'node_modules/prettier-plugin-sfmc/node_modules/ampscript-data: ampscript-data is locked at 4.0.0, npm has 4.2.0',
    ]);
    assert.deepEqual(findOutdated(lock, { ...latest, 'sfmc-language-lsp': '4.4.1' }).length, 1);
    assert.throws(() => findOutdated(lock, {}), /No published version known/);
});

test('the check covers what the extension bundles and runs before a release is built', () => {
    const {
        dependencies = {},
        devDependencies = {},
        scripts,
    } = JSON.parse(read('../package.json'));
    const declared = Object.keys({ ...dependencies, ...devDependencies });
    for (const name of [
        'sfmc-language-lsp',
        'prettier-plugin-sfmc',
        'ampscript-data',
        'ssjs-data',
    ]) {
        assert.ok(declared.includes(name), `${name} is a dependency`);
        assert.ok(OWNED_PACKAGES.includes(name), `${name} is checked`);
    }
    const installed = lockedVersions(JSON.parse(read('../package-lock.json'))).map(
        ({ name }) => name,
    );
    assert.ok(
        installed.includes('ampscript-parser'),
        'packages that come in indirectly are found too',
    );
    assert.equal(scripts['verify:bundled-latest'], 'node scripts/verify-bundled-latest.js');
    const workflow = read('../.github/workflows/chrome-webstore-publish.yml');
    assert.ok(
        workflow.indexOf('npm run verify:bundled-latest') < workflow.indexOf('npm run build'),
        'the release workflow checks before it builds',
    );
    assert.notEqual(workflow.indexOf('npm run verify:bundled-latest'), -1);
});

test('what ships is a dependency, tools are devDependencies, and the editor version is exact', () => {
    const { dependencies, devDependencies } = JSON.parse(read('../package.json'));
    assert.deepEqual(Object.keys(dependencies), [
        'ampscript-data',
        'prettier',
        'prettier-plugin-sfmc',
        'sfmc-language-lsp',
        'ssjs-data',
        'typescript',
    ]);
    // the version the SSJS service was built for; the build inlines it
    assert.match(dependencies.typescript, /^\d+\.\d+\.\d+$/);
    for (const tool of ['esbuild', 'eslint', 'jsdom', 'codemirror']) {
        assert.ok(Object.hasOwn(devDependencies, tool), tool);
    }
    // the version Content Builder ships; a range would let the tests drift away from it
    assert.match(devDependencies.codemirror, /^\d+\.\d+\.\d+$/);
});
