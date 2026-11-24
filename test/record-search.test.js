import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
// in the order of the manifest
const ruleScript = read('../src/record-search-rule.js');
const script = ruleScript + read('../src/record-search.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
// what a page made, as an object of the test's own
const plain = (value) => structuredClone(value);
const between = (start, end) => `[Created] gte '${start}' and [Created] lt '${end}'`;
const ID = '0a1b2c3d-1111-2222-3333-444455556666';
const ORIGIN = 'https://mc.s7.marketingcloudapps.com';
const PAGE = `${ORIGIN}/contactsmeta/admin.html`;
const ROWS = `/contactsmeta/fuelapi/internal/v1/CustomObjectData/${ID}`;
const FIELDS_URL = `/contactsmeta/fuelapi/internal/v1/customobjects/${ID}/fields`;
const MARK = 'sfmc-ux-tools-record-search';
const FIELDS = [
    { name: 'zeta', isPrimaryKey: false, type: 'Text' },
    { name: 'RowId', isPrimaryKey: true, type: 'Number' },
    { name: 'Spaced Field', isPrimaryKey: false, type: 'Text' },
    { name: 'alpha_lower', isPrimaryKey: false, type: 'Text' },
    { name: 'Created', isPrimaryKey: false, type: 'Date' },
    { name: 'IsActive', isPrimaryKey: false, type: 'Boolean' },
    { name: 'Region', isPrimaryKey: true, type: 'Text' },
];
// the bar as Contact Builder draws it for a data extension with a primary key
const WITH_KEY =
    '<div class="repeater repeater-records"><div class="edit-de-grid-select">' +
    '<div class="de-search-dropdown"><div class="btn-group selectlist filter-by-type">' +
    '<button class="btn dropdown-toggle" data-toggle="dropdown"><span class="selected-label">RowId</span></button>' +
    '<ul class="dropdown-menu dropdown-search"><li data-value="Region"><a>Region</a></li><li data-value="RowId"><a>RowId</a></li></ul>' +
    '</div></div>' +
    '<div class="repeater-search"><div class="search input-group">' +
    '<input data-testid="records-search-input" placeholder="Search" />' +
    '<button data-testid="records-search-button"></button></div></div>' +
    '<button class="de-search-info"></button><button class="de-search-disabled"></button>' +
    '</div></div>';
// and for one without: no menu, everything switched off
const WITHOUT_KEY =
    '<div class="repeater repeater-records"><div class="edit-de-grid-select">' +
    '<div class="repeater-search"><div class="search input-group disabled">' +
    '<input data-testid="records-search-input" disabled />' +
    '<button data-testid="records-search-button" disabled></button></div></div>' +
    '<button class="de-search-info"></button><button class="de-search-disabled"></button>' +
    '</div></div>';

/**
 * Loads the rules of the search the way a page does.
 *
 * @returns {object} what record-search-rule.js offers
 */
function rules() {
    const { window } = new JSDOM('', { runScripts: 'outside-only', url: PAGE });
    window.eval(ruleScript);
    return window.sfmcUxToolsRecordSearch;
}

/**
 * Runs the script in a page of Contact Builder and stands in for the server.
 *
 * @param {string} [html] content of the page
 * @param {string} [hash] route of the page
 * @returns {{window: Window, document: Document, opened: string[], get: (url: string, answer?: object | string, status?: number) => XMLHttpRequest, loadFields: (fields?: object[]) => Promise.<void>}} the page, the addresses that went out, a way to send a request as the page would and have it answered, and a way to let the page learn the fields
 */
function page(html = '', hash = `#admin/data-extension/${ID}/records`) {
    const { window } = new JSDOM(`<!doctype html><body>${html}</body>`, {
        runScripts: 'outside-only',
        url: PAGE + hash,
    });
    const opened = [];
    // the answer to the request that was sent last; the tests read each answer before the next
    let last = { text: '', status: 0, state: 1 };
    const prototype = window.XMLHttpRequest.prototype;
    // what the script wraps and reads: nothing leaves the test
    prototype.open = (method, url) => {
        opened.push(String(url));
    };
    Object.defineProperties(prototype, {
        responseText: { configurable: true, get: () => last.text },
        response: { configurable: true, get: () => last.text },
        status: { configurable: true, get: () => last.status },
        readyState: { configurable: true, get: () => last.state },
    });
    window.eval(script);
    const get = (url, answer = {}, status = 200) => {
        const request = new window.XMLHttpRequest();
        request.open('GET', url, true);
        const text = typeof answer === 'string' ? answer : JSON.stringify(answer);
        last = { text, status, state: 4 };
        request.dispatchEvent(new window.Event('load'));
        return request;
    };
    return {
        window,
        document: window.document,
        opened,
        get,
        loadFields: async (fields = FIELDS) => {
            get(FIELDS_URL, { fields });
            await tick();
        },
    };
}

test('the menu lists primary key fields first, then the other fields from A to Z whatever their case', () => {
    const { menuOrder } = rules();
    assert.deepEqual(plain(menuOrder(FIELDS)), {
        keys: ['RowId', 'Region'],
        others: ['alpha_lower', 'Created', 'IsActive', 'Spaced Field', 'zeta'],
    });
    assert.deepEqual(plain(menuOrder([{ name: 'b' }, { name: 'A' }])), {
        keys: [],
        others: ['A', 'b'],
    });
});

test('a request is read as the fields, the rows or a search of a data extension, and nothing else is', () => {
    const { readRequest } = rules();
    assert.equal(readRequest('GET', FIELDS_URL, PAGE).kind, 'fields');
    assert.equal(readRequest('GET', FIELDS_URL, PAGE).id, ID);
    assert.equal(readRequest('GET', `${ROWS}?$page=1&$pagesize=25`, PAGE).kind, 'rows');
    // an emptied box lists all rows
    assert.equal(readRequest('GET', `${ROWS}?searchColumn=RowId&key=`, PAGE).kind, 'rows');
    const search = readRequest(
        'GET',
        `${ROWS.toLowerCase()}?searchColumn=Spaced%20Field&key=a%25b&preciseDateTime=true&$page=2&$pagesize=50`,
        PAGE,
    );
    assert.equal(search.kind, 'search');
    assert.equal(search.column, 'Spaced Field');
    assert.equal(search.text, 'a%b');
    assert.equal(search.id, ID);
    assert.equal(readRequest('POST', `${ROWS}?searchColumn=RowId&key=a`, PAGE), null);
    assert.equal(readRequest('GET', `${ROWS}/rowset?key=a`, PAGE), null);
    assert.equal(readRequest('GET', '/contactsmeta/fuelapi/internal/v1/other', PAGE), null);
});

test('text, number and similar fields are searched by the start of the value; % and _ pass, an apostrophe becomes _', () => {
    const { filterFor } = rules();
    assert.equal(filterFor({ name: 'zeta', type: 'Text' }, 'ab'), "[zeta] like 'ab%'");
    assert.equal(
        filterFor({ name: 'Spaced Field', type: 'EmailAddress' }, '%x_y'),
        "[Spaced Field] like '%x_y%'",
    );
    assert.equal(filterFor({ name: 'Amount', type: 'Decimal' }, '42'), "[Amount] like '42%'");
    assert.equal(filterFor({ name: 'Name', type: 'Text' }, "O'Brien"), "[Name] like 'O_Brien%'");
    assert.equal(filterFor({ name: 'Name' }, 'a'), "[Name] like 'a%'");
});

test('a boolean field takes true, false, 1 and 0, and any other text finds nothing', () => {
    const { filterFor } = rules();
    const field = { name: 'IsActive', type: 'Boolean' };
    assert.equal(filterFor(field, 'TRUE'), '[IsActive] eq true');
    assert.equal(filterFor(field, '1'), '[IsActive] eq true');
    assert.equal(filterFor(field, ' false '), '[IsActive] eq false');
    assert.equal(filterFor(field, '0'), '[IsActive] eq false');
    assert.equal(filterFor(field, 'yes'), null);
});

test('a date field takes a year, a month or a day, and any other text is searched by its start', () => {
    const { filterFor } = rules();
    const field = { name: 'Created', type: 'Date' };
    assert.equal(filterFor(field, '2026'), between('2026-01-01', '2027-01-01'));
    assert.equal(filterFor(field, '2026-12'), between('2026-12-01', '2027-01-01'));
    assert.equal(filterFor(field, '2026-01'), between('2026-01-01', '2026-02-01'));
    assert.equal(filterFor(field, '2026-01-31'), between('2026-01-31', '2026-02-01'));
    assert.equal(filterFor(field, '2028-02-29'), between('2028-02-29', '2028-03-01'));
    // no such month or day
    assert.equal(filterFor(field, '2026-13'), "[Created] like '2026-13%'");
    assert.equal(filterFor(field, '2026-02-30'), "[Created] like '2026-02-30%'");
    assert.equal(filterFor(field, 'Jan'), "[Created] like 'Jan%'");
});

test('the address of the public route keeps page and page size and carries the filter', () => {
    const { readRequest, rowsetAddress } = rules();
    const search = readRequest(
        'GET',
        `${ROWS}?searchColumn=zeta&key=a&preciseDateTime=true&$page=3&$pagesize=50&$sort=zeta%20ASC`,
        PAGE,
    );
    assert.equal(
        rowsetAddress(search, "[zeta] like 'a%'"),
        `${ORIGIN}/contactsmeta/fuelapi/data/v1/customobjectdata/${ID}/rowset?$filter=%5Bzeta%5D%20like%20%27a%25%27&$page=3&$pagesize=50`,
    );
    // nothing can match: no filter is sent, and no more is asked for than one row
    assert.equal(
        rowsetAddress(search, null),
        `${ORIGIN}/contactsmeta/fuelapi/data/v1/customobjectdata/${ID}/rowset?$page=1&$pagesize=1`,
    );
});

test('a date of the public route is written as Contact Builder writes it', () => {
    const { toInternalDate } = rules();
    assert.equal(toInternalDate('1/15/2026 8:30:00 AM'), '2026-01-15 08:30:00.000');
    assert.equal(toInternalDate('8/15/2026 3:06:23 PM'), '2026-08-15 15:06:23.000');
    assert.equal(toInternalDate('12/1/2026 12:00:00 AM'), '2026-12-01 00:00:00.000');
    assert.equal(toInternalDate('12/1/2026 12:05:09 PM'), '2026-12-01 12:05:09.000');
    assert.equal(toInternalDate(''), '');
    assert.equal(toInternalDate('2026-01-15'), '2026-01-15');
});

test('an answer of the public route becomes the one Contact Builder expects', () => {
    const { translate } = rules();
    const answer = {
        count: 7,
        page: 2,
        pageSize: 1,
        items: [
            {
                keys: { rowid: '3', region: 'EU' },
                values: {
                    'spaced field': 'x',
                    alpha_lower: 'y',
                    created: '1/15/2026 8:30:00 AM',
                    isactive: 'True',
                    zeta: '',
                    unknown: '1/15/2026 8:30:00 AM',
                },
            },
        ],
    };
    assert.deepEqual(plain(translate(answer, FIELDS)), {
        count: 7,
        page: 2,
        pageSize: 1,
        items: [
            {
                rowId: '3',
                region: 'EU',
                'spaced Field': 'x',
                alpha_lower: 'y',
                created: '2026-01-15 08:30:00.000',
                isActive: 'True',
                zeta: '',
                unknown: '1/15/2026 8:30:00 AM',
            },
        ],
    });
    // the names an answer of Contact Builder's own route used come first
    const seen = translate(answer, FIELDS, ['ROWID', 'Zeta']).items[0];
    assert.equal(seen.ROWID, '3');
    assert.equal(seen.Zeta, '');
    // nothing matched: the public route leaves the rows out
    assert.deepEqual(plain(translate({ count: 0, page: 1, pageSize: 25 }, FIELDS)), {
        count: 0,
        page: 1,
        pageSize: 25,
        items: [],
    });
});

test('with a primary key, the menu keeps its entries on top and marked and gets every other field below', async () => {
    const { document, loadFields } = page(WITH_KEY);
    await loadFields();
    const entries = [...document.querySelectorAll('.dropdown-search > li')];
    assert.deepEqual(
        entries.map((entry) => entry.dataset.value),
        ['RowId', 'Region', 'alpha_lower', 'Created', 'IsActive', 'Spaced Field', 'zeta'],
    );
    assert.deepEqual(
        entries.map((entry) => entry.classList.contains(`${MARK}-key`)),
        [true, true, false, false, false, false, false],
    );
    assert.deepEqual(
        entries
            .filter((entry) => entry.classList.contains(`${MARK}-first`))
            .map((entry) => entry.dataset.value),
        ['alpha_lower'],
    );
    for (const entry of entries) {
        // Contact Builder reads the field from the parent of what is clicked
        assert.equal(entry.children.length, 1);
        assert.equal(entry.firstElementChild.localName, 'a');
        assert.equal(entry.firstElementChild.children.length, 0);
        assert.equal(entry.firstElementChild.hasAttribute('href'), false);
    }
    assert.equal(document.querySelector('.selected-label').textContent, 'RowId');
    assert.match(document.querySelector('input').placeholder, /Starts with.*%/);
    const icon = document.querySelector(`.repeater-search + .${MARK}-icon`);
    assert.match(icon.title, /%.*2026-01-15.*true or false/);
    assert.ok(document.querySelector('.edit-de-grid-select').classList.contains(MARK));
    assert.equal(document.querySelectorAll(`.${MARK}-icon`).length, 1);
});

test('without a primary key, the menu is added and the search is switched on, and stays so when it is drawn again', async () => {
    const { document, loadFields } = page(WITHOUT_KEY);
    const fields = FIELDS.map((field) => ({ ...field, isPrimaryKey: false }));
    await loadFields(fields);
    const dropdown = document.querySelector('.edit-de-grid-select > .de-search-dropdown');
    assert.equal(dropdown.nextElementSibling, document.querySelector('.repeater-search'));
    assert.ok(dropdown.querySelector('.btn-group.selectlist.filter-by-type'));
    assert.equal(dropdown.querySelector('button.dropdown-toggle').dataset.toggle, 'dropdown');
    const names = [
        ...dropdown.querySelectorAll(':scope ul.dropdown-menu.dropdown-search > li'),
    ].map((entry) => entry.dataset.value);
    assert.deepEqual(names, [
        'alpha_lower',
        'Created',
        'IsActive',
        'Region',
        'RowId',
        'Spaced Field',
        'zeta',
    ]);
    assert.equal(document.querySelectorAll(`.${MARK}-key, .${MARK}-first`).length, 0);
    assert.equal(dropdown.querySelector('.selected-label').textContent, 'alpha_lower');
    const input = document.querySelector('input');
    const button = document.querySelector('[data-testid="records-search-button"]');
    const group = document.querySelector('.input-group');
    assert.equal(input.disabled, false);
    assert.equal(button.disabled, false);
    assert.equal(group.classList.contains('disabled'), false);
    assert.ok(document.querySelector('.de-search-disabled').classList.contains(`${MARK}-hidden`));
    // Contact Builder draws the grid again and switches the search off once more
    input.disabled = true;
    button.disabled = true;
    group.classList.add('disabled');
    await tick();
    assert.equal(input.disabled, false);
    assert.equal(button.disabled, false);
    assert.equal(group.classList.contains('disabled'), false);
});

test('a click on an entry shows it as the choice, and a search tells Contact Builder the choice of an added menu first', async () => {
    const { window, document, loadFields } = page(WITHOUT_KEY);
    await loadFields(FIELDS.map((field) => ({ ...field, isPrimaryKey: false })));
    const heard = [];
    // Contact Builder's own handler
    document.querySelector('.edit-de-grid-select').addEventListener('click', (event) => {
        if (event.target.closest('.de-search-dropdown .dropdown-menu')) {
            heard.push(event.target.parentElement.attributes['data-value'].value);
        }
    });
    const input = document.querySelector('input');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(heard, ['alpha_lower']);
    // told once
    document.querySelector('[data-testid="records-search-button"]').click();
    assert.deepEqual(heard, ['alpha_lower']);
    document.querySelector('li[data-value="zeta"] > a').click();
    await tick();
    assert.deepEqual(heard, ['alpha_lower', 'zeta']);
    assert.equal(document.querySelector('.selected-label').textContent, 'zeta');
});

test('a click in the menu beside the link of an entry never reaches Contact Builder and changes no choice', async () => {
    const { document, opened, get, loadFields } = page(WITH_KEY);
    await loadFields();
    const heard = [];
    // Contact Builder's own handler, which fails on anything but the link of an entry
    document.querySelector('.edit-de-grid-select').addEventListener('click', (event) => {
        heard.push(event.target.localName);
    });
    const menu = document.querySelector('.dropdown-search');
    menu.click();
    document.querySelector('li[data-value="zeta"]').click();
    document.querySelector('li[data-value="Region"]').click();
    await tick();
    assert.deepEqual(heard, []);
    assert.equal(document.querySelector('.selected-label').textContent, 'RowId');
    // no field was chosen: the search stays the one Contact Builder asked for
    const url = `${ROWS}?searchColumn=RowId&key=4&$page=1&$pagesize=25`;
    get(url);
    assert.equal(opened.at(-1), url);
    // the link of an entry is heard, and so is a click outside the menu
    document.querySelector('li[data-value="zeta"] > a').click();
    document.querySelector('.dropdown-toggle').click();
    assert.deepEqual(heard, ['a', 'button']);
    assert.equal(document.querySelector('.selected-label').textContent, 'zeta');
});

test('an entry Contact Builder adds for a field replaces the one this script made, so each field is listed once', async () => {
    const { document, loadFields } = page(WITH_KEY);
    await loadFields();
    const menu = document.querySelector('.dropdown-search');
    assert.ok(menu.querySelector('li[data-value="zeta"]').classList.contains(`${MARK}-field`));
    const own = (name) => {
        const entry = document.createElement('li');
        entry.dataset.value = name;
        entry.append(Object.assign(document.createElement('a'), { textContent: name }));
        return entry;
    };
    // after the entry of this script, and before it
    const after = own('zeta');
    const before = own('Created');
    menu.append(after);
    menu.prepend(before);
    await tick();
    const entries = [...menu.children];
    assert.deepEqual(
        entries.map((entry) => entry.dataset.value),
        ['RowId', 'Region', 'alpha_lower', 'Created', 'IsActive', 'Spaced Field', 'zeta'],
    );
    assert.equal(entries[3], before);
    assert.equal(entries[6], after);
    assert.deepEqual(
        entries.map((entry) => entry.classList.contains(`${MARK}-field`)),
        [false, false, true, false, true, true, false],
    );
});

test('the chosen field outlives a bar that is drawn again, and ends with the route of another data extension', async () => {
    const { window, document, opened, get, loadFields } = page(WITH_KEY);
    await loadFields();
    // jsdom follows a link without an address, to the page without its route; no browser does
    document.addEventListener('click', (event) => event.preventDefault());
    document.querySelector('li[data-value="Created"] > a').click();
    // Contact Builder takes the bar away and draws it again
    document.body.replaceChildren();
    await tick();
    document.body.innerHTML = WITH_KEY;
    await tick();
    assert.equal(document.querySelector('.selected-label').textContent, 'Created');
    const url = `${ROWS}?searchColumn=RowId&key=2026&$page=1&$pagesize=25`;
    get(url);
    assert.equal(
        new URL(opened.at(-1), ORIGIN).searchParams.get('$filter'),
        between('2026-01-01', '2027-01-01'),
    );
    // the records of another data extension
    window.location.hash = '#admin/data-extension/ffffffff-1111-2222-3333-444455556666/records';
    await new Promise((resolve) => {
        window.addEventListener('hashchange', resolve, { once: true });
    });
    get(FIELDS_URL.replace(ID, 'ffffffff-1111-2222-3333-444455556666'), { fields: FIELDS });
    document.body.innerHTML = WITH_KEY;
    await tick();
    assert.equal(document.querySelector('.selected-label').textContent, 'RowId');
    const other = url.replace(ID, 'ffffffff-1111-2222-3333-444455556666');
    get(other);
    assert.equal(opened.at(-1), other);
    // and the first one no longer has a choice either
    get(url);
    assert.equal(opened.at(-1), url);
});

test('a search on a primary key field stays Contact Builder’s own request', async () => {
    const { opened, get, loadFields } = page(WITH_KEY);
    await loadFields();
    const url = `${ROWS}?searchColumn=RowId&key=4&preciseDateTime=true&$page=1&$pagesize=25`;
    const request = get(url, { count: 1, items: [{ rowId: '4' }] });
    assert.equal(opened.at(-1), url);
    assert.equal(Object.hasOwn(request, 'responseText'), false);
    assert.deepEqual(JSON.parse(request.responseText).items, [{ rowId: '4' }]);
});

test('a search on any other field goes to the public route, and its answer reaches Contact Builder translated', async () => {
    const { document, opened, get, loadFields } = page(WITH_KEY);
    await loadFields();
    // the names Contact Builder's own route writes are learned from its rows
    get(`${ROWS}?preciseDateTime=true&$page=1&$pagesize=25`, {
        count: 1,
        items: [{ rowId: '1', region: 'EU', created: '', zeta: '' }],
    });
    document.querySelector('li[data-value="Created"] > a').click();
    // Contact Builder does not know the entry and still names its own field
    const request = get(
        `${ROWS}?searchColumn=RowId&key=2026-01&preciseDateTime=true&$page=2&$pagesize=25`,
        {
            count: 30,
            page: 2,
            pageSize: 25,
            items: [
                { keys: { rowid: '9', region: 'EU' }, values: { created: '1/15/2026 8:30:00 AM' } },
            ],
        },
    );
    const address = new URL(opened.at(-1), ORIGIN);
    assert.equal(address.pathname, `/contactsmeta/fuelapi/data/v1/customobjectdata/${ID}/rowset`);
    assert.equal(
        address.searchParams.get('$filter'),
        "[Created] gte '2026-01-01' and [Created] lt '2026-02-01'",
    );
    assert.equal(address.searchParams.get('$page'), '2');
    assert.equal(address.searchParams.get('$pagesize'), '25');
    const expected = {
        count: 30,
        page: 2,
        pageSize: 25,
        items: [{ rowId: '9', region: 'EU', created: '2026-01-15 08:30:00.000' }],
    };
    assert.deepEqual(JSON.parse(request.responseText), expected);
    assert.deepEqual(JSON.parse(request.response), expected);
});

test('a search that names a field without a primary key is sent to the public route as well', async () => {
    const { opened, get, loadFields } = page(WITHOUT_KEY);
    await loadFields(FIELDS.map((field) => ({ ...field, isPrimaryKey: false })));
    const request = get(`${ROWS}?searchColumn=alpha_lower&key=O'B&$page=1&$pagesize=25`, {
        count: 0,
        page: 1,
        pageSize: 25,
    });
    assert.equal(
        new URL(opened.at(-1), ORIGIN).searchParams.get('$filter'),
        "[alpha_lower] like 'O_B%'",
    );
    assert.deepEqual(JSON.parse(request.responseText), {
        count: 0,
        page: 1,
        pageSize: 25,
        items: [],
    });
});

test('a text that no boolean can match sends no filter and shows no rows', async () => {
    const { document, opened, get, loadFields } = page(WITH_KEY);
    await loadFields();
    document.querySelector('li[data-value="IsActive"] > a').click();
    const request = get(`${ROWS}?searchColumn=RowId&key=maybe&$page=1&$pagesize=25`, {
        count: 6,
        page: 1,
        pageSize: 1,
        items: [{ keys: { rowid: '1' }, values: {} }],
    });
    assert.equal(new URL(opened.at(-1), ORIGIN).searchParams.has('$filter'), false);
    assert.deepEqual(JSON.parse(request.responseText), {
        count: 0,
        page: 1,
        pageSize: 25,
        items: [],
    });
});

test('an answer the server refused, and one that cannot be read, reach Contact Builder as they are', async () => {
    const { document, get, loadFields } = page(WITH_KEY);
    await loadFields();
    document.querySelector('li[data-value="zeta"] > a').click();
    const url = `${ROWS}?searchColumn=RowId&key=a&$page=1&$pagesize=25`;
    const refused = '{"message":"$filter could not be resolved"}';
    assert.equal(get(url, refused, 400).responseText, refused);
    assert.equal(get(url, '<html>', 200).responseText, '<html>');
});

test('requests are left alone while the fields are unknown, for other data extensions and for other servers', async () => {
    const { opened, get, loadFields } = page(WITH_KEY);
    const url = `${ROWS}?searchColumn=zeta&key=a&$page=1&$pagesize=25`;
    get(url);
    assert.equal(opened.at(-1), url);
    await loadFields();
    const other = url.replace(ID, 'ffffffff-1111-2222-3333-444455556666');
    get(other);
    assert.equal(opened.at(-1), other);
    const elsewhere = `https://example.com${url}`;
    get(elsewhere);
    assert.equal(opened.at(-1), elsewhere);
    get(url);
    assert.match(opened.at(-1), /\/rowset\?/);
});

test('nothing is added outside the Records tab of a data extension', async () => {
    const { document, loadFields } = page(WITH_KEY, `#admin/data-extension/${ID}/properties`);
    await loadFields();
    assert.equal(document.querySelectorAll('.dropdown-search > li').length, 2);
    assert.equal(document.querySelector(`.${MARK}-icon`), null);
});

test('the manifest runs the search in Contact Builder, in the page’s own world, from the start, with its stylesheet', () => {
    const manifest = JSON.parse(read('../src/manifest.json'));
    const entry = manifest.content_scripts.find((item) => item.js.includes('record-search.js'));
    assert.deepEqual(entry.js, ['record-search-rule.js', 'record-search.js']);
    assert.deepEqual(entry.css, ['record-search.css']);
    assert.deepEqual(entry.matches, ['https://*.marketingcloudapps.com/contactsmeta/*']);
    assert.equal(entry.world, 'MAIN');
    assert.equal(entry.run_at, 'document_start');
    assert.equal(entry.all_frames, true);
    // the icon is loaded by the page
    const css = read('../src/record-search.css');
    assert.match(css, /chrome-extension:\/\/__MSG_@@extension_id__\/icons\/icon16\.png/);
    assert.ok(
        manifest.web_accessible_resources.some(
            (item) =>
                item.resources.includes('icons/icon16.png') &&
                item.matches.includes('https://*.marketingcloudapps.com/*'),
        ),
    );
});
