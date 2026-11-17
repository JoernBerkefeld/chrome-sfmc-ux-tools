import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { openPopup } from '../src/editor-language/ace/popup.js';

const ITEMS = Array.from({ length: 25 }, (unused, index) => ({
    label: `item${index}`,
    detail: index % 2 ? `detail ${index}` : '',
    text: `text${index}`,
}));
const PLACE = { left: 40, top: 100, bottom: 120 };

/**
 * Opens a popup in a page of its own.
 *
 * @param {object} t test context, which closes the page
 * @returns {{window: object, popup: object, chosen: object[], closed: {count: number}}} the page, the popup and what it told
 */
function open(t) {
    const { window } = new JSDOM('<!doctype html><body><input id="other"></body>', {
        pretendToBeVisual: true,
    });
    t.after(() => window.close());
    const chosen = [];
    const closed = { count: 0 };
    const popup = openPopup({
        ownerDocument: window.document,
        items: ITEMS,
        place: PLACE,
        onChoose: (item) => {
            chosen.push(item);
        },
        onClose: () => closed.count++,
    });
    return { window, popup, chosen, closed };
}

/**
 * The entry that is marked as active.
 *
 * @param {object} popup the popup
 * @returns {number[]} the indexes of the active entries, which should be one
 */
function activeEntries(popup) {
    return Array.from(popup.element.children, (entry, index) =>
        entry.classList.contains('CodeMirror-hint-active') ? index : -1,
    ).filter((index) => index !== -1);
}

test('popup: a list on the page body with labels, muted details and the first entry active', (t) => {
    const { window, popup } = open(t);
    const list = window.document.querySelector('body > ul.CodeMirror-hints');
    assert.equal(list, popup.element);
    const entries = [...list.querySelectorAll('li')];
    assert.equal(entries.length, ITEMS.length);
    assert.equal(entries[0].className, 'CodeMirror-hint CodeMirror-hint-active');
    assert.equal(entries[0].textContent, 'item0');
    assert.equal(entries[0].querySelector('.sfmc-hint-detail'), null);
    assert.equal(entries[1].firstChild.textContent, 'item1');
    assert.equal(entries[1].querySelector('.sfmc-hint-detail').textContent, 'detail 1');
    assert.deepEqual(activeEntries(popup), [0]);
    assert.equal(popup.isOpen(), true);
    // below the line, at the left edge it was given
    assert.equal(list.style.position, 'fixed');
    assert.equal(list.style.top, '120px');
    assert.equal(list.style.left, '40px');
});

test('popup: it goes above the line where there is no room below, and stays inside the window', (t) => {
    const { window, popup } = open(t);
    popup.element.getBoundingClientRect = () => ({ width: 200, height: 300 });
    popup.update(ITEMS, { left: window.innerWidth - 50, top: 700, bottom: 720 });
    assert.equal(popup.element.style.top, '400px');
    assert.equal(popup.element.style.left, `${window.innerWidth - 200}px`);
    // no room above either: below
    popup.element.getBoundingClientRect = () => ({ width: 200, height: 700 });
    popup.update(ITEMS, { left: 10, top: 600, bottom: 620 });
    assert.equal(popup.element.style.top, '620px');
});

test('popup: the keys move the active entry', (t) => {
    const { popup, chosen, closed } = open(t);
    const last = ITEMS.length - 1;
    const steps = [
        ['ArrowDown', 1],
        ['ArrowDown', 2],
        ['ArrowUp', 1],
        ['PageDown', 11],
        ['PageDown', 21],
        ['PageDown', last],
        ['ArrowDown', 0],
        ['ArrowUp', last],
        ['PageUp', last - 10],
        ['Home', 0],
        ['PageUp', 0],
        ['End', last],
    ];
    for (const [key, expected] of steps) {
        assert.equal(popup.key(key), true, key);
        assert.equal(popup.activeIndex(), expected, key);
        assert.deepEqual(activeEntries(popup), [expected], key);
    }
    // other keys are not the popup's
    assert.equal(popup.key('ArrowLeft'), false);
    assert.equal(popup.key('a'), false);
    assert.equal(popup.isOpen(), true);
    assert.deepEqual(chosen, []);
    assert.equal(closed.count, 0);
});

test('popup: the active entry is scrolled into view', (t) => {
    const { window, popup } = open(t);
    const list = popup.element;
    // jsdom lays nothing out: every entry is 10 high, and 5 of them fit
    Object.defineProperty(list, 'clientHeight', { value: 50 });
    for (const [index, entry] of [...list.children].entries()) {
        Object.defineProperties(entry, {
            offsetTop: { value: index * 10 },
            offsetHeight: { value: 10 },
        });
    }
    popup.key('End');
    assert.equal(list.scrollTop, 200);
    popup.key('ArrowUp');
    assert.equal(list.scrollTop, 200);
    // a page is what fits, less one
    popup.key('PageUp');
    assert.equal(popup.activeIndex(), 19);
    assert.equal(list.scrollTop, 190);
    popup.key('Home');
    assert.equal(list.scrollTop, 0);
    // its own scrolling does not close it
    list.dispatchEvent(new window.Event('scroll'));
    assert.equal(popup.isOpen(), true);
});

test('popup: Enter, Tab and a click choose, and the popup is gone by then', (t) => {
    for (const key of ['Enter', 'Tab']) {
        const { window, popup, chosen, closed } = open(t);
        popup.key('ArrowDown');
        assert.equal(popup.key(key), true);
        assert.deepEqual(chosen, [ITEMS[1]]);
        assert.equal(closed.count, 1);
        assert.equal(popup.isOpen(), false);
        assert.equal(window.document.querySelector('.CodeMirror-hints'), null);
        // a closed popup takes no keys
        assert.equal(popup.key('Enter'), false);
        assert.equal(chosen.length, 1);
    }
    const { window, popup, chosen, closed } = open(t);
    const detail = popup.element.querySelector(':scope > li:nth-child(4) .sfmc-hint-detail');
    // a mouse button that goes down on the popup must not move the focus
    const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    detail.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(popup.isOpen(), true);
    detail.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(chosen, [ITEMS[3]]);
    assert.equal(closed.count, 1);
    assert.equal(window.document.querySelector('.CodeMirror-hints'), null);
});

test('popup: Escape, a click elsewhere, scrolling and close() close it without a choice, once', (t) => {
    const ways = {
        Escape: ({ popup }) => assert.equal(popup.key('Escape'), true),
        'a click elsewhere': ({ window }) =>
            window.document
                .querySelector('#other')
                .dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })),
        'the page scrolls': ({ window }) =>
            window.document.dispatchEvent(new window.Event('scroll')),
        'something in the page scrolls': ({ window }) =>
            window.document.querySelector('#other').dispatchEvent(new window.Event('scroll')),
        'close()': ({ popup }) => popup.close(),
    };
    for (const [name, closeIt] of Object.entries(ways)) {
        const opened = open(t);
        closeIt(opened);
        assert.equal(opened.popup.isOpen(), false, name);
        assert.equal(opened.window.document.querySelector('.CodeMirror-hints'), null, name);
        opened.popup.close();
        assert.equal(opened.closed.count, 1, name);
        assert.deepEqual(opened.chosen, [], name);
    }
});

test('popup: a new list starts with its first entry active', (t) => {
    const { popup, chosen } = open(t);
    popup.key('End');
    popup.update(ITEMS.slice(5, 8), PLACE);
    assert.equal(popup.element.children.length, 3);
    assert.deepEqual(activeEntries(popup), [0]);
    popup.key('ArrowUp');
    assert.equal(popup.activeIndex(), 2);
    popup.key('Enter');
    assert.deepEqual(chosen, [ITEMS[7]]);
});
