/*
 * SFMC UX Tools — content script for Setup > Installed Packages.
 *
 * Adds a "Select all" / "Deselect all" button to the "Scope" bar of the component
 * dialog so that every scope checkbox can be toggled with one click.
 */
(() => {
    'use strict';

    const MODAL_SELECTOR = '.slds-modal';
    const BUTTON_ATTRIBUTE = 'data-sfmc-ux-tools-scope-toggle';
    const HEADING_TEXT = 'Scope';
    const LABEL_SELECT = 'Select all';
    const LABEL_DESELECT = 'Deselect all';

    /**
     * Text that belongs to the element itself, ignoring the text of child elements.
     * The injected button lives inside the heading, so `textContent` cannot be used.
     *
     * @param {Element} element element to read
     * @returns {string} trimmed text of the element's own text nodes
     */
    function ownText(element) {
        let text = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            }
        }
        return text.trim();
    }

    /**
     * Finds the "Scope" heading bar inside a dialog.
     *
     * @param {Element} modal dialog to search
     * @returns {Element | undefined} the heading element, if the dialog has one
     */
    function findScopeHeading(modal) {
        for (const element of modal.querySelectorAll('div')) {
            if (ownText(element) === HEADING_TEXT) {
                return element;
            }
        }
        return;
    }

    /**
     * Lists the scope checkboxes: every enabled checkbox of the dialog that comes after the heading.
     *
     * @param {Element} modal dialog that contains the heading
     * @param {Element} heading the "Scope" heading bar
     * @returns {HTMLInputElement[]} checkboxes in document order
     */
    function scopeCheckboxes(modal, heading) {
        return [...modal.querySelectorAll('input[type="checkbox"]')].filter(
            (checkbox) =>
                !checkbox.disabled &&
                heading.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
    }

    /**
     * Sets the button label according to the current state of the checkboxes.
     * Only writes when the label changes so that it never re-triggers the observer endlessly.
     *
     * @param {HTMLButtonElement} button the injected toggle button
     * @param {HTMLInputElement[]} checkboxes scope checkboxes
     */
    function updateLabel(button, checkboxes) {
        const label = checkboxes.some((checkbox) => !checkbox.checked)
            ? LABEL_SELECT
            : LABEL_DESELECT;
        if (button.textContent !== label) {
            button.textContent = label;
        }
    }

    /**
     * Checks all scope checkboxes, or unchecks them when all are checked already.
     * Uses real clicks because the page is a React app that ignores direct `checked` writes.
     *
     * @param {HTMLButtonElement} button the injected toggle button
     */
    function toggleAll(button) {
        const modal = button.closest(MODAL_SELECTOR);
        const heading = button.parentElement;
        if (!modal || !heading) {
            return;
        }
        const checkboxes = scopeCheckboxes(modal, heading);
        const isSelectAll = checkboxes.some((checkbox) => !checkbox.checked);
        for (const checkbox of checkboxes) {
            if (checkbox.checked !== isSelectAll) {
                checkbox.click();
            }
        }
        updateLabel(button, checkboxes);
    }

    /**
     * Adds the toggle button to a dialog's Scope bar, or refreshes its label if present.
     *
     * @param {Element} modal dialog to process
     */
    function processModal(modal) {
        const heading = findScopeHeading(modal);
        if (!heading) {
            return;
        }
        const checkboxes = scopeCheckboxes(modal, heading);
        if (checkboxes.length === 0) {
            return;
        }
        let button = heading.querySelector(`:scope > [${CSS.escape(BUTTON_ATTRIBUTE)}]`);
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.setAttribute(BUTTON_ATTRIBUTE, '');
            button.className = 'slds-button slds-button_neutral';
            button.style.marginLeft = 'auto';
            button.addEventListener('click', () => toggleAll(button));
            heading.append(button);
        }
        updateLabel(button, checkboxes);
    }

    /**
     * Processes every open dialog of the page.
     */
    function scan() {
        for (const modal of document.querySelectorAll(MODAL_SELECTOR)) {
            processModal(modal);
        }
    }

    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', scan, { capture: true });
    scan();
})();
