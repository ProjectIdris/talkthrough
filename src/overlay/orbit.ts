// The small rules behind turning, zooming and opening a finished 3D model with the pointer, kept apart from the
// page so they can be tested: where the pointer counts as "on the model", what a wheel click does to the zoom,
// and where the Explode button sits.

import type { Rect } from './timeline.ts';

/** How far outside the model's own bounds the pointer still counts as on it (CSS pixels), so a thin part is easy to catch. */
export const HOVER_MARGIN = 28;

export const grown = (rect: Rect, margin: number): Rect => ({ x: rect.x - margin, y: rect.y - margin, w: rect.w + 2 * margin, h: rect.h + 2 * margin });

/** The pointer is on the model: inside its screen bounds plus a margin. */
export function overModel(rect: Rect | undefined, x: number, y: number, margin = HOVER_MARGIN): boolean {
  if (!rect) return false;
  const r = grown(rect, margin);
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Zoom change for one wheel event: forward (negative deltaY) zooms in. Mouse wheels and touchpads report different units; each event is kept to a gentle step. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.0016);
}

/** Where the Explode button goes: just inside the model's top-right corner, kept on screen. */
export function explodeButtonBox(model: Rect, view: { width: number; height: number }, size: { w: number; h: number }): { x: number; y: number } {
  const x = model.x + model.w - size.w - 6;
  const y = model.y + 6;
  return { x: Math.max(6, Math.min(view.width - size.w - 6, x)), y: Math.max(6, Math.min(view.height - size.h - 6, y)) };
}
