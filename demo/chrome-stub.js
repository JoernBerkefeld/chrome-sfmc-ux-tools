/*
 * SFMC UX Tools — demo pages: a stand-in for the part of Chrome's extension API that the built
 * scripts use, so that they run on a plain page. Nothing here talks to Chrome or to anyone else.
 *
 * The settings the scripts read are the defaults they ask with, except for those the address of
 * the page names: `?editorTheme=dark` fixes the theme of the code editor, for example.
 */
(() => {
    'use strict';

    const settings = Object.fromEntries(new URLSearchParams(location.search));
    // where the built extension is, seen from the page; an absolute address, as Chrome gives one
    const extension = new URL('/dist/extension/', location.origin);

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- where the built scripts look for Chrome's API
    globalThis.chrome = {
        runtime: {
            getURL: (file) => new URL(file, extension).href,
        },
        storage: {
            sync: {
                get: async (defaults) => ({ ...defaults, ...settings }),
                // the options page saves a choice; the demo forgets it
                set: async () => {},
            },
            onChanged: {
                addListener: () => {},
            },
        },
    };
})();
