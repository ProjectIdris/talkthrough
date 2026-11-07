// Bounded data-only loft preparation, shared by admission and rendering. No renderer import.
import type { Vec2, Vec3 } from './types.ts';

export const LOFT_STRIPS = { low: 4, mid: 8, high: 12 } as const;
export type LoftMesh = { positions: Float32Array; normals: Float32Array; indices: number[]; edges: Float32Array };
const own = (value: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && 'value' in d ? d.value : undefined;
};
const scalar = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
function ring(value: unknown): Vec2[] | undefined {
  if (!Array.isArray(value) || value.length < 3 || value.length > 24) return;
  const points: Vec2[] = [];
  for (let i = 0; i < value.length; i++) {
    const p = own(value, String(i));
    if (!Array.isArray(p) || p.length !== 2) return;
    const x = own(p, '0'), y = own(p, '1');
    if (!scalar(x, -100, 100) || !scalar(y, -100, 100)) return;
    points.push([x, y]);
  }
  return points;
}
const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
type MovingPoint = [Vec2, Vec2];
type Polynomial = [number, number, number];
/** Orientation of three linearly moving points: c + b*t + a*t*t. */
function orientation(p: MovingPoint, q: MovingPoint, r: MovingPoint): Polynomial {
  const u = sub(q[0], p[0]), v = sub(r[0], p[0]);
  const du = sub(sub(q[1], p[1]), u), dv = sub(sub(r[1], p[1]), v);
  return [cross(u, v), cross(du, v) + cross(u, dv), cross(du, dv)];
}
const valueAt = ([c, b, a]: Polynomial, t: number): number => (a * t + b) * t + c;
function minimum(p: Polynomial): number {
  const t = p[2] > 0 ? -p[1] / (2 * p[2]) : -1;
  return Math.min(p[0], valueAt(p, 1), t > 0 && t < 1 ? valueAt(p, t) : Infinity);
}
/** Every other corner stays strictly inside every oriented edge, continuously, not only at sampled rings. */
function convexThroughout(start: Vec2[], end: Vec2[], epsilon: number): boolean {
  for (let i = 0; i < start.length; i++) {
    const j = (i + 1) % start.length;
    for (let k = 0; k < start.length; k++) {
      if (k === i || k === j) continue;
      if (!(minimum(orientation([start[i]!, end[i]!], [start[j]!, end[j]!], [start[k]!, end[k]!])) > epsilon)) return false;
    }
  }
  return true;
}
/** Each strip-boundary segment collapses at exactly one end: its vector is
 * t*endEdge or (1-t)*startEdge. Factor that legal endpoint contact analytically;
 * the remaining orientation is linear, with at most one interior event. */
function events(p: MovingPoint, q: MovingPoint, r: MovingPoint): number[] {
  const collapsedAtStart = p[0][0] === q[0][0] && p[0][1] === q[0][1];
  const edge = collapsedAtStart ? sub(q[1], p[1]) : sub(q[0], p[0]);
  const first = cross(edge, sub(r[0], p[0])), last = cross(edge, sub(r[1], p[1]));
  return first === last ? [] : [first / (first - last)];
}
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2, epsilon: number): boolean {
  // Near a collinearity event, floating orientation signs alone can disagree.
  // Spatially disjoint segments cannot intersect, regardless of those signs.
  for (const axis of [0, 1] as const) {
    if (Math.max(a[axis], b[axis]) < Math.min(c[axis], d[axis]) || Math.max(c[axis], d[axis]) < Math.min(a[axis], b[axis])) return false;
  }
  const o = (x: Vec2, y: Vec2, z: Vec2) => cross(sub(y, x), sub(z, x));
  const on = (x: Vec2, y: Vec2, z: Vec2, turn: number) => Math.abs(turn) <= epsilon &&
    z[0] >= Math.min(x[0], y[0]) && z[0] <= Math.max(x[0], y[0]) && z[1] >= Math.min(x[1], y[1]) && z[1] <= Math.max(x[1], y[1]);
  const x = o(a, b, c), y = o(a, b, d), z = o(c, d, a), w = o(c, d, b);
  return on(a, b, c, x) || on(a, b, d, y) || on(c, d, a, z) || on(c, d, b, w) ||
    ((x > 0) !== (y > 0) && (z > 0) !== (w > 0));
}
/** A triangulated warped wall differs from its ideal bilinear patch. Check its actual
 * section boundary for intersections between every orientation-root event, and at
 * the events themselves. Endpoints are checked separately as convex rings. */
function safeStrip(start: Vec2[], end: Vec2[], epsilon: number): boolean {
  // A common linearly moving origin preserves every intersection, while keeping
  // long translated sections out of unrelated edges' broad-phase bounds.
  const first = start[0]!, last = end[0]!;
  start = start.map(p => sub(p, first));
  end = end.map(p => sub(p, last));
  const boundary: MovingPoint[] = [];
  for (let i = 0; i < start.length; i++) {
    boundary.push([start[i]!, end[i]!], [start[i]!, end[(i + 1) % start.length]!]);
  }
  const bounds = boundary.map((p, i) => {
    const q = boundary[(i + 1) % boundary.length]!;
    return [Math.min(p[0][0], p[1][0], q[0][0], q[1][0]), Math.max(p[0][0], p[1][0], q[0][0], q[1][0]),
      Math.min(p[0][1], p[1][1], q[0][1], q[1][1]), Math.max(p[0][1], p[1][1], q[0][1], q[1][1])];
  });
  for (let i = 0; i < boundary.length; i++) for (let j = i + 2; j < boundary.length; j++) {
    if (i === 0 && j === boundary.length - 1) continue;
    const bi = bounds[i]!, bj = bounds[j]!;
    if (bi[1]! < bj[0]! || bj[1]! < bi[0]! || bi[3]! < bj[2]! || bj[3]! < bi[2]!) continue;
    const a = boundary[i]!, b = boundary[(i + 1) % boundary.length]!, c = boundary[j]!, d = boundary[(j + 1) % boundary.length]!;
    const times = [0, 1, ...[events(a, b, c), events(a, b, d), events(c, d, a), events(c, d, b)].flat().filter(t => t > 0 && t < 1)].sort((x, y) => x - y);
    const check = (t: number) => intersects(mix(...a, t), mix(...b, t), mix(...c, t), mix(...d, t), epsilon);
    for (let k = 1; k < times.length; k++) {
      if (times[k]! > times[k - 1]! && check((times[k]! + times[k - 1]!) / 2)) return false;
      if (times[k]! < 1 && check(times[k]!)) return false;
    }
  }
  return true;
}

/** Reject unsafe input rather than changing correspondence or silently flattening a profile. */
export function prepareLoft(outline: unknown, endOutline: unknown, depth: unknown, strips: number): LoftMesh | undefined {
  if (!scalar(depth, 0.01, 100) || !Object.values(LOFT_STRIPS).includes(strips as 4 | 8 | 12)) return;
  const start = ring(outline), end = ring(endOutline);
  if (!start || !end || start.length !== end.length) return;
  const extent = (points: Vec2[], axis: 0 | 1) => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]));
  const span = Math.max(extent(start, 0), extent(start, 1), extent(end, 0), extent(end, 1));
  const epsilon = span * span * 1e-12;
  if (!(span > 0)) return;
  if (cross(sub(start[1]!, start[0]!), sub(start[2]!, start[0]!)) < 0) { start.reverse(); end.reverse(); }
  if (!convexThroughout(start, end, epsilon)) return;
  const rings: Vec3[][] = [];
  for (let k = 0; k <= strips; k++) {
    const t = k / strips;
    rings.push(start.map((p, i): Vec3 => [Math.fround(p[0] + (end[i]![0] - p[0]) * t), Math.fround(p[1] + (end[i]![1] - p[1]) * t), Math.fround(depth * (t - 0.5))]));
  }
  for (let k = 0; k < strips; k++) {
    const a = rings[k]!.map((p): Vec2 => [p[0], p[1]]), b = rings[k + 1]!.map((p): Vec2 => [p[0], p[1]]);
    if (!(rings[k + 1]![0]![2] > rings[k]![0]![2]) || !convexThroughout(a, b, epsilon) || !safeStrip(a, b, epsilon)) return;
  }
  const positions: number[] = [], normals: number[] = [], indices: number[] = [], edges: number[] = [];
  const vertex = (p: Vec3, n: Vec3): number => { const i = positions.length / 3; positions.push(...p); normals.push(...n); return i; };
  for (let i = 0; i < start.length; i++) {
    const j = (i + 1) % start.length, base = positions.length / 3;
    for (let k = 0; k <= strips; k++) {
      const t = k / strips, e = mix(sub(start[j]!, start[i]!), sub(end[j]!, end[i]!), t);
      for (const corner of [i, j]) {
        const delta = sub(end[corner]!, start[corner]!);
        const n: Vec3 = [e[1] * depth, -e[0] * depth, cross(e, delta)], length = Math.hypot(...n);
        if (!(length > 0)) return;
        vertex(rings[k]![corner]!, n.map(v => v / length) as Vec3);
      }
    }
    for (let k = 0; k < strips; k++) { const a = base + 2 * k; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    edges.push(...rings[0]![i]!, ...rings[0]![j]!, ...rings[strips]![i]!, ...rings[strips]![j]!, ...rings[0]![i]!, ...rings[strips]![i]!);
  }
  for (const k of [0, strips]) {
    const base = positions.length / 3, sign = k === 0 ? -1 : 1;
    for (const p of rings[k]!) vertex(p, [0, 0, sign]);
    for (let i = 1; i < start.length - 1; i++) indices.push(base, base + i + (sign < 0 ? 1 : 0), base + i + (sign > 0 ? 1 : 0));
  }
  const p = new Float32Array(positions), n = new Float32Array(normals);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) return;
    for (const at of [a, b, c]) if (!((nx * n[at]! + ny * n[at + 1]! + nz * n[at + 2]!) / length > 1e-6)) return;
  }
  return { positions: p, normals: n, indices, edges: new Float32Array(edges) };
}
