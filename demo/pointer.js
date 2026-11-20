/*
 * SFMC UX Tools — demo pages: draws a mouse pointer where the mouse is, which a screenshot leaves
 * out otherwise. Only with `?pointer=on` in the address of the page.
 */
(() => {
    'use strict';

    if (new URLSearchParams(location.search).get('pointer') !== 'on') {
        return;
    }
    const pointer = document.createElement('div');
    pointer.className = 'demo-pointer';
    pointer.hidden = true;
    document.body.append(pointer);
    addEventListener('mousemove', (event) => {
        pointer.hidden = false;
        pointer.style.left = `${event.clientX}px`;
        pointer.style.top = `${event.clientY}px`;
    });
})();
