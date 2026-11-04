// The geometry of the pen: what counts as a stroke, and which part of the screen to crop around it.
// Everything is on the 0..1000 scale across the whole screenshot.

export type Point = [number, number];
export type Box = { x: number; y: number; w: number; h: number };

/** Smallest drag (in scale units, on either axis) that counts as a stroke; a click or a twitch is not one. */
export const MIN_STROKE_SPAN = 15;
/** The crop is never smaller than this (in scale units) on either axis, so a tiny circle still has context. */
export const MIN_CROP_SPAN = 120;
/** Padding around the strokes: this share of their size on each side, at least this many units. */
const PAD_SHARE = 0.15;
const PAD_MIN = 20;

/** The box that holds every point of every stroke, or null when there are none. */
export function strokeBounds(strokes: ReadonlyArray<ReadonlyArray<Point>>): Box | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes) {
    for (const [x, y] of stroke) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The most separate circles one press counts: more are merged, nearest first. */
export const MAX_CIRCLES = 3;
/** Two strokes are one circle when their boxes (grown by this many units) overlap by at least this share of the smaller one. */
const SAME_CIRCLE_SHARE = 0.4;
const SAME_CIRCLE_GROW = 6;

const grown = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by });
const overlapArea = (a: Box, b: Box): number => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const gapBetween = (a: Box, b: Box): number => Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));

/**
 * The strokes of one press as separate circles, in the order they were first drawn: strokes that lie on one another (a loop gone round
 * twice, a circle drawn in two pieces) are one circle; at most MAX_CIRCLES come out (the nearest are merged). A twitch is left out when
 * there is anything larger. Each circle is its strokes, in the order drawn.
 */
export function groupStrokes(strokes: ReadonlyArray<ReadonlyArray<Point>>, max = MAX_CIRCLES): Point[][][] {
  type Group = { first: number; strokes: Array<{ index: number; points: Point[] }>; box: Box };
  const all = strokes.map((points, index) => ({ index, points: [...points], box: strokeBounds([points]) })).filter((s): s is { index: number; points: Point[]; box: Box } => s.box !== null);
  const real = all.filter((s) => s.box.w >= MIN_STROKE_SPAN / 2 || s.box.h >= MIN_STROKE_SPAN / 2);
  let groups: Group[] = (real.length > 0 ? real : all).map((s) => ({ first: s.index, strokes: [s], box: s.box }));
  const join = (a: Group, b: Group): Group => ({ first: Math.min(a.first, b.first), strokes: [...a.strokes, ...b.strokes].sort((u, v) => u.index - v.index), box: strokeBounds([...a.strokes, ...b.strokes].map((s) => s.points)) as Box });
  const merge = (i: number, j: number): void => {
    const joined = join(groups[i] as Group, groups[j] as Group);
    groups = groups.filter((_, k) => k !== i && k !== j);
    groups.push(joined);
  };
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < groups.length && !again; i++) {
      for (let j = i + 1; j < groups.length && !again; j++) {
        const a = grown((groups[i] as Group).box, SAME_CIRCLE_GROW), b = grown((groups[j] as Group).box, SAME_CIRCLE_GROW);
        if (overlapArea(a, b) >= SAME_CIRCLE_SHARE * Math.min(a.w * a.h, b.w * b.h)) {
          merge(i, j);
          again = true;
        }
      }
    }
  }
  while (groups.length > Math.max(1, max)) {
    let best = [0, 1], bestGap = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const gap = gapBetween((groups[i] as Group).box, (groups[j] as Group).box);
      if (gap < bestGap) { bestGap = gap; best = [i, j]; }
    }
    merge(best[0] as number, best[1] as number);
  }
  return groups.sort((a, b) => a.first - b.first).map((g) => g.strokes.map((s) => s.points));
}

/** True when the strokes together span enough of the screen to mean something. */
export function isRealStroke(strokes: ReadonlyArray<ReadonlyArray<Point>>): boolean {
  const box = strokeBounds(strokes);
  return box !== null && (box.w >= MIN_STROKE_SPAN || box.h >= MIN_STROKE_SPAN);
}

/**
 * The padded box to crop around the strokes, grown to a minimum size and kept inside the screen. `block` is the whole page block, figure
 * or control the strokes are mostly on (see pen-blocks.ts): a circle is rough, so the crop takes in all of what it mostly covers, and
 * the strokes themselves.
 */
export function cropBox(strokes: ReadonlyArray<ReadonlyArray<Point>>, block?: Box | null): Box | null {
  const b = strokeBounds(strokes);
  if (!b) return null;
  return cropAround(block ? unionOf(b, block) : b);
}

/** The smallest box that holds both. */
export function unionOf(a: Box, b: Box): Box {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The padded box to crop around a subject, grown to a minimum size and kept inside the screen. */
export function cropAround(b: Box): Box {
  const padX = Math.max(b.w * PAD_SHARE, PAD_MIN);
  const padY = Math.max(b.h * PAD_SHARE, PAD_MIN);
  let x0 = b.x - padX;
  let y0 = b.y - padY;
  let x1 = b.x + b.w + padX;
  let y1 = b.y + b.h + padY;
  const grow = (lo: number, hi: number): [number, number] => {
    if (hi - lo >= MIN_CROP_SPAN) return [lo, hi];
    const mid = (lo + hi) / 2;
    return [mid - MIN_CROP_SPAN / 2, mid + MIN_CROP_SPAN / 2];
  };
  [x0, x1] = grow(x0, x1);
  [y0, y1] = grow(y0, y1);
  // keep inside the screen without shrinking: slide, then clip
  const fit = (lo: number, hi: number): [number, number] => {
    const size = hi - lo;
    if (lo < 0) return [0, Math.min(1000, size)];
    if (hi > 1000) return [Math.max(0, 1000 - size), 1000];
    return [lo, hi];
  };
  [x0, x1] = fit(x0, x1);
  [y0, y1] = fit(y0, y1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
