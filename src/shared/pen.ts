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

/** True when the strokes together span enough of the screen to mean something. */
export function isRealStroke(strokes: ReadonlyArray<ReadonlyArray<Point>>): boolean {
  const box = strokeBounds(strokes);
  return box !== null && (box.w >= MIN_STROKE_SPAN || box.h >= MIN_STROKE_SPAN);
}

/** The padded box to crop around the strokes, grown to a minimum size and kept inside the screen. */
export function cropBox(strokes: ReadonlyArray<ReadonlyArray<Point>>): Box | null {
  const b = strokeBounds(strokes);
  if (!b) return null;
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
