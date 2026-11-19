/*
 * SFMC UX Tools — quick fixes: the changes the language service offers for an error or warning.
 */
import { getScriptRegions, sfmcLanguageService } from 'sfmc-language-lsp';
import { AMPSCRIPT, DOCUMENT_URI, SETTINGS, SSJS } from './shared.js';
import { offsetAt, positionAt } from './core/text.js';

/**
 * Converts a range of a text into a range of another text that starts later in the same content.
 *
 * @param {{start: object, end: object}} range range of the language service
 * @param {string} from text the range belongs to
 * @param {string} to text the range is wanted for
 * @param {number} shift how much later the first text starts than the second; negative the other way round
 * @returns {{start: object, end: object}} the range in the other text
 */
function moveRange(range, from, to, shift) {
    return {
        start: positionAt(to, offsetAt(from, range.start) + shift),
        end: positionAt(to, offsetAt(from, range.end) + shift),
    };
}

/**
 * Asks the language service how a problem can be fixed. SSJS is asked for its script alone, as
 * the language server of the VS Code extension does: with the whole document, a fix that adds
 * something at the start of the code would land at the start of the HTML.
 *
 * @param {string} text whole document
 * @param {object} diagnostic diagnostic of the language service, for this very text
 * @returns {{title: string, edits: {from: number, to: number, text: string}[]}[]} the fixes, with what they replace, by offsets of the document
 */
export function fixesFor(text, diagnostic) {
    let source = text;
    let shift = 0;
    let asked = diagnostic;
    let language = AMPSCRIPT;
    if (diagnostic.source === SSJS) {
        const start = offsetAt(text, diagnostic.range.start);
        const end = offsetAt(text, diagnostic.range.end);
        const region = getScriptRegions(text).find(
            (item) => item.kind === SSJS && start >= item.bodyStart && end <= item.bodyEnd,
        );
        if (!region) {
            return [];
        }
        source = text.slice(region.bodyStart, region.bodyEnd);
        shift = region.bodyStart;
        language = SSJS;
        asked = { ...diagnostic, range: moveRange(diagnostic.range, text, source, -shift) };
    }
    return sfmcLanguageService
        .getCodeActions(
            { text: source, languageId: language, uri: DOCUMENT_URI },
            [asked],
            SETTINGS,
        )
        .map((action) => ({
            title: String(action.title),
            edits: (action.edit?.changes?.[DOCUMENT_URI] ?? []).map((edit) => ({
                from: offsetAt(source, edit.range.start) + shift,
                to: offsetAt(source, edit.range.end) + shift,
                text: String(edit.newText),
            })),
        }))
        .filter((fix) => fix.edits.length > 0);
}

/**
 * Applies a fix to an editor in one step that can be undone.
 *
 * @param {object} cm CodeMirror instance
 * @param {{edits: {from: number, to: number, text: string}[]}} fix fix from `fixesFor`, for the editor's current content
 */
export function applyFix(cm, fix) {
    // from the end of the document backwards, so that earlier offsets stay right
    const edits = fix.edits.toSorted((a, b) => b.from - a.from);
    cm.operation(() => {
        for (const edit of edits) {
            cm.replaceRange(
                edit.text,
                cm.posFromIndex(edit.from),
                cm.posFromIndex(edit.to),
                '+fix',
            );
        }
    });
}
