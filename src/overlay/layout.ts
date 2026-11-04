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
