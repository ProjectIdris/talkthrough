// Where the 3D panel sits on the display, in CSS pixels snapped to physical pixels.

import { snap } from './marks.ts';
import type { View } from './marks.ts';
import type { Frame } from './timeline.ts';

export type PanelRect = { x: number; y: number; w: number; h: number; alpha: number };

/** Below this opacity the panel is treated as gone: not drawn, and not in the way of clicks. */
export const PANEL_VISIBLE_ALPHA = 0.003;

/** The panel's rectangle for a frame, or undefined when there is no panel or it is not visible. */
export function panelRect(panel: Frame['panel'], view: View): PanelRect | undefined {
  if (!panel) return undefined;
  const alpha = Math.max(0, Math.min(1, panel.appear * panel.fade));
  if (alpha <= PANEL_VISIBLE_ALPHA) return undefined;
  const r = panel.rect;
  return {
    x: snap((r.x / 1000) * view.width, view.dpr),
    y: snap((r.y / 1000) * view.height, view.dpr),
    w: Math.max(8, snap((r.w / 1000) * view.width, view.dpr)),
    h: Math.max(8, snap((r.h / 1000) * view.height, view.dpr)),
    alpha,
  };
}

export function inRect(rect: { x: number; y: number; w: number; h: number } | undefined, x: number, y: number): boolean {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

type Box = { x: number; y: number; w: number; h: number };

/** Room kept between a model and the edge of its card, in CSS pixels. */
export const STAGE_ROOM = 16;
/** How near the display's edge a card may grow. */
const STAGE_EDGE = 4;

/**
 * The visible card behind the 3D model. The panel says where the model is placed and fitted; it is not a frame to cut the model to. When the model
 * reaches past that rectangle (turning, pulled apart, a part swinging out, a long hose) the card grows to hold the whole of it, with room, instead of
 * leaving an edge across it that reads as a cut. It only grows, so a pendulum does not make the card breathe; a new panel or no panel starts it again.
 */
export class StageGrowth {
  private base: Box | undefined;
  private grown: Box | undefined;

  /** The card for this frame: `panel` is where the model is placed, `model` is what it covers on screen now (undefined when nothing is drawn). */
  card(panel: Box | undefined, model: Box | undefined, view: { width: number; height: number }): Box | undefined {
    if (!panel) {
      this.base = undefined;
      this.grown = undefined;
      return undefined;
    }
    if (!this.base || !sameBox(this.base, panel)) {
      this.base = { x: panel.x, y: panel.y, w: panel.w, h: panel.h };
      this.grown = { ...this.base };
    }
    const g = this.grown!;
    if (model && model.w > 0 && model.h > 0) {
      const x0 = Math.max(STAGE_EDGE, Math.min(g.x, model.x - STAGE_ROOM));
      const y0 = Math.max(STAGE_EDGE, Math.min(g.y, model.y - STAGE_ROOM));
      const x1 = Math.min(view.width - STAGE_EDGE, Math.max(g.x + g.w, model.x + model.w + STAGE_ROOM));
      const y1 = Math.min(view.height - STAGE_EDGE, Math.max(g.y + g.h, model.y + model.h + STAGE_ROOM));
      // Never smaller than the panel (a model near the display's edge must not shrink the card into it).
      g.x = Math.min(x0, panel.x);
      g.y = Math.min(y0, panel.y);
      g.w = Math.max(x1, panel.x + panel.w) - g.x;
      g.h = Math.max(y1, panel.y + panel.h) - g.y;
    }
    return { x: g.x, y: g.y, w: g.w, h: g.h };
  }
}

const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
