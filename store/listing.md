# Chrome Web Store listing

The texts and answers for the extension's page in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Copy the content of each box into the field of the same name. Keep this file up to date when a feature, a permission or the privacy section of the README changes.

## Store listing tab

### Name

Comes from `src/manifest.json`; it cannot be typed in the dashboard.

```text
SFMC UX Tools
```

### Summary (at most 132 characters)

Comes from `description` in `src/manifest.json`; it cannot be typed in the dashboard.

```text
Usability helpers for Salesforce Marketing Cloud Engagement and Next: code editor help, readable keys, transactional messages.
```

### Description

```text
SFMC UX Tools makes Salesforce Marketing Cloud easier to work in. Install it and it works; there is nothing to set up.

Not affiliated with, endorsed by or supported by Salesforce.

CODE EDITORS YOU CAN READ
• AMPscript and server-side JavaScript (SSJS) in colour, in Content Builder, CloudPages and the script activity of Automation Studio.
• A light or a dark editor theme, or the one of your system.

HELP WHILE YOU TYPE
• Suggestions for AMPscript functions, SSJS functions and objects, and your own variables.
• Explanations with parameters, an example and links when you point at code.
• Parameter help while you type a function call.
• Mistakes underlined before you save, with one-click fixes for many of them.
• Ctrl+click jumps to where a function or variable is defined.

TIDY CODE WITH ONE CLICK
• The { } button or Shift+Alt+F formats AMPscript, SSJS, HTML, CSS and JavaScript.
• Ctrl+S saves in the code editor, and formatting on save can be switched on.
• The SQL query activity gets the theme and formatting too.

MARKETING CLOUD NEXT
• In the content editor, every AMPscript function of Marketing Cloud Next is explained and suggested, including the ones the editor itself leaves out.
• AMPscript that Marketing Cloud Next does not support is underlined.
• Shift+Alt+F formats the code.

READABLE KEYS INSTEAD OF RANDOM ONES
• New automations, activities, data extensions, data filters, triggered sends, content blocks, emails, journeys, API events, sender profiles, send classifications, delivery profiles, file locations, roles and users get a key made from their name, such as Welcome_series.
• A key you type yourself is kept, and existing items are never changed.

A REAL NAME FOR EVERY JOURNEY
• Journey Builder asks you for a real name before a journey called "New Journey" with a date is saved.
• The key of a journey is shown and can be copied with one click.

TRANSACTIONAL SMS, PUSH AND OTT MESSAGES
• A new entry in the Mobile Studio menu lists your transactional messages, which Marketing Cloud otherwise only shows through its API.
• Search, sort and filter them by status, and open their details.
• Create, change and delete them in a form that offers your codes, keywords, apps and contents.
• The text of an SMS is written in a code editor with AMPscript colours and help, and its length is counted.

SMALL FIXES FOR EVERYDAY ANNOYANCES
• Select all scopes of an installed package with one click.
• A name or key pasted with the mouse is used where Marketing Cloud would ignore it.
• The browser's own right-click menu in the code editor.

PRIVATE
• Nothing is collected and nothing is sent anywhere but to Marketing Cloud itself.
• The only stored data is your choice on the options page.
• Open source under the MIT license: https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools

Built by Jörn Berkefeld, the developer behind SFMC DevTools (mcdev), with the same language service as the SFMC Language Service extension for VS Code.
```

### Category

```text
Developer Tools
```

### Language

```text
English
```

### Graphic assets

| Asset              | Size                                          | Needed            | Source                                                                              |
| ------------------ | --------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| Store icon         | 128 × 128 PNG                                 | yes               | `src/icons/icon128.png`                                                             |
| Screenshots        | 1280 × 800 (or 640 × 400) PNG or JPEG, 1 to 5 | at least 1        | to be taken from the demo pages with `scripts/screenshots.js`, made-up content only |
| Small promo tile   | 440 × 280 PNG or JPEG                         | see the dashboard | not made yet                                                                        |
| Marquee promo tile | 1400 × 560 PNG or JPEG                        | no                | not made yet                                                                        |
| Promo video        | YouTube link                                  | no                | none                                                                                |

Suggested screenshots, in this order: completions in the code editor, the hover explanation, the panel Transactional Messages, readable keys, the dark theme.

### Additional fields

| Field          | Value                                                           |
| -------------- | --------------------------------------------------------------- |
| Official URL   | none                                                            |
| Homepage URL   | `https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools`        |
| Support URL    | `https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools/issues` |
| Mature content | No                                                              |

## Privacy tab

### Single purpose

```text
SFMC UX Tools improves the user interface of Salesforce Marketing Cloud for the people who work in it: language help and formatting in its code editors, keys made from names, a list of transactional messages, and small fixes to its screens. It only runs on Marketing Cloud's own pages.
```

### Permission justification: storage

```text
Stores the user's choices from the extension's options page (editor theme, format on save, readable keys, journey names, context menu) in chrome.storage.sync. In chrome.storage.local it keeps a short list (at most 200 entries of kind, key and two dates) of transactional messages that Marketing Cloud lists but cannot open, so that the panel leaves them out without requesting them again. Nothing else is stored, and nothing leaves the browser.
```

### Permission justification: scripting

```text
The language service for server-side JavaScript includes TypeScript and is about 4 MB, too large to run as a content script in every frame. When a Content Builder or Automation Studio page shows a code editor, the service worker loads this one file of the extension, editor-typescript.js, into that document with chrome.scripting.executeScript. It is never used for anything else and never loads code from outside the extension package.
```

### Host permission justification

```text
The extension only works on Salesforce Marketing Cloud's own pages:
- https://*.marketingcloudapps.com/* : Content Builder, Automation Studio, Contact Builder and Journey Builder. The stack number in these addresses differs per account, so the host cannot be narrowed further. The content scripts are limited to those apps by their match patterns and include globs. This host permission is also what lets the scripting permission load the language service into Content Builder and Automation Studio.
- https://*.exacttarget.com/... : the Marketing Cloud page around the apps (Mobile Studio menu, transactional messages panel), Email Studio, Setup pages and Installed Packages, each limited to the exact pages listed in the manifest.
- https://*.lightning.force.com/cmsAuthor/contentEditor.app : the content editor of Marketing Cloud Next. The first part of the address differs per account.
The extension only reads and changes these pages to add its editor help and fixes, and only sends requests to Marketing Cloud's own servers, through the page the user is logged in to.
```

### Remote code

Answer **No, I am not using remote code**.

```text
All JavaScript is part of the extension package. The bundles are built with esbuild before packaging; nothing is fetched or evaluated at run time.
```

### Data usage

Proposed answer: tick **no** data type. The extension reads page content and the code in the editor inside the page only, and the only requests it makes are the ones the user starts on Marketing Cloud (a check whether a key is free, the lists and changes of transactional messages), sent to Marketing Cloud's own servers through the page. Nothing reaches the developer or any third party.

If you would rather declare it: tick **Website content**, and the dashboard will then ask for a privacy policy URL (see below).

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

Works once the repository is public:

```text
https://github.com/JoernBerkefeld/chrome-sfmc-ux-tools#privacy
```

## Distribution tab

| Field      | Value                                       |
| ---------- | ------------------------------------------- |
| Payments   | Free of charge                              |
| Visibility | Public (later uploads keep this visibility) |
| Regions    | All regions                                 |
