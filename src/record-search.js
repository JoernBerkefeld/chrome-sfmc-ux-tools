/*
 * SFMC UX Tools — search the records of a data extension on every field. This script runs in the
 * page's own world, in Contact Builder.
 *
 * The Records tab of a data extension searches its primary key fields only, and not at all where
 * there is no primary key. This script lists every field in the menu of that search and switches
 * the search on where Contact Builder switched it off. A search on a primary key field stays
 * Contact Builder's own request. Its route ignores any other field, so for those the request is
 * sent to the public route for the rows of a data extension instead, and its answer is handed to
 * Contact Builder in the form it expects. The rows are shown by Contact Builder's own grid.
 */
(() => {
    'use strict';

    const rule = globalThis.sfmcUxToolsRecordSearch;
    // where Contact Builder shows the records of a data extension
    const ROUTE = /^#admin\/data-extension\/([^/]+)\/records/i;
    // the bar above the grid, and what Contact Builder puts into it
    const BAR = '.repeater-records .edit-de-grid-select';
    const DROPDOWN = 'de-search-dropdown';
    const MENU = `.${DROPDOWN} .dropdown-menu`;
    const LABEL = `.${DROPDOWN} .selected-label`;
    const SEARCH = '.repeater-search';
    const GROUP = '.repeater-search .search.input-group';
    const INPUT = 'input[data-testid="records-search-input"]';
    const BUTTON = 'button[data-testid="records-search-button"]';
    // the help that says the search is switched off
    const OFF_HELP = '.de-search-disabled';
    const OFF = 'disabled';
    // what this script adds
    const MARK = 'sfmc-ux-tools-record-search';
    const FIELD = `${MARK}-field`;
    const KEY = `${MARK}-key`;
    const FIRST = `${MARK}-first`;
    const ICON = `${MARK}-icon`;
    const HIDDEN = `${MARK}-hidden`;
    const PLACEHOLDER = 'Starts with… (% = any text)';
    const INFO =
        'SFMC UX Tools: search on every field. It finds values that start with your text. ' +
        '% stands for any text, _ for one character. ' +
        'Dates: 2026, 2026-01 or 2026-01-15. Booleans: true or false.';
    const FOUND = 200;
    // the browser's own way to read an answer
    const nativeText = Object.getOwnPropertyDescriptor(
        XMLHttpRequest.prototype,
        'responseText',
    ).get;
    const nativeWhole = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get;
    // fields of the data extensions Contact Builder asked for, by the id of the data extension
    const fieldsById = new Map();
    // names of the fields as Contact Builder's own route wrote them, by the id of the data extension
    const seenById = new Map();
    // the field chosen in the menu, by the id of the data extension
    const chosen = new Map();
    // menus of this script whose choice Contact Builder was told
    const told = new WeakSet();
    // requests whose answer is translated, with what the translation needs
    const translations = new WeakMap();

    /**
     * Tells which data extension has its records shown.
     *
     * @returns {string | null} its id in lower case; null on any other page
     */
    function openId() {
        return ROUTE.exec(location.hash)?.[1].toLowerCase() ?? null;
    }

    /**
     * Builds the menu of fields where Contact Builder left it out, with the classes of its own.
     *
     * @returns {HTMLDivElement} the menu, still empty
     */
    function buildDropdown() {
        const dropdown = document.createElement('div');
        dropdown.className = DROPDOWN;
        dropdown.dataset.sfmcUxTools = 'menu';
        const group = document.createElement('div');
        group.className = 'btn-group selectlist filter-by-type';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn btn-default dropdown-toggle';
        toggle.dataset.toggle = 'dropdown';
        const label = document.createElement('span');
        label.className = 'selected-label';
        const caret = document.createElement('span');
        caret.className = 'caret';
        toggle.append(label, caret);
        const menu = document.createElement('ul');
        menu.className = 'dropdown-menu dropdown-search';
        menu.setAttribute('role', 'menu');
        group.append(toggle, menu);
        dropdown.append(group);
        return dropdown;
    }

    /**
     * Builds an entry of the menu. Contact Builder reads the field of a click from the parent of
     * what was clicked, so the link holds text only and has no address to go to.
     *
     * @param {string} name name of the field
     * @returns {HTMLLIElement} the entry
     */
    function buildEntry(name) {
        const entry = document.createElement('li');
        entry.className = FIELD;
        entry.dataset.value = name;
        const link = document.createElement('a');
        link.setAttribute('role', 'menuitem');
        link.tabIndex = -1;
        link.textContent = name;
        entry.append(link);
        return entry;
    }

    /**
     * Makes the menu list every field: the primary key fields first and marked, Contact Builder's
     * own entries among them where it made them, then the other fields from A to Z.
     *
     * @param {HTMLUListElement} menu list of the menu
     * @param {{name: string, isPrimaryKey?: boolean}[]} fields fields of the data extension
     */
    function fillMenu(menu, fields) {
        const { keys, others } = rule.menuOrder(fields);
        const entries = new Map();
        for (const entry of menu.querySelectorAll(':scope > li[data-value]')) {
            const name = entry.dataset.value.toLowerCase();
            const known = entries.get(name);
            if (!known) {
                entries.set(name, entry);
            } else if (known.classList.contains(FIELD)) {
                // Contact Builder added its own entry after this script made one: its own stays
                known.remove();
                entries.set(name, entry);
            } else if (entry.classList.contains(FIELD)) {
                entry.remove();
            }
        }
        const wanted = [...keys, ...others].map((name, index) => {
            const entry = entries.get(name.toLowerCase()) ?? buildEntry(name);
            entry.classList.toggle(KEY, index < keys.length);
            // a line between the two groups
            entry.classList.toggle(FIRST, keys.length > 0 && index === keys.length);
            return entry;
        });
        const last = [...menu.children].slice(-wanted.length);
        if (last.length !== wanted.length || wanted.some((entry, index) => entry !== last[index])) {
            menu.append(...wanted);
        }
    }

    /**
     * Switches the search on where Contact Builder switched it off.
     *
     * @param {Element} bar bar above the grid
     */
    function enable(bar) {
        for (const control of bar.querySelectorAll(`${INPUT}, ${BUTTON}`)) {
            if (control.disabled) {
                control.disabled = false;
            }
        }
        // toggle, unlike add and remove, writes nothing where nothing changes: a write would
        // count as a change of the page and bring this script here again, without end
        bar.querySelector(GROUP)?.classList.toggle(OFF, false);
        bar.querySelector(OFF_HELP)?.classList.toggle(HIDDEN, true);
    }

    /**
     * Keeps the search of the Records tab the way this script wants it, whatever Contact Builder
     * draws: every field in the menu, the search switched on, the hint and the icon in place.
     */
    function tend() {
        const id = openId();
        const bar = document.querySelector(BAR);
        const search = bar?.querySelector(SEARCH);
        if (!search) {
            return;
        }
        const fields = fieldsById.get(id);
        if (!fields?.length) {
            return;
        }
        bar.classList.toggle(MARK, true);
        let dropdown = bar.querySelector(`.${DROPDOWN}`);
        if (!dropdown) {
            dropdown = buildDropdown();
            search.before(dropdown);
        }
        const menu = bar.querySelector(MENU);
        if (menu) {
            fillMenu(menu, fields);
        }
        if (!chosen.has(id) && dropdown.dataset.sfmcUxTools) {
            // a menu of this script starts with its first entry
            const { keys, others } = rule.menuOrder(fields);
            chosen.set(id, keys[0] ?? others[0]);
        }
        const label = bar.querySelector(LABEL);
        if (label && chosen.has(id) && label.textContent !== chosen.get(id)) {
            label.textContent = chosen.get(id);
        }
        enable(bar);
        const input = bar.querySelector(INPUT);
        if (input && input.placeholder !== PLACEHOLDER) {
            input.placeholder = PLACEHOLDER;
        }
        if (bar.querySelector(`.${ICON}`)) {
            return;
        }
        const icon = document.createElement('span');
        icon.className = ICON;
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', INFO);
        icon.title = INFO;
        search.after(icon);
    }

    /**
     * Notes the field that was clicked in the menu, and shows it as the choice, which Contact
     * Builder does not do for an entry of this script.
     *
     * @param {MouseEvent} event click anywhere on the page
     */
    function onClick(event) {
        if (!(event.target instanceof Element)) {
            return;
        }
        if (event.target.closest(BUTTON)) {
            tell();
            return;
        }
        if (!event.target.closest(`${BAR} ${MENU}`)) {
            return;
        }
        const id = openId();
        if (!id || !event.target.matches('li[data-value] > a')) {
            // Contact Builder reads the field from the parent of whatever was clicked in the
            // menu and fails on anything but the link of an entry, so it never hears of this click
            event.stopPropagation();
            return;
        }
        const entry = event.target.parentElement;
        chosen.set(id, entry.dataset.value);
        const dropdown = entry.closest(`.${DROPDOWN}`);
        told.add(dropdown);
        const label = dropdown.querySelector('.selected-label');
        if (label && label.textContent !== entry.dataset.value) {
            label.textContent = entry.dataset.value;
        }
    }

    /**
     * Tells Contact Builder the field of a menu of this script before a search starts, by the
     * click it listens for: it knows no field where it left the menu out.
     */
    function tell() {
        const dropdown = document.querySelector(`${BAR} .${DROPDOWN}`);
        const field = chosen.get(openId());
        if (!field || !dropdown?.dataset.sfmcUxTools || told.has(dropdown)) {
            return;
        }
        told.add(dropdown);
        const entries = [...dropdown.querySelectorAll('li[data-value]')];
        entries
            .find((entry) => entry.dataset.value === field)
            ?.querySelector('a')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    /**
     * Follows the keys: Enter starts a search in the box, and picks an entry of this script in
     * the menu, which has no address that the browser would follow.
     *
     * @param {KeyboardEvent} event key pressed anywhere on the page
     */
    function onKeyDown(event) {
        if (event.key !== 'Enter' || !(event.target instanceof Element)) {
            return;
        }
        if (event.target.matches(INPUT)) {
            tell();
        } else if (event.target.matches(`.${FIELD} > a`)) {
            event.target.click();
        }
    }

    /**
     * Notes what an answer of Contact Builder's own route tells: the fields of a data extension,
     * or the names its rows are written with.
     *
     * @param {{kind: string, id: string}} read request as the rule read it
     * @param {XMLHttpRequest} request request of the page that was answered
     */
    function note(read, request) {
        try {
            const content =
                request.responseType === 'json' ? request.response : JSON.parse(request.response);
            if (read.kind === 'rows') {
                const [first] = content.items ?? [];
                if (first) {
                    seenById.set(read.id, Object.keys(first));
                }
                return;
            }
            const fields = Array.isArray(content) ? content : (content.fields ?? content.items);
            fieldsById.set(
                read.id,
                fields.filter((field) => typeof field?.name === 'string'),
            );
            tend();
        } catch {
            // not an answer this script knows how to read
        }
    }

    /**
     * Reads the answer to a search as Contact Builder expects it.
     *
     * @param {XMLHttpRequest} request request of the page
     * @returns {string | null} the translated answer; null where the answer is the server's own: while it is under way, when the server refused, or when it cannot be read
     */
    function translated(request) {
        const translation = translations.get(request);
        if (
            !translation ||
            request.readyState !== XMLHttpRequest.DONE ||
            request.status !== FOUND
        ) {
            return null;
        }
        if (translation.text === undefined) {
            try {
                const whole = nativeWhole.call(request);
                const answer = typeof whole === 'string' ? JSON.parse(whole) : whole;
                const source = translation.isEmpty
                    ? { count: 0, page: 1, pageSize: translation.size }
                    : answer;
                translation.text = JSON.stringify(
                    rule.translate(source, translation.fields, seenById.get(translation.id)),
                );
            } catch {
                translation.text = null;
            }
        }
        return translation.text;
    }

    /**
     * Looks at a request the page opens. A search on a field that is not a primary key is sent to
     * the public route, and that request gets its own way to read the answer.
     *
     * @param {XMLHttpRequest} request request of the page
     * @param {unknown[]} parameters what the page opens it with: method and address first
     * @returns {unknown[]} what the request is opened with
     */
    function prepare(request, parameters) {
        if (translations.has(request)) {
            // the request is used for something else
            translations.delete(request);
            delete request.responseText;
            delete request.response;
        }
        const [method, url] = parameters;
        if (new URL(String(url), location.href).origin !== location.origin) {
            return parameters;
        }
        const read = rule.readRequest(String(method), String(url), location.href);
        if (!read) {
            return parameters;
        }
        if (read.kind !== 'search') {
            request.addEventListener('load', () => note(read, request), { once: true });
            return parameters;
        }
        const fields = fieldsById.get(read.id);
        // the menu is what the user sees, so its choice counts
        const field = fields && rule.findField(fields, chosen.get(read.id) ?? read.column);
        if (!field) {
            return parameters;
        }
        if (field.isPrimaryKey) {
            if (field.name.toLowerCase() === read.column.toLowerCase()) {
                return parameters;
            }
            const address = new URL(read.address);
            address.searchParams.set('searchColumn', field.name);
            return [method, address.href, ...parameters.slice(2)];
        }
        const filter = rule.filterFor(field, read.text);
        translations.set(request, {
            fields,
            id: read.id,
            isEmpty: filter === null,
            size: Number(read.address.searchParams.get('$pagesize')) || 0,
        });
        Object.defineProperties(request, {
            responseText: {
                configurable: true,
                get: () => translated(request) ?? nativeText.call(request),
            },
            response: {
                configurable: true,
                get: () => {
                    const text = translated(request);
                    if (text === null) {
                        return nativeWhole.call(request);
                    }
                    return request.responseType === 'json' ? JSON.parse(text) : text;
                },
            },
        });
        return [method, rule.rowsetAddress(read, filter), ...parameters.slice(2)];
    }

    // the page's requests pass through here on their way out
    XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
        apply: (open, request, parameters) => {
            let prepared = parameters;
            try {
                prepared = prepare(request, parameters);
            } catch {
                // not a request this script knows how to read
            }
            return Reflect.apply(open, request, prepared);
        },
    });
    new MutationObserver(tend).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', OFF, 'placeholder'],
    });
    addEventListener('hashchange', () => {
        // a choice ends when the page leaves the records of its data extension
        const id = openId();
        for (const key of chosen.keys()) {
            if (key !== id) {
                chosen.delete(key);
            }
        }
        tend();
    });
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
})();
