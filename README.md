# SFMC UX Tools

A Chrome extension with small usability helpers for Salesforce Marketing Cloud Engagement.

> Not affiliated with, endorsed by or supported by Salesforce.

## Features

### AMPscript and SSJS colours in the code editor

Marketing Cloud's code editor colours HTML but shows AMPscript as plain text. With the extension, the code inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and `<script runat="server" language="ampscript">` tags is coloured as well: keywords, functions, variables, strings, numbers and comments.

- Personalisation strings such as `%%emailaddr%%` are coloured too.
- In server-side JavaScript (`<script runat="server">`), Marketing Cloud's own objects and functions get colours of their own, for example `Platform`, `DataExtension`, `Variable`, `Write()` and the functions behind `Platform.Function.`. The JavaScript itself keeps the colours the editor already gives it.
- Works in the code view of Content Builder, and wherever Marketing Cloud shows that same editor: Email Studio and CloudPages open Content Builder's code view, so everything described here applies there too.
- **Code resources** of CloudPages are files of their own kind in that same editor, which Marketing Cloud shows without colours. The extension colours a JavaScript, CSS, JSON, XML or RSS resource as what it is; AMPscript and `<script runat="server">` inside it keep their colours and features. A JavaScript resource gets the [completions](#completions) of a browser script. **{ }** and **Shift+Alt+F** [format](#formatting) JavaScript, CSS and JSON resources with the formatter for that language, and a resource that consists of server-side scripts only like other content. A resource that mixes its own code with AMPscript or a server-side script is not formatted, and XML, RSS and text resources have no format button, because no bundled formatter reads them. The Save and Publish buttons of a code resource are outside the editor, so format on save does not apply there.
- The code editor of Automation Studio's **script activity** is covered as well, with the same colours and both themes, also on the wizard's summary step. That editor also has [completions](#completions), hovers, parameter help, error and warning underlines with notes next to the line numbers, quick fixes (**Ctrl+.** / **Cmd+.**) and go to definition (**Ctrl+click** / **Cmd+click**), as described below for Content Builder; the read-only editor on the summary step explains and underlines but offers no fixes. A **{ }** button next to **Validate Syntax**, and **Shift+Alt+F**, [format](#formatting) the script; with format on save switched on, a click on **Next** formats it first. Saving with **Ctrl+S** is for Content Builder only, as that dialog saves at the end of its wizard. Its own check of the script, which marked the `<script runat="server">` tag as a JavaScript error, is switched off; **Validate Syntax** still asks Marketing Cloud.
- The code editor of Automation Studio's **SQL query activity** follows the editor theme, light or dark, with the SQL colouring Marketing Cloud gives it. A **{ }** button next to **Validate Syntax**, and **Shift+Alt+F**, [format](#formatting) the query as T-SQL; with format on save switched on, a click on **Next** formats it first. SQL has no completions, hovers or checks from the extension.
- The content itself is never changed; only the colours are.
- A script tag is only recognised if its opening tag fits on one line.

### Documentation on hover

Rest the mouse on an AMPscript function, keyword or variable, or on one of Marketing Cloud's SSJS functions, and a box shows what it does: its parameters with their types, what it returns, an example and links to the full documentation. The text is the one the SFMC Language Service extension for VS Code shows, and the code in it has the colours of the editor. You can move the mouse onto the box to scroll it or to follow a link. Nothing is shown inside browser scripts.

In server-side JavaScript the box also knows your own code: rest the mouse on a variable, a function of the content or a method of a value, such as `Rows.Add` of a `DataExtension.Init(...)` result, and it shows the type and, where there is one, the description. This comes from TypeScript, which reads the SSJS with the type declarations of Marketing Cloud's objects.

### Errors and warnings

The extension checks your AMPscript and SSJS while you type and underlines what will not work: red for errors, yellow for warnings. Rest the mouse on an underline to read why, with a link to the rule behind it.

- AMPscript: unknown functions, a wrong number of arguments, blocks and `IF` statements that are never closed, and more.
- SSJS: syntax that Marketing Cloud's engine rejects (`let`, arrow functions, template literals, …), JavaScript methods the engine does not have, Core library calls without `Platform.Load`, and more.
- SSJS, with TypeScript: mistakes in the use of Marketing Cloud's objects and of your own code, such as a method that a value does not have (`de.Rowz`) or an argument of the wrong type.
- **Quick fixes**: where the language service knows a remedy, the box offers it as a button, for example adding the polyfill for a JavaScript method that SSJS lacks. **Ctrl+.** (**Cmd+.** on a Mac) opens the fixes for the problem at the cursor; Enter applies the first one, Esc closes the box. A fix is one step for **Ctrl+Z**.
- The checks are those of the language service; browser scripts are not checked. There is no list of all problems yet.

### Go to definition

Hold **Ctrl** (**Cmd** on a Mac) and click a name that the server-side JavaScript of the content declares; the cursor jumps to the declaration. It covers functions, variables, parameters and the members of your own objects in the same content, not Marketing Cloud's own names and not AMPscript.

### Parameter help

While the cursor is inside the brackets of an AMPscript function or of one of Marketing Cloud's SSJS functions, a box above the line lists the function's parameters, marks the one you are typing and says what it is for. It follows the cursor, also in calls that are already written, and **Esc** closes it. In SSJS this also works for the functions of the content and for the methods of a value, such as `de.Rows.Lookup(`.

### Formatting

Click the **{ }** button in the toolbar of the code view, or press **Shift+Alt+F**, to format the whole content: AMPscript, SSJS, HTML, CSS and browser JavaScript, with the rules of the [prettier-plugin-sfmc](https://github.com/JoernBerkefeld/prettier-plugin-sfmc) plugin and the settings the SFMC Language Service extension for VS Code uses (4 spaces, 100 characters per line, single quotes). **Ctrl+Z** undoes it in one step.

- Formatting only changes the text in the editor. Nothing is saved until you save.
- AMPscript with a syntax error is left exactly as written; the rest is formatted.
- **Format on save** can be switched on in the extension's options. The code is then formatted first whenever you save with Marketing Cloud's **Save** or **Save and Exit** button or with the shortcut below. In Automation Studio's script activity it is formatted when you click **Next**.

### Save with Ctrl+S

**Ctrl+S** (**Cmd+S** on a Mac) in the code view saves the content, exactly like a click on Marketing Cloud's **Save** button. Without the extension the key opens the browser's "save page" dialog.

- There are no settings yet, and it always formats the whole content, not a selection.

### Completions

While you type AMPscript or server-side JavaScript (SSJS) in the code view of Content Builder or in Automation Studio's script activity, the extension suggests what fits. Press **Ctrl+Space** to ask for suggestions at any time.

- **AMPscript**: functions, keywords, personalisation strings and the variables of the current content.
- **SSJS**, inside `<script runat="server">`: Marketing Cloud's functions and objects (`Platform.Function.Lookup`, `Write`, `DataExtension`, `HTTP.Get`, …), the JavaScript built-ins that work in SSJS, and the functions declared in the content. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`).
- **Members of a value in SSJS**: after a dot, the suggestions are the members of what stands in front of it, whatever that is: `Platform.Function.`, a variable that holds a `DataExtension.Init(...)` result, its `Rows`, a string, an array or one of your own objects. The popup lists the members by their short names (`Lookup`, not `Platform.Function.Lookup`); Marketing Cloud's own members keep their description, documentation and brackets.
- **JavaScript for the browser**, inside any other `<script>`: the names used in the content's browser scripts, JavaScript's keywords and the usual globals (`document`, `console`, …). Marketing Cloud's server-side names are never suggested there. SSJS gets the names of its own scripts and its keywords in the same way.

- AMPscript suggestions appear inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and AMPscript script tags, never in plain HTML. While you type, they stay away inside strings and comments.
- Picking a function inserts its name and the opening bracket; picking anything else inserts the plain word. Nothing is inserted unless you pick it.
- Not covered yet, in browser scripts: the members of a value, such as the methods of `document`.
- What the extension knows about your own SSJS (members, types, declarations) comes from [TypeScript](https://www.typescriptlang.org/), with the type declarations of the `ssjs-data` package, as in the VS Code extension. This part is large, so it is only loaded into a page once that page shows a code editor. Until it is there, and if it cannot be loaded, the editor works with Marketing Cloud's own names alone.
- The suggestions come from the [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp) language service (version 4.5.1), the same one behind the SFMC Language Service extension for VS Code. It is built into the extension and runs inside the page.
- In Content Builder the popup needs the editor's hint feature. Where an editor does not have it, completions stay off and everything else works as before.
- **Automation Studio's script activity**: the editor of that dialog has the same completions, while you type and on **Ctrl+Space**, in a popup of the extension's own, as that editor has none. The arrow keys, **Page Up**/**Page Down**, **Home** and **End** move through the list, **Enter**, **Tab** or a click picks an entry, and **Esc**, a click elsewhere or scrolling closes it. A pick is one step for **Ctrl+Z**. The read-only editor on the summary step has no completions.

### Readable keys

When you create something in Marketing Cloud and leave its external key empty, the key becomes a random string of letters and digits. With the extension, the key field of the dialog is filled from the name while you type it, much like Salesforce derives an API name from a label: `Welcome series - step 2` becomes `Welcome_series_-_step_2`.

- Covered: the dialogs that create an **SQL query**, **script**, **filter**, **import**, **data extract** or **file transfer** activity in Automation Studio, and the dialog that creates a **data extension** in Contact Builder. Automation Studio's Contact to Business Unit Mapping dialog uses the fields of the import dialog and is filled the same way.
- Spaces become underscores. Accents are dropped (`ö` becomes `o`). Of the rest, only the letters A to Z, digits, underscores and hyphens stay; everything else is left out. The key is cut to the length its field allows.
- A name without any of these characters, for example one in Japanese, gives no key; Marketing Cloud then uses its random one, as before.
- A key you type yourself is kept. Empty the field and it follows the name again.
- This is for creating only: a dialog that opens with a key, because it edits something that exists, is left alone, also if you empty its key field.
- The extension only fills the field. Nothing is saved until you finish the dialog, and if the key is already in use, Marketing Cloud says so.
- Switch it off under **Readable keys** in the extension's options.

### Options

Click the extension's icon in Chrome's toolbar to open the options: editor theme, right-click menu, format on save and readable keys. The same options are on the extension's page in `chrome://extensions`. Changes apply at once.

### Editor themes

Until you choose a theme, the editor follows your system: Dark Modern if your computer is in dark mode, Light Modern otherwise, and it switches along when the system does.

The code editor of Content Builder is shown in the colours of Visual Studio Code's **Light Modern** theme. To switch to **Dark Modern**, open the extension's options (`chrome://extensions` → SFMC UX Tools → Details → Extension options); the change applies at once. The theme covers the whole editor, not only AMPscript and SSJS, and replaces the themes that Marketing Cloud's own menu offers.

### Browser context menu in the code editor

The gear button below the editor opens the same Marketing Cloud menu as a right-click. While the browser's menu is chosen (the default), that button is hidden; choosing Marketing Cloud's menu in the options brings back both.

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

The extension runs on four places of Marketing Cloud Engagement:

- the Installed Packages page (`https://*.exacttarget.com/Content/Administration/InstalledPackages.aspx`), where it reads the open dialog to find the scope checkboxes and clicks them on your request;
- Content Builder (`https://content-builder.<stack>.marketingcloudapps.com`), where it adds colours, completions, hovers, parameter help, error underlines and formatting to the code editor. The editor reads your code through the colouring rules, and the built-in language service and formatter read it to do the rest; all of this happens inside the page only. To tell a code resource of CloudPages from other content, the extension reads the asset type, and nothing else, from the message with which Marketing Cloud sets the editor up. The part that understands the types of server-side JavaScript is large, so the extension only adds it to a Content Builder page that shows a code editor; for this it has Chrome's `scripting` permission, which it uses for nothing but loading that one file of its own into such a page. No code is ever loaded from anywhere else. Chrome's site-access prompt names `marketingcloudapps.com` as a whole because the stack number in the address differs per account; the extension itself is restricted to the addresses listed here.
- Automation Studio (`https://mc.<stack>.marketingcloudapps.com/AutomationStudioFuel3/`), where it adds colours, completions, hovers, parameter help, error underlines and quick fixes and formatting to the code editor of the script activity and applies the editor theme. The editor reads your script through the colouring rules and the built-in language service reads it to do the rest, inside the page only; the large TypeScript part is added to such a page in the same way as on Content Builder. The code editor of the SQL query activity gets the editor theme and formatting only; the built-in formatter reads the query inside the page. The same files as on Content Builder are loaded there, but the code editors of all other activities are left as they are. In the dialogs that create an activity, it reads the name you type and writes the key derived from it into the dialog's key field.
- Contact Builder (`https://mc.<stack>.marketingcloudapps.com/contactsmeta/`), where it does the same in the dialog that creates a data extension, and nothing else.

It does not collect or transmit any data and makes no network requests. The only thing it stores is your choice on the options page, in Chrome's extension storage (synced with your Chrome profile if sync is on).

## Development

```bash
npm install --no-workspaces
npm run lint
npm test
npm run build
```

- `src/` holds the extension's sources. `npm run build` writes the loadable extension to `dist/extension` and packs that folder as `dist/chrome-sfmc-ux-tools-v<version>.zip` for the Chrome Web Store. For **Load unpacked**, always pick `dist/extension`, not `src`.
- The build bundles `src/editor-format.js` with Prettier and `prettier-plugin-sfmc`, and `src/editor-language.js`, the files in `src/editor-language` and the `sfmc-language-lsp` package (currently 4.5.1) into one classic script each with esbuild. A third bundle, `src/editor-typescript.js`, holds TypeScript (6.0.3, the exact version the service is built for), the SSJS service of `sfmc-language-lsp/typescript` and the text of `ssjs-data`'s `sfmc-globals.d.ts`; it alone is minified. The build fails if a bundle calls `eval` or `new Function`, which Chrome does not allow. All other files are copied as they are.
- `src/editor-language/core` holds the editor-independent logic (text and a position in, plain data out), and the files next to it bind it to CodeMirror.
- The TypeScript bundle is about 4 MB, so it is not a content script. When the language script sets up its first editor in a frame, it dispatches `sfmc-ux-tools:need-typescript` on the document; `src/editor-typescript-loader.js` (extension world) passes that on, and the service worker `src/background.js` injects `editor-typescript.js` into the page world of the document that asked with `chrome.scripting.executeScript` and answers whether that worked; after a failure the next editor that is set up asks again. TypeScript's diagnostics only run in the check after typing has paused. The language script looks the TypeScript API up at every use and falls back to the catalogue without it.
- `node scripts/measure-typescript.mjs` (after a build) prints the size of the TypeScript bundle and how long it takes to start and to answer for a 1,500-line document.
- `npm test` runs the build first, because the completion tests run the built bundle.
- `npm run icons` redraws the icons in `src/icons/`.
- `npm run generate` rewrites `src/language-data.js` from the `ampscript-data` and `ssjs-data` packages; run it after updating either dependency. A test fails if the file is out of date.
- In `package.json`, `dependencies` are the packages whose code or data ends up in the shipped extension; `devDependencies` are tools for building, linting and testing. The package is never installed from npm, so the split is for clarity only.
- `codemirror` is fixed to the exact version Content Builder ships (5.65.21), so that the tests run against the editor the extension meets in the page. Change it only when Marketing Cloud updates its editor.
- `ace-builds` is fixed to the exact version of the Ace editor in Automation Studio's script activity (1.4.12), for the same reason. It is only used by the tests: `src/editor-language/ace` builds its mode at run time from the Ace of the page and bundles no copy of it.
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
