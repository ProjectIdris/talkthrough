// The whole thing a rough pen circle is on. People do not circle neatly: a loop cuts through a paragraph, takes half a figure, runs over onto the
// next block. The page's own ink says where its blocks are: lines of text a line's gap apart, the parts of a figure, the controls of a bar, all
// run together once the ink is blurred a little, and what is more than a gap away is another block. The block the circle is mostly on is the
// one that holds most of the ink inside the circle's box.
//
// Pure over the page's ink grid (the one the snapper reads: 1 where there is ink); every position out is on the 0..1000 scale of the screen.

import type { Box } from './pen.ts';

/** The page as cells: 1 where there is ink. */
export type InkGrid = { cols: number; rows: number; ink: ArrayLike<number> };

/**
 * How far apart ink may be, in cells of a grid about 960 wide, and still be one block, across and down. A page packs its blocks close (a justified
 * paragraph runs up to the frame of a figure beside it), so the least bridging that makes the circled thing one block is the one used: lines of a
 * paragraph join down (their words overlap from line to line), the words of a short line or a row of controls need a little across.
 */
const SCALES: ReadonlyArray<{ x: number; y: number }> = [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 5, y: 3 }];
/** A block is at most this many times the area of the stroke's box (a loop round half a figure is under 6; a ring on a detail of a photo is far over). */
const MAX_GROWTH = 6;
/** The block must hold at least this share of the page's ink that is inside the stroke's box: the stroke is mostly on it. */
const MIN_HELD = 0.5;
/** A block larger than this share of the screen is the page itself (a column of everything), not a thing someone circled. */
const MAX_AREA_SHARE = 0.45;
/** The ink the circle's box must hold, as a share of its cells, for there to be anything under it. */
const MIN_INK_SHARE = 0.01;

/** `ink` blurred by a (2rx+1) by (2ry+1) window: 1 where there is ink within reach. */
function bridged(g: InkGrid, rx: number, ry: number): Uint8Array {
  const { cols, rows } = g;
  const across = new Uint8Array(cols * rows);
  const next = new Float64Array(Math.max(cols, rows));
  for (let y = 0; y < rows; y++) {
    let upcoming = Infinity;
    for (let x = cols - 1; x >= 0; x--) {
      if (g.ink[y * cols + x]) upcoming = x;
      next[x] = upcoming;
    }
    let last = -Infinity;
    for (let x = 0; x < cols; x++) {
      if (g.ink[y * cols + x]) last = x;
      across[y * cols + x] = x - last <= rx || (next[x] as number) - x <= rx ? 1 : 0;
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let x = 0; x < cols; x++) {
    let upcoming = Infinity;
    for (let y = rows - 1; y >= 0; y--) {
      if (across[y * cols + x]) upcoming = y;
      next[y] = upcoming;
    }
    let last = -Infinity;
    for (let y = 0; y < rows; y++) {
      if (across[y * cols + x]) last = y;
      out[y * cols + x] = y - last <= ry || (next[y] as number) - y <= ry ? 1 : 0;
    }
  }
  return out;
}

type Cells = { x0: number; y0: number; x1: number; y1: number };

/** The component of the blurred ink that holds the most of the real ink under the cell box `at`, as cells; null when there is none. */
function heaviest(g: InkGrid, mask: Uint8Array, at: Cells): (Cells & { mass: number }) | null {
  const { cols, rows } = g;
  const label = new Int32Array(cols * rows);
  const stack = new Int32Array(cols * rows);
  let best: (Cells & { mass: number }) | null = null;
  let id = 0;
  for (let y = at.y0; y < at.y1; y++) {
    for (let x = at.x0; x < at.x1; x++) {
      const start = y * cols + x;
      if (!mask[start] || label[start]) continue;
      id++;
      let top = 0, mass = 0, bx0 = x, bx1 = x, by0 = y, by1 = y;
      stack[top++] = start;
      label[start] = id;
      while (top > 0) {
        const cell = stack[--top] as number;
        const cx = cell % cols, cy = (cell - cx) / cols;
        if (cx < bx0) bx0 = cx;
        if (cx > bx1) bx1 = cx;
        if (cy < by0) by0 = cy;
        if (cy > by1) by1 = cy;
        if (g.ink[cell] && cx >= at.x0 && cx < at.x1 && cy >= at.y0 && cy < at.y1) mass++;
        for (const next of [cx > 0 ? cell - 1 : -1, cx < cols - 1 ? cell + 1 : -1, cy > 0 ? cell - cols : -1, cy < rows - 1 ? cell + cols : -1]) {
          if (next >= 0 && mask[next] && !label[next]) {
            label[next] = id;
            stack[top++] = next;
          }
        }
      }
      if (!best || mass > best.mass) best = { mass, x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
    }
  }
  return best;
}

/**
 * The block of the page that the stroke's box is mostly on, as a box on the 0..1000 scale, or null when there is nothing under it, or the block
 * is the page, or much larger than the circle (a ring on a detail of a photo is not round the whole photo). Where the stroke is on two blocks
 * (an overshoot onto the next one) it is the one with more of the ink under the box.
 */
export function blockAround(g: InkGrid, bounds: Box): Box | null {
  const { cols, rows } = g;
  if (cols < 8 || rows < 8) return null;
  const at: Cells = {
    x0: Math.max(0, Math.floor((bounds.x / 1000) * cols)), x1: Math.min(cols, Math.ceil(((bounds.x + bounds.w) / 1000) * cols)),
    y0: Math.max(0, Math.floor((bounds.y / 1000) * rows)), y1: Math.min(rows, Math.ceil(((bounds.y + bounds.h) / 1000) * rows)),
  };
  if (at.x1 <= at.x0 || at.y1 <= at.y0) return null;
  let under = 0;
  for (let y = at.y0; y < at.y1; y++) for (let x = at.x0; x < at.x1; x++) if (g.ink[y * cols + x]) under++;
  if (under < MIN_INK_SHARE * (at.x1 - at.x0) * (at.y1 - at.y0) || under < 6) return null;
  const boxArea = (at.x1 - at.x0) * (at.y1 - at.y0);
  for (const scale of SCALES) {
    const mask = bridged(g, Math.max(1, Math.round((scale.x * cols) / 960)), Math.max(1, Math.round((scale.y * rows) / 402)));
    const best = heaviest(g, mask, at);
    if (!best || best.mass < MIN_HELD * under) continue;
    const area = (best.x1 - best.x0) * (best.y1 - best.y0);
    if (area / (cols * rows) > MAX_AREA_SHARE || area > MAX_GROWTH * boxArea) continue;
    return { x: (best.x0 / cols) * 1000, y: (best.y0 / rows) * 1000, w: ((best.x1 - best.x0) / cols) * 1000, h: ((best.y1 - best.y0) / rows) * 1000 };
  }
  return null;
}

/**
 * The words an underline is under: the line of text just above the row `y` (0..1000), over the columns `x0` to `x1`, grown out to the edges of
 * the words it touches. A box on the 0..1000 scale; null when there is no ink above the line within a line's height.
 */
export function textAbove(g: InkGrid, x0: number, x1: number, y: number): Box | null {
  const { cols, rows } = g;
  const cx0 = Math.max(0, Math.floor((x0 / 1000) * cols)), cx1 = Math.min(cols, Math.ceil((x1 / 1000) * cols));
  const row = Math.min(rows - 1, Math.max(0, Math.round((y / 1000) * rows)));
  if (cx1 - cx0 < 3) return null;
  const need = Math.max(2, Math.round(0.04 * (cx1 - cx0)));
  const inked = (r: number, a: number, b: number): number => {
    let n = 0;
    for (let x = a; x < b; x++) if (g.ink[r * cols + x]) n++;
    return n;
  };
  // Up from the underline to the first row with letters in it (the underline sits a little under them), then up through the line.
  const reach = Math.round((rows * 60) / 402);
  let bottom = -1;
  for (let r = row; r >= Math.max(0, row - reach); r--) if (inked(r, cx0, cx1) >= need) { bottom = r; break; }
  if (bottom < 0) return null;
  let top = bottom, gap = 0;
  for (let r = bottom - 1; r >= 0 && gap <= 1; r--) {
    if (inked(r, cx0, cx1) >= need) { top = r; gap = 0; } else gap++;
  }
  // Out along the line to the edge of the words the underline touches (a space between words is a few cells blank).
  const inBand = (x: number): boolean => inked(top, x, x + 1) > 0 || inked(bottom, x, x + 1) > 0 || (() => { for (let r = top; r <= bottom; r++) if (g.ink[r * cols + x]) return true; return false; })();
  const word = Math.max(2, Math.round((3 * cols) / 960)), most = Math.round((cols * 26) / 960);
  let left = cx0, right = cx1;
  for (let blank = 0, x = cx0 - 1, moved = 0; x >= 0 && moved < most; x--, moved++) { if (inBand(x)) { left = x; blank = 0; } else if (++blank > word) break; }
  for (let blank = 0, x = cx1, moved = 0; x < cols && moved < most; x++, moved++) { if (inBand(x)) { right = x + 1; blank = 0; } else if (++blank > word) break; }
  return { x: (left / cols) * 1000, y: (top / rows) * 1000, w: ((right - left) / cols) * 1000, h: ((bottom + 1 - top) / rows) * 1000 };
}
