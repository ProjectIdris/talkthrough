// Draws the app icon (a speech bubble holding a circled dot: it talks and it points) and writes
// build/icon.png (512 px) and build/icon.ico (16 to 256 px). No packages: shapes are signed
// distance functions, edges are anti-aliased by supersampling, PNG and ICO are written by hand.
// Run `node scripts/make-icon.mjs` after changing the design; the output files are committed.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const INDIGO = [0x3a, 0x2f, 0xc9];
const TEAL = [0x10, 0xb3, 0xa4];
const WHITE = [255, 255, 255];

const roundedBox = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
/** Distance to a triangle (negative inside). */
function triangle(x, y, a, b, c) {
  const edge = (p, q) => {
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const t = Math.max(0, Math.min(1, ((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey)));
    return Math.hypot(x - p[0] - ex * t, y - p[1] - ey * t);
  };
  const d = Math.min(edge(a, b), edge(b, c), edge(c, a));
  const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const inside = (s(a, b) >= 0 && s(b, c) >= 0 && s(c, a) >= 0) || (s(a, b) <= 0 && s(b, c) <= 0 && s(c, a) <= 0);
  return inside ? -d : d;
}

/** The colour (RGBA, 0..1 coordinates) at one point of the design. */
function sample(x, y) {
  if (roundedBox(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) > 0) return [0, 0, 0, 0];
  const base = mix(INDIGO, TEAL, Math.min(1, Math.max(0, (x + y) / 2 * 1.15 - 0.05)));
  const bubble = Math.min(roundedBox(x, y, 0.5, 0.44, 0.31, 0.215, 0.13), triangle(x, y, [0.3, 0.6], [0.25, 0.8], [0.5, 0.64]));
  if (bubble > 0) return [...base, 1];
  const ring = Math.abs(circle(x, y, 0.5, 0.44, 0.115)) - 0.03;
  const dot = circle(x, y, 0.5, 0.44, 0.04);
  return Math.min(ring, dot) <= 0 ? [...mix(INDIGO, TEAL, 0.25), 1] : [...WHITE, 1];
}

function render(size) {
  const grid = size <= 64 ? 6 : 3;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < grid; sy++) {
        for (let sx = 0; sx < grid; sx++) {
          const c = sample((px + (sx + 0.5) / grid) / size, (py + (sy + 0.5) / grid) / size);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      }
      const n = grid * grid;
      const i = (py * size + px) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(images) {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    head[e] = size === 256 ? 0 : size;
    head[e + 1] = size === 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png(512, render(512)));
writeFileSync('build/icon.ico', ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: png(size, render(size)) }))));
console.log('wrote build/icon.png and build/icon.ico');
