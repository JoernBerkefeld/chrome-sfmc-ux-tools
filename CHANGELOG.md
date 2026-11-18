# Changelog

## [0.4.0]

### Changed

- Chrome 122 or newer is required.
- Email Studio and CloudPages are named as covered: both open Content Builder's code view, where the extension already works.
- The toolbar icon is no longer greyed out, and a click on it opens the options.
- The editor theme follows the system's light or dark mode until a theme is chosen in the options; "Like the system" is the new default there.
- The gear button below the code editor, which opens Marketing Cloud's own editor menu, is hidden while the browser's context menu is chosen (the default), and comes back with the option "Marketing Cloud's menu".

### Added

- **SSJS completions in the code editor**: inside `<script runat="server">`, Marketing Cloud's functions and objects, the JavaScript built-ins that work in SSJS and the functions declared in the content are suggested while you type and on **Ctrl+Space**. A name is found by its full path (`Platform.Function.Loo`) or by the name alone (`Loo`). The start of an object leads through it one level at a time, in any spelling: `plat` offers `Platform`, `platform.` offers `Platform.Function`, `Platform.Response`, …, and only the last level lists the functions.
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
- **Colours in Automation Studio's script activity**: the code editor of that dialog, and the read-only one on its summary step, show server-side JavaScript, AMPscript, personalisation strings and the HTML around them in the same colours as Content Builder, in both editor themes. Until now the whole script had one colour and the script tag was marked as an error. The extension therefore also runs on `https://*.marketingcloudapps.com/AutomationStudioFuel3/`, which needs no new permission.
- **Completions in Automation Studio's script activity**: the editor of that dialog suggests AMPscript, SSJS and browser JavaScript like the code view of Content Builder, while you type and on **Ctrl+Space**. That editor has no popup for suggestions, so the extension shows its own, with the same look and keys: the arrow keys, **Page Up**/**Page Down**, **Home** and **End** move, **Enter**, **Tab** or a click picks, **Esc** closes. The read-only editor on the summary step has none.
- **Hovers, parameter help, errors and warnings, quick fixes and go to definition in Automation Studio's script activity**: the editor of that dialog explains the name under the mouse, shows a function's parameters while you type a call, underlines what the language service objects to and notes it next to the line number, offers quick fixes as buttons and on **Ctrl+.** / **Cmd+.**, and jumps to a declaration on **Ctrl+click** / **Cmd+click**, all as in Content Builder. The TypeScript-backed part is loaded there on demand too. The read-only editor on the summary step explains and underlines, but offers no fixes and no parameter help.
- **Formatting in Automation Studio's script activity**: a **{ }** button next to **Validate Syntax**, and **Shift+Alt+F**, format the script like the code view of Content Builder, in one step for **Ctrl+Z**; the line endings of the script stay as they are. With **format on save** switched on, the script is also formatted when you click **Next**, before the dialog takes it over for its summary and for **Finish**. **Ctrl+S** is not part of that dialog, which saves at the end of its wizard.
- **Theme and formatting in Automation Studio's SQL query activity**: the query editor of that dialog follows the editor theme, light or dark, and keeps Marketing Cloud's SQL colouring. A **{ }** button next to **Validate Syntax**, and **Shift+Alt+F**, format the query as T-SQL with the bundled `prettier-plugin-sfmc`, in one step for **Ctrl+Z**; with **format on save** switched on, a click on **Next** formats it first.
- **CloudPages code resources**: a JavaScript, CSS, JSON, XML or RSS resource is coloured as what it is; until now the editor showed it as HTML, which left it without colours. A JavaScript resource is completed like a browser script. **{ }** and **Shift+Alt+F** format JavaScript, CSS and JSON resources with the formatter for that language; a resource that mixes its own code with AMPscript or a server-side script is left as it is, and XML, RSS and text resources have no format button. AMPscript and server-side scripts inside a resource keep their colours and features.
- **Readable keys**: the dialogs that create an SQL query, script, filter, import, data extract or file transfer activity in Automation Studio, a new automation (its key is on the Summary tab), and a data extension in Contact Builder, get their external key filled from the name while you type it, instead of the random key Marketing Cloud uses when the field is left empty. Spaces become underscores, accents are dropped (`ö` becomes `o`), and of the rest only letters, digits, underscores and hyphens stay; the key is cut to the length its field allows. Email Studio's dialog for a new data extension is covered as well, for which the extension now also runs on `https://*.exacttarget.com/C12/Default.aspx`; Chrome asks to accept that when the extension is updated. In Contact Builder, a name or key pasted with the mouse into the dialog for a new data extension is now taken over (Marketing Cloud ignores it and, for the key, creates a random one); this fix also works with readable keys switched off. The key field there is lifted from the 36 characters its dialog allows to the 200 Marketing Cloud accepts. A key you type yourself is kept, the key of something that already exists is never touched, and the option "Readable keys" switches it off. The extension therefore also runs on `https://*.marketingcloudapps.com/contactsmeta/`, which needs no new permission.
- **Readable keys in Journey Builder**: a new journey of any kind is saved with a key made from its name instead of the random one Journey Builder makes up; the key of a journey cannot be changed later. The Event Definition Key of a new API event, which Journey Builder only shows, becomes a field that starts with a key made from the event's name, and the key a transactional journey asks for is filled in from the journey's name. A key that another journey or event already has gets `_2`, `_3`, … at its end, because Marketing Cloud would otherwise store a second journey with the same key as a new version of the first; for this the extension asks Journey Builder's own server whether a key is free, which is the only kind of request it makes. Existing journeys and events, later versions of a journey and entry events of other kinds are left alone. The extension therefore also runs on `https://jbinteractions.<stack>.marketingcloudapps.com`, which needs no new permission.
- **Journey names**: Journey Builder calls every new journey "New Journey" with the date and time and hands that name on to its API event. Saving, validating, testing or activating a journey that still has this name is held back and the name field opens instead. The option "Journey names" switches this off.
- **Readable keys in Setup**: the pages that create a sender profile, a send classification, a delivery profile, a file location, a role or a user get their external key from the name, for which the extension now also runs on `https://*.exacttarget.com/Content/Administration/SendManagement/`, `…/Roles/RoleDetails.aspx` and `…/EmployeeDetails.aspx`. The key of a new user follows the username (the login) and keeps its dots and its `@`.
- **The key of a journey, to see and to copy**: the details below a journey's name get an entry **Key**. For a journey that was never saved it is a field that shows the key made from the name and takes a key of your own; the details open by themselves so that it is seen. For a saved journey it shows the key as text, which one click marks for copying, also with readable keys switched off.

### Fixed

- The Event Definition Key field of a new API event now looks like the Activity Name field next to it.
- Setup, new or existing user: the browser's password manager no longer fills a saved login into the Username, External Key and password fields of the user page. The option "Saved logins on Setup's user pages" switches this off.
- Setup, new or existing user: Chrome no longer offers saved logins at the password fields, and LastPass, 1Password, Bitwarden and Dashlane are told to skip the fields.
- Setup, new user: a saved login that a password manager puts into the External Key field, at any time, is replaced by the key made from the username; a key typed by hand stays.
- Automation Studio's script activity: the underline of an error or warning no longer disappears on the line the cursor is on.
- Automation Studio: the name typed for an automation is kept when you click elsewhere, for example on **Save**, instead of being dropped unless **Done** was clicked first.

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
