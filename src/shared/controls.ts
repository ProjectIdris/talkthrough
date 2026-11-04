// Real controls: on a real window, the bounds of the buttons, tabs, menu items and fields the person sees, as the
// operating system's accessibility tree reports them (main/uia.ts reads them, read-only). A mark the model drew at a
// control is put exactly on that control. This is pure arithmetic on boxes on the 0..1000 scale of the display; the
// renderer calls it before the picture-based snapping (overlay/snap.ts), which stays the fallback everywhere there are
// no controls (another system, a picture, a page the accessibility tree does not describe).

import type { Action } from '../scene/index.ts';

export type Box = { x: number; y: number; w: number; h: number };
/** A control on the 0..1000 scale of the display, and what kind it is (button, tab, menu item, ...). */
export type ControlBox = Box & { kind?: string };

/** An action's result: the moved action, and how far it moved (units) and onto which kind of control. */
export type ControlSnap = { action: Action; moved: number; kind: string };

const iou = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
};

const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const round1 = (v: number): number => Math.round(v * 10) / 10;
const inside = (b: Box, x: number, y: number): boolean => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/**
 * The control a box was aimed at: the one it overlaps most, when that is a clear match (a good overlap, of about the
 * same size, with its middle near) and no other control matches nearly as well. A box round a whole form, a box over
 * blank page and a box between two buttons are left alone.
 */
function aimedAt(box: Box, controls: readonly ControlBox[]): ControlBox | undefined {
  const scored = controls
    .map((c) => ({ c, s: iou(box, c) }))
    .filter(({ c, s }) => {
      if (s < 0.3) return false;
      const ratio = (c.w * c.h) / Math.max(1e-6, box.w * box.h);
      if (ratio < 0.3 || ratio > 3.3) return false;
      const a = centre(box), b = centre(c);
      return Math.abs(a.x - b.x) <= 0.5 * Math.max(box.w, c.w) && Math.abs(a.y - b.y) <= 0.5 * Math.max(box.h, c.h);
    })
    .sort((p, q) => q.s - p.s);
  const best = scored[0];
  if (!best) return undefined;
  const next = scored[1];
  // Two controls that fit about as well (a button inside a row that is nearly the same size): not clear which was meant.
  if (next && next.s > best.s * 0.85) return undefined;
  return best.c;
}

/** The smallest control that holds a point (a nested control is the one the person sees), when the point is in one. */
function holding(x: number, y: number, controls: readonly ControlBox[]): ControlBox | undefined {
  let best: ControlBox | undefined;
  for (const c of controls) if (inside(c, x, y) && (!best || c.w * c.h < best.w * best.h)) best = c;
  return best;
}

const REACH = 40;
/** The largest control a point is moved to the middle of: units across, and the height counted in the same (horizontal) units. */
const SMALL_W = 120, SMALL_H = 60;

/**
 * Puts one mark on the control it was aimed at, or returns nothing. A box takes the control's bounds (a little
 * outside them, `pad` units across and `pad * aspect` down), a circle goes round it, a point inside a small one moves to its middle, an
 * arrow's tip comes onto its edge. Marks that point at no control, and every other kind of action, come back as nothing.
 */
export function snapToControl(a: Action, controls: readonly ControlBox[], aspect: number, pad = 2): ControlSnap | undefined {
  if (controls.length === 0) return undefined;
  const px = pad, py = pad * aspect;
  switch (a.op) {
    case 'box': {
      const c = aimedAt(a, controls);
      if (!c) return undefined;
      const next = { x: round1(c.x - px), y: round1(c.y - py), w: round1(c.w + 2 * px), h: round1(c.h + 2 * py) };
      const moved = Math.max(Math.abs(next.x - a.x), Math.abs(next.y - a.y), Math.abs(next.x + next.w - a.x - a.w), Math.abs(next.y + next.h - a.y - a.h));
      return moved < 0.5 ? undefined : { action: { ...a, ...next }, moved, kind: c.kind ?? 'control' };
    }
    case 'circle': {
      const c = aimedAt(a, controls);
      if (!c) return undefined;
      const m = centre(c);
      const w = round1(c.w * 1.25 + 2 * px), h = round1(c.h * 1.25 + 2 * py);
      const next = { x: round1(m.x - w / 2), y: round1(m.y - h / 2), w, h };
      const moved = Math.hypot(next.x + w / 2 - (a.x + a.w / 2), next.y + h / 2 - (a.y + a.h / 2));
      return moved < 0.5 && Math.abs(w - a.w) < 1 && Math.abs(h - a.h) < 1 ? undefined : { action: { ...a, ...next }, moved, kind: c.kind ?? 'control' };
    }
    case 'point': {
      const c = holding(a.x, a.y, controls);
      if (!c) return undefined;
      // A small control (a button, a tab) takes the point at its middle; a wide field or a list row is already pointed at.
      if (c.w > SMALL_W || c.h / aspect > SMALL_H) return undefined;
      const m = centre(c);
      const moved = Math.hypot(m.x - a.x, m.y - a.y);
      return moved < 0.5 ? undefined : { action: { ...a, x: round1(m.x), y: round1(m.y) }, moved, kind: c.kind ?? 'control' };
    }
    case 'arrow': {
      // The tip is on a control already, or comes to the nearest control's edge when it stops just short of it.
      if (holding(a.x2, a.y2, controls)) return undefined;
      let best: { c: ControlBox; d: number; x: number; y: number } | undefined;
      let second = Infinity;
      for (const c of controls) {
        const x = Math.max(c.x, Math.min(a.x2, c.x + c.w)), y = Math.max(c.y, Math.min(a.y2, c.y + c.h));
        const d = Math.hypot((x - a.x2) * aspect, y - a.y2);
        if (!best || d < best.d) {
          if (best) second = Math.min(second, best.d);
          best = { c, d, x, y };
        } else second = Math.min(second, d);
      }
      if (!best || best.d > REACH || best.d < 0.5) return undefined;
      if (second < best.d * 1.5) return undefined; // two controls about as near: which was meant is not clear
      // A little inside the edge, so the head touches the control and does not stop at it.
      const m = centre(best.c);
      const k = Math.min(1, 1.5 / Math.max(1e-6, Math.hypot((m.x - best.x) * aspect, m.y - best.y)));
      const x = round1(best.x + (m.x - best.x) * k), y = round1(best.y + (m.y - best.y) * k);
      return { action: { ...a, x2: x, y2: y }, moved: best.d, kind: best.c.kind ?? 'control' };
    }
    default:
      return undefined;
  }
}
