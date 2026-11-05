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
      for (let x = x0; x < end; x++) if ((Math.floor((x - x0) / 6) + l * 2) % 5 !== 4) this.fill(x, y0 + l * 13, x + 1, y0 + l * 13 + 8, 40);
    }
  }
  /**
   * Body text set tight, as on a real page once it is shrunk: every line is a solid band six cells thick (lines at a pitch of 11, from y0) with the
   * tops of letters sparsely above it and their feet and blur thickly below, so each line reads as a thick rule to anything that looks only at rows.
   */
  dense(x0: number, y0: number, x1: number, lines: number, lastTo = x1) {
    for (let l = 0; l < lines; l++) {
      const y = y0 + l * 11, end = l === lines - 1 ? lastTo : x1;
      this.fill(x0, y, end, y + 2, 40);
      for (let x = x0; x < end; x++) {
        if ((x - x0) % 12 === 0) this.fill(x, y - 2, x + 1, y, 40);
        if ((x - x0) % 4 === 0) this.fill(x, y + 2, x + 1, y + 4, 40);
      }
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
  // Rows 38..96: the first four lines whole and the fifth cut through its middle: five of the six lines.
  const out = s.snapMark(box(58, 38, 302, 96));
  const { y0, y1 } = cellsOfBox(out);
  assert.ok(y1 >= 113 && y1 <= 121, `bottom at the end of the sixth line, not the next paragraph: ${y1.toFixed(1)}`);
  assert.ok(y0 <= 37 && y0 >= 30, `air above the first line (at 40): ${y0.toFixed(1)}`);
  const b = out as Extract<Mark, { op: 'box' }>;
  assert.ok(b.x * kx <= 57 && (b.x + b.w) * kx >= 303 && (b.x + b.w) * kx <= 310, `air on both sides of the lines (60 to 300): ${(b.x * kx).toFixed(1)} to ${((b.x + b.w) * kx).toFixed(1)}`);
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
  assert.ok((same.x + same.w) * kx >= 218 && (same.x + same.w) * kx <= 244, 'an underline inside its line stays on it, ending at the end of the word it ended in');
});

test('a box round a framed figure with its caption is not taken for a table, even with a table close below it', () => {
  const page = new Page();
  page.fill(60, 60, 340, 61, 90); // the figure's top border
  page.fill(60, 140, 340, 141, 90); // under the picture
  page.fill(60, 168, 340, 169, 90); // under the caption
  page.text(66, 148, 200, 1);
  page.table(60, 340, 230, 2, 24); // a small table below: rules at 230, 254, 278
  const s = page.snapper();
  const out = s.snapMark(box(58, 58, 342, 170));
  assert.ok(cellsOfBox(out).y1 < 180, `the figure's box stays on the figure: ${cellsOfBox(out).y1.toFixed(1)}`);
});

test('an underline starts and ends at the edges of words of its line, not in the middle of one', () => {
  const page = new Page();
  page.text(60, 100, 280, 1); // words 60-84, 90-114, 120-144, 150-174 ... with 6 blank cells between
  const s = page.snapper();
  // From the middle of the second word (94) to the middle of the fourth (160): 90 to 174 are the words, and the ends come to their edges.
  const m: Mark = { op: 'underline', id: 'w', x: 94 / kx, y: 109 / ky, w: (160 - 94) / kx, color: 'teal' };
  const out = s.snapMark(m) as Extract<Mark, { op: 'underline' }>;
  const a = out.x * kx, b = (out.x + out.w) * kx;
  assert.ok(Math.abs(a - 90) <= 3, `starts at the start of the word (90), got ${a.toFixed(1)}`);
  assert.ok(Math.abs(b - 174) <= 3, `ends at the end of the word (174), got ${b.toFixed(1)}`);
});

test('a box on one sentence (four of six lines, its bottom through the fourth) keeps its own lines and does not grow to the whole paragraph', () => {
  const page = new Page();
  page.text(60, 40, 300, 6, 200);
  const s = page.snapper();
  const out = s.snapMark(box(58, 38, 302, 83)); // lines 1 to 3 whole and line 4 cut through its middle
  const { y1 } = cellsOfBox(out);
  assert.ok(y1 >= 86 && y1 <= 93, `completed to the end of the fourth line (87), no further: ${y1.toFixed(1)}`);
  assert.ok((out as Extract<Mark, { op: 'box' }>).x * kx <= 57, 'and it has air at the left of its lines');
});

test('a box that holds about half a paragraph and cuts a line at each edge is not left cutting them: its lines are completed, not the whole paragraph', () => {
  const page = new Page();
  page.text(60, 40, 300, 6); // lines at 40, 53, 66, 79, 92, 105 (each 8 tall)
  const s = page.snapper();
  const out = s.snapMark(box(58, 56, 302, 95)); // line 2 cut near its middle at the top, line 5 near its middle at the bottom
  const { y0, y1 } = cellsOfBox(out);
  const clear = (y: number): boolean => ![40, 53, 66, 79, 92, 105].some((t) => y > t + 2 && y < t + 6);
  assert.ok(clear(y0) && clear(y1), `neither edge runs through a line: ${y0.toFixed(1)} to ${y1.toFixed(1)}`);
  assert.ok(y1 < 110, `not the whole paragraph: ${y1.toFixed(1)}`);
});

test('a box over four or more lines of dense body text is not taken for a table: it becomes its paragraph and does not run on to a border beside the text', () => {
  const page = new Page();
  page.dense(60, 40, 300, 6, 200); // lines at 40, 51, 62, 73, 84, 95 (the last one ends at 200)
  page.fill(311, 20, 313, 200, 60); // the border of a box beside the text
  page.dense(60, 150, 300, 4); // the next paragraph
  const s = page.snapper();
  const out = s.snapMark(box(58, 38, 302, 86)); // lines 1 to 4 whole and the fifth cut through its middle: five of the six lines
  const b = out as Extract<Mark, { op: 'box' }>;
  const { y0, y1 } = cellsOfBox(out);
  assert.ok((b.x + b.w) * kx <= 309, `its right edge stays in the air beside the text, not on the border at 311: ${((b.x + b.w) * kx).toFixed(1)}`);
  assert.ok(y1 >= 99 && y1 <= 112, `the box takes the sixth line too (it ends at 99), not the next paragraph: ${y1.toFixed(1)}`);
  assert.ok(y0 <= 38 && y0 >= 30, `and has air above the first line (40): ${y0.toFixed(1)}`);
});

test('a narrow box around one dense paragraph line does not grow into the adjoining photo column', () => {
  const page = new Page();
  page.dense(60, 40, 300, 6);
  page.fill(311, 35, 460, 130, 70); // adjacent photo/figure content, separated by a narrow gutter
  const s = page.snapper();
  const out = s.snapMark(box(58, 38, 302, 51));
  const assertFitsSelectedLine = (mark: Mark): void => {
    const b = mark as Extract<Mark, { op: 'box' }>;
    const x0 = b.x * kx, x1 = (b.x + b.w) * kx;
    const { y0, y1 } = cellsOfBox(mark);
    assert.ok(x0 <= 60 && x1 >= 300, `the selected line (x 60..300) stays inside, got ${x0.toFixed(1)}..${x1.toFixed(1)}`);
    assert.ok(y0 <= 40 && y1 >= 44, `the selected line (y 40..44) stays inside, got ${y0.toFixed(1)}..${y1.toFixed(1)}`);
    assert.ok(x1 <= 310, `paragraph fit stays left of adjacent content, got ${x1.toFixed(1)}`);
    assert.ok(y1 < 64, `one selected line stays a one-line mark, got ${y1.toFixed(1)}`);
  };
  assertFitsSelectedLine(out);

  // Exercise the same geometry contract against plausible bad outputs, not just the real snap result.
  assert.throws(() => assertFitsSelectedLine(box(0, 0, 1, 1)), /selected line/);
  assert.throws(() => assertFitsSelectedLine(box(100, 40, 200, 44)), /selected line/);
});

test('where the gap between lines is only a few cells, the air at a cut line is no more than half of it: an edge never lands inside the next line', () => {
  const page = new Page();
  page.dense(60, 40, 300, 6, 200); // line bands 37-44, 48-55, 59-66, 70-77, 81-88, 92-99: a gap of three cells
  const s = page.snapper();
  const inLine = (y: number): boolean => [0, 1, 2, 3, 4, 5].some((l) => y > 37 + l * 11 + 0.5 && y < 45 + l * 11 - 0.5);
  for (const [t, b] of [[51, 75], [53, 75], [52, 86], [53, 90]] as const) {
    const { y0, y1 } = cellsOfBox(s.snapMark(box(58, t, 302, b)));
    assert.ok(!inLine(y0) && !inLine(y1), `box ${t} to ${b}: neither edge is inside a line (${y0.toFixed(1)} to ${y1.toFixed(1)})`);
  }
});
