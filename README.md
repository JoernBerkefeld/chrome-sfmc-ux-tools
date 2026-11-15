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
- Not covered yet: diagnostics.

### Documentation on hover

Rest the mouse on an AMPscript function, keyword or variable, or on one of Marketing Cloud's SSJS functions, and a box shows what it does: its parameters with their types, what it returns, an example and links to the full documentation. You can move the mouse onto the box to scroll it or to follow a link. Nothing is shown inside browser scripts.

### Parameter help

While the cursor is inside the brackets of an AMPscript function or of one of Marketing Cloud's SSJS functions, a box above the line lists the function's parameters, marks the one you are typing and says what it is for. It follows the cursor, also in calls that are already written, and **Esc** closes it.

### Completions

While you type AMPscript or server-side JavaScript (SSJS) in the code view of Content Builder, the extension suggests what fits. Press **Ctrl+Space** to ask for suggestions at any time.

- **AMPscript**: functions, keywords, personalisation strings and the variables of the current content.
- **SSJS**, inside `<script runat="server">`: Marketing Cloud's functions and objects (`Platform.Function.Lookup`, `Write`, `DataExtension`, `HTTP.Get`, …), the JavaScript built-ins that work in SSJS, and the functions declared in the content. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`).
- **JavaScript for the browser**, inside any other `<script>`: the names used in the content's browser scripts, JavaScript's keywords and the usual globals (`document`, `console`, …). Marketing Cloud's server-side names are never suggested there. SSJS gets the names of its own scripts and its keywords in the same way.

- AMPscript suggestions appear inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and AMPscript script tags, never in plain HTML. While you type, they stay away inside strings and comments.
- Picking a function inserts its name and the opening bracket; picking anything else inserts the plain word. Nothing is inserted unless you pick it.
- Not covered yet, in SSJS and in browser scripts: the members of a value, such as the methods of a `DataExtension.Init(...)` result or of `document`.
- The suggestions come from the [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp) language service (version 4.4.0), the same one behind the SFMC Language Service extension for VS Code. It is built into the extension and runs inside the page.
- The popup needs the editor's hint feature. Where an editor does not have it, completions stay off and everything else works as before.

### Editor themes

The code editor of Content Builder is shown in the colours of Visual Studio Code's **Light Modern** theme. To switch to **Dark Modern**, open the extension's options (`chrome://extensions` → SFMC UX Tools → Details → Extension options); the change applies at once. The theme covers the whole editor, not only AMPscript and SSJS, and replaces the themes that Marketing Cloud's own menu offers.

### Browser context menu in the code editor

A right-click in the code editor opens the browser's own context menu instead of the menu Marketing Cloud draws over the code. To get Marketing Cloud's menu back, open the extension's options (`chrome://extensions` → SFMC UX Tools → Details → Extension options) and choose it there; the change applies at once.

### Select all scopes of an installed package

When you add or edit an API integration under **Setup → Platform Tools → Apps → Installed Packages**, the dialog lists around a hundred scope checkboxes. The extension adds a **Select all** button to the **Scope** bar of that dialog:

- **Select all** ticks every scope, including the ones that are scrolled out of view.
- Once everything is ticked, the button turns into **Deselect all** and clears every scope again.

Nothing is saved until you press the dialog's own **Save** button. The button works in every language of the Marketing Cloud user interface, in the dialog for adding a component and in the one for editing it.

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
- Content Builder (`https://content-builder.<stack>.marketingcloudapps.com`), where it adds colouring rules and completions to the code editor. The editor reads your code through these rules to colour it, and the built-in language service reads it to suggest completions; both happen inside the page only. Chrome's site-access prompt names `marketingcloudapps.com` as a whole because the stack number in the address differs per account; the extension itself is restricted to the Content Builder address.

It does not collect or transmit any data and makes no network requests. The only thing it stores is your choice on the options page, in Chrome's extension storage (synced with your Chrome profile if sync is on).

## Development

```bash
npm install --no-workspaces
npm run lint
npm test
npm run build
```

- `src/` holds the extension's sources. `npm run build` writes the loadable extension to `dist/extension` and packs that folder as `dist/chrome-sfmc-ux-tools-v<version>.zip` for the Chrome Web Store. For **Load unpacked**, always pick `dist/extension`, not `src`.
- The build bundles `src/editor-language.js`, the files in `src/editor-language` and the `sfmc-language-lsp` package (currently 4.4.0) into one classic script with esbuild, and fails if that bundle calls `eval` or `new Function`, which Chrome does not allow. All other files are copied as they are.
- `npm test` runs the build first, because the completion tests run the built bundle.
- `npm run icons` redraws the icons in `src/icons/`.
- `npm run generate` rewrites `src/language-data.js` from the `ampscript-data` and `ssjs-data` packages; run it after updating either dependency. A test fails if the file is out of date.
- Keep `version` in `package.json` and `src/manifest.json` identical; a test checks this.

### Releasing

Publishing a GitHub Release runs `.github/workflows/chrome-webstore-publish.yml`. The release tag must equal the version in `src/manifest.json` (a leading `v` is allowed), otherwise the run fails. Prereleases only get the zip attached and are not uploaded to the store. For a regular release it attaches the zip to the release and uploads it to the Chrome Web Store when the repository secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` are set. The first version has to be submitted by hand in the Chrome Web Store developer dashboard, which is also where the extension ID comes from.

## License

[MIT](LICENSE) © Jörn Berkefeld
