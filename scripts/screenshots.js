/*
 * Takes the pictures of the README: `npm run screenshots` builds the extension and runs this.
 *
 * No Marketing Cloud page is used. The demo pages in ./demo load the built scripts from
 * dist/extension with made-up content, a local server serves them, and the installed Edge (or the
 * browser in the environment variable SCREENSHOT_BROWSER) opens them without a window. Every
 * request that does not go to that local server is refused. Each picture is cut to the feature it
 * shows, and each capture checks first that the feature is on screen; if one is not, the run fails
 * and names it. Hover, suggestions and parameter help become animated GIFs.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import gifenc from 'gifenc';
import puppeteer from 'puppeteer-core';

const { GIFEncoder, applyPalette, quantize } = gifenc;
const root = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = path.join(root, 'images');
const BROWSER =
    process.env.SCREENSHOT_BROWSER ||
    String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
// the only folders the server hands out
const SERVED = ['demo/', 'dist/extension/'];
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.json': 'application/json',
};
// pictures are taken at twice the size, so that they stay sharp on a high-resolution screen;
// GIFs at the normal size, to keep them small
const SHARP = 2;
const PLAIN = 1;
const VIEWPORT = { width: 1280, height: 860 };
// room around a feature in a picture; less around a field with an open list, which the next field follows closely
const MARGIN = 12;
const LIST_MARGIN = 6;
// how long a feature may take to appear
const WAIT = 10_000;
// how long one frame of a GIF stands, the first one and the last one
const FRAME_TIME = 120;
const FIRST_FRAME_TIME = 800;
const LAST_FRAME_TIME = 2500;

/**
 * Writes a line of progress.
 *
 * @param {string} text what to say
 */
function say(text) {
    process.stdout.write(`${text}\n`);
}

/**
 * Waits a moment.
 *
 * @param {number} time milliseconds
 * @returns {Promise.<void>} settles after that time
 */
const pause = (time) =>
    new Promise((resolve) => {
        setTimeout(resolve, time);
    });

/**
 * Starts a server for the demo pages and the built extension, on a free port of this computer.
 *
 * @returns {Promise.<{origin: string, close: () => void}>} its address, and what stops it
 */
async function serve() {
    const server = createServer(async (request, response) => {
        const { pathname } = new URL(request.url, 'http://localhost');
        const relative = path.posix.normalize(decodeURIComponent(pathname)).replace(/^\/+/, '');
        if (SERVED.every((folder) => !relative.startsWith(folder))) {
            response.writeHead(404).end();
            return;
        }
        try {
            const content = await readFile(path.join(root, relative));
            response
                .writeHead(200, {
                    'Content-Type': TYPES[path.extname(relative)] ?? 'application/octet-stream',
                })
                .end(content);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    return {
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
    };
}

/**
 * Opens a page that may reach the local server only. What it tries to reach elsewhere, its
 * script errors and the errors in its console are noted, and fail the run at the end.
 *
 * @param {object} browser the browser
 * @param {string} origin address of the local server
 * @param {string[]} problems what went wrong, for the end of the run
 * @param {number} scale device pixels per CSS pixel
 * @returns {Promise.<object>} the page
 */
async function openPage(browser, origin, problems, scale) {
    const page = await browser.newPage();
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: scale });
    await page.emulateTimezone('UTC');
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const url = request.url();
        // asked for by the options page, which has no icon of its own
        if (url === `${origin}/favicon.ico`) {
            request.respond({ status: 204 });
            return;
        }
        if (url.startsWith(`${origin}/`) || url.startsWith('data:')) {
            request.continue();
            return;
        }
        problems.push(`a request to ${url} was refused`);
        request.abort();
    });
    page.on('pageerror', (ex) => {
        problems.push(`script error: ${ex.message}`);
    });
    page.on('console', (message) => {
        if (message.type() === 'error') {
            problems.push(`console: ${message.text()}`);
        }
    });
    return page;
}

/**
 * Waits until a condition holds in the page, and fails with the name of the feature otherwise.
 *
 * @param {object} page the page
 * @param {string} feature what is waited for, for the message
 * @param {(...parameters: unknown[]) => unknown} condition runs in the page; true once the feature is on screen
 * @param {...unknown} parameters handed to the condition
 */
async function expect(page, feature, condition, ...parameters) {
    try {
        await page.waitForFunction(condition, { timeout: WAIT }, ...parameters);
    } catch {
        throw new Error(`not on screen: ${feature}`);
    }
}

/**
 * Measures the room the given elements take together, with a margin, inside the viewport.
 *
 * @param {object} page the page
 * @param {string[]} selectors elements to cover; each one must be on the page
 * @param {{margin?: number, below?: number, above?: number, right?: number, within?: string}} [extra] room around them, more room below, above or to the right, and an element the region must not leave, such as the part of a panel that scrolls
 * @returns {Promise.<{x: number, y: number, width: number, height: number}>} the region, in CSS pixels
 */
async function regionOf(page, selectors, extra = {}) {
    const { margin = MARGIN, below = 0, above = 0, right: wider = 0, within } = extra;
    const bounds = within
        ? await page.$eval(within, (element) => {
              const { left, top, right, bottom } = element.getBoundingClientRect();
              return { left, top, right, bottom };
          })
        : { left: 0, top: 0, right: VIEWPORT.width, bottom: VIEWPORT.height };
    const box = await page.evaluate((list) => {
        const rects = list.map((selector) => {
            const element = document.querySelector(selector);
            if (!element) {
                throw new Error(`missing: ${selector}`);
            }
            return element.getBoundingClientRect();
        });
        return {
            left: Math.min(...rects.map((rect) => rect.left)),
            top: Math.min(...rects.map((rect) => rect.top)),
            right: Math.max(...rects.map((rect) => rect.right)),
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
        };
    }, selectors);
    const left = Math.max(0, bounds.left, Math.floor(box.left - margin));
    const top = Math.max(0, bounds.top, Math.floor(box.top - margin - above));
    const right = Math.min(VIEWPORT.width, bounds.right, Math.ceil(box.right + margin + wider));
    const bottom = Math.min(VIEWPORT.height, bounds.bottom, Math.ceil(box.bottom + margin + below));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Takes a picture of a region of the page and writes it to ./images.
 *
 * @param {object} page the page
 * @param {string} name file name, without folder
 * @param {object} clip the region, in CSS pixels
 */
async function picture(page, name, clip) {
    await page.screenshot({ path: path.join(OUTPUT, name), clip });
    say(`images/${name}`);
}

/**
 * Turns pictures into pixels, in a page of their own; Node has no PNG decoder of its own.
 *
 * @param {object} helper an empty page
 * @param {string[]} pictures PNG files, base64-encoded
 * @returns {Promise.<{width: number, height: number, data: Uint8Array}[]>} the pixels of each, as RGBA
 */
async function decode(helper, pictures) {
    const frames = [];
    for (const png of pictures) {
        const { width, height, rgba } = await helper.evaluate(async (base64) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const { data } = context.getImageData(0, 0, image.width, image.height);
            let binary = '';
            for (let index = 0; index < data.length; index += 0x80_00) {
                binary += String.fromCodePoint(...data.subarray(index, index + 0x80_00));
            }
            return { width: image.width, height: image.height, rgba: btoa(binary) };
        }, png);
        frames.push({ width, height, data: new Uint8Array(Buffer.from(rgba, 'base64')) });
    }
    return frames;
}

/**
 * Writes frames as an animated GIF to ./images: one palette for all of them, so that colours do
 * not flicker, and a frame that repeats the one before it only makes that one stand longer.
 *
 * @param {object} helper an empty page
 * @param {string} name file name, without folder
 * @param {string[]} pictures the frames, as PNG files, base64-encoded; all of one size
 */
async function animation(helper, name, pictures) {
    const shown = [];
    for (const png of pictures) {
        if (shown.at(-1)?.png === png) {
            shown.at(-1).delay += FRAME_TIME;
        } else {
            shown.push({ png, delay: FRAME_TIME });
        }
    }
    shown[0].delay = Math.max(shown[0].delay, FIRST_FRAME_TIME);
    shown.at(-1).delay = LAST_FRAME_TIME;
    const frames = await decode(
        helper,
        shown.map(({ png }) => png),
    );
    const all = new Uint8Array(frames.reduce((sum, frame) => sum + frame.data.length, 0));
    let offset = 0;
    for (const frame of frames) {
        all.set(frame.data, offset);
        offset += frame.data.length;
    }
    const palette = quantize(all, 256);
    const gif = GIFEncoder();
    for (const [index, frame] of frames.entries()) {
        gif.writeFrame(applyPalette(frame.data, palette), frame.width, frame.height, {
            palette,
            delay: shown[index].delay,
        });
    }
    gif.finish();
    await writeFile(path.join(OUTPUT, name), gif.bytes());
    say(`images/${name} (${frames.length} frames)`);
}

/**
 * Puts two pictures one above the other, each with a label, and writes the result to ./images.
 *
 * @param {object} helper an empty page
 * @param {string} name file name, without folder
 * @param {{label: string, png: string}[]} parts the pictures, base64-encoded, from the top
 * @param {number} scale device pixels per CSS pixel of the pictures
 */
async function stacked(helper, name, parts, scale) {
    const png = await helper.evaluate(
        async (list, ratio) => {
            const LABEL = 28 * ratio;
            const images = await Promise.all(
                list.map(async ({ png: base64 }) => {
                    const image = new Image();
                    image.src = `data:image/png;base64,${base64}`;
                    await image.decode();
                    return image;
                }),
            );
            const width = Math.max(...images.map((image) => image.width));
            const height = images.reduce((sum, image) => sum + LABEL + image.height, 0);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            context.fillStyle = '#f3f3f3';
            context.fillRect(0, 0, width, height);
            context.fillStyle = '#1f1f1f';
            context.font = `600 ${15 * ratio}px "Segoe UI", Arial, sans-serif`;
            context.textBaseline = 'middle';
            let top = 0;
            for (const [index, image] of images.entries()) {
                context.fillText(list[index].label, 12 * ratio, top + LABEL / 2 + 2 * ratio);
                top += LABEL;
                context.drawImage(image, 0, top);
                top += image.height;
            }
            return canvas.toDataURL('image/png').split(',', 2)[1];
        },
        parts,
        scale,
    );
    await writeFile(path.join(OUTPUT, name), Buffer.from(png, 'base64'));
    say(`images/${name}`);
}

/**
 * Opens the demo page of the code editor and waits until the extension has set the editor up.
 *
 * @param {object} context browser, origin and problems
 * @param {Object.<string, string>} query what the page is told in its address
 * @param {number} scale device pixels per CSS pixel
 * @returns {Promise.<object>} the page
 */
async function editorPage(context, query, scale) {
    const page = await openPage(context.browser, context.origin, context.problems, scale);
    await page.goto(`${context.origin}/demo/editor.html?${new URLSearchParams(query)}`);
    await expect(
        page,
        'the colours of the extension in the editor',
        () =>
            Object.hasOwn(document.documentElement.dataset, 'sfmcUxToolsTheme') &&
            document.querySelector(
                '.CodeMirror .cm-sfmc-delimiter, .CodeMirror .cm-sfmc-ssjs-object',
            ),
    );
    return page;
}

/**
 * Where the mouse rests on a word of the editor: a few characters into it, in window coordinates.
 *
 * @param {object} page the page
 * @param {string} text text to find; its first occurrence
 * @returns {Promise.<{x: number, y: number}>} the middle of that character
 */
async function placeOf(page, text) {
    const place = await page.evaluate((wanted) => {
        const cm = globalThis.demoEditor;
        const index = cm.getValue().indexOf(wanted);
        if (index === -1) {
            return null;
        }
        const INTO = 4;
        const coords = cm.charCoords(cm.posFromIndex(index + INTO), 'window');
        return { x: (coords.left + coords.right) / 2, y: (coords.top + coords.bottom) / 2 };
    }, text);
    if (!place) {
        throw new Error(`the demo code has no "${text}"`);
    }
    return place;
}

/**
 * Puts the cursor of the editor at a place of its text.
 *
 * @param {object} page the page
 * @param {number} line line, counted from 0
 * @param {number} ch character of the line
 */
async function cursorAt(page, line, ch) {
    await page.evaluate(
        (atLine, atCh) => {
            globalThis.demoEditor.focus();
            globalThis.demoEditor.setCursor({ line: atLine, ch: atCh });
        },
        line,
        ch,
    );
}

/**
 * Collects the frames of an animation: pictures of one region of a page.
 *
 * @param {object} page the page
 * @param {object} clip the region, in CSS pixels
 * @returns {{frames: string[], frame: () => Promise.<void>}} the frames so far, as PNG files, base64-encoded, and what takes the next one
 */
function recorder(page, clip) {
    const frames = [];
    return {
        frames,
        frame: async () => {
            frames.push(await page.screenshot({ clip, encoding: 'base64' }));
        },
    };
}

/**
 * Colours and theme: the same code in the light and in the dark theme.
 *
 * @param {object} context browser, origin and problems
 */
async function colours(context) {
    for (const [theme, name] of [
        ['light', 'colours.png'],
        ['dark', 'theme-dark.png'],
    ]) {
        const page = await editorPage(context, { editorTheme: theme }, SHARP);
        await expect(
            page,
            `the ${theme} theme with colours for AMPscript and SSJS`,
            (wanted) =>
                document.documentElement.dataset.sfmcUxToolsTheme === wanted &&
                document.querySelector('.CodeMirror .cm-sfmc-function') &&
                document.querySelector('.CodeMirror .cm-sfmc-ssjs-object'),
            theme,
        );
        await picture(page, name, await regionOf(page, ['.CodeMirror']));
        await page.close();
    }
}

/**
 * Suggestions while typing, as an animation: a name is typed, the list narrows, one is picked.
 *
 * @param {object} context browser, origin, problems and the helper page
 */
async function completion(context) {
    const page = await editorPage(context, { sample: 'typing' }, PLAIN);
    await cursorAt(page, 2, 0);
    // room above for the parameter help that follows the pick
    const clip = await regionOf(page, ['.CodeMirror'], { above: 100, below: 150 });
    const { frames, frame } = recorder(page, clip);
    await frame();
    for (const character of 'SET @lastName = Look') {
        await page.keyboard.type(character);
        await pause(250);
        await frame();
    }
    await expect(
        page,
        'the list of suggestions',
        () => document.querySelectorAll('.CodeMirror-hints li').length > 1,
    );
    await frame();
    await frame();
    await page.keyboard.press('Enter');
    await expect(page, 'the picked suggestion', () =>
        globalThis.demoEditor.getLine(2).endsWith('Lookup('),
    );
    await pause(300);
    await frame();
    await animation(context.helper, 'completion.gif', frames);
    await page.close();
}

/**
 * Parameter help, as an animation: the box follows the input that is being typed.
 *
 * @param {object} context browser, origin, problems and the helper page
 */
async function signature(context) {
    const page = await editorPage(context, { sample: 'typing' }, PLAIN);
    await cursorAt(page, 2, 0);
    // the box follows the cursor to the right, past the end of the editor
    const clip = await regionOf(page, ['.CodeMirror'], { above: 110, below: 40, right: 100 });
    const { frames, frame } = recorder(page, clip);
    // typed without the keyboard, so that no list of suggestions comes in the way
    const typed = async (text) => {
        for (const character of text) {
            await page.evaluate(
                (added) => globalThis.demoEditor.replaceSelection(added),
                character,
            );
            await pause(200);
            await frame();
        }
    };
    await frame();
    await typed('SET @reminder = DateAdd(');
    await expect(
        page,
        'the parameter help',
        () => document.querySelector('.sfmc-signature strong')?.textContent,
    );
    // the call stays open, so that the last frame shows the box on the last input
    await typed('Now(), 3, "D"');
    await expect(page, 'the parameter help on the last input', () =>
        document.querySelector('.sfmc-signature strong')?.textContent.startsWith('unitToAdd'),
    );
    await pause(300);
    await frame();
    await animation(context.helper, 'signature.gif', frames);
    await page.close();
}

/**
 * Explanations, as an animation: the mouse comes to rest on a function and its box opens.
 *
 * @param {object} context browser, origin, problems and the helper page
 */
async function hover(context) {
    const page = await editorPage(context, { sample: 'typing', pointer: 'on' }, PLAIN);
    const target = await placeOf(page, 'AttributeValue');
    const clip = await regionOf(page, ['.CodeMirror'], { below: 270 });
    const { frames, frame } = recorder(page, clip);
    const start = { x: target.x + 260, y: target.y + 70 };
    const steps = 10;
    await page.mouse.move(start.x, start.y);
    await frame();
    for (let step = 1; step <= steps; step++) {
        await page.mouse.move(
            start.x + ((target.x - start.x) * step) / steps,
            start.y + ((target.y - start.y) * step) / steps,
        );
        await frame();
    }
    await expect(page, 'the explanation box', () =>
        document.querySelector('.sfmc-hover')?.textContent.includes('AttributeValue'),
    );
    await pause(300);
    await frame();
    await animation(context.helper, 'hover.gif', frames);
    await page.close();
}

/**
 * Underlined mistakes: the mouse rests on one, and the box says what is wrong.
 *
 * @param {object} context browser, origin and problems
 */
async function diagnostics(context) {
    const page = await editorPage(context, { sample: 'mistakes', pointer: 'on' }, SHARP);
    await expect(page, 'an underlined mistake', () =>
        document.querySelector('.CodeMirror .sfmc-diagnostic-error'),
    );
    const place = await placeOf(page, 'ProperCse');
    await page.mouse.move(place.x, place.y);
    await expect(page, 'the box that says what is wrong', () =>
        document.querySelector('.sfmc-hover .sfmc-problem')?.textContent.includes('ProperCse'),
    );
    await pause(300);
    await picture(page, 'diagnostics.png', await regionOf(page, ['.CodeMirror', '.sfmc-hover']));
    await page.close();
}

/**
 * One-click fixes: Ctrl+. on a mistake opens its fixes.
 *
 * @param {object} context browser, origin and problems
 */
async function quickFix(context) {
    const page = await editorPage(context, { sample: 'fix' }, SHARP);
    await expect(page, 'an underlined mistake', () =>
        document.querySelector('.CodeMirror .sfmc-diagnostic'),
    );
    await cursorAt(page, 1, 4);
    await page.keyboard.down('Control');
    await page.keyboard.press('Period');
    await page.keyboard.up('Control');
    await expect(page, 'the button of a fix', () =>
        document.querySelector('.sfmc-hover .sfmc-fix'),
    );
    await pause(300);
    await picture(page, 'quick-fix.png', await regionOf(page, ['.CodeMirror', '.sfmc-hover']));
    await page.close();
}

/**
 * Formatting: the same code before and after a click on the button.
 *
 * @param {object} context browser, origin, problems and the helper page
 */
async function format(context) {
    const page = await editorPage(context, { sample: 'format' }, SHARP);
    await expect(page, 'the format button', () => document.querySelector('.sfmc-format-button'));
    const before = await page.screenshot({
        clip: await regionOf(page, ['.CodeMirror']),
        encoding: 'base64',
    });
    const text = await page.evaluate(() => globalThis.demoEditor.getValue());
    await page.click('.sfmc-format-button');
    await expect(
        page,
        'the formatted code',
        (old) => globalThis.demoEditor.getValue() !== old,
        text,
    );
    // without the blinking cursor the button leaves behind
    await page.evaluate(() => document.activeElement?.blur());
    await pause(300);
    const after = await page.screenshot({
        clip: await regionOf(page, ['.CodeMirror']),
        encoding: 'base64',
    });
    await stacked(
        context.helper,
        'format.png',
        [
            { label: 'Before', png: before },
            { label: 'After a click on { }', png: after },
        ],
        SHARP,
    );
    await page.close();
}

const PANEL = 'dialog';
const FORM = `${PANEL} form`;

/**
 * Opens the demo page of the panel "Transactional Messages" on the list of a kind of message,
 * once all its details are read.
 *
 * @param {object} context browser, origin and problems
 * @param {string} kind sms or push
 * @returns {Promise.<object>} the page
 */
async function panelPage(context, kind) {
    const page = await openPage(context.browser, context.origin, context.problems, SHARP);
    await page.goto(`${context.origin}/demo/panel.html`);
    await expect(page, 'the menu entry Transactional Messages', () =>
        document.querySelector('[data-sfmc-ux-tools-transactional] a'),
    );
    await page.click('[data-sfmc-ux-tools-transactional] a');
    if (kind !== 'sms') {
        await expect(page, 'the tabs of the panel', () =>
            document.querySelector('dialog [role="tab"]'),
        );
        await page.click(`${PANEL} [role="tab"][data-kind="${kind}"]`);
    }
    await expect(page, `the list of ${kind} messages with all their details`, () => {
        const rows = [...document.querySelectorAll('dialog tbody tr')];
        return (
            rows.length > 0 &&
            rows.every((row) => [...row.cells].every((cell) => cell.textContent.trim()))
        );
    });
    return page;
}

/**
 * Clicks a button of the panel by its text.
 *
 * @param {object} page the page
 * @param {string} text what the button says
 */
async function press(page, text) {
    const found = await page.evaluate((wanted) => {
        const button = [...document.querySelectorAll('dialog button')].find(
            (item) => item.textContent.trim() === wanted,
        );
        button?.click();
        return Boolean(button);
    }, text);
    if (!found) {
        throw new Error(`not on screen: the button "${text}"`);
    }
}

/**
 * Opens the list below a field of a form and waits for its entries.
 *
 * @param {object} page the page
 * @param {string} name name of the field
 * @returns {Promise.<string>} the selector of the field with its list
 */
async function openList(page, name) {
    const field = `${FORM} [name="${name}"]`;
    // the field and the list that opens below it in the middle of the panel
    await page.$eval(field, (element) =>
        element.closest('.sfmc-ux-tools-transactional-field').scrollIntoView({ block: 'center' }),
    );
    await page.click(field);
    await expect(
        page,
        `the list below the field ${name}`,
        (selector) =>
            document
                .querySelector(selector)
                ?.closest('.sfmc-ux-tools-transactional-field')
                ?.querySelector('[role="listbox"]')?.children.length > 0,
        field,
    );
    await pause(200);
    return `.sfmc-ux-tools-transactional-field:has([name="${name}"])`;
}

/**
 * The list of SMS messages, with the counts per status.
 *
 * @param {object} context browser, origin and problems
 */
async function panelList(context) {
    const page = await panelPage(context, 'sms');
    await expect(page, 'the counts per status', () =>
        [...document.querySelectorAll('dialog select option')].some((option) =>
            option.textContent.startsWith('All ('),
        ),
    );
    await picture(page, 'panel-list.png', await regionOf(page, [PANEL], { margin: 0 }));
    await page.close();
}

/**
 * The form of an SMS: the code editor with the list for personalization, and the link boxes
 * that the account has switched off.
 *
 * @param {object} context browser, origin and problems
 */
async function smsForm(context) {
    const page = await panelPage(context, 'sms');
    await page.click(`${PANEL} tbody tr`);
    await expect(page, 'the details of a message', () => document.querySelector('dialog dl'));
    await press(page, 'Edit');
    await expect(page, 'the code editor of the message', () =>
        document.querySelector('dialog form .CodeMirror .cm-sfmc-personalization'),
    );
    // the line of the field, the editor below it and the helpers below that
    const message = [
        '.sfmc-ux-tools-transactional-field:has([name="content.message"])',
        `${FORM} .sfmc-ux-tools-transactional-code`,
        `${FORM} .sfmc-ux-tools-transactional-tools`,
    ];
    await page.$eval(message[0], (element) => element.scrollIntoView({ block: 'center' }));
    await page.click(`${FORM} .sfmc-ux-tools-transactional-person`);
    // the list that opened, marked for the picture
    await expect(page, 'the list for personalization', () => {
        const list = [...document.querySelectorAll('dialog form [role="listbox"]')].find(
            (item) => item.checkVisibility() && item.textContent.includes('FirstName'),
        );
        list?.setAttribute('data-capture', 'personalization');
        return list;
    });
    await pause(200);
    await picture(
        page,
        'sms-editor.png',
        await regionOf(page, [...message, '[data-capture="personalization"]'], {
            margin: LIST_MARGIN,
            within: PANEL,
        }),
    );
    await page.keyboard.press('Escape');
    const links = `.sfmc-ux-tools-transactional-field:has([name="options.urlShortenerOptions.isLinkShorteningEnabled"])`;
    const note = `${FORM} .sfmc-ux-tools-transactional-account-note`;
    await expect(
        page,
        'the link boxes that cannot be ticked',
        (selector) =>
            document.querySelector(
                'dialog form [name="options.urlShortenerOptions.isLinkShorteningEnabled"]',
            )?.disabled && document.querySelector(selector),
        note,
    );
    await page.$eval(links, (element) => element.scrollIntoView({ block: 'center' }));
    await pause(200);
    await picture(
        page,
        'sms-links.png',
        await regionOf(page, [links, note], { margin: LIST_MARGIN, within: PANEL }),
    );
    await page.close();
}

/**
 * The form of a push message: the list of apps with one that cannot push, and the list of
 * contents with their folders.
 *
 * @param {object} context browser, origin and problems
 */
async function pushForm(context) {
    const page = await panelPage(context, 'push');
    await page.click(`${PANEL} .sfmc-ux-tools-transactional-new`);
    await expect(page, 'the form of a new push message', () =>
        document.querySelector('dialog form [name="applicationId"]'),
    );
    const app = await openList(page, 'applicationId');
    await expect(page, 'an app without push credentials', () =>
        document.querySelector('dialog form')?.textContent.includes('no push credentials set up'),
    );
    await picture(
        page,
        'push-app.png',
        await regionOf(page, [app, `${app} [role="listbox"]`], {
            margin: LIST_MARGIN,
            within: PANEL,
        }),
    );
    await page.keyboard.press('Escape');
    const content = await openList(page, 'content.customerKey');
    await expect(page, 'the folders of the contents', () =>
        document.querySelector('dialog form')?.textContent.includes('Demo Push Messages'),
    );
    await picture(
        page,
        'push-content.png',
        await regionOf(page, [content, `${content} [role="listbox"]`], {
            margin: LIST_MARGIN,
            within: PANEL,
        }),
    );
    await page.close();
}

/**
 * The details of a push message: its app and content by name, what the content says, and its
 * custom keys.
 *
 * @param {object} context browser, origin and problems
 */
async function pushDetails(context) {
    const page = await panelPage(context, 'push');
    await page.click(`${PANEL} tbody tr`);
    await expect(page, 'the details with the texts of the content and the custom keys', () => {
        const text = document.querySelector('dialog dl')?.textContent ?? '';
        return text.includes('Welcome to Demo App') && text.includes('promo_code');
    });
    await pause(200);
    await picture(page, 'push-details.png', await regionOf(page, [PANEL], { margin: 0 }));
    await page.close();
}

/**
 * The options page, as the popup of the extension shows it.
 *
 * @param {object} context browser, origin and problems
 */
async function options(context) {
    const page = await openPage(context.browser, context.origin, context.problems, SHARP);
    await page.setViewport({ width: 800, height: VIEWPORT.height, deviceScaleFactor: SHARP });
    await page.evaluateOnNewDocument(
        await readFile(path.join(root, 'demo', 'chrome-stub.js'), 'utf8'),
    );
    await page.goto(`${context.origin}/dist/extension/options.html`);
    await expect(page, 'the options with their defaults ticked', () =>
        document.querySelector('input[name="editorTheme"]:checked'),
    );
    await picture(page, 'options.png', await regionOf(page, ['main', 'footer']));
    await page.close();
}

const CAPTURES = {
    colours,
    completion,
    signature,
    hover,
    diagnostics,
    quickFix,
    format,
    panelList,
    smsForm,
    pushForm,
    pushDetails,
    options,
};

/**
 * Takes all pictures, or those named on the command line.
 */
async function main() {
    const wanted = process.argv.slice(2);
    const unknown = wanted.filter((name) => !Object.hasOwn(CAPTURES, name));
    if (unknown.length > 0) {
        throw new Error(
            `unknown: ${unknown.join(', ')}; known: ${Object.keys(CAPTURES).join(', ')}`,
        );
    }
    await mkdir(OUTPUT, { recursive: true });
    const server = await serve();
    const browser = await puppeteer.launch({
        executablePath: BROWSER,
        headless: true,
        args: ['--lang=en-US', '--force-color-profile=srgb', '--hide-scrollbars'],
    });
    const problems = [];
    try {
        const helper = await openPage(browser, server.origin, problems, PLAIN);
        const context = { browser, origin: server.origin, problems, helper };
        for (const [name, capture] of Object.entries(CAPTURES)) {
            if (wanted.length === 0 || wanted.includes(name)) {
                await capture(context);
            }
        }
    } finally {
        await browser.close();
        server.close();
    }
    if (problems.length > 0) {
        throw new Error(`the demo pages had problems:\n${problems.join('\n')}`);
    }
}

try {
    await main();
} catch (ex) {
    process.stderr.write(`screenshots failed: ${ex.message}\n`);
    process.exitCode = 1;
}
