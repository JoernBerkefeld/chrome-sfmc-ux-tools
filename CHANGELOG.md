# Changelog

## [0.2.0]

### Added

- **AMPscript colours in the code editor** of Content Builder and other Marketing Cloud apps that use the same editor: keywords, functions, variables, strings, numbers and comments inside `%%[ ... ]%%` blocks, `%%= ... =%%` expressions and `<script runat="server" language="ampscript">` tags.
- **SSJS colours in the code editor**: inside `<script runat="server">`, Marketing Cloud's objects (`Platform`, `DataExtension`, `Variable`, …), its global functions (`Write()`, `Stringify()`, …) and the functions behind `Platform.Function.` are coloured.
- Personalisation strings (`%%name%%`) are coloured, and their closing `%%` is never mistaken for the start of AMPscript.

### Changed

- The extension now also runs on `*.marketingcloudapps.com`, where the code editor lives. Chrome asks existing users to confirm this additional site access.
- Chrome 111 or newer is required.

## [0.1.0]

### Added

- **Select all** / **Deselect all** button in the Scope bar of the Installed Packages component dialog.
