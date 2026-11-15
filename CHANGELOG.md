# Changelog

## [0.4.0]

### Added

- **SSJS completions in the code editor**: inside `<script runat="server">`, Marketing Cloud's functions and objects, the JavaScript built-ins that work in SSJS and the functions declared in the content are suggested while you type and on **Ctrl+Space**. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`). The members of your own variables are not suggested yet.
- **Documentation on hover**: resting the mouse on an AMPscript function, keyword or variable, or on one of Marketing Cloud's SSJS functions, shows its parameters, return value, an example and links to the documentation.
- **Parameter help**: inside the brackets of an AMPscript function or of one of Marketing Cloud's SSJS functions, a box lists the parameters, marks the one that is being typed and says what it is for.
- **Errors and warnings**: AMPscript and SSJS are checked while you type. What will not work is underlined, red for errors and yellow for warnings, and resting the mouse on it says why.
- **Formatting**: **Shift+Alt+F** formats the whole content of the code editor, AMPscript, SSJS, HTML, CSS and browser JavaScript, with the bundled `prettier-plugin-sfmc` and the settings of the SFMC Language Service extension for VS Code.
- **JavaScript completions in browser scripts**: inside a `<script>` that runs in the browser, the names used in the content's browser scripts, JavaScript's keywords and the usual globals are suggested. Marketing Cloud's server-side names stay out of browser scripts, and SSJS gets the names of its own scripts and its keywords in the same way.

## [0.3.0]

### Added

- **AMPscript completions in the code editor** of Content Builder: functions, keywords, personalisation strings and the variables of the current content are suggested while you type and on **Ctrl+Space**. Picking a function inserts its name and the opening bracket. The suggestions come from the bundled `sfmc-language-lsp` 4.4.0 language service. Server-side JavaScript has no completions yet.

- **Editor themes**: the code editor of Content Builder is shown in the colours of Visual Studio Code's **Light Modern** theme, or in **Dark Modern** if you choose that in the extension's options. This covers the whole editor (background, line numbers, selection, HTML, CSS and JavaScript) and replaces the themes of Marketing Cloud's own menu.

### Changed

- A right-click in the code editor now opens the browser's own context menu (copy, paste, spell check, …) instead of Marketing Cloud's menu. Marketing Cloud's menu (source formatting, word wrap, line numbers) can be switched back on in the extension's options. The setting is stored with Chrome's `storage` permission, which needs no confirmation.
- The extension now has a build step. To load it unpacked, run `npm run build` and pick `dist/extension` instead of `src`.

## [0.2.0]

### Added

- **AMPscript colours in the code editor** of Content Builder and other Marketing Cloud apps that use the same editor: keywords, functions, variables, strings, numbers and comments inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and `<script runat="server" language="ampscript">` tags.
- **SSJS colours in the code editor**: inside `<script runat="server">`, Marketing Cloud's objects (`Platform`, `DataExtension`, `Variable`, …), its global functions (`Write()`, `Stringify()`, …) and the functions behind `Platform.Function.` are coloured.
- Personalisation strings (`%%name%%`) are coloured, and their closing `%%` is never mistaken for the start of AMPscript.

### Changed

- The **Select all** button no longer depends on the language of the Marketing Cloud user interface. It recognises the dialog by its structure, so it also appears in German and other languages, and in the dialog for editing a component.
- The extension now also runs on Content Builder (`content-builder.<stack>.marketingcloudapps.com`), where the code editor lives. Chrome asks existing users to confirm this additional site access.
- Chrome 111 or newer is required.

## [0.1.0]

### Added

- **Select all** / **Deselect all** button in the Scope bar of the Installed Packages component dialog.
