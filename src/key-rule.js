/*
 * SFMC UX Tools — how a readable key is derived from a name.
 *
 * Shared by the script that fills the key fields of dialogs and the one that puts a key into the
 * requests of Journey Builder; each runs in a world of its own and loads this file first.
 */
(() => {
    'use strict';

    // what a key keeps besides the underscores that replace spaces
    const NOT_KEPT = /[^\w-]/g;
    // the marks that are left of accented letters once they are taken apart
    const MARKS = /\p{M}/gu;

    /**
     * Derives a key from a name: spaces become underscores, accents are dropped, and of the rest
     * only letters, digits, underscores and hyphens stay.
     *
     * @param {string} name what the user typed as the name
     * @param {number} max longest key that is allowed; anything below 1 means no limit
     * @returns {string} the key; empty if nothing of the name can be part of a key
     */
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- content scripts of one world share nothing but their global object
    globalThis.sfmcUxToolsToKey = (name, max) => {
        const key = name
            .normalize('NFD')
            .replaceAll(MARKS, '')
            .trim()
            .replaceAll(/\s+/g, '_')
            .replaceAll(NOT_KEPT, '')
            .replaceAll(/_+/g, '_')
            .replaceAll(/^_|_$/g, '');
        return max > 0 ? key.slice(0, max).replace(/_$/, '') : key;
    };
})();
