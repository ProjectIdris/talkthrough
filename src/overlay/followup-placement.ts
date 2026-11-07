import type { Rect } from './captions.ts';
import type { VisibleRegion } from './visible-regions.ts';

/** Conservative pixel bounds of what is drawn, excluding only the controls being placed. */
export function followupKeepOut(regions: readonly VisibleRegion[]): Rect[] {
  return regions.flatMap(region => {
    if (region.alpha <= 0.02 || ['button:ask-more', 'button:send-followup', 'button:cancel-followup'].includes(region.id)) return [];
    const s = region.shape;
    if (s.type === 'rect') return [{ x: s.x, y: s.y, w: s.w, h: s.h }];
    if (s.type === 'circle') return [{ x: s.x - s.r, y: s.y - s.r, w: 2 * s.r, h: 2 * s.r }];
    const points = s.type === 'line' ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : s.points;
    if (!points.length) return [];
    const pad = s.type === 'line' || s.type === 'polyline' ? s.width / 2 : 0;
    const x = Math.min(...points.map(p => p.x)) - pad, y = Math.min(...points.map(p => p.y)) - pad;
    return [{ x, y, w: Math.max(...points.map(p => p.x)) + pad - x, h: Math.max(...points.map(p => p.y)) + pad - y }];
  });
}

/** Keep the complete control group near its usual corner, with air around the current drawing.
 * A clear previous spot is retained; crowded scenes choose the least overlap, never hide controls.
 */
export function followupSpot(view: { width: number; height: number }, size: { w: number; h: number }, keepOut: readonly Rect[], prefer?: { x: number; y: number }): { x: number; y: number } {
  const gap = 8;
  const maxX = Math.max(0, Math.floor(view.width - size.w)), maxY = Math.max(0, Math.floor(view.height - size.h));
  const left = Math.min(22, Math.floor(maxX / 2)), right = maxX - left;
  const top = Math.min(28, Math.floor(maxY / 2)), bottom = maxY - top;
  const home = { x: left, y: bottom };
  const fits = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x <= maxX && p.y <= maxY;
  const score = (p: { x: number; y: number }) => keepOut.reduce((sum, r) => sum +
    Math.max(0, Math.min(p.x + size.w + gap, r.x + r.w) - Math.max(p.x - gap, r.x)) *
    Math.max(0, Math.min(p.y + size.h + gap, r.y + r.h) - Math.max(p.y - gap, r.y)), 0);
  if (prefer && fits(prefer) && score(prefer) === 0) return prefer;
  // Sweep rows at obstacle edges. Merged blocked x intervals find interior gaps made by
  // different obstacles without testing every x/y/obstacle combination on each frame.
  // Round away from the obstacle: fractional glyph metrics must not round into the gap in CSS.
  const rows = new Set([0, top, bottom, maxY]);
  for (const r of keepOut) { rows.add(Math.floor(r.y - size.h - gap)); rows.add(Math.ceil(r.y + r.h + gap)); }
  let clear: { x: number; y: number } | undefined, clearDistance = Infinity;
  for (const y of rows) {
    if (y < 0 || y > maxY) continue;
    const intervals = keepOut.filter(r => y + size.h + gap > r.y && y - gap < r.y + r.h)
      .map(r => ({ lo: Math.floor(r.x - size.w - gap), hi: Math.ceil(r.x + r.w + gap) }))
      .sort((a, b) => a.lo - b.lo);
    const consider = (lo: number, hi: number): void => {
      lo = Math.max(0, lo); hi = Math.min(maxX, hi);
      if (hi < lo) return;
      const x = Math.max(lo, Math.min(home.x, hi));
      const distance = (x - home.x) ** 2 + (y - home.y) ** 2;
      if (distance < clearDistance) { clear = { x, y }; clearDistance = distance; }
    };
    let from = 0;
    for (const interval of intervals) {
      consider(from, interval.lo);
      from = Math.max(from, interval.hi);
    }
    consider(from, maxX);
  }
  if (clear) return clear;
  const candidates = [home, { x: right, y: bottom }, { x: left, y: top }, { x: right, y: top }];
  for (const r of keepOut) {
    const above = Math.floor(r.y - size.h - gap), below = Math.ceil(r.y + r.h + gap);
    const before = Math.floor(r.x - size.w - gap), after = Math.ceil(r.x + r.w + gap);
    for (const x of [left, right, before, after]) for (const y of [above, below]) candidates.push({ x, y });
    for (const x of [before, after]) for (const y of [top, bottom]) candidates.push({ x, y });
  }
  let best = home, bestScore = Infinity, bestDistance = Infinity;
  for (const p of candidates) {
    if (!fits(p)) continue;
    const overlap = score(p), distance = (p.x - home.x) ** 2 + (p.y - home.y) ** 2;
    if (overlap < bestScore || (overlap === bestScore && distance < bestDistance)) {
      best = p; bestScore = overlap; bestDistance = distance;
    }
  }
  return best;
}
