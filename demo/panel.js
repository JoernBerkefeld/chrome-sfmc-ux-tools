/*
 * SFMC UX Tools — demo page of the panel "Transactional Messages": answers the requests the
 * panel makes to Marketing Cloud's API with made-up messages, apps and contents, so that the
 * built script runs on a plain page. No request leaves the page; everything below is invented
 * for the pictures of the README and only follows the shape of the API's answers.
 */
(() => {
    'use strict';

    const API = '/cloud/fuelapi/';
    const CODE = '00000';
    const APP = 'demo-app-0001';
    const TEST_APP = 'demo-app-0002';
    const FOLDER = 1001;
    // the panel says when it read a list; the demo's clock starts at the same time on every run
    const NOW = Date.parse('2026-11-20T10:30:00Z');

    const RealDate = Date;
    const shift = NOW - RealDate.now();
    /**
     * A clock that runs from NOW on; dates that are given are taken as they are.
     */
    class DemoDate extends RealDate {
        /**
         * @returns {number} the current time of the demo
         */
        static now() {
            return super.now() + shift;
        }

        /**
         * @param {...unknown} parts what a date is made of; nothing for the current time
         */
        constructor(...parts) {
            super(...(parts.length > 0 ? parts : [RealDate.now() + shift]));
        }
    }
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the panel's script reads the clock of the page
    globalThis.Date = DemoDate;

    /**
     * Builds a message as the API has it, in a list and in its details.
     *
     * @param {string} name name of the message
     * @param {string} status Active, Inactive or Draft
     * @param {string} day day of the creation, in November 2026
     * @param {object} more what the details hold besides
     * @returns {object} the message
     */
    const message = (name, status, day, more) => ({
        name,
        definitionKey: name.toLowerCase(),
        status,
        createdDate: `2026-11-${day}T09:15:00`,
        modifiedDate: `2026-11-${day}T16:40:00`,
        ...more,
    });
    const sms = (keyword, text) => ({
        content: { message: text },
        subscriptions: { shortCode: CODE, countryCode: 'US', keyword },
    });
    const push = (app, content, keys = []) => ({
        applicationId: app,
        content: { customerKey: content },
        options: { sound: 'default', customKeys: keys },
    });
    const MESSAGES = {
        sms: [
            message(
                'Welcome_SMS',
                'Active',
                '02',
                sms('WELCOME', 'Hi %%FirstName%%, welcome to the demo club!'),
            ),
            message(
                'Order_Confirmation_Demo',
                'Active',
                '03',
                sms('ORDER', 'Your demo order is confirmed. Reply STOP to opt out.'),
            ),
            message(
                'Delivery_Update_Demo',
                'Active',
                '05',
                sms('ORDER', 'Your demo parcel is on its way.'),
            ),
            message(
                'Appointment_Reminder',
                'Inactive',
                '09',
                sms('WELCOME', 'See you tomorrow at 10:00.'),
            ),
            message('Spring_Sale_Draft', 'Draft', '12', sms('DEMO', 'Spring sale starts soon.')),
            message('Password_Reset_Demo', 'Active', '16', sms('DEMO', 'Your demo code is 0000.')),
        ],
        push: [
            message(
                'Welcome_Push',
                'Active',
                '04',
                push(APP, 'welcome_push', [
                    { key: 'promo_code', value: 'DEMO10' },
                    { key: 'deep_link', value: 'https://example.com/welcome' },
                ]),
            ),
            message('Order_Shipped_Push', 'Active', '07', push(APP, 'order_shipped_push')),
            message('Test_Push_Draft', 'Draft', '11', push(TEST_APP, 'welcome_push')),
        ],
        ott: [],
    };
    // the apps of MobilePush; the test app has no credentials to push with
    const APPS = [
        { id: APP, name: 'Demo App', keys: ['promo_code', 'deep_link'] },
        { id: TEST_APP, name: 'Demo App (test)', keys: [] },
    ];
    const CREDENTIALS = [
        { id: APP, name: 'Demo App', fcmFileName: 'demo-app.json' },
        { id: TEST_APP, name: 'Demo App (test)' },
    ];
    const CONTENTS = [
        {
            id: 1,
            name: 'Welcome_Push',
            customerKey: 'welcome_push',
            availableViews: ['push'],
            modifiedDate: '2026-11-04T10:20:00',
            modifiedBy: { name: 'Jane Doe' },
            category: { id: FOLDER },
            views: {
                push: {
                    meta: {
                        options: {
                            customBlockData: {
                                'display:title': 'Welcome to Demo App',
                                'display:subtitle': 'Nice to meet you',
                                'display:message': 'Hi %%FirstName%%, here is 10% off: DEMO10',
                            },
                        },
                    },
                },
            },
        },
        {
            id: 2,
            name: 'Order_Shipped_Push',
            customerKey: 'order_shipped_push',
            availableViews: ['push'],
            modifiedDate: '2026-11-07T14:05:00',
            modifiedBy: { name: 'John Doe' },
            category: { id: FOLDER + 1 },
        },
        {
            id: 3,
            name: 'Spring_Sale_Push',
            customerKey: 'spring_sale_push',
            availableViews: ['push'],
            modifiedDate: '2026-11-12T08:45:00',
            modifiedBy: { name: 'Jane Doe' },
            category: { id: FOLDER },
        },
    ];
    const FOLDERS = [
        { id: FOLDER, name: 'Demo Push Messages' },
        { id: FOLDER + 1, name: 'Demo Order Updates' },
    ];
    // the lists of the forms, by the start of their address
    const LISTS = [
        [
            'legacy/v1/beta/mobile/code/',
            {
                entry: [
                    {
                        id: 'demo-code',
                        code: CODE,
                        countryCode: 'US',
                        isShortCode: true,
                        codeType: 'SHARED',
                    },
                ],
            },
        ],
        [
            'legacy/v1/beta/mobile/keyword/',
            {
                entry: ['DEMO', 'ORDER', 'WELCOME'].map((keyword) => ({
                    keyword,
                    code: { code: CODE },
                })),
            },
        ],
        // link shortening is switched off for the made-up account
        [
            'legacy/v1/beta/mobile/account/@default',
            { optedInForSmslinktracking: false, mobileBlackoutWindow: { isEnabled: false } },
        ],
        [
            'contacts/v1/attributeSetDefinitions',
            {
                items: [
                    {
                        key: 'MobileDemographics',
                        attributes: ['_FirstName', '_City', '_FavouriteColour'].map(
                            (storageName) => ({ storageName, isSystemDefined: false }),
                        ),
                    },
                ],
            },
        ],
        ['push/v1/application', APPS],
        ['push-internal/v1/application', { count: CREDENTIALS.length, items: CREDENTIALS }],
        ['asset/v1/content/categories', { count: FOLDERS.length, items: FOLDERS }],
    ];

    /**
     * Answers a request to the API.
     *
     * @param {string} path address below the API, with its query
     * @param {string} method GET, POST or DELETE
     * @returns {{status: number, body: unknown}} the answer
     */
    function answer(path, method) {
        const [address, query = ''] = path.split('?', 2);
        const parameters = new URLSearchParams(query);
        // the list pages are 1 and up; there is only ever one
        if (parameters.has('$page') && parameters.get('$page') !== '1') {
            return { status: 200, body: { count: 0, items: [], definitions: [] } };
        }
        if (method !== 'GET') {
            return { status: 200, body: {} };
        }
        const found = /^messaging\/v1\/(\w+)\/definitions(?:\/(.+))?$/.exec(address);
        if (found) {
            const [, kind, key] = found;
            const list = MESSAGES[kind] ?? [];
            if (!key) {
                return { status: 200, body: { count: list.length, definitions: list } };
            }
            const definition = list.find((item) => item.definitionKey === decodeURIComponent(key));
            return definition
                ? { status: 200, body: { requestId: 'demo', ...definition } }
                : { status: 404, body: { message: 'Not found' } };
        }
        if (address === 'asset/v1/content/assets') {
            // one content by its key, with what it says, or the list of them
            const key = /customerKey eq '(.+)'/.exec(parameters.get('$filter') ?? '')?.[1];
            const items = key ? CONTENTS.filter((item) => item.customerKey === key) : CONTENTS;
            return { status: 200, body: { count: items.length, items } };
        }
        const list = LISTS.find(([start]) => address.startsWith(start));
        return list
            ? { status: 200, body: list[1] }
            : { status: 404, body: { message: 'Not part of the demo' } };
    }

    // the page's own requests go on as they are; those to the API never leave the page
    const passOn = fetch;
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- the panel's script asks the page's fetch
    globalThis.fetch = async (url, options = {}) => {
        const address = String(url);
        if (!address.startsWith(API)) {
            return passOn(url, options);
        }
        const { status, body } = answer(address.slice(API.length), options.method ?? 'GET');
        return Response.json(body, {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    };
})();
