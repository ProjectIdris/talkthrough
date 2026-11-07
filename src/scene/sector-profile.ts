import type { Vec2 } from './types.ts';

type Result = { ok: true; profile: Vec2[] } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1];
const own = (value: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && 'value' in d ? d.value : undefined;
};

/** Bounded simple-polygon checks, repeated after Float32 conversion before rendering. */
function check(points: Vec2[]): string | undefined {
  // Reject ambiguous thin features rather than guess their topology. The unit floor keeps tiny
  // profiles from making the tolerance arbitrarily small; larger coordinates scale both tests.
  // These are profile-space checks only: rotation and GPU conversion can introduce further
  // collapse, so the renderer must separately accept the final transformed Float32 geometry.
  const scale = Math.max(1, ...points.flat().map(Math.abs));
  const lengthEpsilon = scale * 1e-10;
  const areaEpsilon = scale * scale * 1e-10;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]) <= lengthEpsilon) {
        return 'duplicate or numerically indistinguishable profile points';
      }
    }
  }
  const on = (a: Vec2, b: Vec2, p: Vec2): boolean =>
    Math.abs(cross(a, b, p)) <= areaEpsilon &&
    p[0] >= Math.min(a[0], b[0]) - lengthEpsilon && p[0] <= Math.max(a[0], b[0]) + lengthEpsilon &&
    p[1] >= Math.min(a[1], b[1]) - lengthEpsilon && p[1] <= Math.max(a[1], b[1]) + lengthEpsilon;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    area += cross(points[0]!, a, b);
    const turn = cross(a, b, c);
    if (Math.abs(turn) <= areaEpsilon) {
      if (turn !== 0) return 'numerically unsafe nearly collinear profile corner';
      if ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) <= 0) {
        return 'overlapping adjacent profile edges';
      }
    }
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const d = points[j]!;
      const e = points[(j + 1) % points.length]!;
      const abD = cross(a, b, d), abE = cross(a, b, e);
      const deA = cross(d, e, a), deB = cross(d, e, b);
      if (on(a, b, d) || on(a, b, e) || on(d, e, a) || on(d, e, b) ||
          ((abD > 0) !== (abE > 0) && (deA > 0) !== (deB > 0))) {
        return 'profile edges intersect or touch';
      }
    }
  }
  if (Math.abs(area) <= areaEpsilon * points.length) return 'zero-area or numerically unsafe profile';
}

/** Returns a fresh CCW polygon without closing duplicate or exact redundant collinear points. */
export function normalizeSectorProfile(value: unknown): Result {
  if (!Array.isArray(value) || value.length < 3 || value.length > 40) {
    return fail('sector profile needs 3..40 authored points');
  }
  const profile: Vec2[] = [];
  for (let i = 0; i < value.length; i++) {
    const point = own(value, String(i));
    if (!Array.isArray(point) || point.length !== 2) {
      return fail('sector profile points must be dense [radius,y] pairs');
    }
    const radius = own(point, '0'), y = own(point, '1');
    if (typeof radius !== 'number' || typeof y !== 'number' ||
        !Number.isFinite(radius) || !Number.isFinite(y) || radius < 0 || radius > 100 || y < -100 || y > 100) {
      return fail('sector profile requires finite radius 0..100 and y -100..100');
    }
    profile.push([radius, y]);
  }
  if (same(profile[0]!, profile[profile.length - 1]!)) profile.pop();
  if (profile.length < 3) return fail('sector profile needs three distinct corners');
  const problem = check(profile);
  if (problem) return fail(problem);
  // Only exact straight boundary runs are redundant. Near-straight authored corners are not silently erased.
  let changed = true;
  while (changed && profile.length > 3) {
    changed = false;
    for (let i = 0; i < profile.length; i++) {
      if (cross(profile[(i + profile.length - 1) % profile.length]!, profile[i]!, profile[(i + 1) % profile.length]!) === 0) {
        profile.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  const rounded: Vec2[] = profile.map(([r, y]) => [Math.fround(r), Math.fround(y)]);
  const roundedProblem = check(rounded);
  if (roundedProblem) return fail(`Float32: ${roundedProblem}`);
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]!, b = profile[(i + 1) % profile.length]!, c = profile[(i + 2) % profile.length]!;
    const ra = rounded[i]!, rb = rounded[(i + 1) % profile.length]!, rc = rounded[(i + 2) % profile.length]!;
    if (Math.sign(cross(a, b, c)) !== Math.sign(cross(ra, rb, rc)) || (a[0] > 0 && ra[0] === 0)) {
      return fail('Float32 changes profile corner or axis topology');
    }
  }
  const area = profile.reduce((sum, p, i) => sum + cross(profile[0]!, p, profile[(i + 1) % profile.length]!), 0);
  if (area < 0) profile.reverse();
  return { ok: true, profile };
}
