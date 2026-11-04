import test from 'node:test';
import assert from 'node:assert/strict';
import { Snapper } from '../src/overlay/snap.ts';
import type { Mark } from '../src/scene/index.ts';

// Synthetic pages, 480 x 270 cells for 1000 x 1000 units, softened a little as a shrunk screenshot is.
const COLS = 480, ROWS = 270;
const kx = COLS / 1000, ky = ROWS / 1000;

class Page {
  g = new Float32Array(COLS * ROWS).fill(250);
  fill(x0: number, y0: number, x1: number, y1: number, v: number) {
    for (let y = Math.max(0, y0); y < Math.min(ROWS, y1); y++) for (let x = Math.max(0, x0); x < Math.min(COLS, x1); x++) this.g[y * COLS + x] = Math.min(this.g[y * COLS + x] as number, v);
  }
  /** Lines of letters 8 cells tall at a pitch of 13, with word gaps; the last line stops at `lastTo`. */
  text(x0: number, y0: number, x1: number, lines: number, lastTo = x1) {
    for (let l = 0; l < lines; l++) {
      const end = l === lines - 1 ? lastTo : x1;
      for (let x = x0; x < end; x++) if (Math.floor((x - x0) / 6) % 5 !== 4) this.fill(x, y0 + l * 13, x + 1, y0 + l * 13 + 8, 40);
    }
  }
  /** A ruled table: a rule every `pitch` cells from y0, a short word in each row. */
  table(x0: number, x1: number, y0: number, rows: number, pitch: number) {
    for (let r = 0; r <= rows; r++) this.fill(x0, y0 + r * pitch, x1, y0 + r * pitch + 1, 90);
    for (let r = 0; r < rows; r++) this.text(x0 + 6, y0 + r * pitch + 6, x0 + 60, 1);
  }
  snapper(): Snapper {
    const out = new Float32Array(this.g.length);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < COLS && yy < ROWS) { s += this.g[yy * COLS + xx] as number; n++; }
      }
      out[y * COLS + x] = s / n;
    }
    return new Snapper(out, COLS, ROWS);
  }
}

const box = (x0: number, y0: number, x1: number, y1: number): Extract<Mark, { op: 'box' }> => ({ op: 'box', id: 'b', x: x0 / kx, y: y0 / ky, w: (x1 - x0) / kx, h: (y1 - y0) / ky, color: 'blue' });
const cellsOfBox = (m: Mark): { y0: number; y1: number } => { const b = m as Extract<Mark, { op: 'box' }>; return { y0: b.y * ky, y1: (b.y + b.h) * ky }; };

test('a box round the first lines of a paragraph, its bottom edge through a line, is made the whole paragraph', () => {
  const page = new Page();
  page.text(60, 40, 300, 6, 200); // lines at 40, 53, 66, 79, 92, 105; ends at 113
  page.text(60, 140, 300, 4); // the next paragraph, a gap of 27 below
  const s = page.snapper();
  // Rows 38..82: the first three lines whole and the fourth cut through its middle.
  const out = s.snapMark(box(58, 38, 302, 83));
  const { y0, y1 } = cellsOfBox(out);
  assert.ok(y1 >= 113 && y1 <= 121, `bottom at the end of the sixth line, not the next paragraph: ${y1.toFixed(1)}`);
  assert.ok(y0 <= 40 && y0 >= 34, `top stays on the first line: ${y0.toFixed(1)}`);
});

test('a box that holds one line of a long paragraph and cuts it is made to take that line, not the paragraph', () => {
  const page = new Page();
  page.text(60, 40, 300, 8);
  const s = page.snapper();
  const out = s.snapMark(box(58, 36, 302, 44)); // the first line, its bottom cut
  const { y1 } = cellsOfBox(out);
  assert.ok(y1 < 60, `the line is completed and no more: ${y1.toFixed(1)}`);
});

test('a box with clean edges in the gaps between lines is left as it is', () => {
  const page = new Page();
  page.text(60, 40, 300, 6);
  const s = page.snapper();
  const m = box(58, 36, 302, 87); // lines 1 to 4, both edges in gaps
  const out = s.snapMark(m);
  assert.ok(Math.abs(cellsOfBox(out).y1 - 87) < 2, `the bottom stays, got ${cellsOfBox(out).y0.toFixed(1)}..${cellsOfBox(out).y1.toFixed(1)}`);
});

test('a box round the first rows of a ruled table is made the whole table, to the edge of the screen when it runs off', () => {
  const page = new Page();
  page.table(60, 340, 60, 10, 20); // rules at 60, 80, ... 260 (the last at 260, the screen ends at 270)
  const s = page.snapper();
  const out = s.snapMark(box(58, 58, 342, 150)); // rows 1 to 4 and a half
  const { y0, y1 } = cellsOfBox(out);
  assert.ok(y1 >= 258 && y1 <= 269, `bottom at the last rule: ${y1.toFixed(1)}`);
  assert.ok(y0 >= 54 && y0 <= 62, `top stays at the first rule: ${y0.toFixed(1)}`);
});

test('a box round two rows of a long table is not taken for the table', () => {
  const page = new Page();
  page.table(60, 340, 40, 10, 20);
  const s = page.snapper();
  const out = s.snapMark(box(58, 58, 342, 102)); // rules at 60, 80, 100: two rows
  assert.ok(cellsOfBox(out).y1 < 130, `the two rows stay two rows: ${cellsOfBox(out).y1.toFixed(1)}`);
});

test('a box on a small bordered table is left on it', () => {
  const page = new Page();
  page.table(300, 440, 100, 2, 22);
  const s = page.snapper();
  const out = s.snapMark(box(298, 98, 442, 146));
  assert.ok(Math.abs(cellsOfBox(out).y1 - 146) < 7 && Math.abs(cellsOfBox(out).y0 - 98) < 3, `got ${cellsOfBox(out).y0.toFixed(1)}..${cellsOfBox(out).y1.toFixed(1)}`);
});

test('an underline stops at the end of its line of text and does not run on into the picture beside it', () => {
  const page = new Page();
  page.text(60, 100, 280, 1);
  page.fill(300, 80, 440, 160, 80); // a picture past a gutter of 20 cells
  const s = page.snapper();
  const wide: Mark = { op: 'underline', id: 'u', x: 120 / kx, y: 109 / ky, w: 300 / kx, color: 'teal' };
  const out = s.snapMark(wide) as Extract<Mark, { op: 'underline' }>;
  assert.ok((out.x + out.w) * kx <= 284, `ends with the text, not at ${((out.x + out.w) * kx).toFixed(0)} cells`);
  assert.ok(out.x * kx >= 112 && out.x * kx <= 128, 'the start stays about where it was');
  const inside: Mark = { op: 'underline', id: 'u2', x: 120 / kx, y: 109 / ky, w: 100 / kx, color: 'teal' };
  const same = s.snapMark(inside) as Extract<Mark, { op: 'underline' }>;
  assert.ok(Math.abs((same.x + same.w) * kx - 220) < 3, 'an underline inside its line keeps its length');
});
