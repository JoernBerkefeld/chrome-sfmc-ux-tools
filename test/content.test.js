import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const contentScript = read('../src/content.js');
const BUTTON = '[data-sfmc-ux-tools-scope-toggle]';

/**
 * Markup of one scope checkbox, mirroring the Installed Packages dialog.
 *
 * @param {string} name scope name
 * @param {string} [attributes] extra attributes for the input
 * @returns {string} html
 */
function checkbox(name, attributes = '') {
    return `<div class="slds-form-element"><div class="slds-form-element__control"><span class="slds-checkbox"><input id="${name}" name="${name}" type="checkbox" ${attributes}><label class="slds-checkbox__label" for="${name}"><span class="slds-checkbox--faux"></span><span class="slds-form-element__label">Read</span></label></span></div></div>`;
}

/**
 * Markup of the component dialog.
 *
 * @param {object} [options] fixture options
 * @param {string} [options.heading] text of the heading bar
 * @param {string} [options.before] html placed before the heading
 * @param {string} [options.boxes] html of the checkboxes below the heading
 * @returns {string} html
 */
function modalHtml({
    heading = 'Scope',
    before = '',
    boxes = checkbox('email_read') + checkbox('email_write') + checkbox('push_send'),
} = {}) {
    return `<div class="slds-modal slds-fade-in-open"><div class="slds-modal__container mc-packages--components_creation-modal"><div class="slds-modal__content"><section>${before}<div class="css-upjinv"><div><div class="css-ozs2lt">${heading}</div></div><div class="css-1t62idy"><div class="css-670dbu">Channels</div>${boxes}</div></div></section></div></div></div>`;
}

/**
 * Creates a page and runs the content script in it.
 *
 * @param {string} bodyHtml initial body content
 * @returns {Document} the page's document
 */
function load(bodyHtml) {
    const dom = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`, {
        runScripts: 'outside-only',
    });
    dom.window.eval(contentScript);
    return dom.window.document;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const checkedNames = (document) =>
    [...document.querySelectorAll('input:checked')].map((input) => input.name);

test('adds a "Select all" button to the Scope bar of an open dialog', () => {
    const document = load(modalHtml());
    const buttons = document.querySelectorAll(BUTTON);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, 'Select all');
    assert.equal(buttons[0].type, 'button');
    assert.equal(buttons[0].parentElement.className, 'css-ozs2lt');
});

test('adds the button when the dialog is opened later', async () => {
    const document = load('<div id="root"></div>');
    assert.equal(document.querySelector(BUTTON), null);
    document.querySelector('#root').innerHTML = modalHtml();
    await tick();
    assert.equal(document.querySelectorAll(BUTTON).length, 1);
});

test('toggles all checkboxes on repeated clicks', async () => {
    const document = load(modalHtml());
    const button = document.querySelector(BUTTON);

    button.click();
    assert.deepEqual(checkedNames(document), ['email_read', 'email_write', 'push_send']);
    assert.equal(button.textContent, 'Deselect all');

    await tick();
    button.click();
    assert.deepEqual(checkedNames(document), []);
    assert.equal(button.textContent, 'Select all');

    await tick();
    button.click();
    assert.equal(checkedNames(document).length, 3);
    assert.equal(document.querySelectorAll(BUTTON).length, 1);
});

test('selects the remaining checkboxes when only some are checked', () => {
    const document = load(modalHtml());
    document.querySelector('#email_write').click();
    document.querySelector(BUTTON).click();
    assert.equal(checkedNames(document).length, 3);
});

test('label follows manual changes', () => {
    const document = load(modalHtml());
    const button = document.querySelector(BUTTON);
    for (const input of document.querySelectorAll('input')) {
        input.click();
    }
    assert.equal(button.textContent, 'Deselect all');
    document.querySelector('#push_send').click();
    assert.equal(button.textContent, 'Select all');
});

test('leaves disabled checkboxes and checkboxes above the heading alone', () => {
    const document = load(
        modalHtml({
            before: checkbox('unrelated'),
            boxes: checkbox('email_read') + checkbox('locked', 'disabled'),
        }),
    );
    const button = document.querySelector(BUTTON);
    button.click();
    assert.deepEqual(checkedNames(document), ['email_read']);
    assert.equal(button.textContent, 'Deselect all');
});

test('does nothing for dialogs without a Scope heading or without checkboxes', async () => {
    const document = load(modalHtml({ heading: 'Properties' }) + modalHtml({ boxes: '' }));
    await tick();
    assert.equal(document.querySelector(BUTTON), null);
});

test('manifest and package agree on the version and reference existing files', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const package_ = JSON.parse(read('../package.json'));
    assert.equal(manifest.version, package_.version);
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.description.length <= 132, 'the store allows 132 characters at most');
    const files = [
        ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css ?? [])]),
        ...Object.values(manifest.icons),
    ];
    for (const file of files) {
        assert.ok(existsSync(new URL(`../src/${file}`, import.meta.url)), `${file} is missing`);
    }
});
