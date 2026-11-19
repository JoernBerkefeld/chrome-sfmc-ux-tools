/*
 * SFMC UX Tools — language features for Marketing Cloud's code editor.
 *
 * Source of the language script. `npm run build` bundles it together with the files in
 * ./editor-language and with sfmc-language-lsp into one classic script, which takes this file's
 * place in dist/extension. What the editor is told comes from that language service; the files
 * in ./editor-language connect it to CodeMirror 5. For server-side JavaScript they also ask the
 * TypeScript script (./editor-typescript.js), which is loaded once a frame has an editor.
 *
 * Like the colouring, it has to run in the page's own script world, and it is a file of its own
 * so that a failure in here can never break the colouring.
 */
import { registerCompletions } from './editor-language/completions.js';
import { registerDefinition } from './editor-language/definition.js';
import { registerDiagnostics } from './editor-language/diagnostics.js';
import { IS_NEXT, watchEditors } from './editor-language/editors.js';
import { registerHover } from './editor-language/hover.js';
import { registerSignature } from './editor-language/signature.js';
import { requestTypescript } from './editor-language/typescript.js';
import { watchAceEditors } from './editor-language/ace/script-activity.js';
import { watchQueryEditors } from './editor-language/ace/query-activity.js';

if (IS_NEXT) {
    // Marketing Cloud Next's content editor has suggestions of its own and runs no server-side
    // JavaScript: it gets explanations, parameter help and what is wrong with the code
    watchEditors('language', [registerHover, registerSignature, registerDiagnostics]);
} else {
    watchEditors('language', [
        // a frame with an editor has use for the TypeScript script, which is loaded on demand
        requestTypescript,
        registerCompletions,
        registerHover,
        registerSignature,
        registerDiagnostics,
        registerDefinition,
    ]);
    // Automation Studio's script activity has another editor, Ace; it gets its colours and the same features here
    watchAceEditors();
    // its SQL query activity keeps its own SQL colouring and follows the editor theme
    watchQueryEditors();
}
