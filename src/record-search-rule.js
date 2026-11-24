/*
 * SFMC UX Tools — the rules behind the search for records of a data extension on every field:
 * the order of the field menu, which requests of Contact Builder are a search, the filter that is
 * sent for a field of each type, and how the answer is turned into the one Contact Builder expects.
 *
 * Nothing here touches the page; record-search.js, which is loaded after this file, does.
 */
(() => {
    'use strict';

    // Contact Builder's own route for the rows of a data extension, and for its fields
    const ROWS = /^(.*\/fuelapi\/)internal\/v1\/customobjectdata\/([^/]+)\/?$/i;
    const FIELDS = /\/fuelapi\/internal\/v1\/customobjects\/([^/]+)\/fields\/?$/i;
    // a year, a month or a day, as the search takes them for a date field
    const DAY = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
    // a date as the public route writes it: 1/15/2026 8:30:00 AM
    const PUBLIC_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i;
    const TRUE = ['true', '1'];
    const FALSE = ['false', '0'];
    const NOON = 12;

    /**
     * Writes a number with at least two digits.
     *
     * @param {number | string} number number to write
     * @returns {string} the number, with a zero in front where it has one digit
     */
    function twoDigits(number) {
        return String(number).padStart(2, '0');
    }

    /**
     * Tells the type of a field in lower case.
     *
     * @param {{type?: string}} field field of a data extension
     * @returns {string} its type; empty if it names none
     */
    function typeOf(field) {
        return String(field.type ?? '').toLowerCase();
    }

    /**
     * Finds a field by its name, whatever its case.
     *
     * @param {{name: string}[]} fields fields of a data extension
     * @param {string} name name to look for
     * @returns {{name: string, isPrimaryKey?: boolean, type?: string} | undefined} the field
     */
    function findField(fields, name) {
        const wanted = name.toLowerCase();
        return fields.find((field) => field.name.toLowerCase() === wanted);
    }

    /**
     * Orders the fields for the menu of the search: primary key fields first, in the order of
     * the data extension, then all other fields from A to Z, whatever their case.
     *
     * @param {{name: string, isPrimaryKey?: boolean}[]} fields fields of a data extension
     * @returns {{keys: string[], others: string[]}} the names of both groups
     */
    function menuOrder(fields) {
        const keys = fields.filter((field) => field.isPrimaryKey).map((field) => field.name);
        const others = fields
            .filter((field) => !field.isPrimaryKey)
            .map((field) => field.name)
            .toSorted((first, second) =>
                first.localeCompare(second, 'en', { sensitivity: 'base' }),
            );
        return { keys, others };
    }

    /**
     * Reads a request of Contact Builder.
     *
     * @param {string} method method of the request
     * @param {string} url address of the request
     * @param {string} base address of the page
     * @returns {{kind: 'fields', id: string} | {kind: 'rows', id: string} | {kind: 'search', id: string, objectId: string, column: string, text: string, address: URL, prefix: string} | null} the fields of a data extension, its rows, or a search in them; null for any other request
     */
    function readRequest(method, url, base) {
        if (method.toUpperCase() !== 'GET') {
            return null;
        }
        const address = new URL(url, base);
        const fields = FIELDS.exec(address.pathname);
        if (fields) {
            return { kind: 'fields', id: fields[1].toLowerCase() };
        }
        const rows = ROWS.exec(address.pathname);
        if (!rows) {
            return null;
        }
        const id = rows[2].toLowerCase();
        const text = address.searchParams.get('key') ?? '';
        if (text === '') {
            return { kind: 'rows', id };
        }
        const column = address.searchParams.get('searchColumn') ?? '';
        return { kind: 'search', id, objectId: rows[2], column, text, address, prefix: rows[1] };
    }

    /**
     * Builds the two ends of a year, a month or a day.
     *
     * @param {string} text what the user typed
     * @returns {[string, string] | null} first day, and the day after the last one; null if the text is none of the three
     */
    function dayRange(text) {
        const parts = DAY.exec(text.trim());
        if (!parts) {
            return null;
        }
        const [year, month, day] = parts.slice(1).map((part) => (part ? Number(part) : null));
        const start = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
        // a month 13 or a day 31 of a short month lands in another month
        if (
            (month !== null && start.getUTCMonth() !== month - 1) ||
            (day !== null && start.getUTCDate() !== day)
        ) {
            return null;
        }
        const end = new Date(start);
        if (day !== null) {
            end.setUTCDate(day + 1);
        } else if (month === null) {
            end.setUTCFullYear(year + 1);
        } else {
            end.setUTCMonth(month);
        }
        return [start, end].map((date) => date.toISOString().slice(0, 10));
    }

    /**
     * Builds the filter that finds the rows whose field starts with a text.
     *
     * @param {{name: string, type?: string}} field field to search in
     * @param {string} text what the user typed
     * @returns {string | null} the filter; null if no row can match, as for a text that is neither true nor false in a boolean field
     */
    function filterFor(field, text) {
        const name = `[${field.name}]`;
        const type = typeOf(field);
        if (type === 'boolean') {
            const word = text.trim().toLowerCase();
            if (TRUE.includes(word)) {
                return `${name} eq true`;
            }
            return FALSE.includes(word) ? `${name} eq false` : null;
        }
        const range = type === 'date' ? dayRange(text) : null;
        // an apostrophe cannot be written into the filter; _ stands for any one character
        return range
            ? `${name} gte '${range[0]}' and ${name} lt '${range[1]}'`
            : `${name} like '${text.replaceAll("'", '_')}%'`;
    }

    /**
     * Builds the address of the public route that answers a search.
     *
     * @param {{objectId: string, address: URL, prefix: string}} search search as readRequest found it
     * @param {string | null} filter filter of the search; null to ask for no more than the answer needs
     * @returns {string} the address
     */
    function rowsetAddress(search, filter) {
        const address = new URL(search.address);
        address.pathname = `${search.prefix}data/v1/customobjectdata/${search.objectId}/rowset`;
        const page = filter === null ? '1' : (search.address.searchParams.get('$page') ?? '1');
        const size = filter === null ? '1' : (search.address.searchParams.get('$pagesize') ?? '25');
        const query = filter === null ? '' : `$filter=${encodeURIComponent(filter)}&`;
        address.search = `?${query}$page=${encodeURIComponent(page)}&$pagesize=${encodeURIComponent(size)}`;
        return address.href;
    }

    /**
     * Writes a date of the public route the way Contact Builder's own route does.
     *
     * @param {string} value date such as 1/15/2026 8:30:00 AM
     * @returns {string} 2026-01-15 08:30:00.000; any other text as it is
     */
    function toInternalDate(value) {
        const parts = PUBLIC_DATE.exec(value);
        if (!parts) {
            return value;
        }
        const [, month, day, year, hour, minute, second, half] = parts;
        const hours = (Number(hour) % NOON) + (half.toUpperCase() === 'PM' ? NOON : 0);
        return `${year}-${twoDigits(month)}-${twoDigits(day)} ${twoDigits(hours)}:${minute}:${second}.000`;
    }

    /**
     * Tells the name Contact Builder's own route gives a field: the name with its first letter in
     * lower case, or the name as an earlier answer of that route wrote it.
     *
     * @param {string} name name of the field
     * @param {string[]} seen names in an answer of Contact Builder's own route
     * @returns {string} the name to use
     */
    function internalName(name, seen) {
        const lower = name.toLowerCase();
        return (
            seen.find((item) => item.toLowerCase() === lower) ??
            name.charAt(0).toLowerCase() + name.slice(1)
        );
    }

    /**
     * Turns an answer of the public route into the one Contact Builder's own route gives.
     *
     * @param {{count?: number, page?: number, pageSize?: number, items?: {keys?: object, values?: object}[]}} answer answer of the public route
     * @param {{name: string, type?: string}[]} fields fields of the data extension
     * @param {string[]} [seen] names in an answer of Contact Builder's own route
     * @returns {{count: number, page: number, pageSize: number, items: object[]}} the answer for Contact Builder
     */
    function translate(answer, fields, seen = []) {
        const items = (answer.items ?? []).map((row) => {
            const item = {};
            const values = Object.entries({ ...row.keys, ...row.values });
            for (const [lower, value] of values) {
                const field = findField(fields, lower);
                const name = field ? internalName(field.name, seen) : lower;
                const isDate = field && typeOf(field) === 'date' && typeof value === 'string';
                item[name] = isDate ? toInternalDate(value) : value;
            }
            return item;
        });
        return {
            count: answer.count ?? items.length,
            page: answer.page ?? 1,
            pageSize: answer.pageSize ?? items.length,
            items,
        };
    }

    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- content scripts of one world share nothing but their global object
    globalThis.sfmcUxToolsRecordSearch = {
        findField,
        menuOrder,
        readRequest,
        filterFor,
        rowsetAddress,
        toInternalDate,
        translate,
    };
})();
