/*
 * SFMC UX Tools — a code editor of the extension's own, for a place where Marketing Cloud has
 * none: the message of a transactional SMS in the panel "Transactional Messages".
 *
 * Everywhere else the extension works on the CodeMirror of the page. Here it brings CodeMirror 5
 * itself, with the hint addon and the HTML mode under the name Marketing Cloud uses for its own
 * mode, so that the colouring (editor-highlight.js) and the language features
 * (editor-language.js) treat this editor like any other. `npm run build` bundles this file with
 * CodeMirror into one script, which transactional-messages.js loads when it is needed.
 */
import CodeMirror from 'codemirror';
import 'codemirror/mode/htmlmixed/htmlmixed.js';
import 'codemirror/addon/hint/show-hint.js';

CodeMirror.defineMode('ampScriptHtmlMixed', (config) => CodeMirror.getMode(config, 'htmlmixed'));
// where transactional-messages.js finds it; that script's world holds no other CodeMirror
// eslint-disable-next-line unicorn/no-global-object-property-assignment -- handed to a classic script
globalThis.CodeMirror = CodeMirror;
