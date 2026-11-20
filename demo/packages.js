/*
 * SFMC UX Tools — demo page of an installed package: the scopes of its dialog as rows of
 * checkboxes, named the way the built script for Setup > Installed Packages recognises them.
 * The groups and rows are made up for the pictures of the README; two scopes start ticked.
 */
(() => {
    'use strict';

    // groups of scopes: each row has a name and what may be done with it
    const GROUPS = {
        Channels: [
            ['Email', ['read', 'write', 'send']],
            ['OTT', ['read', 'send']],
            ['Push', ['read', 'write', 'send']],
            ['SMS', ['read', 'write', 'send']],
            ['Web', ['read', 'write', 'publish']],
        ],
        Assets: [
            ['Documents and Images', ['read', 'write']],
            ['Saved Content', ['read', 'write']],
        ],
        Automation: [
            ['Automations', ['read', 'write', 'execute']],
            ['Journeys', ['read', 'write', 'execute', 'delete']],
        ],
        Contacts: [
            ['Audiences', ['read', 'write']],
            ['List and Subscribers', ['read', 'write']],
        ],
        Data: [
            ['Data Extensions', ['read', 'write']],
            ['File Locations', ['read']],
            ['Tracking Events', ['read', 'write']],
        ],
        Administration: [
            ['Accounts', ['read', 'write']],
            ['Users', ['read', 'write']],
            ['Webhooks', ['read', 'write']],
        ],
    };
    const TICKED = new Set(['email_read', 'email_send']);
    const scopes = document.querySelector('#scopes');

    for (const [group, rows] of Object.entries(GROUPS)) {
        const section = document.createElement('section');
        section.className = 'demo-scope-group';
        const heading = document.createElement('h2');
        heading.textContent = group;
        section.append(heading);
        for (const [label, rights] of rows) {
            const row = document.createElement('div');
            row.className = 'demo-scope-row';
            const title = document.createElement('span');
            title.textContent = label;
            row.append(title);
            for (const right of rights) {
                const name = `${label.toLowerCase().replaceAll(' ', '_')}_${right}`;
                const box = document.createElement('label');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.name = name;
                checkbox.checked = TICKED.has(name);
                box.append(checkbox, ` ${right[0].toUpperCase()}${right.slice(1)}`);
                row.append(box);
            }
            section.append(row);
        }
        scopes.append(section);
    }
})();
