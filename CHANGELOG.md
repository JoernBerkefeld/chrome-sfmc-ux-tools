# Changelog

## [0.4.0]

### Changed

- Chrome 122 or newer is required.
- The toolbar icon is no longer greyed out, and a click on it opens the options.
- The editor theme follows the system's light or dark mode until a theme is chosen in the options; "Like the system" is the new default there.
- The gear button below the code editor, which opens Marketing Cloud's own editor menu, is hidden while the browser's context menu is chosen (the default), and comes back with the option "Marketing Cloud's menu".

### Added

- **SSJS completions in the code editor**: inside `<script runat="server">`, Marketing Cloud's functions and objects, the JavaScript built-ins that work in SSJS and the functions declared in the content are suggested while you type and on **Ctrl+Space**. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`).
- **TypeScript for SSJS**: the extension now understands the types of server-side JavaScript, as the SFMC Language Service extension for VS Code does. After a dot, the completions are the members of the value in front of it, also for your own variables (`var de = DataExtension.Init("x"); de.Rows.` offers `Add`, `Retrieve`, …). Hover and parameter help work for your own functions, variables and the methods of a value. Type errors, such as a method that a value does not have, are underlined. **Ctrl+click** / **Cmd+click** also goes to the declaration of a variable. This part is loaded into a Content Builder page only once it shows a code editor, for which the extension needs Chrome's `scripting` permission; it still makes no network requests.
- **Documentation on hover**: resting the mouse on an AMPscript function, keyword or variable, or on one of Marketing Cloud's SSJS functions, shows its parameters, return value, an example and links to the documentation. The box looks like the hover of VS Code, with the same colours for function names, parameters and types.
- **Parameter help**: inside the brackets of an AMPscript function or of one of Marketing Cloud's SSJS functions, a box lists the parameters, marks the one that is being typed and says what it is for.
- **Errors and warnings**: AMPscript and SSJS are checked while you type. What will not work is underlined, red for errors and yellow for warnings, and resting the mouse on it says why.
- **Formatting**: the **{ }** button in the editor's toolbar and **Shift+Alt+F** format the whole content of the code editor, AMPscript, SSJS, HTML, CSS and browser JavaScript, with the bundled `prettier-plugin-sfmc` and the settings of the SFMC Language Service extension for VS Code.
- **Format on save**: an option, off by default. When it is on, the code is formatted before Marketing Cloud saves it.
- **Save with Ctrl+S / Cmd+S** in the code editor, which does what Marketing Cloud's Save button does.
- **Quick fixes**: the box of an error or warning offers the fixes the language service knows, as buttons; **Ctrl+.** / **Cmd+.** opens them at the cursor.
- **Go to definition**: **Ctrl+click** / **Cmd+click** on the name of a function declared in the content's SSJS jumps to its declaration.
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
