import type { Mark } from '../scene/types.ts';
import { arrowHeadPoints, markRotationRadians, underlineBand } from './mark-geometry.ts';

/** The visible, interactive parts of the current explanation, in viewport CSS pixels. */
export type VisibleRegionKind = 'content' | 'pill' | 'capture-control' | 'guide-target';

export type VisibleShape =
  | { type: 'rect'; x: number; y: number; w: number; h: number }
  | { type: 'circle'; x: number; y: number; r: number }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { type: 'polyline'; points: readonly { x: number; y: number }[]; width: number; closed?: boolean }
  | { type: 'polygon'; points: readonly { x: number; y: number }[] };

export type VisibleRegion = {
  id: string;
  kind: VisibleRegionKind;
  alpha: number;
  shape: VisibleShape;
};

export type VisibleRegionSnapshot = {
  version: 1;
  revision: number;
  units: 'css-px';
  width: number;
  height: number;
  regions: readonly VisibleRegion[];
};

export type VisibleRegionInput = Omit<VisibleRegionSnapshot, 'version' | 'revision' | 'units'>;

/** Convert a user-visible scene mark to tight shape hits in viewport CSS pixels. */
export function regionsForMark(mark: Mark, width: number, height: number, alpha: number, appear = 1, dpr = 1, fade = 1, reduceMotion = false): VisibleRegion[] {
  const x = (u: number) => (u / 1000) * width;
  const y = (u: number) => (u / 1000) * height;
  const id = `mark:${mark.id}`;
  const hitWidth = Math.max(10, height * 0.01);
  const line = (x1: number, y1: number, x2: number, y2: number): VisibleRegion[] => x1 === x2 && y1 === y2
    ? []
    : [{ id, kind: 'content', alpha, shape: { type: 'line', x1, y1, x2, y2, width: hitWidth } }];
  const lines = (points: readonly { x: number; y: number }[], close = false): VisibleRegion[] => {
    if (points.length < 2 || points.every((p) => p.x === points[0]!.x && p.y === points[0]!.y)) return [];
    return [{ id, kind: 'content', alpha, shape: { type: 'polyline', points, width: hitWidth, ...(close ? { closed: true } : {}) } }];
  };
  switch (mark.op) {
    case 'box': case 'circle': {
      const cx = x(mark.x + mark.w / 2), cy = y(mark.y + mark.h / 2);
      const rx = x(mark.w / 2), ry = y(mark.h / 2);
      const tilt = markRotationRadians(mark.rot ?? 0);
      const count = mark.op === 'circle' ? 32 : 4;
      const points = Array.from({ length: count }, (_, i) => {
        const angle = mark.op === 'circle' ? (i / count) * Math.PI * 2 : (i / count) * Math.PI * 2;
        const px = mark.op === 'circle' ? rx * Math.cos(angle) : (i === 0 || i === 3 ? -rx : rx);
        const py = mark.op === 'circle' ? ry * Math.sin(angle) : (i < 2 ? -ry : ry);
        return { x: cx + px * Math.cos(tilt) - py * Math.sin(tilt), y: cy + px * Math.sin(tilt) + py * Math.cos(tilt) };
      });
      return lines(points, true);
    }
    case 'underline': {
      const snap = (n: number) => Math.round(n * dpr) / dpr;
      const w = snap(x(mark.w));
      const band = underlineBand(snap(x(mark.x)), snap(y(mark.y)), w, height, dpr, reduceMotion ? (appear > 0 ? w : 0) : w * appear, reduceMotion ? 0 : w * (1 - fade));
      return band ? [{ id, kind: 'content', alpha, shape: { type: 'rect', ...band } }] : [];
    }
    case 'arrow': {
      const lw = Math.round(Math.max(2, height * 0.0027) * dpr) / dpr;
      const snap = (n: number) => Math.round(n * dpr) / dpr;
      const points = arrowHeadPoints(snap(x(mark.x1)), snap(y(mark.y1)), snap(x(mark.x2)), snap(y(mark.y2)), lw, appear);
      return [...line(x(mark.x1), y(mark.y1), x(mark.x2), y(mark.y2)), ...(points.length ? [{ id, kind: 'content' as const, alpha, shape: { type: 'polygon' as const, points } }] : [])];
    }
    case 'poly': return lines(mark.pts.map(([px, py]) => ({ x: x(px), y: y(py) })), true);
    case 'trace': return lines(mark.pts.map(([px, py]) => ({ x: x(px), y: y(py) })));
    case 'point': return [{ id, kind: 'content', alpha, shape: { type: 'circle', x: x(mark.x), y: y(mark.y), r: Math.max(hitWidth, height * 0.012) } }];
    case 'label': return [{ id, kind: 'content', alpha, shape: { type: 'rect', x: x(mark.x), y: y(mark.y), w: Math.max(30, mark.text.length * 11 * height / 1000 * ((mark.size ?? 24) / 24)), h: y(mark.size ?? 24) } }];
    case 'pin': return [];
    case 'card': case 'image': return [];
  }
}

let revision = 0;
let current: VisibleRegionSnapshot = Object.freeze({
  version: 1,
  revision,
  units: 'css-px',
  width: 0,
  height: 0,
  regions: Object.freeze([]),
});

/** Publish a new lifecycle snapshot. It is copied and frozen so consumers cannot mutate renderer state. */
export function publishVisibleRegions(input: VisibleRegionInput): VisibleRegionSnapshot {
  const regions = input.regions.map((region) => {
    const shape = region.shape.type === 'polygon' || region.shape.type === 'polyline'
      ? Object.freeze({ ...region.shape, points: Object.freeze(region.shape.points.map((point) => Object.freeze({ ...point }))) })
      : Object.freeze({ ...region.shape });
    return Object.freeze({ ...region, alpha: Math.max(0, Math.min(1, region.alpha)), shape });
  });
  current = Object.freeze({
    version: 1,
    revision: ++revision,
    units: 'css-px',
    width: Math.max(0, input.width),
    height: Math.max(0, input.height),
    regions: Object.freeze(regions),
  });
  return current;
}

export function readVisibleRegions(): VisibleRegionSnapshot {
  return current;
}

/** Publish an empty snapshot and advance the revision so a consumer cannot keep stale hits. */
export function clearVisibleRegions(): VisibleRegionSnapshot {
  return publishVisibleRegions({ width: current.width, height: current.height, regions: [] });
}

/** Shape-aware point test shared by renderer checks and focused regression tests. */
export function containsVisiblePoint(snapshot: VisibleRegionSnapshot, x: number, y: number, kind?: VisibleRegionKind): boolean {
  return snapshot.regions.some((region) => region.alpha > 0 && (!kind || region.kind === kind) && contains(region.shape, x, y));
}

function contains(shape: VisibleShape, x: number, y: number): boolean {
  switch (shape.type) {
    case 'rect': return shape.w > 0 && shape.h > 0 && x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h;
    case 'circle': return shape.r > 0 && (x - shape.x) ** 2 + (y - shape.y) ** 2 <= shape.r ** 2;
    case 'line': return shape.width > 0 && distanceToSegment(x, y, shape.x1, shape.y1, shape.x2, shape.y2) <= shape.width / 2;
    case 'polyline': {
      if (shape.width <= 0 || shape.points.length < 2) return false;
      const points = shape.closed ? [...shape.points, shape.points[0]!] : shape.points;
      return points.slice(1).some((point, i) => distanceToSegment(x, y, points[i]!.x, points[i]!.y, point.x, point.y) <= shape.width / 2);
    }
    case 'polygon': return pointInPolygon(x, y, shape.points);
  }
}

function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / length2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function pointInPolygon(x: number, y: number, points: readonly { x: number; y: number }[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) < 0.001) return true;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
