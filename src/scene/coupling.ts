// Coupling geometry: where two parts that are said to turn together must stand for that to be believable. Pure arithmetic on the bodies the validator
// keeps (no renderer): a spur gear meshes with another at the sum of their pitch radii and parallel axes, a bevel gear meets its mate at right angles with
// the two points (apexes) together. Each fit answers one of three things: it already holds (inside a tolerance), it is close enough to be moved (the later
// part is shifted, with a note), or it is too far to be a slip of the pen (nothing is moved; the note names the nearest valid place).

import { apply, worldOf } from './attach.ts';
import type { Body } from './attach.ts';
import type { Vec3 } from './types.ts';

/** A round part in the scene's space: where its middle is, which way its axis runs, how far out its pitch circle is, how thick it is. */
export type Round = {
  id: string;
  c: Vec3;
  axis: Vec3;
  /** The pitch radius of a gear (half way between the tips of the teeth and their roots); the radius of a wheel; a cone's radius at its base. */
  rp: number;
  /** How far out the rim reaches (the tips of a gear's teeth). */
  outer: number;
  width: number;
  kind: 'gear' | 'wheel' | 'cone';
  /** A gear's tooth count. */
  n?: number;
  /** A cone: its height, and where its point is (the axis points from its base to its point). */
  tip?: Vec3;
  height?: number;
};

/** How far from parallel (or from a right angle) axes may be and still count as that. */
export const AXIS_TOLERANCE_DEG = 8;
/** The most a coupling is moved to be repaired, as a multiple of what it should be (the sum of the pitch radii): beyond it, it is refused. */
export const REPAIR_REACH = 2.5;
/** A mesh within this share of the sum of pitch radii is left as written. */
export const MESH_TOLERANCE = 0.06;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : [0, 0, 0]; };
const round3 = (a: Vec3): Vec3 => [Math.round(a[0] * 1000) / 1000, Math.round(a[1] * 1000) / 1000, Math.round(a[2] * 1000) / 1000];
const round = (n: number): number => Math.round(n * 100) / 100;
const deg = (rad: number): number => (rad * 180) / Math.PI;

/** The pitch radius of a ready-made gear: half way between its tips and its roots, as the kit cuts it. */
export function pitchRadius(outer: number, teeth: number): number {
  return (outer + outer * (teeth > 40 ? 0.93 : 0.86)) / 2;
}

/** Whether the body, or a body that holds it, is placed by a face of its holder (its pos is then an offset, not a place in the holder's space). */
function mountedAnywhere(bodies: ReadonlyMap<string, Body>, id: string): boolean {
  for (let cur: string | undefined = id, n = 0; cur !== undefined && n < 32; n++) {
    const b = bodies.get(cur);
    if (!b) return false;
    if (b.mounted) return true;
    cur = b.parent;
  }
  return false;
}

/** A gear, wheel or cone as a round part where it stands in the scene; undefined when it is none of those or its place is not known by its own words. */
export function roundOf(bodies: ReadonlyMap<string, Body>, id: string): Round | undefined {
  const b = bodies.get(id);
  if (!b?.size || b.size.some((n) => !(n > 0)) || mountedAnywhere(bodies, id)) return undefined;
  const m = worldOf(bodies, id);
  const c = apply(m, [0, 0, 0]);
  if (b.cone) {
    const axis = unit([m.r[1]!, m.r[4]!, m.r[7]!]);
    const height = b.size[1];
    return { id, c, axis, rp: Math.max(b.size[0], b.size[2]) / 2, outer: Math.max(b.size[0], b.size[2]) / 2, width: height, kind: 'cone', height, tip: add(c, mul(axis, height / 2)) };
  }
  if (b.shape === 'cylinder') {
    const axis = unit([m.r[1]!, m.r[4]!, m.r[7]!]);
    return { id, c, axis, rp: Math.max(b.size[0], b.size[2]) / 2, outer: Math.max(b.size[0], b.size[2]) / 2, width: b.size[1], kind: 'wheel' };
  }
  if (b.part !== 'gear' && b.part !== 'wheel') return undefined;
  const axis = unit([m.r[2]!, m.r[5]!, m.r[8]!]);
  const outer = Math.max(b.size[0], b.size[1]) / 2;
  if (b.part === 'wheel') return { id, c, axis, rp: outer, outer, width: b.size[2], kind: 'wheel' };
  const n = b.n ?? 16;
  return { id, c, axis, rp: pitchRadius(outer, n), outer, width: b.size[2], kind: 'gear', n };
}

/** Where a part should stand (its middle, in the scene's space). */
export type Move = { id: string; to: Vec3 };
export type Fit =
  | { verdict: 'ok' }
  /** The later part (and any other that must go with the fit) is shifted to `moves`; `by` is the longest of the shifts. */
  | { verdict: 'repair'; moves: Move[]; by: number; why: string }
  /** Too far to be a slip: nothing moves; `moves` is the nearest valid place. */
  | { verdict: 'refuse'; moves: Move[]; by: number; why: string };

/** The angle between two axes taken as lines (an axis and its opposite are the same line), in degrees. */
export function lineAngle(a: Vec3, b: Vec3): number {
  return deg(Math.acos(Math.min(1, Math.abs(dot(a, b)))));
}

/** Whether two gears stand on one shaft (their axes run the same way and pass through each other's middle): that is not a mesh. */
export function sameShaft(a: Round, b: Round): boolean {
  if (lineAngle(a.axis, b.axis) > AXIS_TOLERANCE_DEG) return false;
  const between = sub(b.c, a.c);
  const across = len(sub(between, mul(a.axis, dot(between, a.axis))));
  return across <= 0.25 * Math.min(a.rp, b.rp);
}

/**
 * Two spur gears (or wheels that drive by touching) mesh when their axes are parallel and the middles of the two stand the sum of the pitch radii apart
 * across the axis, in one plane along it. Where `b` should stand for that, shifting it the least: along the line between the two, and along the axis only
 * when the faces hardly overlap.
 */
export function meshFit(a: Round, b: Round): Fit {
  const angle = lineAngle(a.axis, b.axis);
  if (angle > AXIS_TOLERANCE_DEG) {
    return { verdict: 'refuse', moves: [{ id: b.id, to: round3(b.c) }], by: 0, why: `their axes are ${Math.round(angle)} degrees apart, and spur gears mesh only on parallel axes (turn ${b.id} to run parallel to ${a.id})` };
  }
  const want = a.rp + b.rp;
  const between = sub(b.c, a.c);
  const axial = dot(between, a.axis);
  const across = sub(between, mul(a.axis, axial));
  const dist = len(across);
  const overlap = (a.width + b.width) / 2 - Math.abs(axial);
  const engaged = overlap >= 0.5 * Math.min(a.width, b.width);
  if (Math.abs(dist - want) <= MESH_TOLERANCE * want && engaged) return { verdict: 'ok' };
  // Which way along the line between them: as written, else a direction in the plane that is steady (the scene's x, or y when the axis runs that way).
  const fallback: Vec3 = Math.abs(a.axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const dir = dist > 1e-6 ? mul(across, 1 / dist) : unit(cross(a.axis, fallback));
  const to = round3(add(add(a.c, mul(a.axis, engaged ? axial : 0)), mul(dir, want)));
  const by = len(sub(to, b.c));
  const why = engaged
    ? `their middles are ${round(dist)} apart, and gears with pitch radii ${round(a.rp)} and ${round(b.rp)} mesh ${round(want)} apart`
    : `the two are not in one plane along their axis (their faces hardly overlap), and their middles are ${round(dist)} apart, where gears with pitch radii ${round(a.rp)} and ${round(b.rp)} mesh ${round(want)} apart`;
  return { verdict: dist > REPAIR_REACH * want || by > REPAIR_REACH * want ? 'refuse' : 'repair', moves: [{ id: b.id, to }], by, why };
}

/** Where two axis lines come closest, as the point on the first. */
function crossing(p1: Vec3, d1: Vec3, p2: Vec3, d2: Vec3): Vec3 {
  const w = sub(p1, p2);
  const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2), d = dot(d1, w), e = dot(d2, w);
  const den = a * c - b * b;
  return add(p1, mul(d1, Math.abs(den) < 1e-9 ? 0 : (b * e - c * d) / den));
}

/**
 * Two bevel gears (cones) meet at right angles with their points together. The point of meeting is where the axes cross (on the first one's axis, if they
 * pass each other by); each cone is shifted until its point stands there: the later one whole, the earlier along its own axis.
 */
export function bevelFit(a: Round, b: Round): Fit {
  if (!a.tip || !b.tip) return { verdict: 'ok' };
  const angle = deg(Math.acos(Math.min(1, Math.abs(dot(a.axis, b.axis)))));
  if (Math.abs(angle - 90) > AXIS_TOLERANCE_DEG) {
    return { verdict: 'refuse', moves: [{ id: b.id, to: round3(b.c) }], by: 0, why: `their axes are ${Math.round(angle)} degrees apart, and bevel gears mesh at right angles (turn ${b.id} square to ${a.id})` };
  }
  const meet = crossing(a.c, a.axis, b.c, b.axis);
  const near = (0.05 * ((a.height ?? 0) + (b.height ?? 0))) / 2;
  const moves: Move[] = [];
  let by = 0;
  for (const [r, shift] of [[a, sub(meet, a.tip)], [b, sub(meet, b.tip)]] as const) {
    const far = len(shift);
    if (far <= near) continue;
    by = Math.max(by, far);
    moves.push({ id: r.id, to: round3(add(r.c, shift)) });
  }
  if (moves.length === 0) return { verdict: 'ok' };
  const why = `their points are ${round(len(sub(a.tip, b.tip)))} apart, and bevel gears meet with the points together`;
  return { verdict: by > REPAIR_REACH * (a.rp + b.rp) ? 'refuse' : 'repair', moves, by, why };
}

/** The directions a side of a part is seen from the front, in the scene's space. */
export const SIDE_DIRECTIONS: Readonly<Record<string, Vec3>> = { left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1] };

/** Where a side of a round part meets its rim, in the scene's space: the direction taken flat into the wheel's plane (undefined when it points along the axis). */
export function rimPoint(r: Round, side: string): Vec3 | undefined {
  const d = SIDE_DIRECTIONS[side];
  if (!d) return undefined;
  const flat = sub(d, mul(r.axis, dot(d, r.axis)));
  return len(flat) < 1e-3 ? undefined : add(r.c, mul(unit(flat), r.rp));
}

/**
 * Whether a belt or chain strand along the same side of two parallel wheels of different size (the tops of both) is no tangent to both, and so cuts
 * through the larger. False when the two are the same size, or one lies inside the other, or their axes are not parallel.
 */
export function strandCutsWheel(a: Round, b: Round): boolean {
  if (lineAngle(a.axis, b.axis) > AXIS_TOLERANCE_DEG) return false;
  const big = Math.max(a.rp, b.rp);
  if (Math.abs(a.rp - b.rp) <= 0.08 * big) return false;
  const between = sub(b.c, a.c);
  const along = len(sub(between, mul(a.axis, dot(between, a.axis))));
  return along > Math.abs(a.rp - b.rp) + 1e-6;
}

/**
 * A rope that leaves a wheel at a point of its rim should leave along the tangent there. When it instead runs in through the wheel (heads into it from the
 * rim point), the tangent point from the rope's other end nearest the written one is where it should leave. Undefined when the rope already leaves the
 * wheel (along it, or away), or its other end is inside the rim.
 */
export function ropeTangent(wheel: Round, rim: Vec3, other: Vec3): Vec3 | undefined {
  const out = unit(sub(rim, wheel.c));
  const heading = unit(sub(other, rim));
  if (dot(heading, out) >= -0.3) return undefined;
  const q = sub(other, wheel.c);
  const flat = sub(q, mul(wheel.axis, dot(q, wheel.axis)));
  const d = len(flat);
  if (d <= wheel.rp * 1.02) return undefined;
  const w = mul(flat, 1 / d);
  const phi = Math.acos(wheel.rp / d);
  const side = cross(wheel.axis, w);
  const at = (s: number): Vec3 => add(wheel.c, mul(add(mul(w, Math.cos(phi)), mul(side, s * Math.sin(phi))), wheel.rp));
  const p = at(1), n = at(-1);
  return dot(sub(p, wheel.c), out) >= dot(sub(n, wheel.c), out) ? p : n;
}

/** Whether two gears are meshed as they stand: parallel axes, not on one shaft, the middles the sum of the pitch radii apart (a little looser than a fit), in one plane. */
export function meshes(a: Round, b: Round): boolean {
  if (a.kind !== 'gear' || b.kind !== 'gear' || sameShaft(a, b)) return false;
  if (lineAngle(a.axis, b.axis) > AXIS_TOLERANCE_DEG) return false;
  const want = a.rp + b.rp;
  const between = sub(b.c, a.c);
  const axial = dot(between, a.axis);
  const dist = len(sub(between, mul(a.axis, axial)));
  const overlap = (a.width + b.width) / 2 - Math.abs(axial);
  return Math.abs(dist - want) <= 2 * MESH_TOLERANCE * want && overlap >= 0.5 * Math.min(a.width, b.width);
}

/** A long flat box in the scene's space (a rack): where its middle is, the way it runs, the way across it (along a pinion's axis) and the way out of its teeth. */
export type Bar = { id: string; c: Vec3; length: Vec3; lengthSize: number; width: Vec3; widthSize: number; depth: Vec3; depthSize: number };

/** A box at least twice as long as it is wide or deep, as a bar; undefined for anything else or a box whose place is not known by its own words. */
export function barOf(bodies: ReadonlyMap<string, Body>, id: string): Bar | undefined {
  const b = bodies.get(id);
  if (!b || b.shape !== 'box' || b.part !== undefined || !b.size || b.size.some((n) => !(n > 0)) || mountedAnywhere(bodies, id)) return undefined;
  const m = worldOf(bodies, id);
  const order = [0, 1, 2].sort((i, j) => b.size![j]! - b.size![i]!);
  const [li, mi, si] = order as [number, number, number];
  if (b.size[li]! < 2 * b.size[mi]!) return undefined;
  const col = (i: number): Vec3 => unit([m.r[i]!, m.r[3 + i]!, m.r[6 + i]!]);
  return { id, c: apply(m, [0, 0, 0]), length: col(li), lengthSize: b.size[li]!, width: col(mi), widthSize: b.size[mi]!, depth: col(si), depthSize: b.size[si]! };
}

/**
 * A rack touches its pinion when the pinion's axis runs across the rack (along its width or its depth), and the pitch circle just touches the rack's
 * toothed face (the face of the bar nearest the pinion), the pinion standing over the width of the rack. `moving` is the one that is shifted: the pinion
 * along the way out of the face, or the bar the other way, and either along the pinion's axis when the two are not over each other.
 */
export function rackFit(pinion: Round, bar: Bar, moving: 'pinion' | 'bar'): Fit {
  // Which of the bar's two short ways runs along the pinion's axis: that is the width; the other is the depth, out of the toothed face.
  const w = Math.abs(dot(bar.width, pinion.axis)) >= Math.abs(dot(bar.depth, pinion.axis)) ? 0 : 1;
  const across = w === 0 ? bar.width : bar.depth, acrossSize = w === 0 ? bar.widthSize : bar.depthSize;
  const out = w === 0 ? bar.depth : bar.width, outSize = w === 0 ? bar.depthSize : bar.widthSize;
  const angle = lineAngle(across, pinion.axis);
  const subject = moving === 'pinion' ? pinion.id : bar.id;
  const here = moving === 'pinion' ? pinion.c : bar.c;
  if (angle > AXIS_TOLERANCE_DEG || lineAngle(bar.length, pinion.axis) < 90 - AXIS_TOLERANCE_DEG) {
    return { verdict: 'refuse', moves: [{ id: subject, to: round3(here) }], by: 0, why: `the pinion's axis does not run across the rack (it is ${Math.round(angle)} degrees off the rack's width), and a rack meets its pinion with the axis across it (turn ${subject} to suit)` };
  }
  const between = sub(pinion.c, bar.c);
  const side = dot(between, out) >= 0 ? 1 : -1;
  const gap = side * dot(between, out) - outSize / 2; // from the toothed face to the pinion's middle
  const axial = dot(between, pinion.axis);
  const overlap = (pinion.width + acrossSize) / 2 - Math.abs(axial);
  const engaged = overlap >= 0.5 * Math.min(pinion.width, acrossSize);
  if (Math.abs(gap - pinion.rp) <= MESH_TOLERANCE * pinion.rp && engaged) return { verdict: 'ok' };
  const toward = pinion.rp - gap; // how much further out of the face the pinion's middle must stand
  const along = engaged ? 0 : axial; // how far the pinion's middle is from the bar's middle, along the pinion's axis
  const shift: Vec3 = moving === 'pinion'
    ? add(mul(out, side * toward), mul(pinion.axis, -along))
    : add(mul(out, -side * toward), mul(pinion.axis, along));
  const to = round3(add(here, shift));
  const by = len(shift);
  const why = engaged
    ? `the pitch circle (radius ${round(pinion.rp)}) is ${round(gap)} from the rack's toothed face, where a pinion and its rack touch`
    : `the pinion and the rack are not over each other (the pinion is ${round(Math.abs(axial))} off the rack's middle along its axis), and its pitch circle (radius ${round(pinion.rp)}) is ${round(gap)} from the toothed face`;
  return { verdict: by > REPAIR_REACH * (pinion.rp + outSize / 2) ? 'refuse' : 'repair', moves: [{ id: subject, to }], by, why };
}

/**
 * Where a rope should meet a wheel when it ends on it with no side given (so it would run to the axle through the wheel): the point of the rim where
 * the rope from `other` leaves it along the tangent (the one with the shorter strand); undefined when the other end is not clear of the rim.
 */
export function seatTangent(wheel: Round, other: Vec3): Vec3 | undefined {
  const q = sub(other, wheel.c);
  const flat = sub(q, mul(wheel.axis, dot(q, wheel.axis)));
  const d = len(flat);
  if (d <= wheel.rp * 1.02) return undefined;
  const w = mul(flat, 1 / d);
  const phi = Math.acos(wheel.rp / d);
  const side = cross(wheel.axis, w);
  const at = (s: number): Vec3 => add(wheel.c, mul(add(mul(w, Math.cos(phi)), mul(side, s * Math.sin(phi))), wheel.rp));
  const p = at(1), n = at(-1);
  return len(sub(other, p)) <= len(sub(other, n)) ? p : n;
}
