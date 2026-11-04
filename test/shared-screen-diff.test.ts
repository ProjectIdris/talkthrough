import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID_COLS, GRID_ROWS, gridFromPixels, inTarget, measureChange, screenChanged } from '../src/shared/screen-diff.ts';
import type { Grid } from '../src/shared/screen-diff.ts';

const blank = (v = 235): Grid => ({ cols: GRID_COLS, rows: GRID_ROWS, luma: new Uint8Array(GRID_COLS * GRID_ROWS).fill(v) });
/** Paints a block of the grid, given on the 0..1000 scale, with a brightness. */
function paint(g: Grid, x: number, y: number, w: number, h: number, v: number): Grid {
  const out = { ...g, luma: g.luma.slice() };
  for (let r = Math.floor((y / 1000) * g.rows); r < Math.ceil(((y + h) / 1000) * g.rows); r++) {
    for (let c = Math.floor((x / 1000) * g.cols); c < Math.ceil(((x + w) / 1000) * g.cols); c++) out.luma[r * g.cols + c] = v;
  }
  return out;
}
const target = { x: 400, y: 100, w: 100, h: 40 };

test('a few flickering blocks (a caret, a clock, a hover glow on the button itself) are not a change', () => {
  const before = blank();
  let after = paint(before, 960, 960, 30, 30, 20); // the clock
  after = paint(after, 410, 105, 30, 20, 100); // the button lights up under the pointer
  const r = screenChanged(before, after, target);
  assert.equal(r.changed, false, JSON.stringify(r));
});

test('a faint shift of the whole picture (a gamma step, an animation tick) is not a change', () => {
  assert.equal(screenChanged(blank(235), blank(228), target).changed, false);
});

test('a menu opening just under the target is a change, even though most of the screen is the same', () => {
  const before = blank();
  const after = paint(before, 400, 140, 160, 220, 40);
  assert.equal(screenChanged(before, after, target).changed, true);
});

test('a dialog opening in the middle of the screen counts with or without a target', () => {
  const before = blank();
  const after = paint(before, 300, 300, 400, 300, 60);
  assert.equal(screenChanged(before, after, target).changed, true);
  assert.equal(screenChanged(before, after, null).changed, true);
});

test('a page turning is a change; a small change far from the target and under the screen threshold is not', () => {
  const before = blank();
  assert.equal(screenChanged(before, paint(before, 0, 0, 1000, 1000, 90), target).changed, true);
  assert.equal(screenChanged(before, paint(before, 700, 700, 80, 60, 90), target).changed, false);
});

test('grids of different sizes count as changed, and an empty area counts nothing', () => {
  assert.equal(measureChange(blank(), { cols: 4, rows: 4, luma: new Uint8Array(16) }).share, 1);
  assert.equal(measureChange(blank(), blank(), { x: 0, y: 0, w: 0, h: 0 }).share, 0);
});

test('a grid is the average brightness of its blocks, bgra or rgba', () => {
  // 4x2 pixels: left half white, right half black; two columns of blocks.
  const px = (white: boolean) => (white ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const data = [...[0, 1, 2, 3].flatMap((x) => px(x < 2)), ...[0, 1, 2, 3].flatMap((x) => px(x < 2))];
  const g = gridFromPixels(data, 4, 2, 'bgra', 2, 1);
  assert.deepEqual([...g.luma], [255, 0]);
  // a pure red pixel: rgba and bgra read it differently
  const red = [255, 0, 0, 255];
  assert.equal(gridFromPixels(red, 1, 1, 'rgba', 1, 1).luma[0], Math.round(0.299 * 255));
  assert.equal(gridFromPixels(red, 1, 1, 'bgra', 1, 1).luma[0], Math.round(0.114 * 255));
});

test('a click counts as on the target within a margin, and anywhere when there is no target', () => {
  assert.equal(inTarget({ x: 450, y: 120 }, target), true);
  assert.equal(inTarget({ x: 515, y: 120 }, target), true, 'a box that is a guess gets a margin');
  assert.equal(inTarget({ x: 600, y: 120 }, target), false);
  assert.equal(inTarget({ x: 10, y: 10 }, null), true);
});
