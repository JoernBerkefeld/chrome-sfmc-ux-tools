/*
 * SFMC UX Tools — a box that floats next to a place in the code editor.
 */

const GAP = 4;

/**
 * Creates a floating box. It is added to the page when first shown.
 *
 * @param {Document} document document of the editor
 * @param {string} className class of the box, next to "sfmc-tooltip"
 * @returns {{element: HTMLElement, show: (content: Node, anchor: {left: number, top: number, bottom: number}) => void, hide: () => void, isShown: () => boolean}} the box
 */
export function createTooltip(document, className) {
    const element = document.createElement('div');
    element.className = `sfmc-tooltip ${className}`;
    return {
        element,
        /**
         * Shows content above a place, or below it where there is no room above.
         *
         * @param {Node} content what to show
         * @param {{left: number, top: number, bottom: number}} anchor the place, in window coordinates
         */
        show(content, anchor) {
            element.replaceChildren(content);
            if (!element.isConnected) {
                document.body.append(element);
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
