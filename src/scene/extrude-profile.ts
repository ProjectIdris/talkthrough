// Validation for a bounded, flat polygon with through-openings. No topology is repaired.
import type { Vec2 } from './types.ts';
import { LIMITS } from './spec.ts';

type Ring = readonly Vec2[];
type Point = readonly [number, number];
type Issue = { field: string; message: string };
const same = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];
const open = (ring: Ring): Ring => ring.length > 1 && same(ring[0]!, ring[ring.length - 1]!) ? ring.slice(0, -1) : ring;
const cross = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = (ring: Ring): number => ring.reduce((sum, a, i) => sum + cross(ring[0]!, a, ring[(i + 1) % ring.length]!), 0);

/** Validate both authored coordinates and the renderer's Float32 positions, without changing input.
 * Near contacts are rejected conservatively: tolerance scales with the profile's extent;
 * Float32 rounding additionally accounts for coordinate magnitude and renderer precision. */
export function extrudeProfileIssue(outline: Ring, holes: readonly Ring[]): Issue | undefined {
  const authored = checkProfile(outline, holes);
  if (authored || holes.length === 0) return authored;
  // Only an authored exact closing point may be removed. A new closure created by
  // rounding is a collapsed edge, not an optional closing marker.
  const round = (ring: Ring): Vec2[] => open(ring).map(([x, y]) => [Math.fround(x), Math.fround(y)]);
  const rounded = checkProfile(round(outline), holes.map(round), false);
  return rounded ? { field: rounded.field, message: `invalid at renderer precision: ${rounded.message}` } : undefined;
}

function checkProfile(outline: Ring, holes: readonly Ring[], allowClosingPoint = true): Issue | undefined {
  if (holes.length === 0) return undefined;
  if (holes.length > LIMITS.maxExtrudeHoles) return { field: 'holes', message: `at most ${LIMITS.maxExtrudeHoles} holes` };
  const all = [outline, ...holes];
  if (outline.length < 3 || outline.length > LIMITS.maxOutline) return { field: 'outline', message: `outline needs 3 to ${LIMITS.maxOutline} points` };
  let total = outline.length;
  for (let h = 0; h < holes.length; h++) {
    const ring = holes[h]!;
    if (ring.length < 3 || ring.length > LIMITS.maxHolePoints) return { field: `holes[${h}]`, message: `hole needs 3 to ${LIMITS.maxHolePoints} points` };
    total += ring.length;
  }
  if (total > LIMITS.maxExtrudePoints) return { field: 'holes', message: `at most ${LIMITS.maxExtrudePoints} points in all rings` };
  for (let r = 0; r < all.length; r++) for (const p of all[r]!) {
    if (!Array.isArray(p) || p.length !== 2 || [p[0], p[1]].some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < -100 || n > 100)) {
      return { field: r === 0 ? 'outline' : `holes[${r - 1}]`, message: 'points must have two finite coordinates from -100 to 100' };
    }
  }
  const points = all.flatMap((ring) => [...ring]);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const scale = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const eps = 1e-9 * scale, crossEps = eps * scale;
  const near = (a: Point, b: Point) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
  const onSegment = (a: Point, b: Point, p: Point) => Math.abs(cross(a, b, p)) <= crossEps && p[0] >= Math.min(a[0], b[0]) - eps && p[0] <= Math.max(a[0], b[0]) + eps && p[1] >= Math.min(a[1], b[1]) - eps && p[1] <= Math.max(a[1], b[1]) + eps;
  const sign = (n: number) => n > crossEps ? 1 : n < -crossEps ? -1 : 0;
  const intersects = (a: Point, b: Point, c: Point, d: Point): boolean => {
    const rawAbC = cross(a, b, c), rawAbD = cross(a, b, d), rawCdA = cross(c, d, a), rawCdB = cross(c, d, b);
    const opposite = (x: number, y: number) => (x < 0 && y > 0) || (x > 0 && y < 0);
    // Never erase a proper crossing just because the orientation values are small.
    if (opposite(rawAbC, rawAbD) && opposite(rawCdA, rawCdB)) return true;
    const abC = sign(rawAbC), abD = sign(rawAbD), cdA = sign(rawCdA), cdB = sign(rawCdB);
    return (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d)) || (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b));
  };
  const rings = allowClosingPoint ? all.map(open) : all;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!, field = r === 0 ? 'outline' : `holes[${r - 1}]`;
    if (ring.length < 3 || Math.abs(area(ring)) <= crossEps) return { field, message: 'ring must have nonzero area' };
    for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
      if (near(ring[i]!, ring[j]!)) return { field, message: 'ring has duplicate or indistinguishable points' };
      // Adjacent edges share their endpoint; reject backtracking overlap as well.
      const nextI = (i + 1) % ring.length, nextJ = (j + 1) % ring.length;
      if (nextI === j || nextJ === i) {
        const shared = nextI === j ? ring[j]! : ring[i]!;
        const a = nextI === j ? ring[i]! : ring[j]!;
        const b = nextI === j ? ring[nextJ]! : ring[nextI]!;
        if (onSegment(a, shared, b) || onSegment(shared, b, a)) return { field, message: 'adjacent edges overlap' };
      } else if (intersects(ring[i]!, ring[nextI]!, ring[j]!, ring[nextJ]!)) return { field, message: 'ring crosses or touches itself' };
    }
  }
  const boundariesIntersect = (a: Ring, b: Ring): boolean => a.some((p, i) => b.some((q, j) => intersects(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)));
  const inside = (p: Point, ring: Ring): boolean => {
    let yes = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if (onSegment(a, b, p)) return false;
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  };
  for (let h = 1; h < rings.length; h++) {
    const ring = rings[h]!, field = `holes[${h - 1}]`;
    if (boundariesIntersect(rings[0]!, ring) || !inside(ring[0]!, rings[0]!)) return { field, message: 'hole must lie strictly inside the outline' };
    for (let j = 1; j < h; j++) {
      if (boundariesIntersect(rings[j]!, ring) || inside(ring[0]!, rings[j]!) || inside(rings[j]![0]!, ring)) return { field, message: 'holes must be disjoint and not nested' };
    }
  }
  return undefined;
}

/** Copy validated rings, remove one closing point and orient for Shape/Path. */
export function normalizeExtrudeProfile(outline: Ring, holes: readonly Ring[]): { outline: Vec2[]; holes: Vec2[][] } {
  const copy = (ring: Ring, clockwise: boolean): Vec2[] => {
    const points: Vec2[] = open(ring).map(([x, y]) => [x, y]);
    if ((area(points) < 0) !== clockwise) points.reverse();
    return points;
  };
  return { outline: copy(outline, true), holes: holes.map((ring) => copy(ring, false)) };
}
