/*
 * SFMC UX Tools — shows the Markdown of the language service.
 *
 * Covers what its documentation uses: fenced code, quotes, paragraphs, inline code, bold,
 * italics and links. Everything is built from elements and text nodes; no text of the
 * documentation is ever read as HTML.
 */

const FENCE = /^```/;
const QUOTE = /^>\s?/;
// inline code, bold, italics, or a link to a secure web address
const INLINE =
    /`([^`]+)`|\*\*([^*]+(?:\*[^*]+)*?)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

/**
 * Adds a line of Markdown to an element, turning its inline marks into elements.
 *
 * @param {HTMLElement} parent element to add to
 * @param {string} text the Markdown
 */
function addInline(parent, text) {
    const document = parent.ownerDocument;
    let end = 0;
    for (const match of text.matchAll(INLINE)) {
        parent.append(text.slice(end, match.index));
        end = match.index + match[0].length;
        const [, code, bold, italic, label, address] = match;
        const tag =
            code === undefined ? (address ? 'a' : bold === undefined ? 'em' : 'strong') : 'code';
        const element = document.createElement(tag);
        if (tag === 'code') {
            element.textContent = code;
        } else if (tag === 'a') {
            element.href = address;
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
            element.textContent = label;
        } else {
            addInline(element, bold ?? italic);
        }
        parent.append(element);
    }
    parent.append(text.slice(end));
}

/**
 * Turns Markdown into elements.
 *
 * @param {Document} document document the elements are for
 * @param {string} markdown the Markdown
 * @returns {DocumentFragment} what to show
 */
export function renderMarkdown(document, markdown) {
    const result = document.createDocumentFragment();
    const lines = markdown.split(/\r?\n/);
    let paragraph = [];
    let quote = [];
    const flush = () => {
        for (const [tag, content] of [
            ['p', paragraph],
            ['blockquote', quote],
        ]) {
            if (!content.length) {
                continue;
            }

            const element = document.createElement(tag);
            addInline(element, content.join(' '));
            result.append(element);
        }
        paragraph = [];
        quote = [];
    };
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (FENCE.test(line)) {
            flush();
            const code = [];
            while (++index < lines.length && !FENCE.test(lines[index])) {
                code.push(lines[index]);
            }
            const element = document.createElement('pre');
            element.textContent = code.join('\n');
            result.append(element);
        } else if (!line.trim()) {
            flush();
        } else if (QUOTE.test(line)) {
            quote.push(line.replace(QUOTE, ''));
        } else {
            paragraph.push(line);
        }
    }
    flush();
    return result;
}
