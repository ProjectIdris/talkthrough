// Field lines, illustrated: where the arrows of a magnet's field, a charge's or a mass's, or the field between two plates, run. Pure geometry in the front
// plane (z = 0) about the middle of the field; the timeline turns each line into an arrow. Nothing is solved: a dipole's lines are the textbook curves
// r = L sin^2(theta), kept to the outside of the magnet; the rest are straight.

import type { Vec3 } from './types.ts';

export type FieldKind = 'dipole' | 'radial' | 'uniform';
export type FieldShape = { kind: FieldKind; axis?: 'x' | 'y'; size?: number; count?: number; gap?: number; flip?: boolean };

const POINTS = 24;

/** A point from its place along the axis and across it, in the front plane. */
function at(axis: 'x' | 'y', along: number, across: number): Vec3 {
  return axis === 'x' ? [along, across, 0] : [across, along, 0];
}

/** The field of a positive pole at +x and a negative at -x (a unit each), at a point of the front plane. */
function fieldAt(px: number, py: number, pole: number): [number, number] {
  let ex = 0, ey = 0;
  for (const [cx, sign] of [[pole, 1], [-pole, -1]] as const) {
    const dx = px - cx, dy = py;
    const d3 = Math.pow(dx * dx + dy * dy, 1.5) || 1e-9;
    ex += (sign * dx) / d3;
    ey += (sign * dy) / d3;
  }
  return [ex, ey];
}

/**
 * One line of a dipole: from a ring round the positive pole at `alpha` from the axis, step by step the way the field points (a short step, a midpoint
 * correction) until it comes to the negative pole, or has gone far past `size`; then `POINTS` points of it spaced by length. `side` mirrors it below the axis.
 */
function traceLine(pole: number, ring: number, alpha: number, side: number, size: number, axis: 'x' | 'y'): Vec3[] {
  const path: Array<[number, number]> = [[pole + ring * Math.cos(alpha), side * ring * Math.sin(alpha)]];
  const step = Math.max(0.01, pole * 0.04);
  for (let i = 0; i < 4000; i++) {
    const [px, py] = path[path.length - 1] as [number, number];
    if (Math.hypot(px + pole, py) < ring || Math.hypot(px, py) > size * 1.6) break;
    const dir = (x: number, y: number): [number, number] => {
      const [ex, ey] = fieldAt(x, y, pole);
      const n = Math.hypot(ex, ey) || 1;
      return [ex / n, ey / n];
    };
    const [dx, dy] = dir(px, py);
    const [mx, my] = dir(px + (dx * step) / 2, py + (dy * step) / 2);
    path.push([px + mx * step, py + my * step]);
  }
  // Even by length.
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((path[i] as number[])[0]! - (path[i - 1] as number[])[0]!, (path[i] as number[])[1]! - (path[i - 1] as number[])[1]!));
  const total = cum[cum.length - 1] as number;
  const out: Vec3[] = [];
  let j = 1;
  for (let i = 0; i < POINTS; i++) {
    const want = (total * i) / (POINTS - 1);
    while (j < path.length - 1 && (cum[j] as number) < want) j++;
    const span = (cum[j] as number) - (cum[j - 1] as number);
    const t = span > 1e-12 ? (want - (cum[j - 1] as number)) / span : 0;
    const p0 = path[j - 1] as [number, number], p1 = path[j] as [number, number];
    out.push(at(axis, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t));
  }
  return out;
}

/**
 * The lines, each a run of points in the direction the field points (the lines of a dipole leave the end on the positive side of the axis and curve
 * round to the other; `flip` reverses them all). Never more than `count` lines, and never a line with fewer than two points.
 */
export function fieldLines(shape: FieldShape): Vec3[][] {
  const axis = shape.axis ?? 'x';
  const size = Math.max(0.5, shape.size ?? 5);
  const count = Math.max(2, Math.min(16, Math.round(shape.count ?? 8)));
  const lines: Vec3[][] = [];
  if (shape.kind === 'dipole') {
    // Two opposite poles near the ends of a bar `gap` long (three tenths of the reach by default). Each line is followed from a small ring round the
    // positive pole, the way the field points, to the negative one. They leave at angles from the axis chosen so the widest loop just reaches `size`.
    const end = Math.max(0.1, (shape.gap ?? size * 0.3) / 2);
    const pole = end * 0.85;
    const ring = pole * 0.3;
    // A loop launched at angle alpha from the axis is widest (across the middle) at pole x tan(phi) with cos(phi) = (1 - cos(alpha)) / 2.
    const keep = pole / Math.hypot(pole, size);
    const widest = Math.acos(Math.max(-1, Math.min(1, 1 - 2 * keep)));
    const perSide = Math.max(1, Math.floor(count / 2));
    const last = (120 * Math.PI) / 180;
    for (let side = 1; side >= -1; side -= 2) {
      for (let k = 0; k < perSide; k++) {
        const alpha = perSide === 1 ? (widest + last) / 2 : last - ((last - widest) * k) / (perSide - 1);
        lines.push(traceLine(pole, ring, alpha, side, size, axis));
      }
    }
  } else if (shape.kind === 'radial') {
    const from = Math.max(0.05, (shape.gap ?? 1) / 2);
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count;
      lines.push([[Math.cos(a) * from, Math.sin(a) * from, 0], [Math.cos(a) * size, Math.sin(a) * size, 0]]);
    }
  } else {
    // Parallel lines along the axis, spread across the gap between the plates.
    const across = shape.gap ?? size * 0.6;
    for (let i = 0; i < count; i++) {
      const y = count === 1 ? 0 : -across / 2 + (across * i) / (count - 1);
      lines.push([at(axis, -size / 2, y), at(axis, size / 2, y)]);
    }
  }
  return shape.flip === true ? lines.map((l) => [...l].reverse()) : lines;
}
