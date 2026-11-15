/*
 * Draws the extension icon (an orange magnifying glass with white code brackets in its lens)
 * and writes it as PNG in the sizes Chrome needs. Run with `npm run icons` after changing the drawing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const outputDirectory = fileURLToPath(new URL('../src/icons', import.meta.url));
const ORANGE = [221, 122, 1];
const PEACH = [255, 186, 144];
const WHITE = [255, 255, 255];
const SAMPLES = 4;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// all coordinates are fractions of the icon's edge length
const LENS = { x: 0.484, y: 0.469, rim: 0.344, glass: 0.281 };
const HANDLE = [[0.7, 0.7, 0.865, 0.865]];
const HANDLE_HALF_WIDTH = 0.075;
const BRACKETS = [
    [0.406, 0.359, 0.3125, 0.469],
    [0.3125, 0.469, 0.406, 0.578],
    [0.5625, 0.359, 0.656, 0.469],
    [0.656, 0.469, 0.5625, 0.578],
];
const BRACKET_HALF_WIDTH = 0.032;

/**
 * Tests whether a point lies on the round-capped stroke of one of the line segments.
 *
 * @param {number} x point x
 * @param {number} y point y
 * @param {number[][]} segments list of x1, y1, x2, y2
 * @param {number} halfWidth half of the stroke width
 * @returns {boolean} true if on a stroke
 */
function isOnStroke(x, y, segments, halfWidth) {
    return segments.some(([x1, y1, x2, y2]) => {
        const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        const projection = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared;
        const t = Math.max(0, Math.min(1, projection));
        return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1))) <= halfWidth;
    });
}

/**
 * Colour of the icon at a point of the unit square.
 *
 * @param {number} x 0..1
 * @param {number} y 0..1
 * @returns {number[] | undefined} rgb, or undefined for transparent
 */
function colourAt(x, y) {
    const distance = Math.hypot(x - LENS.x, y - LENS.y);
    if (distance <= LENS.glass) {
        return isOnStroke(x, y, BRACKETS, BRACKET_HALF_WIDTH) ? WHITE : PEACH;
    }
    if (distance <= LENS.rim || isOnStroke(x, y, HANDLE, HANDLE_HALF_WIDTH)) {
        return ORANGE;
    }
    return;
}

/**
 * Builds one PNG chunk.
 *
 * @param {string} type four letter chunk type
 * @param {Buffer} data chunk payload
 * @returns {Buffer} length, type, payload and checksum
 */
function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, checksum]);
}

/**
 * Renders the icon as an RGBA PNG.
 *
 * @param {number} size edge length in pixels
 * @returns {Buffer} png file content
 */
function renderPng(size) {
    const rowLength = size * 4 + 1;
    const raw = Buffer.alloc(rowLength * size);
    for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
            const sum = [0, 0, 0];
            let covered = 0;
            for (let sample = 0; sample < SAMPLES ** 2; sample++) {
                const sx = (px + ((sample % SAMPLES) + 0.5) / SAMPLES) / size;
                const sy = (py + (Math.floor(sample / SAMPLES) + 0.5) / SAMPLES) / size;
                const colour = colourAt(sx, sy);
                if (!colour) {
                    continue;
                }

                covered++;
                for (let index = 0; index < 3; index++) {
                    sum[index] += colour[index];
                }
            }
            const offset = py * rowLength + 1 + px * 4;
            for (let index = 0; index < 3; index++) {
                raw[offset + index] = covered ? Math.round(sum[index] / covered) : 0;
            }
            raw[offset + 3] = Math.round((covered / SAMPLES ** 2) * 255);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
        Buffer.from(PNG_SIGNATURE),
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

mkdirSync(outputDirectory, { recursive: true });
for (const size of [16, 48, 128]) {
    writeFileSync(path.join(outputDirectory, `icon${size}.png`), renderPng(size));
}
