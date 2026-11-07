import type { Vec2, Vec3 } from './types.ts';

export type TaperedExtrusion = { outline: Vec2[]; start: Vec2[]; end: Vec2[]; halfDepth: number; caps: [number, number, number][] };
type Result = { ok: true; value: TaperedExtrusion } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const own = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1];
const scalar = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function pair(value: unknown): Vec2 | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = own(value, '0'), y = own(value, '1');
  return scalar(x, -100, 100) && scalar(y, -100, 100) ? [x, y] : null;
}

/** Conservative simple-polygon checks in the actual coordinate space, bounded to 40 vertices. */
function issue(points: Vec2[]): string | undefined {
  const scale = Math.max(1, ...points.flat().map(Math.abs));
  const lengthEpsilon = scale * 1e-10, areaEpsilon = scale * scale * 1e-10;
  const on = (a: Vec2, b: Vec2, p: Vec2): boolean => Math.abs(cross(a, b, p)) <= areaEpsilon &&
    p[0] >= Math.min(a[0], b[0]) - lengthEpsilon && p[0] <= Math.max(a[0], b[0]) + lengthEpsilon &&
    p[1] >= Math.min(a[1], b[1]) - lengthEpsilon && p[1] <= Math.max(a[1], b[1]) + lengthEpsilon;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!, c = points[(i + 2) % points.length]!;
    area += cross(points[0]!, a, b);
    const turn = cross(a, b, c);
    if (Math.abs(turn) <= areaEpsilon) {
      if (turn !== 0) return 'nearly collinear outline corner';
      if ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) <= 0) return 'overlapping adjacent outline edges';
    }
    for (let j = i + 1; j < points.length; j++) {
      const d = points[j]!, e = points[(j + 1) % points.length]!;
      if (Math.hypot(a[0] - d[0], a[1] - d[1]) <= lengthEpsilon) return 'duplicate outline points';
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (on(a, b, d) || on(a, b, e) || on(d, e, a) || on(d, e, b) ||
          ((cross(a, b, d) > 0) !== (cross(a, b, e) > 0) && (cross(d, e, a) > 0) !== (cross(d, e, b) > 0))) return 'outline edges intersect or touch';
    }
  }
  if (Math.abs(area) <= areaEpsilon * points.length) return 'numerically unsafe outline area';
}

/** Ear clipping on the emitted start coordinates; every cap triangle must also survive at the end. */
function triangulate(points: Vec2[], end: Vec2[]): [number, number, number][] | null {
  const remaining = points.map((_, i) => i), caps: [number, number, number][] = [];
  const inside = (a: Vec2, b: Vec2, c: Vec2, p: Vec2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length]!, b = remaining[i]!, c = remaining[(i + 1) % remaining.length]!;
      if (cross(points[a]!, points[b]!, points[c]!) <= 0 || cross(end[a]!, end[b]!, end[c]!) <= 0) continue;
      if (remaining.some(j => j !== a && j !== b && j !== c && (inside(points[a]!, points[b]!, points[c]!, points[j]!) || inside(end[a]!, end[b]!, end[c]!, end[j]!)))) continue;
      caps.push([a, b, c]); remaining.splice(i, 1); clipped = true; break;
    }
    if (!clipped) return null;
  }
  const [a, b, c] = remaining as [number, number, number];
  if (cross(points[a]!, points[b]!, points[c]!) <= 0 || cross(end[a]!, end[b]!, end[c]!) <= 0) return null;
  caps.push([a, b, c]); return caps;
}

/** Keep quantization well below every authored local feature's separation, not only cap area.
 * At section t, the emitted wall has a diagonal point in addition to each ring vertex.
 * Each is a convex interpolation of endpoint coordinates. Its rounding error divided by
 * the ideal section scale is at most max(startError, endError/taper). Endpoint polygons
 * alone miss crossing wall diagonals in very thin, translated outlines.
 */
function hasWallClearance(outline: Vec2[], transformed: Vec2[], start: Vec2[], end: Vec2[], taper: number): boolean {
  let error = 0, clearance = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    error = Math.max(error, Math.hypot(start[i]![0] - p[0], start[i]![1] - p[1]),
      Math.hypot(end[i]![0] - transformed[i]![0], end[i]![1] - transformed[i]![1]) / taper);
    for (let j = 0; j < outline.length; j++) {
      const k = (j + 1) % outline.length;
      if (i === j || i === k) continue;
      const a = outline[j]!, b = outline[k]!, dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      clearance = Math.min(clearance, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
  }
  // Leave a conservative margin for both boundaries and corner/diagonal perturbations.
  return Number.isFinite(clearance) && Number.isFinite(error) && clearance > 8 * error;
}

function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
  const u = c[0] - a[0], v = c[1] - a[1], w = c[2] - a[2];
  const nx = y * w - z * v, ny = z * u - x * w, nz = x * v - y * u;
  const length = Math.hypot(nx, ny, nz);
  return [nx / length, ny / length, nz / length];
}

/** A rounded wall must remain planar to a small angular tolerance, without folded shading. */
function alignedWalls(outline: Vec2[], transformed: Vec2[], start: Vec2[], end: Vec2[], depth: number, halfDepth: number): boolean {
  const at = (p: Vec2, z: number): Vec3 => [p[0], p[1], z];
  const aligned = (a: Vec3, b: Vec3): boolean => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] >= 1 - 1e-6;
  for (let i = 0; i < start.length; i++) {
    const j = (i + 1) % start.length;
    const a = at(start[i]!, -halfDepth), b = at(start[j]!, -halfDepth), c = at(end[j]!, halfDepth), d = at(end[i]!, halfDepth);
    const first = normal(a, b, c), second = normal(a, c, d);
    const authored = normal(at(outline[i]!, -depth / 2), at(outline[j]!, -depth / 2), at(transformed[j]!, depth / 2));
    if (!aligned(first, second) || !aligned(first, authored) || !aligned(second, authored)) return false;
  }
  return true;
}

/** Validate before binding IDs; both validator and renderer consume this exact bounded preparation. */
export function prepareTaperedExtrusion(outline: unknown, depth: unknown, taper: unknown = 1, shift: unknown = [0, 0]): Result {
  if (!scalar(depth, 0.01, 100) || !scalar(taper, 0.05, 20)) return fail('tapered depth must be 0.01..100 and taper 0.05..20');
  const offset = pair(shift);
  if (!offset) return fail('shift must be a finite [x,y] pair within -100..100');
  if (!Array.isArray(outline) || outline.length < 3 || outline.length > 40) return fail('tapered outline needs 3..40 authored points');
  const points: Vec2[] = [];
  for (let i = 0; i < outline.length; i++) {
    const p = pair(own(outline, String(i)));
    if (!p) return fail('outline must contain dense finite [x,y] pairs within -100..100');
    points.push(p);
  }
  if (same(points[0]!, points[points.length - 1]!)) points.pop();
  if (points.length < 3) return fail('outline needs three distinct corners');
  const problem = issue(points);
  if (problem) return fail(problem);
  // Only exact straight boundary runs are redundant; never silently erase near-straight corners.
  for (let i = 0; i < points.length && points.length > 3;) {
    if (cross(points[(i + points.length - 1) % points.length]!, points[i]!, points[(i + 1) % points.length]!) === 0) { points.splice(i, 1); i = 0; }
    else i++;
  }
  if (points.reduce((sum, p, i) => sum + cross(points[0]!, p, points[(i + 1) % points.length]!), 0) < 0) points.reverse();
  const transformed: Vec2[] = points.map(([x, y]) => [x * taper + offset[0], y * taper + offset[1]]);
  if (transformed.some(p => !scalar(p[0], -100, 100) || !scalar(p[1], -100, 100))) return fail('tapered endpoint exceeds -100..100');
  const round = (p: Vec2): Vec2 => [Math.fround(p[0]), Math.fround(p[1])];
  const start = points.map(round), end = transformed.map(round);
  for (const ring of [start, end]) {
    const problem = issue(ring);
    if (problem) return fail(`Float32: ${problem}`);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, k = (i + 2) % ring.length;
      if (Math.sign(cross(points[i]!, points[j]!, points[k]!)) !== Math.sign(cross(ring[i]!, ring[j]!, ring[k]!))) return fail('Float32 changes outline corner topology');
    }
  }
  const halfDepth = Math.fround(depth / 2);
  if (!hasWallClearance(points, transformed, start, end, taper)) return fail('Float32 wall displacement exceeds outline feature clearance');
  if (!alignedWalls(points, transformed, start, end, depth, halfDepth)) return fail('Float32 changes wall orientation or planarity');
  const caps = triangulate(start, end);
  if (!caps) return fail('outline has no safe shared cap triangulation');
  return { ok: true, value: { outline: points, start, end, halfDepth, caps } };
}
