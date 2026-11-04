// Has the screen really changed? Guide mode asks this after a click, comparing the screen as it was
// when the click began with the screen now. One flickering pixel (a caret, a clock, a hover glow) must
// not count, and a menu opening or a page turning must. So both pictures are first reduced to a coarse
// grid of average brightness, and the answer is how much of an area changed by a clearly visible amount.
// Pure arithmetic on grids; turning a screenshot into a grid is the caller's job (see frame-grid.ts).

/** A box on the 0..1000 scale of the screenshot (x, y is the top-left corner). */
export type Box = { x: number; y: number; w: number; h: number };

/** Average brightness (0 to 255) of each block of a screenshot, row by row. */
export type Grid = { cols: number; rows: number; luma: Uint8Array };

export const GRID_COLS = 160;
export const GRID_ROWS = 90;

/** A block counts as changed when its average brightness moved by at least this much (about 5%). */
export const BLOCK_DELTA = 12;
/** Near the target: at least this share of the area's blocks, and at least this many, must have changed. */
export const LOCAL_SHARE = 0.06;
export const LOCAL_MIN_BLOCKS = 4;
/** Anywhere on the screen: a menu or a dialog opening away from the target still counts when it is this big. */
export const SCREEN_SHARE = 0.015;
/** How far the area around the target reaches past it, on the 0..1000 scale. */
export const AREA_PAD = 60;

/**
 * Averages the brightness of a picture's pixels into a grid. `order` says how a pixel's bytes run:
 * Electron's bitmaps are bgra, canvas data is rgba.
 */
export function gridFromPixels(data: ArrayLike<number>, width: number, height: number, order: 'rgba' | 'bgra' = 'bgra', cols = GRID_COLS, rows = GRID_ROWS): Grid {
  const sum = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  const r = order === 'rgba' ? 0 : 2;
  const b = order === 'rgba' ? 2 : 0;
  for (let y = 0; y < height; y++) {
    const row = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = 0.299 * (data[i + r] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + b] as number);
      const cell = row * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
      sum[cell] = (sum[cell] as number) + luma;
      count[cell] = (count[cell] as number) + 1;
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((sum[i] as number) / Math.max(1, count[i] as number));
  return { cols, rows, luma: out };
}

export type Change = {
  /** Blocks that changed by a visible amount. */
  blocks: number;
  /** Blocks looked at. */
  total: number;
  /** blocks / total. */
  share: number;
};

/** How much of an area (a box on the 0..1000 scale, or all of the screen) changed between two grids of the same size. */
export function measureChange(before: Grid, after: Grid, area?: Box | null): Change {
  if (before.cols !== after.cols || before.rows !== after.rows) return { blocks: before.cols * before.rows, total: before.cols * before.rows, share: 1 };
  const { cols, rows } = before;
  const c0 = area ? Math.max(0, Math.floor((area.x / 1000) * cols)) : 0;
  const c1 = area ? Math.min(cols, Math.ceil(((area.x + area.w) / 1000) * cols)) : cols;
  const r0 = area ? Math.max(0, Math.floor((area.y / 1000) * rows)) : 0;
  const r1 = area ? Math.min(rows, Math.ceil(((area.y + area.h) / 1000) * rows)) : rows;
  let blocks = 0;
  let total = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      total++;
      if (Math.abs((before.luma[r * cols + c] as number) - (after.luma[r * cols + c] as number)) >= BLOCK_DELTA) blocks++;
    }
  }
  return { blocks, total, share: total === 0 ? 0 : blocks / total };
}

/** The area around a target that matters for it: the box with a margin, kept on the screen. */
export function areaAround(target: Box): Box {
  const x = Math.max(0, target.x - AREA_PAD);
  const y = Math.max(0, target.y - AREA_PAD);
  return { x, y, w: Math.min(1000, target.x + target.w + AREA_PAD) - x, h: Math.min(1000, target.y + target.h + AREA_PAD) - y };
}

export type ScreenChange = { changed: boolean; local: Change | null; screen: Change };

/**
 * Whether the screen has really changed since `before`. With a target, a change that fills enough of
 * the area around it counts; with or without one, so does a change that fills enough of the whole
 * screen. Small flickers fall under both.
 */
export function screenChanged(before: Grid, after: Grid, target?: Box | null): ScreenChange {
  const screen = measureChange(before, after);
  const local = target ? measureChange(before, after, areaAround(target)) : null;
  const near = local !== null && local.share >= LOCAL_SHARE && local.blocks >= LOCAL_MIN_BLOCKS;
  return { changed: near || screen.share >= SCREEN_SHARE, local, screen };
}

/** Whether a click, on the 0..1000 scale, lands in a target box, with a margin for the box being a guess. */
export function inTarget(click: { x: number; y: number }, target: Box | null | undefined, margin = 20): boolean {
  if (!target) return true;
  return click.x >= target.x - margin && click.x <= target.x + target.w + margin && click.y >= target.y - margin && click.y <= target.y + target.h + margin;
}
