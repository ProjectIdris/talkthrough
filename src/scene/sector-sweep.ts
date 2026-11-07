import type { Vec2, Vec3 } from './types.ts';

const MIN_NORMAL_COS = 0.99;

function face(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const x = b[0] - a[0], y = b[1] - a[1], z = b[2] - a[2];
  const u = c[0] - a[0], v = c[1] - a[1], w = c[2] - a[2];
  return [y * w - z * v, z * u - x * w, x * v - y * u];
}

function aligned(actual: Vec3, expected: Vec3): boolean {
  const lengths = Math.hypot(...actual) * Math.hypot(...expected);
  const dot = actual[0] * expected[0] + actual[1] * expected[1] + actual[2] * expected[2];
  return lengths > 0 && Number.isFinite(lengths) && dot >= MIN_NORMAL_COS * lengths;
}

/**
 * A canonical CCW profile, swept into the exact Float32 grid the renderer will use.
 * Reject collapsed, reversed or badly tilted triangles before reserving scene IDs.
 * Side checks use the ideal frustum triangles, not smooth shading normals. All possible
 * non-collinear cap triples are checked so acceptance is independent of triangulation.
 * Work is bounded by 40 profile points, 64 angular segments and two sets of cap triples.
 */
export function prepareSectorRings(profile: readonly Vec2[], sides: number, sweep: number): Vec3[][] | null {
  if (profile.length < 3 || profile.length > 40 || !Number.isFinite(sides) || sides < 3 || sides > 64 ||
      !Number.isFinite(sweep) || sweep < 1 || sweep > 359) return null;
  const segments = Math.max(Math.ceil(sweep / 90), Math.ceil(Math.round(sides) * sweep / 360));
  const angle = sweep * Math.PI / 180;
  const ideal: Vec3[][] = [];
  const rings: Vec3[][] = [];
  for (let j = 0; j <= segments; j++) {
    const theta = angle * j / segments;
    const ring: Vec3[] = profile.map(([r, y]) => [r * Math.sin(theta), y, r * Math.cos(theta)]);
    ideal.push(ring);
    rings.push(ring.map(([x, y, z]) => [Math.fround(x), Math.fround(y), Math.fround(z)]));
  }
  for (let i = 0; i < profile.length; i++) {
    const next = (i + 1) % profile.length;
    if (profile[i]![0] === 0 && profile[next]![0] === 0) continue;
    for (let j = 0; j < segments; j++) {
      const a = rings[j]![i]!, b = rings[j]![next]!;
      const c = rings[j + 1]![i]!, d = rings[j + 1]![next]!;
      const ia = ideal[j]![i]!, ib = ideal[j]![next]!;
      const ic = ideal[j + 1]![i]!, id = ideal[j + 1]![next]!;
      // One triangle at each axis endpoint has zero area by construction and is not emitted.
      if (profile[i]![0] !== 0 && !aligned(face(a, c, b), face(ia, ic, ib))) return null;
      if (profile[next]![0] !== 0 && !aligned(face(c, d, b), face(ic, id, ib))) return null;
    }
  }
  for (const end of [0, segments]) {
    const theta = angle * end / segments;
    for (let i = 0; i < profile.length - 2; i++) {
      for (let j = i + 1; j < profile.length - 1; j++) {
        for (let k = j + 1; k < profile.length; k++) {
          const a = profile[i]!, b = profile[j]!, c = profile[k]!;
          const turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (turn === 0) continue;
          // [radius,y] CCW maps to the cap normal facing away from increasing angle.
          const expected: Vec3 = [-Math.cos(theta) * turn, 0, Math.sin(theta) * turn];
          if (!aligned(face(rings[end]![i]!, rings[end]![j]!, rings[end]![k]!), expected)) return null;
        }
      }
    }
  }
  return rings;
}
