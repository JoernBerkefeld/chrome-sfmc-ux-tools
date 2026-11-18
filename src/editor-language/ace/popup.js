/*
 * SFMC UX Tools — a popup that lists suggestions, for an editor that has none of its own.
 *
 * It knows no editor: it is given the suggestions and a place in the window, and it tells which
 * suggestion was chosen. It uses the classes of CodeMirror's hint popup, so that it looks like
 * the one of Content Builder and follows the editor theme (see ../../editor-highlight.css).
 */

const LIST_CLASS = 'CodeMirror-hints';
const ITEM_CLASS = 'CodeMirror-hint';
const ACTIVE_CLASS = 'CodeMirror-hint-active';
const DETAIL_CLASS = 'sfmc-hint-detail';
// how far PageUp and PageDown go where the sizes of the list are not known
const PAGE_SIZE = 10;

/**
 * Opens a popup with suggestions. The first one is active.
 *
 * @param {object} options what to show and whom to tell
 * @param {Document} options.ownerDocument the page's document
 * @param {{label: string, detail?: string}[]} options.items the suggestions
 * @param {{left: number, top: number, bottom: number}} options.place where the text that is completed starts, in window coordinates: its left edge and the top and bottom of its line
 * @param {(item: object) => void} options.onChoose called with the chosen suggestion, after the popup closed
 * @param {() => void} [options.onClose] called once when the popup closes, whatever closed it
 * @param {() => boolean} [options.isMoved] asked when something scrolls: whether the place of the popup is no longer right. Without it, any scrolling closes the popup
 * @returns {{element: HTMLElement, isOpen: () => boolean, activeIndex: () => number, update: (items: object[], place: object) => void, key: (name: string) => boolean, close: () => void}} the popup
 */
export function openPopup({ ownerDocument, items, place, onChoose, onClose, isMoved }) {
    const view = ownerDocument.defaultView;
    const list = ownerDocument.createElement('ul');
    list.className = LIST_CLASS;
    list.setAttribute('role', 'listbox');
    // the window coordinates stay right, because the popup closes when scrolling moves its place
    list.style.position = 'fixed';
    const state = { items: [], active: 0, isOpen: true };

    const setActive = (index) => {
        list.children[state.active]?.classList.remove(ACTIVE_CLASS);
        state.active = index;
        const node = list.children[index];
        if (!node) {
            return;
        }
        node.classList.add(ACTIVE_CLASS);
        if (node.offsetTop < list.scrollTop) {
            list.scrollTop = node.offsetTop;
        } else if (node.offsetTop + node.offsetHeight > list.scrollTop + list.clientHeight) {
            list.scrollTop = node.offsetTop + node.offsetHeight - list.clientHeight;
        }
    };

    const position = ({ left, top, bottom }) => {
        const { width, height } = list.getBoundingClientRect();
        const hasRoomBelow = bottom + height <= view.innerHeight;
        const isAbove = !hasRoomBelow && top >= height;
        list.style.top = `${isAbove ? top - height : bottom}px`;
        list.style.left = `${Math.max(0, Math.min(left, view.innerWidth - width))}px`;
    };

    const close = () => {
        if (!state.isOpen) {
            return;
        }
        state.isOpen = false;
        ownerDocument.removeEventListener('mousedown', onMouseDownAnywhere, true);
        ownerDocument.removeEventListener('scroll', onScrollAnywhere, true);
        list.remove();
        onClose?.();
    };

    const choose = (index) => {
        const item = state.items[index];
        close();
        if (item) {
            onChoose(item);
        }
    };

    /**
     * Closes the popup for a click outside of it.
     *
     * @param {MouseEvent} event the click
     */
    function onMouseDownAnywhere(event) {
        if (!list.contains(event.target)) {
            close();
        }
    }

    /**
     * Closes the popup when something else than its own list scrolls and its place is no longer
     * right. An editor scrolls parts of itself while it is typed in, which moves nothing.
     *
     * @param {Event} event the scrolling
     */
    function onScrollAnywhere(event) {
        if (event.target !== list && (isMoved?.() ?? true)) {
            close();
        }
    }

    const update = (nextItems, nextPlace) => {
        state.items = [...nextItems];
        list.replaceChildren(
            ...state.items.map(({ label, detail }) => {
                const entry = ownerDocument.createElement('li');
                entry.className = ITEM_CLASS;
                entry.setAttribute('role', 'option');
                entry.textContent = label;
                if (detail) {
                    const note = ownerDocument.createElement('span');
                    note.className = DETAIL_CLASS;
                    note.textContent = detail;
                    entry.append(note);
                }
                return entry;
            }),
        );
        list.scrollTop = 0;
        state.active = 0;
        setActive(0);
        position(nextPlace);
    };

    const pageSize = () => {
        const height = list.children[state.active]?.offsetHeight;
        return height && list.clientHeight
            ? Math.max(1, Math.floor(list.clientHeight / height) - 1)
            : PAGE_SIZE;
    };

    const key = (name) => {
        const last = state.items.length - 1;
        if (!state.isOpen || last < 0) {
            return false;
        }
        switch (name) {
            case 'ArrowDown': {
                setActive(state.active === last ? 0 : state.active + 1);
                return true;
            }
            case 'ArrowUp': {
                setActive(state.active === 0 ? last : state.active - 1);
                return true;
            }
            case 'PageDown': {
                setActive(Math.min(last, state.active + pageSize()));
                return true;
            }
            case 'PageUp': {
                setActive(Math.max(0, state.active - pageSize()));
                return true;
            }
            case 'Home': {
                setActive(0);
                return true;
            }
            case 'End': {
                setActive(last);
                return true;
            }
            case 'Enter':
            case 'Tab': {
                choose(state.active);
                return true;
            }
            case 'Escape': {
                close();
                return true;
            }
            default: {
                return false;
            }
        }
    };

    // a click on the popup must not take the focus from the editor
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
        const entry = event.target.closest?.(`.${ITEM_CLASS}`);
        const index = Array.prototype.indexOf.call(list.children, entry);
        if (index !== -1) {
            choose(index);
        }
    });
    ownerDocument.addEventListener('mousedown', onMouseDownAnywhere, { capture: true });
    ownerDocument.addEventListener('scroll', onScrollAnywhere, { capture: true });
    ownerDocument.body.append(list);
    update(items, place);

    return {
        element: list,
        isOpen: () => state.isOpen,
        activeIndex: () => state.active,
        update,
        key,
        close,
    };
}
