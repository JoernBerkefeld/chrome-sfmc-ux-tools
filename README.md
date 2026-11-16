# SFMC UX Tools

A Chrome extension with small usability helpers for Salesforce Marketing Cloud Engagement.

> Not affiliated with, endorsed by or supported by Salesforce.

## Features

### AMPscript and SSJS colours in the code editor

Marketing Cloud's code editor colours HTML but shows AMPscript as plain text. With the extension, the code inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and `<script runat="server" language="ampscript">` tags is coloured as well: keywords, functions, variables, strings, numbers and comments.

- Personalisation strings such as `%%emailaddr%%` are coloured too.
- In server-side JavaScript (`<script runat="server">`), Marketing Cloud's own objects and functions get colours of their own, for example `Platform`, `DataExtension`, `Variable`, `Write()` and the functions behind `Platform.Function.`. The JavaScript itself keeps the colours the editor already gives it.
- Works in the code view of Content Builder. Other Marketing Cloud apps with the same editor will follow once each has been checked.
- The content itself is never changed; only the colours are.
- A script tag is only recognised if its opening tag fits on one line.

### Documentation on hover

Rest the mouse on an AMPscript function, keyword or variable, or on one of Marketing Cloud's SSJS functions, and a box shows what it does: its parameters with their types, what it returns, an example and links to the full documentation. The text is the one the SFMC Language Service extension for VS Code shows, and the code in it has the colours of the editor. You can move the mouse onto the box to scroll it or to follow a link. Nothing is shown inside browser scripts.

### Errors and warnings

The extension checks your AMPscript and SSJS while you type and underlines what will not work: red for errors, yellow for warnings. Rest the mouse on an underline to read why, with a link to the rule behind it.

- AMPscript: unknown functions, a wrong number of arguments, blocks and `IF` statements that are never closed, and more.
- SSJS: syntax that Marketing Cloud's engine rejects (`let`, arrow functions, template literals, …), JavaScript methods the engine does not have, Core library calls without `Platform.Load`, and more.
- **Quick fixes**: where the language service knows a remedy, the box offers it as a button, for example adding the polyfill for a JavaScript method that SSJS lacks. **Ctrl+.** (**Cmd+.** on a Mac) opens the fixes for the problem at the cursor; Enter applies the first one, Esc closes the box. A fix is one step for **Ctrl+Z**.
- The checks are those of the language service; browser scripts are not checked. There is no list of all problems yet.

### Go to definition

Hold **Ctrl** (**Cmd** on a Mac) and click the name of a function that the server-side JavaScript of the content declares; the cursor jumps to the declaration. It covers functions declared with `function name(...)` in the same content, not variables and not AMPscript.

### Parameter help

While the cursor is inside the brackets of an AMPscript function or of one of Marketing Cloud's SSJS functions, a box above the line lists the function's parameters, marks the one you are typing and says what it is for. It follows the cursor, also in calls that are already written, and **Esc** closes it.

### Formatting

Click the **{ }** button in the toolbar of the code view, or press **Shift+Alt+F**, to format the whole content: AMPscript, SSJS, HTML, CSS and browser JavaScript, with the rules of the [prettier-plugin-sfmc](https://github.com/JoernBerkefeld/prettier-plugin-sfmc) plugin and the settings the SFMC Language Service extension for VS Code uses (4 spaces, 100 characters per line, single quotes). **Ctrl+Z** undoes it in one step.

- Formatting only changes the text in the editor. Nothing is saved until you save.
- AMPscript with a syntax error is left exactly as written; the rest is formatted.
- **Format on save** can be switched on in the extension's options. The code is then formatted first whenever you save with Marketing Cloud's **Save** or **Save and Exit** button or with the shortcut below.

### Save with Ctrl+S

**Ctrl+S** (**Cmd+S** on a Mac) in the code view saves the content, exactly like a click on Marketing Cloud's **Save** button. Without the extension the key opens the browser's "save page" dialog.

- There are no settings yet, and it always formats the whole content, not a selection.

### Completions

While you type AMPscript or server-side JavaScript (SSJS) in the code view of Content Builder, the extension suggests what fits. Press **Ctrl+Space** to ask for suggestions at any time.

- **AMPscript**: functions, keywords, personalisation strings and the variables of the current content.
- **SSJS**, inside `<script runat="server">`: Marketing Cloud's functions and objects (`Platform.Function.Lookup`, `Write`, `DataExtension`, `HTTP.Get`, …), the JavaScript built-ins that work in SSJS, and the functions declared in the content. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`).
- **JavaScript for the browser**, inside any other `<script>`: the names used in the content's browser scripts, JavaScript's keywords and the usual globals (`document`, `console`, …). Marketing Cloud's server-side names are never suggested there. SSJS gets the names of its own scripts and its keywords in the same way.

- Next to the popup, a box shows the documentation of the suggestion that is currently chosen: parameters, return value and an example.
- AMPscript suggestions appear inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and AMPscript script tags, never in plain HTML. While you type, they stay away inside strings and comments.
- Picking a function inserts its name and the opening bracket; picking anything else inserts the plain word. Nothing is inserted unless you pick it.
- Not covered yet, in SSJS and in browser scripts: the members of a value, such as the methods of a `DataExtension.Init(...)` result or of `document`.
- The suggestions come from the [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp) language service (version 4.4.1), the same one behind the SFMC Language Service extension for VS Code. It is built into the extension and runs inside the page.
- The popup needs the editor's hint feature. Where an editor does not have it, completions stay off and everything else works as before.

### Options

Click the extension's icon in Chrome's toolbar to open the options: editor theme, right-click menu and format on save. The same options are on the extension's page in `chrome://extensions`. Changes apply at once.

### Editor themes

The code editor of Content Builder is shown in the colours of Visual Studio Code's **Light Modern** theme. To switch to **Dark Modern**, open the extension's options (`chrome://extensions` → SFMC UX Tools → Details → Extension options); the change applies at once. The theme covers the whole editor, not only AMPscript and SSJS, and replaces the themes that Marketing Cloud's own menu offers.

### Browser context menu in the code editor

A right-click in the code editor opens the browser's own context menu instead of the menu Marketing Cloud draws over the code. To get Marketing Cloud's menu back, open the extension's options (`chrome://extensions` → SFMC UX Tools → Details → Extension options) and choose it there; the change applies at once.

### Select all scopes of an installed package

When you add or edit an API integration under **Setup → Platform Tools → Apps → Installed Packages**, the dialog lists around a hundred scope checkboxes. The extension adds a **Select all** button to the **Scope** bar of that dialog:

- **Select all** ticks every scope, including the ones that are scrolled out of view.
- Once everything is ticked, the button turns into **Deselect all** and clears every scope again.

Nothing is saved until you press the dialog's own **Save** button. The button works in every language of the Marketing Cloud user interface, in the dialog for adding a component and in the one for editing it.

## Where it comes from, and what goes with it

The editor features are not written for this extension alone. They are the same building blocks as in the tools for working on Marketing Cloud code outside the browser, so both sides behave alike:

| Tool                                                                                                                                                                                     | What it is                                                                                            | How this extension relates to it                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SFMC Language Service for VS Code](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language) ([source](https://github.com/JoernBerkefeld/vscode-sfmc-language)) | AMPscript and SSJS support in VS Code: completions, hovers, diagnostics, formatting                   | The model for this extension. Both use the [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp) language service, so completions, hovers, parameter help and diagnostics show the same texts and rules. The editor themes are VS Code's Light Modern and Dark Modern. |
| [prettier-plugin-sfmc](https://www.npmjs.com/package/prettier-plugin-sfmc) ([source](https://github.com/JoernBerkefeld/prettier-plugin-sfmc))                                            | Prettier plugin for AMPscript, SSJS, Marketing Cloud HTML and SQL                                     | Built into this extension; it does the formatting behind the **{ }** button, with the same settings as the VS Code extension. Use it directly to format files in a project or in CI.                                                                                                      |
| [sfmc.guide](https://sfmc.guide)                                                                                                                                                         | Reference for Marketing Cloud Engagement and Marketing Cloud Next, including every AMPscript function | The hover boxes for AMPscript link to its function pages.                                                                                                                                                                                                                                 |
| [ssjs.guide](https://ssjs.guide)                                                                                                                                                         | Reference for server-side JavaScript in Marketing Cloud, verified against the live platform           | The source of the SSJS descriptions and of the notes on what really works; the hover boxes for SSJS link to its pages.                                                                                                                                                                    |

If you write Marketing Cloud code in files, for example with [mcdev](https://github.com/Accenture/sfmc-devtools), the VS Code extension and the Prettier plugin give you there what this extension gives you in the browser.

## Installation

### Chrome Web Store

Not listed yet.

### From source (unpacked)

1. Clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Run `npm install --no-workspaces` and `npm run build`.
4. Choose **Load unpacked** and pick the `dist/extension` folder.

This works the same way in other Chromium browsers such as Edge.

## Privacy

The extension runs on two places of Marketing Cloud Engagement:

- the Installed Packages page (`https://*.exacttarget.com/Content/Administration/InstalledPackages.aspx`), where it reads the open dialog to find the scope checkboxes and clicks them on your request;
- Content Builder (`https://content-builder.<stack>.marketingcloudapps.com`), where it adds colours, completions, hovers, parameter help, error underlines and formatting to the code editor. The editor reads your code through the colouring rules, and the built-in language service and formatter read it to do the rest; all of this happens inside the page only. Chrome's site-access prompt names `marketingcloudapps.com` as a whole because the stack number in the address differs per account; the extension itself is restricted to the Content Builder address.

It does not collect or transmit any data and makes no network requests. The only thing it stores is your choice on the options page, in Chrome's extension storage (synced with your Chrome profile if sync is on).

## Development

```bash
npm install --no-workspaces
npm run lint
npm test
npm run build
```

- `src/` holds the extension's sources. `npm run build` writes the loadable extension to `dist/extension` and packs that folder as `dist/chrome-sfmc-ux-tools-v<version>.zip` for the Chrome Web Store. For **Load unpacked**, always pick `dist/extension`, not `src`.
- The build bundles `src/editor-format.js` with Prettier and `prettier-plugin-sfmc`, and `src/editor-language.js`, the files in `src/editor-language` and the `sfmc-language-lsp` package (currently 4.4.1) into one classic script with esbuild, and fails if that bundle calls `eval` or `new Function`, which Chrome does not allow. All other files are copied as they are.
- `npm test` runs the build first, because the completion tests run the built bundle.
- `npm run icons` redraws the icons in `src/icons/`.
- `npm run generate` rewrites `src/language-data.js` from the `ampscript-data` and `ssjs-data` packages; run it after updating either dependency. A test fails if the file is out of date.
- In `package.json`, `dependencies` are the packages whose code or data ends up in the shipped extension; `devDependencies` are tools for building, linting and testing. The package is never installed from npm, so the split is for clarity only.
- `codemirror` is fixed to the exact version Content Builder ships (5.65.21), so that the tests run against the editor the extension meets in the page. Change it only when Marketing Cloud updates its editor.
- Keep `version` in `package.json` and `src/manifest.json` identical; a test checks this.
- `npm run verify:bundled-latest` compares the SFMC packages in `package-lock.json` (`sfmc-language-lsp`, `prettier-plugin-sfmc`, the data packages and what they bring along) with the newest versions on npm and fails if one is behind. The release workflow runs it before building, because the build inlines these packages. Update them with `npm install <package>@latest --no-workspaces`.

### Releasing

Publishing a GitHub Release runs `.github/workflows/chrome-webstore-publish.yml`:

- The release tag must equal the version in `src/manifest.json` (a leading `v` is allowed), otherwise the run fails.
- The run lints, tests and builds, and attaches the zip to the release.
- For a regular release it then uploads the zip to the Chrome Web Store and submits it for publication. Google reviews every version; it goes live when the review passes. Prereleases are not uploaded.
- The upload is skipped while any of the repository secrets below is missing.

One-time setup at Google, before the first automatic upload:

1. Register a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) (one-time fee) and switch on 2-step verification for the Google account; the store requires it for publishing.
2. Upload the first version by hand in the developer dashboard and fill in the store listing and the privacy tab. The API cannot create an item or fill in the listing. Publish it once with the visibility it should keep, because later uploads reuse that visibility.
3. Note the **publisher ID** (dashboard, Account) and the **extension ID** (the item's page).
4. In a Google Cloud project, enable the **Chrome Web Store API** and create OAuth credentials. The [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) guide walks through this and yields the client ID, the client secret and a refresh token.
5. Set the OAuth consent screen to **In production**. While it is in "Testing", Google lets refresh tokens expire after 7 days, and the uploads would start failing.
6. Store the values as repository secrets: `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`.

## License

[MIT](LICENSE) © Jörn Berkefeld
