import assert from 'node:assert/strict';
import { test } from 'node:test';
import { penText } from '../src/adapters/subscription-shared.ts';
import { blockAround, textAbove } from '../src/shared/pen-blocks.ts';
import type { InkGrid } from '../src/shared/pen-blocks.ts';
import { readPen } from '../src/shared/pen-read.ts';
import { readShape } from '../src/shared/pen-shape.ts';
import { groupStrokes } from '../src/shared/pen.ts';
import type { Box, Point } from '../src/shared/pen.ts';

const ASPECT = 16 / 9;
const COLS = 480, ROWS = 270;

/** A page as ink: paragraphs (lines of words), frames (a figure's outline with some inside) and nothing else, positioned in 0..1000 units. */
function page(parts: Array<{ text?: Box; figure?: Box }>): InkGrid {
  const ink = new Uint8Array(COLS * ROWS);
  const cx = (u: number) => Math.round((u / 1000) * COLS), cy = (u: number) => Math.round((u / 1000) * ROWS);
  const set = (x: number, y: number) => { if (x >= 0 && x < COLS && y >= 0 && y < ROWS) ink[y * COLS + x] = 1; };
  for (const p of parts) {
    if (p.text) {
      const b = p.text;
      for (let y = cy(b.y); y < cy(b.y + b.h); y += 5) {
        for (let x = cx(b.x); x < cx(b.x + b.w); x++) if ((x - cx(b.x)) % 14 < 11) { set(x, y); set(x, y + 1); set(x, y + 2); }
      }
    }
    if (p.figure) {
      const b = p.figure;
      for (let x = cx(b.x); x < cx(b.x + b.w); x++) { set(x, cy(b.y)); set(x, cy(b.y + b.h) - 1); }
      for (let y = cy(b.y); y < cy(b.y + b.h); y++) { set(cx(b.x), y); set(cx(b.x + b.w) - 1, y); }
      for (let y = cy(b.y) + 4; y < cy(b.y + b.h) - 4; y += 3) for (let x = cx(b.x) + 4; x < cx(b.x + b.w) - 4; x += 3) if (((x + y) >> 2) % 2 === 0) set(x, y);
    }
  }
  return { cols: COLS, rows: ROWS, ink };
}

/** A hand-drawn circle: `turns` times round, a little uneven, from the angle `from`. */
function loop(cx: number, cy: number, rx: number, ry: number, turns = 1.06, from = 0.5): Point[] {
  const n = Math.round(48 * turns);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = from + (i / 48) * 2 * Math.PI;
    const wobble = 1 + 0.04 * Math.sin(3 * a);
    return [cx + rx * wobble * Math.cos(a) / ASPECT * ASPECT, cy + ry * wobble * Math.sin(a)] as Point;
  });
}
const line = (x0: number, y0: number, x1: number, y1: number, n = 30): Point[] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n] as Point);
const inside = (outer: Box, inner: Box): boolean => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;

test('strokes become separate circles in the order drawn: near or far apart, up to three; one circle gone round twice stays one', () => {
  const a = loop(200, 300, 60, 90), b = loop(700, 300, 60, 90), c = loop(450, 750, 60, 90);
  assert.equal(groupStrokes([a]).length, 1);
  const two = groupStrokes([b, a]);
  assert.equal(two.length, 2);
  assert.deepEqual(two[0]?.[0], b, 'the first drawn is first');
  assert.equal(groupStrokes([a, b, c]).length, 3);
  // near: two circles side by side, a little apart, are still two
  assert.equal(groupStrokes([loop(300, 400, 50, 70), loop(430, 400, 50, 70)]).length, 2);
  // one circle drawn twice, a little off, is one
  assert.equal(groupStrokes([loop(300, 400, 50, 70), loop(306, 404, 54, 72, 1.06, 2)]).length, 1);
  // four far circles: three, the nearest two merged
  const four = groupStrokes([loop(100, 100, 40, 60), loop(900, 100, 40, 60), loop(100, 900, 40, 60), loop(150, 700, 40, 60)]);
  assert.equal(four.length, 3);
  assert.equal(four[2]?.length, 2, 'the two nearest were merged');
  // a twitch beside a circle is not a circle
  assert.equal(groupStrokes([loop(300, 400, 50, 70), [[800, 800], [803, 801]]]).length, 1);
});

test('shape: a circle is a circle; going round three times is still one, on what the loops share; an unfinished one is completed', () => {
  const once = readShape([loop(500, 500, 80, 100)], ASPECT);
  assert.equal(once.kind, 'circle');
  assert.equal(once.loops, 1);
  const thrice = readShape([loop(500, 500, 80, 100, 3.1)], ASPECT);
  assert.equal(thrice.kind, 'circle');
  assert.ok((thrice.loops ?? 0) >= 3);
  assert.ok(thrice.subject.w <= 2 * 80 * 1.2 && thrice.subject.h <= 2 * 100 * 1.2, 'the loops share a box about one circle large');
  // a C: three quarters of a circle
  const c = readShape([loop(500, 500, 80, 100, 0.72, 1.2)], ASPECT);
  assert.equal(c.kind, 'circle');
  assert.equal(c.open, true);
  const arc = readShape([loop(500, 500, 80, 100, 0.72, 1.2)], ASPECT);
  assert.ok(arc.subject.w >= 140 && arc.subject.h >= 190, `the missing part is filled in: ${JSON.stringify(arc.subject)}`);
});

test('shape: a flat line is an underline with the strip above it as its subject; a line with a head is an arrow with its tip', () => {
  const under = readShape([line(300, 600, 520, 603)], ASPECT);
  assert.equal(under.kind, 'underline');
  assert.ok(under.subject.y < 600 && under.subject.y + under.subject.h >= 600, 'the text above the line');
  const shaft = line(200, 200, 500, 500), head = [[470, 470], [500, 500], [455, 505]] as Point[];
  const arrow = readShape([shaft, head], ASPECT);
  assert.equal(arrow.kind, 'arrow');
  assert.ok(arrow.tip && Math.abs(arrow.tip[0] - 500) < 25 && Math.abs(arrow.tip[1] - 500) < 25, `tip ${JSON.stringify(arrow.tip)}`);
  const reversed = readShape([line(500, 500, 200, 200), [[230, 205], [200, 200], [205, 235]] as Point[]], ASPECT);
  assert.ok(reversed.tip && Math.abs(reversed.tip[0] - 200) < 25, 'the head says where it points');
});

test('a rough circle grows to the whole paragraph it is mostly on, and the crop takes in all of it', () => {
  const paragraph: Box = { x: 100, y: 300, w: 400, h: 200 };
  const grid = page([{ text: paragraph }, { text: { x: 560, y: 300, w: 300, h: 200 } }]);
  // a loop over the left part of the paragraph that cuts through its lines and does not reach its right edge
  const stroke = loop(250, 400, 140, 90);
  const [mark] = readPen([stroke], grid, ASPECT);
  assert.ok(mark);
  assert.equal(mark.kind, 'circle');
  assert.ok(inside(mark.crop, paragraph), `the crop ${JSON.stringify(mark.crop)} holds the paragraph`);
  assert.ok(!inside(mark.crop, { x: 560, y: 300, w: 300, h: 200 }) && mark.crop.x + mark.crop.w < 700, 'and not the column beside it');
  // without the page, only the stroke's own box is used
  const [bare] = readPen([stroke], null, ASPECT);
  assert.ok(bare && !inside(bare.crop, paragraph));
});

test('a circle that overshoots onto the next block takes the block it is mostly on', () => {
  const left: Box = { x: 100, y: 300, w: 300, h: 200 }, right: Box = { x: 520, y: 300, w: 300, h: 200 };
  const grid = page([{ text: left }, { figure: right }]);
  const [mark] = readPen([loop(330, 400, 150, 110)], grid, ASPECT);
  assert.ok(mark);
  assert.ok(inside(mark.crop, left), 'the paragraph, whole');
  assert.ok(mark.crop.x + mark.crop.w < right.x + 150, 'not the figure it ran over onto');
});

test('a ring on a small detail of a big figure stays small; a ring over blank paper is just its own box', () => {
  const figure: Box = { x: 100, y: 100, w: 700, h: 700 };
  const grid = page([{ figure }]);
  const [mark] = readPen([loop(300, 300, 40, 50)], grid, ASPECT);
  assert.ok(mark && mark.crop.w < 300 && mark.crop.h < 300, JSON.stringify(mark?.crop));
  assert.equal(blockAround(page([]), { x: 400, y: 400, w: 100, h: 100 }), null);
});

test('an underline is grown to the line of words above it, not centred on the line', () => {
  const text: Box = { x: 100, y: 400, w: 600, h: 60 };
  const grid = page([{ text }]);
  const words = textAbove(grid, 300, 400, 468);
  assert.ok(words, 'found the line above');
  assert.ok(words.y + words.h <= 470 && words.y >= 395, JSON.stringify(words));
  const [mark] = readPen([line(300, 470, 400, 471)], grid, ASPECT);
  assert.ok(mark);
  assert.equal(mark.kind, 'underline');
  assert.ok(mark.crop.y + mark.crop.h > 470 && mark.crop.y < 420, 'the crop holds the text and the line');
  assert.ok(mark.subject.h < 40, 'the subject is the one line of words');
});

test('two and three circles come out in the order drawn, each with its own grown crop and its own kind', () => {
  const grid = page([{ text: { x: 80, y: 100, w: 300, h: 150 } }, { figure: { x: 560, y: 120, w: 300, h: 220 } }, { text: { x: 300, y: 600, w: 400, h: 120 } }]);
  const strokes = [loop(700, 230, 130, 120), loop(230, 175, 130, 80), loop(500, 660, 230, 80)];
  const marks = readPen(strokes, grid, ASPECT);
  assert.equal(marks.length, 3);
  assert.ok(marks[0] && inside(marks[0].crop, { x: 560, y: 120, w: 300, h: 220 }), 'the first drawn is the figure');
  assert.ok(marks[1] && inside(marks[1].crop, { x: 80, y: 100, w: 300, h: 150 }), 'the second is the paragraph at the top left');
  assert.ok(marks[2] && inside(marks[2].crop, { x: 300, y: 600, w: 400, h: 120 }));
  assert.deepEqual(marks.map((m) => m.kind), ['circle', 'circle', 'circle']);
  // a circle and an underline in one press
  const mixed = readPen([loop(700, 230, 130, 120), line(100, 262, 300, 263)], grid, ASPECT);
  assert.deepEqual(mixed.map((m) => m.kind), ['circle', 'underline']);
});

test('what the model is told: approximate marks, the kind of each, and the order when there are several', () => {
  const shot = { mime: 'image/png' as const, base64: 'X', width: 10, height: 10 };
  const box = { x: 100, y: 200, w: 300, h: 150 };
  const one = penText([{ crop: shot, box }]);
  assert.match(one, /circle/);
  assert.match(one, /approximate/);
  assert.match(one, /say so in step 1/);
  assert.match(one, /x 100 to 400, y 200 to 350/);
  assert.match(penText([{ crop: shot, box, kind: 'underline' }]), /under some words/);
  assert.match(penText([{ crop: shot, box, kind: 'arrow' }]), /arrow[\s\S]*tip/);
  assert.match(penText([{ crop: shot, box, kind: 'circle', open: true }]), /half-circle/);
  assert.match(penText([{ crop: shot, box, kind: 'circle', loops: 3 }]), /more than once \(still one circle\)/);
  const two = penText([{ crop: shot, box }, { crop: shot, box: { x: 500, y: 100, w: 200, h: 200 }, kind: 'underline' }]);
  assert.match(two, /marked 2 things with the pen, in this order/);
  assert.match(two, /1\. circled[\s\S]*2\. underlined/);
  assert.match(two, /numbered in red/);
});
