/*
 * SFMC UX Tools — demo page of Journey Builder: the header of a new journey with its name, its
 * buttons and the row of its details, which the built Journey Builder scripts that load before
 * this one take for those of Journey Builder. Everything shown is made up for the pictures of the
 * README.
 *
 * As in Journey Builder, the page first shows the name it made up for the new journey, and then
 * the journey. `?name=` is the name the journey has by then; without it, it keeps the made-up one.
 */
(() => {
    'use strict';

    const MADE_UP_NAME = 'New Journey - 20 November 2026 at 10.30';
    const name = new URLSearchParams(location.search).get('name') || MADE_UP_NAME;
    const app = document.querySelector('#app');

    /**
     * Builds an element.
     *
     * @param {string} tag tag name
     * @param {string} [className] its classes
     * @param {string} [text] its text
     * @returns {HTMLElement} the element
     */
    function element(tag, className = '', text = '') {
        const made = document.createElement(tag);
        made.className = className;
        made.textContent = text;
        return made;
    }

    /**
     * Builds an entry of the journey's details.
     *
     * @param {string} title what the entry is
     * @param {string} value what it says
     * @param {string} [className] classes besides those of an entry
     * @returns {HTMLLIElement} the entry
     */
    function detail(title, value, className = '') {
        const entry = element('li', `slds-page-header__detail-block ${className}`);
        entry.append(
            element('p', 'slds-text-title slds-truncate slds-m-bottom_xx-small', title),
            element('p', 'slds-text-body_regular', value),
        );
        return entry;
    }

    /**
     * Turns the name into a field and back, as the pencil next to it does in Journey Builder.
     *
     * @param {HTMLElement} editor the element around the name
     */
    function editName(editor) {
        const text = editor.querySelector('.readonly-text');
        if (!text) {
            return;
        }
        const field = element('input', 'editable-text');
        field.type = 'text';
        field.value = text.textContent;
        field.setAttribute('aria-label', 'Journey name');
        field.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                field.blur();
            }
        });
        field.addEventListener('blur', () => {
            text.textContent = field.value;
            field.replaceWith(text);
        });
        text.replaceWith(field);
        field.focus();
    }

    /**
     * Shows the journey: its header and the row of its details, closed as in Journey Builder.
     */
    function showJourney() {
        const header = element('header', 'demo-journey-header');
        const title = element('div', 'demo-journey-title');
        const editor = element('div', 'name-editor');
        editor.append(element('div', 'readonly-text', name), element('span', 'edit-icon'));
        editor.querySelector('.edit-icon').setAttribute('aria-label', 'Edit name');
        editor.querySelector('.edit-icon').addEventListener('click', () => editName(editor));
        const toggle = element('span', 'toggle-detail-icon');
        toggle.setAttribute('aria-label', 'Show details');
        const naming = element('div', 'demo-journey-naming');
        naming.append(element('p', 'demo-journey-kind', 'Multi-Step Journey'), editor);
        title.append(element('span', 'demo-journey-icon'), naming, toggle);
        const controls = element('div', 'demo-journey-controls');
        for (const [label, className] of [
            ['Validate', 'control-validate'],
            ['Test', 'control-test'],
            ['Save', 'control-save'],
            ['Activate', 'control-activate demo-button-brand'],
        ]) {
            const button = element('button', `demo-button ${className}`, label);
            button.type = 'button';
            controls.append(button);
        }
        header.append(title, controls);
        const row = element('ul', 'slds-page-header__detail-row');
        row.append(
            detail('Description', 'Add a description', 'description-block'),
            detail('Status', 'Draft'),
            detail('Version', '1'),
            detail('Entry Source', 'API Event'),
        );
        toggle.addEventListener('click', () => row.classList.toggle('detail-visible'));
        const canvas = element('div', 'demo-journey-canvas');
        app.replaceChildren(header, row, canvas);
    }

    // the page that starts a journey, with the name Journey Builder made up for it
    const start = element('div');
    start.id = 'journey-name-input';
    const shown = element('div');
    shown.id = 'journey-name-input_text';
    shown.append(
        element('label', 'demo-hidden', 'Journey Name'),
        element('span', '', MADE_UP_NAME),
    );
    start.append(shown);
    app.append(start);
    // the journey replaces it once the page has drawn it
    requestAnimationFrame(() => setTimeout(showJourney, 0));
})();
