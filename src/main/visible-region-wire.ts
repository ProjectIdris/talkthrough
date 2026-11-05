/** Bounded renderer-to-main interaction snapshot. All dimensions are viewport CSS pixels. */
export type WireShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'circle'; x: number; y: number; r: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: 'polyline'; points: Array<{ x: number; y: number }>; width: number; closed?: boolean }
  | { type: 'polygon'; points: Array<{ x: number; y: number }> };
export type WireRegion = { id: string; kind: 'content' | 'pill' | 'capture-control' | 'guide-target'; alpha: number; shape: WireShape };
export type WireSnapshot = { version: 1; revision: number; units: 'css-px'; width: number; height: number; regions: WireRegion[] };

/** Per-window lifetime and revision tracking for the renderer's snapshots. */
export function createVisibleRegionReceiver() {
  let current: WireSnapshot | undefined;
  return {
    accept(value: unknown): boolean {
      const next = readVisibleRegionSnapshot(value, current?.revision ?? -1);
      if (!next) return false;
      current = next;
      return true;
    },
    reset(): void { current = undefined; },
    get current(): WireSnapshot | undefined { return current; },
  };
}

/** Test the actual shape, not the enclosing rectangle of sparse marks. */
export function containsWireRegion(snapshot: WireSnapshot, x: number, y: number, kind: WireRegion['kind']): boolean {
  return snapshot.regions.some((r) => r.kind === kind && r.alpha > 0 && contains(r.shape, x, y));
}
export function containsWireId(snapshot: WireSnapshot, x: number, y: number, id: string): boolean {
  return snapshot.regions.some((r) => r.id === id && r.alpha > 0 && contains(r.shape, x, y));
}
export function containsWireContentExceptModel(snapshot: WireSnapshot, x: number, y: number): boolean {
  return snapshot.regions.some((r) => r.kind === 'content' && r.id !== 'model-geometry' && r.alpha > 0 && contains(r.shape, x, y));
}

function contains(s: WireShape, x: number, y: number): boolean {
  if (s.type === 'rect') return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  if (s.type === 'circle') return (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r ** 2;
  if (s.type === 'line') return distance(x, y, s.x1, s.y1, s.x2, s.y2) <= s.width / 2;
  if (s.type === 'polyline') {
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1]!, b = s.points[i]!;
      if (distance(x, y, a.x, a.y, b.x, b.y) <= s.width / 2) return true;
    }
    if (!s.closed) return false;
    const a = s.points.at(-1)!, b = s.points[0]!;
    return distance(x, y, a.x, a.y, b.x, b.y) <= s.width / 2;
  }
  let inside = false;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const a = s.points[i]!, b = s.points[j]!;
    if (distance(x, y, a.x, a.y, b.x, b.y) < 0.001) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distance(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
}

/** Refuse malformed, oversized and stale messages; never retain a partial set of hits. */
export function readVisibleRegionSnapshot(value: unknown, previousRevision = -1): WireSnapshot | undefined {
  if (!value || typeof value !== 'object') return;
  const s = value as Record<string, unknown>;
  if (s.version !== 1 || s.units !== 'css-px' || !Number.isSafeInteger(s.revision) || (s.revision as number) <= previousRevision || !finite(s.width) || !finite(s.height) || s.width < 0 || s.height < 0 || s.width > 30000 || s.height > 30000 || !Array.isArray(s.regions) || s.regions.length > 2048) return;
  const regions: WireRegion[] = [];
  for (const raw of s.regions) {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length < 1 || r.id.length > 160 || !['content', 'pill', 'capture-control', 'guide-target'].includes(r.kind as string) || !finite(r.alpha) || r.alpha < 0 || r.alpha > 1 || !r.shape || typeof r.shape !== 'object') return;
    const shape = readShape(r.shape as Record<string, unknown>);
    if (!shape) return;
    regions.push({ id: r.id, kind: r.kind as WireRegion['kind'], alpha: r.alpha, shape });
  }
  return { version: 1, revision: s.revision as number, units: 'css-px', width: s.width, height: s.height, regions };
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000;
function readShape(s: Record<string, unknown>): WireShape | undefined {
  if (s.type === 'rect' && finite(s.x) && finite(s.y) && finite(s.w) && finite(s.h) && s.w > 0 && s.h > 0) return { type: 'rect', x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.type === 'circle' && finite(s.x) && finite(s.y) && finite(s.r) && s.r > 0) return { type: 'circle', x: s.x, y: s.y, r: s.r };
  if (s.type === 'line' && finite(s.x1) && finite(s.y1) && finite(s.x2) && finite(s.y2) && finite(s.width) && s.width > 0) return { type: 'line', x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, width: s.width };
  if (s.type === 'polyline' && finite(s.width) && s.width > 0 && (s.closed === undefined || typeof s.closed === 'boolean') && Array.isArray(s.points) && s.points.length >= 2 && s.points.length <= 512) {
    const points: Array<{ x: number; y: number }> = [];
    for (const p of s.points) { if (!p || !finite(p.x) || !finite(p.y)) return; points.push({ x: p.x, y: p.y }); }
    return { type: 'polyline', points, width: s.width, ...(s.closed !== undefined ? { closed: s.closed } : {}) };
  }
  if (s.type === 'polygon' && Array.isArray(s.points) && s.points.length >= 3 && s.points.length <= 512) {
    const points: Array<{ x: number; y: number }> = [];
    for (const p of s.points) { if (!p || !finite(p.x) || !finite(p.y)) return; points.push({ x: p.x, y: p.y }); }
    return { type: 'polygon', points };
  }
  return;
}
