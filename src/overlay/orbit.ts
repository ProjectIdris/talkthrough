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

/**
 * Where the buttons beside a model go, from the model's rectangle and the buttons' sizes: Explode just inside its top-right corner,
 * Cut under it at the same right edge, and, when there is a detail model and the pass has not been asked, More detail to the left of Explode.
 * Pure, so the page can keep a tag off them before they show.
 */
export function modelButtonRects(
  model: Rect,
  view: { width: number; height: number },
  sizes: { explode: { w: number; h: number }; cut: { w: number; h: number }; detail?: { w: number; h: number } },
): { explode: Rect; cut: Rect; detail?: Rect } {
  const at = explodeButtonBox(model, view, sizes.explode);
  const explode = { x: at.x, y: at.y, w: sizes.explode.w, h: sizes.explode.h };
  const cut = { x: at.x + sizes.explode.w - sizes.cut.w, y: at.y + sizes.explode.h + 6, w: sizes.cut.w, h: sizes.cut.h };
  const detail = sizes.detail ? { x: Math.max(6, at.x - sizes.detail.w - 8), y: at.y, w: sizes.detail.w, h: sizes.detail.h } : undefined;
  return { explode, cut, ...(detail ? { detail } : {}) };
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
