# SFMC UX Tools

A Chrome extension with small usability helpers for Salesforce Marketing Cloud Engagement.

> Not affiliated with, endorsed by or supported by Salesforce.

## Features

### AMPscript and SSJS colours in the code editor

Marketing Cloud's code editor colours HTML but shows AMPscript as plain text. With the extension, the code inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and `<script runat="server" language="ampscript">` tags is coloured as well: keywords, functions, variables, strings, numbers and comments.

- In server-side JavaScript (`<script runat="server">`), Marketing Cloud's own objects and functions get colours of their own, for example `Platform`, `DataExtension`, `Variable`, `Write()` and the functions behind `Platform.Function.`. The JavaScript itself keeps the colours the editor already gives it.
- Works in the code view of Content Builder and in other Marketing Cloud apps that use the same editor.
- The content itself is never changed; only the colours are.
- A script tag is only recognised if its opening tag fits on one line.
- Not covered yet: completions, hovers and diagnostics.

### Select all scopes of an installed package

When you add or edit an API integration under **Setup → Platform Tools → Apps → Installed Packages**, the dialog lists around a hundred scope checkboxes. The extension adds a **Select all** button to the **Scope** bar of that dialog:

- **Select all** ticks every scope, including the ones that are scrolled out of view.
- Once everything is ticked, the button turns into **Deselect all** and clears every scope again.

Nothing is saved until you press the dialog's own **Save** button.

The button is attached to the bar labelled **Scope**, so it only appears when the Marketing Cloud user interface is set to English.

## Installation

### Chrome Web Store

Not listed yet.

### From source (unpacked)

1. Clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Choose **Load unpacked** and pick the `src` folder.

This works the same way in other Chromium browsers such as Edge.

## Privacy

The extension runs on two places of Marketing Cloud Engagement:

- the Installed Packages page (`https://*.exacttarget.com/Content/Administration/InstalledPackages.aspx`), where it reads the open dialog to find the scope checkboxes and clicks them on your request;
- the Marketing Cloud apps (`https://*.marketingcloudapps.com`), where it adds colouring rules to the code editor. The editor reads your code through these rules to colour it; this happens inside the page only.

It does not collect, store or transmit any data and makes no network requests.

## Development

```bash
npm install --no-workspaces
npm run lint
npm test
npm run build
```

- `src/` is the extension itself; there is no compile step.
- `npm run build` writes `dist/chrome-sfmc-ux-tools-v<version>.zip` for the Chrome Web Store.
- `npm run icons` redraws the icons in `src/icons/`.
- `npm run generate` rewrites `src/language-data.js` from the `ampscript-data` and `ssjs-data` packages; run it after updating either dependency. A test fails if the file is out of date.
- Keep `version` in `package.json` and `src/manifest.json` identical; a test checks this.

### Releasing

Publishing a GitHub Release runs `.github/workflows/chrome-webstore-publish.yml`. The release tag must equal the version in `src/manifest.json` (a leading `v` is allowed), otherwise the run fails. Prereleases only get the zip attached and are not uploaded to the store. For a regular release it attaches the zip to the release and uploads it to the Chrome Web Store when the repository secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` are set. The first version has to be submitted by hand in the Chrome Web Store developer dashboard, which is also where the extension ID comes from.

## License

[MIT](LICENSE) © Jörn Berkefeld
