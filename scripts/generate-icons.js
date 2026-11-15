/*
 * Draws the extension icon (a checked checkbox on a blue tile) and writes it as PNG
 * in the sizes Chrome needs. Run with `npm run icons` after changing the drawing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const outputDirectory = fileURLToPath(new URL('../src/icons', import.meta.url));
const BLUE = [1, 118, 211];
const WHITE = [255, 255, 255];
const SAMPLES = 4;
const STROKE_HALF_WIDTH = 0.05;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Tests whether a point lies inside a rounded square.
 *
 * @param {number} x point x
 * @param {number} y point y
 * @param {number} min lower bound of the square on both axes
 * @param {number} max upper bound of the square on both axes
 * @param {number} radius corner radius
 * @returns {boolean} true if inside
 */
function isInRoundedSquare(x, y, min, max, radius) {
    const dx = Math.max(min + radius - x, 0, x - (max - radius));
    const dy = Math.max(min + radius - y, 0, y - (max - radius));
    return dx * dx + dy * dy <= radius * radius;
}

/**
 * Tests whether a point lies on the stroke of a line segment.
 *
 * @param {number} x point x
 * @param {number} y point y
 * @param {number[]} segment x1, y1, x2, y2
 * @returns {boolean} true if on the stroke
 */
function isOnSegment(x, y, [x1, y1, x2, y2]) {
    const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    const projection = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1))) <= STROKE_HALF_WIDTH;
}

/**
 * Colour of the icon at a point of the unit square.
 *
 * @param {number} x 0..1
 * @param {number} y 0..1
 * @returns {number[] | undefined} rgb, or undefined for transparent
 */
function colourAt(x, y) {
    if (!isInRoundedSquare(x, y, 0, 1, 0.2)) {
        return;
    }
    if (!isInRoundedSquare(x, y, 0.2, 0.8, 0.1)) {
        return BLUE;
    }
    const isCheckMark =
        isOnSegment(x, y, [0.33, 0.52, 0.45, 0.64]) || isOnSegment(x, y, [0.45, 0.64, 0.68, 0.37]);
    return isCheckMark ? BLUE : WHITE;
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
