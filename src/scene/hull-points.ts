import { LIMITS, WORLD } from './spec.ts';
import type { Vec3 } from './types.ts';

export type HullPointsResult = { ok: true; points: Vec3[] } | { ok: false; message: string };
const fail = (message: string): HullPointsResult => ({ ok: false, message });
const ownValue = (array: unknown[], index: number): unknown => {
  const d = Object.getOwnPropertyDescriptor(array, String(index));
  return d && 'value' in d ? d.value : undefined;
};
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (v: Vec3): number => Math.hypot(...v);

/** Strictly admit, copy, round, deduplicate and order points for geometry. */
export function resolveHullPoints(raw: unknown): HullPointsResult {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length > LIMITS.maxHullPoints) return fail(`expected 4 to ${LIMITS.maxHullPoints} points`);
  const points: Vec3[] = [];
  for (let i = 0; i < raw.length; i++) {
    const p = ownValue(raw, i);
    if (!Array.isArray(p) || p.length !== 3) return fail(`point ${i} must have 3 finite coordinates`);
    const coords = [ownValue(p, 0), ownValue(p, 1), ownValue(p, 2)];
    if (coords.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < WORLD.min || n > WORLD.max)) {
      return fail(`point ${i} must have finite coordinates in [${WORLD.min}, ${WORLD.max}]`);
    }
    points.push(coords.map((n) => Math.fround(n as number) || 0) as Vec3);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const unique = points.filter((p, i) => i === 0 || p.some((n, j) => n !== points[i - 1]![j]));
  if (unique.length < 4) return fail('points must span three dimensions');
  const span = Math.max(...[0, 1, 2].map((axis) => Math.max(...unique.map((p) => p[axis]!)) - Math.min(...unique.map((p) => p[axis]!))));
  const tolerance = 1e-6 * Math.max(1, span);
  // Use the most widely separated pair and the most distant points from its line and plane.
  let a = unique[0]!, b = unique[1]!, longest = 0;
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const d = length(sub(unique[j]!, unique[i]!));
      if (d > longest) { longest = d; a = unique[i]!; b = unique[j]!; }
    }
  }
  if (longest <= tolerance) return fail('points must span three dimensions');
  const ab = sub(b, a);
  let normal: Vec3 = [0, 0, 0], maxArea = 0;
  for (const p of unique) {
    const n = cross(ab, sub(p, a));
    const area = length(n);
    if (area > maxArea) { maxArea = area; normal = n; }
  }
  if (maxArea / longest <= tolerance) return fail('points must span three dimensions');
  let maxHeight = 0;
  for (const p of unique) maxHeight = Math.max(maxHeight, Math.abs(dot(normal, sub(p, a))) / maxArea);
  if (maxHeight <= tolerance) return fail('points must span three dimensions');
  return { ok: true, points: unique };
}
