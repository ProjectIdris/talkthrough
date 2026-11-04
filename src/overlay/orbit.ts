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

/** Space kept between the buttons and the model's bounds (CSS pixels). */
export const BUTTON_GAP = 10;

const rectsMeet = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the buttons beside a model go, from the model's rectangle and the buttons' sizes. They are a small group (Explode, Cut under it at the
 * same right edge, and, when there is a detail model and the pass has not been asked, More detail to the left of Explode) that sits clear of
 * the model's bounds, never over its parts or its tags: above its top-right corner if there is room, else beside it on the right, below it,
 * or on the left. Only a model that fills the whole screen leaves them inside its top-right corner, as a last resort.
 * Pure, so the page can keep a tag off them before they show.
 */
export function modelButtonRects(
  model: Rect,
  view: { width: number; height: number },
  sizes: { explode: { w: number; h: number }; cut: { w: number; h: number }; detail?: { w: number; h: number } },
): { explode: Rect; cut: Rect; detail?: Rect } {
  const groupW = (sizes.detail ? sizes.detail.w + 8 : 0) + sizes.explode.w;
  const groupH = sizes.explode.h + 6 + sizes.cut.h;
  const layout = (x: number, y: number): { explode: Rect; cut: Rect; detail?: Rect } => {
    const explode = { x: x + groupW - sizes.explode.w, y, w: sizes.explode.w, h: sizes.explode.h };
    const cut = { x: x + groupW - sizes.cut.w, y: y + sizes.explode.h + 6, w: sizes.cut.w, h: sizes.cut.h };
    return { explode, cut, ...(sizes.detail ? { detail: { x, y, w: sizes.detail.w, h: sizes.detail.h } } : {}) };
  };
  const clampX = (x: number): number => Math.max(6, Math.min(view.width - groupW - 6, x));
  const clampY = (y: number): number => Math.max(6, Math.min(view.height - groupH - 6, y));
  const keepClear = grown(model, BUTTON_GAP - 2);
  const right = model.x + model.w, bottom = model.y + model.h;
  const candidates: Array<[number, number]> = [
    [right - groupW, model.y - BUTTON_GAP - groupH], // above, at the right
    [right + BUTTON_GAP, model.y], // beside, on the right
    [right - groupW, bottom + BUTTON_GAP], // below, at the right
    [model.x - BUTTON_GAP - groupW, model.y], // beside, on the left
  ];
  for (const [cx, cy] of candidates) {
    const x = clampX(cx), y = clampY(cy);
    if (x !== cx && Math.abs(x - cx) > 0.5) continue; // pushed along the edge: this side has no room
    if (y !== cy && Math.abs(y - cy) > 0.5) continue;
    if (rectsMeet({ x, y, w: groupW, h: groupH }, keepClear)) continue;
    return layout(x, y);
  }
  const at = explodeButtonBox(model, view, sizes.explode);
  const inside = layout(clampX(at.x + sizes.explode.w - groupW), at.y);
  return inside;
}

/**
 * Whether the overlay window should be solid right now, and the page's repeated saying so. The window is solid
 * while the pointer is on the model (or on one of the app's own buttons), or while the model is being dragged.
 * It is worked out again every time any of those change, and on every heartbeat, from where the pointer really is
 * and whether the model is still there; so a model that fades or is cleared under a resting pointer lets go at the
 * next beat at the latest, and a beat never renews a claim that is no longer true.
 */
export function createHold(send: (over: boolean) => void) {
  let over = false;
  let x = -1, y = -1;
  let model: Rect | undefined;
  let hud = false;
  let dragging = false;
  const set = (next: boolean): void => {
    if (next === over) return;
    over = next;
    send(next);
  };
  const evaluate = (): void => set(dragging || hud || overModel(model, x, y));
  return {
    /** The pointer moved; `onHud` is whether it is over one of the app's own buttons. */
    pointer(nx: number, ny: number, onHud: boolean): void {
      x = nx;
      y = ny;
      hud = onHud;
      evaluate();
    },
    /** Where the model is now (undefined: there is none, or it is too faint to take the pointer). */
    model(rect: Rect | undefined): void {
      model = rect;
      evaluate();
    },
    /** Whether the pointer is over one of the app's own buttons (they come and go under a resting pointer). */
    onHud(on: boolean): void {
      hud = on;
      evaluate();
    },
    /** A drag holds the window solid wherever the pointer goes, until it ends. */
    drag(on: boolean): void {
      dragging = on;
      evaluate();
    },
    /** The heartbeat: re-check, and renew the claim only if it still holds. */
    beat(): void {
      evaluate();
      if (over) send(true);
    },
    /** The app's own button was used and went away: nothing is under the pointer until it moves again. */
    release(): void {
      hud = false;
      x = -1;
      y = -1;
      evaluate();
    },
    get over(): boolean {
      return over;
    },
  };
}
