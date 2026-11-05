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

/** A control-only envelope. Live model bounds remain the source of pointer hits. */
export class StableControlBounds {
  private bounds: Box | undefined;
  private keys = new Set<number>();
  private view: { width: number; height: number } | undefined;
  private camera: string | undefined;
  private panel: string | undefined;

  reset(): void { this.bounds = undefined; this.keys.clear(); this.view = undefined; this.camera = undefined; this.panel = undefined; }

  update(model: Box | undefined, keys: readonly number[], view: { width: number; height: number }, motion?: { camera: string; authored: boolean; panel?: string }): Box | undefined {
    if (!model || ![model.x, model.y, model.w, model.h, view.width, view.height].every(Number.isFinite) || model.w <= 0 || model.h <= 0 || view.width <= 0 || view.height <= 0) {
      this.reset();
      return undefined;
    }
    const next = new Set(keys);
    if (this.view && (this.view.width !== view.width || this.view.height !== view.height || [...this.keys].some(k => !next.has(k)))) this.reset();
    if (motion?.authored && this.camera !== undefined && this.camera !== motion.camera) this.reset();
    if (this.panel !== undefined && motion?.panel !== this.panel) this.reset();
    this.camera = motion?.camera;
    this.panel = motion?.panel;
    this.view = { width: view.width, height: view.height };
    this.keys = next;
    if (!this.bounds) this.bounds = { ...model };
    else {
      const x = Math.min(this.bounds.x, model.x), y = Math.min(this.bounds.y, model.y);
      const right = Math.max(this.bounds.x + this.bounds.w, model.x + model.w);
      const bottom = Math.max(this.bounds.y + this.bounds.h, model.y + model.h);
      this.bounds = { x, y, w: right - x, h: bottom - y };
    }
    return { ...this.bounds };
  }
}

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

/** Whether the visible card is drawn: only a framed stage with something drawn in it, never an empty card for the frames before the first part. */
export const cardShows = (framed: boolean, model: Box | undefined): boolean => framed && !!model && model.w > 0 && model.h > 0;

const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
