/*
 * SFMC UX Tools — content script for Setup > Installed Packages.
 *
 * Adds a "Select all" / "Deselect all" button to the bar above the scope checkboxes of the
 * component dialog so that every scope can be toggled with one click.
 *
 * Nothing here depends on the language of the Marketing Cloud UI: the dialog is recognised by
 * its class name and the scope checkboxes by their technical names.
 */
(() => {
    'use strict';

    const MODAL_SELECTOR = '.slds-modal';
    // the add-component and edit-component dialogs carry classes that start like this
    const PACKAGE_DIALOG_SELECTOR = '[class*="mc-packages--components_"]';
    // scope checkboxes are named after the permission they grant, e.g. email_read
    const SCOPE_NAME = /^[a-z\d]+(?:_[a-z\d]+)+$/;
    const BUTTON_ATTRIBUTE = 'data-sfmc-ux-tools-scope-toggle';
    const LABEL_SELECT = 'Select all';
    const LABEL_DESELECT = 'Deselect all';

    /**
     * Tells whether the element has text of its own, ignoring the text of child elements.
     *
     * @param {Element} element element to check
     * @returns {boolean} true if one of its own text nodes is not blank
     */
    function hasOwnText(element) {
        return [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '',
        );
    }

    /**
     * Lists all scope checkboxes of a dialog: every checkbox with a scope name.
     *
     * @param {Element} modal dialog to search
     * @returns {HTMLInputElement[]} checkboxes in document order
     */
    function allScopeCheckboxes(modal) {
        return [...modal.querySelectorAll('input[type="checkbox"]')].filter((checkbox) =>
            SCOPE_NAME.test(checkbox.name),
        );
    }

    /**
     * Lists the scope checkboxes that can be toggled, which leaves out disabled ones.
     *
     * @param {Element} modal dialog to search
     * @returns {HTMLInputElement[]} checkboxes in document order
     */
    function scopeCheckboxes(modal) {
        return allScopeCheckboxes(modal).filter((checkbox) => !checkbox.disabled);
    }

    /**
     * Finds the smallest element that contains all of the given checkboxes.
     *
     * @param {HTMLInputElement[]} checkboxes scope checkboxes, at least one
     * @returns {Element} their common container
     */
    function commonContainer(checkboxes) {
        let container = checkboxes[0].parentElement;
        while (checkboxes.some((checkbox) => !container.contains(checkbox))) {
            container = container.parentElement;
        }
        return container;
    }

    /**
     * Finds the heading bar of the scope section: the element right in front of the checkboxes'
     * container, or the innermost element in it that carries the heading text. If the dialog has
     * no such element, a bar of our own is placed there.
     *
     * @param {Element} container common container of the scope checkboxes
     * @returns {Element} element that hosts the toggle button
     */
    function headingBar(container) {
        let bar = container.previousElementSibling;
        if (!bar) {
            bar = document.createElement('div');
            bar.style.display = 'flex';
            container.before(bar);
            return bar;
        }
        while (
            bar.firstElementChild &&
            !bar.firstElementChild.hasAttribute(BUTTON_ATTRIBUTE) &&
            !hasOwnText(bar)
        ) {
            bar = bar.firstElementChild;
        }
        return bar;
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
        if (!modal) {
            return;
        }
        const checkboxes = scopeCheckboxes(modal);
        const isSelectAll = checkboxes.some((checkbox) => !checkbox.checked);
        for (const checkbox of checkboxes) {
            if (checkbox.checked !== isSelectAll) {
                checkbox.click();
            }
        }
        updateLabel(button, checkboxes);
    }

    /**
     * Adds the toggle button to a component dialog, or refreshes its label if present.
     *
     * @param {Element} modal dialog to process
     */
    function processModal(modal) {
        if (!modal.querySelector(PACKAGE_DIALOG_SELECTOR)) {
            return;
        }
        const checkboxes = scopeCheckboxes(modal);
        if (checkboxes.length === 0) {
            return;
        }
        let button = modal.querySelector(`[${CSS.escape(BUTTON_ATTRIBUTE)}]`);
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.setAttribute(BUTTON_ATTRIBUTE, '');
            button.className = 'slds-button slds-button_neutral';
            button.style.marginLeft = 'auto';
            button.addEventListener('click', () => toggleAll(button));
            headingBar(commonContainer(allScopeCheckboxes(modal))).append(button);
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
