/*
 * SFMC UX Tools — a box that floats next to a place in the code editor.
 */

const GAP = 4;
// the extension's icon in the corner of every box, and what it says under the mouse, by the class
// of the box
const ICON_CLASS = 'sfmc-tooltip-icon';
const ICON_SAYS = {
    'sfmc-hover': 'SFMC UX Tools: added this box, which explains the code under the mouse.',
    'sfmc-signature': 'SFMC UX Tools: added this box, which explains the inputs of the function.',
    'sfmc-notice': 'SFMC UX Tools: added this note, which says why the code was not formatted.',
};
const ICON_SAYS_ELSE = 'SFMC UX Tools: added this box.';

/**
 * Creates the extension's icon for a place it added or changed: a small element of its own, so
 * that the mouse on the icon, and nowhere else, says what the extension did there. The stylesheet
 * draws the icon by the class.
 *
 * @param {Document} document document of the place
 * @param {string} className class of the icon
 * @param {string} says what the extension added or changed there, in one sentence
 * @returns {HTMLElement} the icon
 */
export function createIcon(document, className, says) {
    const icon = document.createElement('span');
    icon.className = className;
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', says);
    icon.title = says;
    return icon;
}

/**
 * Creates the icon of a floating box, which goes first in it.
 *
 * @param {Document} document document of the box
 * @param {string} className class of the box, next to "sfmc-tooltip"
 * @returns {HTMLElement} the icon
 */
export function createTooltipIcon(document, className) {
    return createIcon(document, ICON_CLASS, ICON_SAYS[className] ?? ICON_SAYS_ELSE);
}

/**
 * Finds the dialog that covers the page around an element: one that is open as a modal one, in
 * the page itself. Everything that is to show next to the element has to stand inside of it.
 *
 * @param {Element} [element] element of the editor
 * @returns {HTMLDialogElement | null} the dialog; null without one, in one that covers nothing, and in one of a shadow tree, which the stylesheet of the boxes does not reach
 */
export function coveringDialog(element) {
    const dialog = element?.closest?.('dialog');
    return dialog && dialog.getRootNode() === dialog.ownerDocument && dialog.matches(':modal')
        ? dialog
        : null;
}

/**
 * Creates a floating box. It is added to the page when first shown.
 *
 * @param {Document} document document of the editor
 * @param {string} className class of the box, next to "sfmc-tooltip"
 * @param {Element} [near] element of the editor, which may stand in a dialog
 * @returns {{element: HTMLElement, show: (content: Node, anchor: object) => void, hide: () => void, isShown: () => boolean}} the box
 */
export function createTooltip(document, className, near) {
    const element = document.createElement('div');
    element.className = `sfmc-tooltip ${className}`;
    const icon = createTooltipIcon(document, className);
    return {
        element,
        /**
         * Shows content above a place, or below it where there is no room above.
         *
         * @param {Node} content what to show
         * @param {{left: number, top: number, bottom: number}} anchor the place, in window coordinates
         */
        show(content, anchor) {
            element.replaceChildren(icon, content);
            if (!element.isConnected) {
                // a dialog that is open covers everything that is not inside of it
                (coveringDialog(near) ?? document.body).append(element);
            }
            element.scrollTop = 0;
            const view = document.defaultView;
            const { width, height } = element.getBoundingClientRect();
            const hasRoomAbove = anchor.top >= GAP + height;
            const top = hasRoomAbove ? anchor.top - GAP - height : anchor.bottom + GAP;
            const left = Math.max(0, Math.min(anchor.left, view.innerWidth - width - GAP));
            element.style.top = `${Math.round(top)}px`;
            element.style.left = `${Math.round(left)}px`;
        },
        /**
         * Takes the box off the page.
         */
        hide() {
            element.remove();
        },
        isShown: () => element.isConnected,
    };
}
