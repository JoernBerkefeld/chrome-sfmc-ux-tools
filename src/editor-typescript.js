/*
 * SFMC UX Tools — TypeScript-based language features for the server-side JavaScript in Marketing
 * Cloud's code editor.
 *
 * Source of the TypeScript script. `npm run build` bundles it with TypeScript and the SSJS service
 * of sfmc-language-lsp into one minified classic script and puts the text of ssjs-data's
 * declarations of the SSJS globals in place of `__SFMC_GLOBALS__`.
 *
 * The script is large, so it is no content script: the background script injects it into a frame
 * once the language script found a code editor there. The language script looks this API up
 * whenever it needs it and works as before without it.
 */
/* global __SFMC_GLOBALS__ -- replaced by the build */
import {
    createSsjsTypeScriptService,
    isInSsjsRegion,
    memberCompletions,
} from 'sfmc-language-lsp/typescript';

const API = Symbol.for('sfmcUxTools.typescript');
const READY_EVENT = 'sfmc-ux-tools:typescript-ready';
// the one document the service knows: the SSJS of the editor that asked last
const URI = 'inmemory://editor.ssjs';

// a second injection into the same frame keeps the service that is there
if (globalThis[API] === undefined) {
    const service = createSsjsTypeScriptService({ globalsDts: __SFMC_GLOBALS__ });
    // eslint-disable-next-line unicorn/no-global-object-property-assignment -- how the language script, another classic script, finds the service
    globalThis[API] = {
        update: (text) => service.updateDocument(URI, text),
        completions: (position) => service.getCompletionInfo(URI, position),
        hover: (position) => service.getHover(URI, position),
        signatureHelp: (position) => service.getSignatureHelp(URI, position),
        // declarations of Marketing Cloud's own names are in no editor, so only those of the content count
        definition: (position) =>
            service.getDefinition(URI, position).filter((location) => location.uri === URI),
        diagnostics: () => service.getDiagnostics(URI),
        // shared rules, handed on so that the language script needs no copy of them
        memberCompletions,
        isInSsjsRegion,
    };
    // editors that were checked before learn that there is more to find now
    document.dispatchEvent(new CustomEvent(READY_EVENT));
}
