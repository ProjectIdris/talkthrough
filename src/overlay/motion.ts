// Machines: parts that keep moving once started. A spin turns a part about its own axis without end (at a
// rate that can ramp up and down); a locked spin turns as a multiple of another part (a meshed gear, a cam at
// half the crank's speed); a crank joins a piston to a crankshaft through a rod; a cam pushes a valve down while
// its nose points at it; a flash lights an object at one point of a cycle. None of it needs a clock: every
// position is a function of the angles, and the angles are a function of time since the step began, so a frame
// grab, a clip and the live page agree, and a finished scene can go on running by adding seconds to the angles.
//
// The motion is kept apart from the objects' rest values. An object's pos, rot and opacity stay what the
// scene set; `pose` on the frame's object holds where the machine has put it just now, and the renderer draws
// the pose when there is one.

import type { AddAction, Vec3 } from '../scene/types.ts';
import { crankThrow, pistonPinDrop, rodEnds } from './mechanism-geometry.ts';

const DEG = Math.PI / 180;

export type Axis = 0 | 1 | 2;
export type Lock = { byKey: number; ratio: number; phase: number };

/** A spin as it stands in a frame: the angle (degrees) and rate (degrees a second) it has now. */
export type SpinState = { key: number; axis: Axis; angle: number; rate: number; lock?: Lock };
export type CrankDef = { key: number; shaftKey: number; rodKey: number | null; pin: number };
export type CamDef = { key: number; byKey: number; lift: number | undefined; open: number; phase: number };
export type FlashDef = { key: number; byKey: number; angle: number; span: number; cycle: number };

/**
 * A loop: a repeating motion that is not a full turn, for any object. Its phase is an angle kept like a spin's, in `Motion.spins` under the key
 * `loopDriver(key)` (below zero, so it never meets an object): free, it turns once a period; locked, it follows another part. The pose is a function
 * of that angle (the cosine of it: 1 at the far end, so a part locked to a crank is at the top when the crank pin is).
 */
export type LoopKind = 'slide' | 'swing' | 'pulse';
export type LoopDef = { key: number; kind: LoopKind; axis: Axis; amount: number; pivot: Vec3 };
/** The key of the angle that drives the loop on object `key`; the same call gives the object back from the driver's key. */
export const loopDriver = (key: number): number => -1 - key;
/** Where a free loop's angle starts, so it begins at rest: the cosine is 0 for slide and swing, and the pulse is at its smallest. */
export const loopStart = (kind: LoopKind): number => (kind === 'pulse' ? 180 : 270);

/**
 * Joints and couplings (the mechanism layer). A joint is a freedom an object has: a hinge about `axis` through `pivot`, a slide along `axis` or `dir`,
 * or fixed to ride with `toKey`; `min`/`max` stop its value (it is held at the limit, not turned back). Its value comes from a driver: a spin (the angle), a
 * loop (a swing in degrees, a slide in units) or a coupling to another object's value: ratio x that value + phase, or, between a hinge and a slide,
 * `pitch` units of travel for a whole turn. Every value is a function of the angles, so frames, clips and the live page agree.
 */
export type JointDef = { key: number; kind: 'hinge' | 'slide' | 'fixed'; axis: Axis; dir: Vec3 | null; pivot: Vec3; min: number | undefined; max: number | undefined; toKey: number | null };
export type CoupleDef = { key: number; byKey: number; ratio: number; pitch: number | undefined; phase: number };

export type Motion = { spins: SpinState[]; cranks: CrankDef[]; cams: CamDef[]; flashes: FlashDef[]; loops: LoopDef[]; joints: JointDef[]; couples: CoupleDef[] };
export type Pose = { pos?: Vec3; rot?: Vec3; opacity?: number; /** A multiplier on the object's own scale. */ scale?: Vec3 };

export const emptyMotion = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [], loops: [], joints: [], couples: [] });

// ---- Spins over time ------------------------------------------------------------------------------

/** One stretch of a spin's rate: from `from` to `to` degrees a second over `ramp` seconds, then steady. `angle` is the angle at `start`. */
type RateSeg = { start: number; ramp: number; from: number; to: number; angle: number };
export type SpinPlan = { key: number; axis: Axis; segs: RateSeg[]; lock?: { at: number } & Lock };

export function spinPlanFrom(s: SpinState): SpinPlan {
  const plan: SpinPlan = { key: s.key, axis: s.axis, segs: [{ start: -Infinity, ramp: 0, from: s.rate, to: s.rate, angle: s.angle }] };
  if (s.lock) plan.lock = { at: -Infinity, ...s.lock };
  return plan;
}

function freeAt(p: SpinPlan, t: number): { angle: number; rate: number } {
  let seg = p.segs[0] as RateSeg;
  for (const s of p.segs) {
    if (s.start <= t) seg = s;
    else break;
  }
  const base = Math.max(0, t - (seg.start === -Infinity ? 0 : seg.start));
  if (base < seg.ramp) {
    const k = seg.ramp > 0 ? base / seg.ramp : 1;
    return { angle: seg.angle + seg.from * base + ((seg.to - seg.from) * base * k) / 2, rate: seg.from + (seg.to - seg.from) * k };
  }
  return { angle: seg.angle + ((seg.from + seg.to) / 2) * seg.ramp + seg.to * (base - seg.ramp), rate: seg.to };
}

/** The angle and rate of every spin at `t` seconds into the step (a finite t; the caller clamps). */
export function spinsAt(plans: readonly SpinPlan[], t: number): SpinState[] {
  const byKey = new Map(plans.map((p) => [p.key, p] as const));
  const cache = new Map<number, { angle: number; rate: number }>();
  const resolve = (key: number, depth: number): { angle: number; rate: number } => {
    const hit = cache.get(key);
    if (hit) return hit;
    const p = byKey.get(key);
    if (!p) return { angle: 0, rate: 0 };
    let out = freeAt(p, t);
    if (p.lock && t >= p.lock.at && depth < 4 && p.lock.byKey !== key) {
      const by = resolve(p.lock.byKey, depth + 1);
      out = { angle: by.angle * p.lock.ratio + p.lock.phase, rate: by.rate * p.lock.ratio };
    }
    cache.set(key, out);
    return out;
  };
  return plans.map((p) => {
    const r = resolve(p.key, 0);
    const s: SpinState = { key: p.key, axis: p.axis, angle: r.angle, rate: r.rate };
    if (p.lock && t >= p.lock.at) s.lock = { byKey: p.lock.byKey, ratio: p.lock.ratio, phase: p.lock.phase };
    return s;
  });
}

/** Sets a free spin's rate from `at`, getting there over `ramp` seconds. */
export function setRate(plan: SpinPlan, at: number, rate: number, ramp: number, axis: Axis): void {
  const now = freeAt(plan, at);
  plan.axis = axis;
  delete plan.lock;
  plan.segs.push({ start: at, ramp: Math.max(0, ramp), from: now.rate, to: rate, angle: now.angle });
}

/** Makes a spin follow another part from `at`. */
export function setLock(plan: SpinPlan, at: number, lock: Lock, axis: Axis): void {
  plan.axis = axis;
  plan.lock = { at, ...lock };
}

/** Brings a spin to a stop over `ramp` seconds (when the machine is pulled apart). */
export function stopSpin(plan: SpinPlan, at: number, ramp: number): void {
  const now = freeAt(plan, at);
  if (plan.lock && at >= plan.lock.at) {
    // A locked spin stops where it is; it stays locked to nothing from then on.
    delete plan.lock;
    plan.segs.push({ start: at, ramp: 0, from: 0, to: 0, angle: now.angle });
    return;
  }
  plan.segs.push({ start: at, ramp: Math.max(0, ramp), from: now.rate, to: 0, angle: now.angle });
}

// ---- Poses ----------------------------------------------------------------------------------------

/** What the pose pass needs to know of an object in a frame. */
export type PoseObject = { key: number; parentKey: number | null; def: AddAction; pos: Vec3; rot: Vec3; opacity: number };

const sizeOf = (def: AddAction, fallback: Vec3): Vec3 => ('size' in def && def.size ? def.size : fallback);
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where the machine has put each moving object, given the angles. Objects not moved are not in the result. */
export function poses(objects: readonly PoseObject[], motion: Motion): Map<number, Pose> {
  const out = new Map<number, Pose>();
  if (motion.spins.length + motion.cranks.length + motion.cams.length + motion.flashes.length + motion.loops.length + motion.joints.length + motion.couples.length === 0) return out;
  const byKey = new Map(objects.map((o) => [o.key, o] as const));
  const edit = (key: number): Pose => {
    let p = out.get(key);
    if (!p) {
      p = {};
      out.set(key, p);
    }
    return p;
  };
  const spinOf = new Map(motion.spins.map((s) => [s.key, s] as const));
  /** The turn of an object about z, rest and spin together (read from the spin itself, so a part laid on its side still gives its angle). */
  const turnZ = (key: number): number => {
    const sp = spinOf.get(key);
    return sp && sp.axis === 2 ? (byKey.get(key)?.rot[2] ?? 0) + sp.angle : out.get(key)?.rot?.[2] ?? byKey.get(key)?.rot[2] ?? 0;
  };

  const jointOf = new Map(motion.joints.map((j) => [j.key, j] as const));
  for (const s of motion.spins) {
    const o = byKey.get(s.key);
    if (!o || jointOf.get(s.key)?.kind === 'hinge') continue; // a hinge is turned by the joint pass, about its own axis and pivot
    edit(s.key).rot = turned(o.rot, s.axis, s.angle);
  }

  // What holds a machine never rides on it: a cylinder block or housing, a group, or anything a block sits inside. A crank or cam that names one
  // (the validator binds them to the right part, but a scene can reach here by other roads) leaves it still.
  const holders = new Set<number>();
  for (const o of objects) {
    const d = o.def;
    if (d.shape === 'group' || (d.shape === 'part' && (d.part === 'cylinder-block' || d.part === 'housing'))) {
      for (let k: number | null = o.key, n = 0; k !== null && n < 64 && !holders.has(k); k = byKey.get(k)?.parentKey ?? null, n++) holders.add(k);
    }
  }

  for (const c of motion.cranks) {
    const piston = byKey.get(c.key);
    const shaft = byKey.get(c.shaftKey);
    if (!piston || !shaft || piston.parentKey !== shaft.parentKey || holders.has(c.key)) continue;
    const rod = c.rodKey !== null ? byKey.get(c.rodKey) : undefined;
    if (rod && (rod.parentKey !== shaft.parentKey || holders.has(rod.key))) continue;
    // A plain cylinder stands on y (its width is x, its thickness y); laid on its side it is the disc the kit's crankshaft is.
    const written = sizeOf(shaft.def, [1, 1, 1]);
    const shaftSize: Vec3 = shaft.def.shape === 'cylinder' ? [written[0], written[0], written[1]] : written;
    const throws = Math.max(1, Math.min('n' in shaft.def && shaft.def.n ? shaft.def.n : 1, 8));
    const theta = (turnZ(c.shaftKey) + (throws > 1 ? ((c.pin - 1) * 360) / throws : 0)) * DEG;
    const r = crankThrow(shaftSize);
    const pinX = shaft.pos[0] - Math.sin(theta) * r;
    const pinY = shaft.pos[1] + Math.cos(theta) * r;
    const ends = rod ? rodEnds(sizeOf(rod.def, [1, 4 * r, 1])) : { big: 0, small: 0, length: 3.5 * r };
    const dx = piston.pos[0] - pinX;
    const rise = Math.sqrt(Math.max(0, ends.length * ends.length - dx * dx));
    const wristY = pinY + rise;
    const drop = pistonPinDrop(sizeOf(piston.def, [1, 1, 1]));
    edit(c.key).pos = [piston.pos[0], wristY - drop, piston.pos[2]];
    if (rod) {
      const a = Math.atan2(-dx, rise);
      edit(c.rodKey as number);
      const pose = out.get(c.rodKey as number) as Pose;
      pose.pos = [pinX + ends.big * Math.sin(a), pinY - ends.big * Math.cos(a), rod.pos[2]];
      pose.rot = [rod.rot[0], rod.rot[1], a / DEG];
    }
  }

  for (const cam of motion.cams) {
    const valve = byKey.get(cam.key);
    if (!valve || holders.has(cam.key)) continue;
    const d = Math.abs(wrap180(turnZ(cam.byKey) - cam.phase));
    const half = cam.open / 2;
    const bump = d < half ? 0.5 * (1 + Math.cos((Math.PI * d) / half)) : 0;
    const lift = cam.lift ?? sizeOf(valve.def, [1, 1, 1])[1] * 0.2;
    const pos = out.get(cam.key)?.pos ?? valve.pos;
    edit(cam.key).pos = [pos[0], pos[1] - lift * bump, pos[2]];
  }

  for (const f of motion.flashes) {
    const o = byKey.get(f.key);
    if (!o) continue;
    const c = ((((turnZ(f.byKey) - f.angle) % f.cycle) + f.cycle) % f.cycle);
    let v = 0;
    if (c < f.span) {
      const u = c / f.span;
      v = u < 0.1 ? u / 0.1 : Math.pow(1 - (u - 0.1) / 0.9, 1.6);
    }
    edit(f.key).opacity = o.opacity * v;
  }

  // Joints, loops and couplings go last and ride on whatever a spin, crank or cam already did to the same part.
  const loopOf = new Map(motion.loops.map((l) => [l.key, l] as const));
  const coupleOf = new Map(motion.couples.map((c) => [c.key, c] as const));
  const angleOf = new Map(motion.spins.map((s) => [s.key, s.angle] as const));
  /** The kind of freedom an object has, if it has one (its joint, else what its loop or coupling needs). */
  const kindOf = (key: number, depth = 0): 'hinge' | 'slide' | undefined => {
    const j = jointOf.get(key);
    if (j) return j.kind === 'fixed' ? undefined : j.kind;
    const l = loopOf.get(key);
    if (l) return l.kind === 'slide' ? 'slide' : l.kind === 'swing' ? 'hinge' : undefined;
    const c = coupleOf.get(key);
    if (c && depth < 8) {
      const by = kindOf(c.byKey, depth + 1) ?? 'hinge';
      return c.pitch === undefined ? by : by === 'hinge' ? 'slide' : 'hinge';
    }
    return angleOf.has(key) ? 'hinge' : undefined;
  };
  const memo = new Map<number, number | undefined>();
  /** The value of an object's joint now: degrees for a hinge, units for a slide; undefined when nothing drives it. */
  const valueOf = (key: number, depth: number): number | undefined => {
    if (memo.has(key)) return memo.get(key);
    let v: number | undefined;
    const c = coupleOf.get(key);
    const l = loopOf.get(key);
    if (c) {
      const b = depth < 8 ? valueOf(c.byKey, depth + 1) : undefined; // a coupling that comes round to itself is cut here
      if (b !== undefined) {
        const by = kindOf(c.byKey) ?? 'hinge';
        v = c.pitch === undefined ? c.ratio * b + c.phase : by === 'hinge' ? (c.pitch * b) / 360 + c.phase : (360 * b) / c.pitch + c.phase;
      }
    } else if (l && l.kind !== 'pulse') {
      const a = angleOf.get(loopDriver(key));
      if (a !== undefined) v = (Math.cos(a * DEG) * l.amount) / (l.kind === 'slide' ? 2 : 1);
    } else {
      v = angleOf.get(key);
    }
    memo.set(key, v);
    return v;
  };
  const driven = new Set<number>([...jointOf.keys(), ...coupleOf.keys(), ...[...loopOf.values()].filter((l) => l.kind !== 'pulse').map((l) => l.key)]);
  for (const key of driven) {
    const o = byKey.get(key);
    const joint = jointOf.get(key);
    if (!o || joint?.kind === 'fixed') continue;
    const kind = kindOf(key);
    let q = valueOf(key, 0);
    if (kind === undefined || q === undefined) continue;
    const loop = loopOf.get(key);
    // The limits stop the value where they are; a driver that pushes past them is held there (not turned back).
    if (joint?.min !== undefined) q = Math.max(joint.min, q);
    if (joint?.max !== undefined) q = Math.min(joint.max, q);
    const pose = edit(key);
    if (kind === 'slide') {
      const axis = joint ? joint.axis : loop ? loop.axis : 1;
      const unit: Vec3 = joint?.dir ? unitOf(joint.dir) : axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
      const p = pose.pos ?? o.pos;
      pose.pos = [p[0] + unit[0] * q, p[1] + unit[1] * q, p[2] + unit[2] * q];
    } else {
      const axis = joint ? joint.axis : loop ? loop.axis : 2;
      const pivot: Vec3 = joint ? joint.pivot : loop ? loop.pivot : [0, 0, 0];
      pose.rot = turned(pose.rot ?? o.rot, axis, q);
      const [px, py, pz] = pivot;
      if (px !== 0 || py !== 0 || pz !== 0) {
        // About the pivot point, not its own middle: the part goes to pivot + R(q) * (part - pivot).
        const turned = turnAbout(pivot, axis, q);
        const p = pose.pos ?? o.pos;
        pose.pos = [p[0] + px - turned[0], p[1] + py - turned[1], p[2] + pz - turned[2]];
      }
    }
  }
  // A pulse swells the object about its own middle, on top of any scale it has.
  for (const l of motion.loops) {
    if (l.kind !== 'pulse') continue;
    const o = byKey.get(l.key);
    const a = angleOf.get(loopDriver(l.key));
    if (!o || a === undefined) continue;
    const m = 1 + (l.amount - 1) * ((1 + Math.cos(a * DEG)) / 2);
    const pose = edit(l.key);
    const base = pose.scale ?? [1, 1, 1];
    pose.scale = [base[0] * m, base[1] * m, base[2] * m];
  }
  // A fixed joint rides with the object it is fixed to: its move and its turn, about that object's middle (chains settle in a few passes).
  for (let pass = 0; pass < 4; pass++) {
    for (const j of motion.joints) {
      if (j.kind !== 'fixed' || j.toKey === null) continue;
      const o = byKey.get(j.key);
      const to = byKey.get(j.toKey);
      const moved = out.get(j.toKey);
      if (!o || !to || !moved || o.parentKey !== to.parentKey) continue;
      const dRot: Vec3 = [(moved.rot?.[0] ?? to.rot[0]) - to.rot[0], (moved.rot?.[1] ?? to.rot[1]) - to.rot[1], (moved.rot?.[2] ?? to.rot[2]) - to.rot[2]];
      const dPos: Vec3 = [(moved.pos?.[0] ?? to.pos[0]) - to.pos[0], (moved.pos?.[1] ?? to.pos[1]) - to.pos[1], (moved.pos?.[2] ?? to.pos[2]) - to.pos[2]];
      let v: Vec3 = [o.pos[0] - to.pos[0], o.pos[1] - to.pos[1], o.pos[2] - to.pos[2]];
      v = turnAbout(v, 0, dRot[0]);
      v = turnAbout(v, 1, dRot[1]);
      v = turnAbout(v, 2, dRot[2]);
      const pose = edit(j.key);
      pose.pos = [to.pos[0] + dPos[0] + v[0], to.pos[1] + dPos[1] + v[1], to.pos[2] + dPos[2] + v[2]];
      pose.rot = [o.rot[0] + dRot[0], o.rot[1] + dRot[1], o.rot[2] + dRot[2]];
    }
  }
  return out;
}

/**
 * A turn of `deg` about the parent's axis (0 x, 1 y, 2 z) added to an object's rest turn. With the other two angles at 0 it is just the angle added; with
 * them set (a cylinder laid on its side is [90,0,0]) the part turns about the parent's axis, as the scene says, and does not tumble about its own: the
 * result is the same orientation written again as the XYZ turn the renderer draws.
 */
type Row = [number, number, number];
type M3 = [Row, Row, Row];

export function turned(rest: Vec3, axis: Axis, deg: number): Vec3 {
  if (rest[(axis + 1) % 3] === 0 && rest[(axis + 2) % 3] === 0) {
    const out: Vec3 = [rest[0], rest[1], rest[2]];
    out[axis] += deg;
    return out;
  }
  // three.js Euler XYZ: the matrix is Rx * Ry * Rz
  const [x, y, z] = [rest[0] * DEG, rest[1] * DEG, rest[2] * DEG];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  const r: M3 = [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const t: M3 = axis === 2 ? [[c, -s, 0], [s, c, 0], [0, 0, 1]] : axis === 0 ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  const col = (j: 0 | 1 | 2) => (row: Row): number => row[0] * r[0][j] + row[1] * r[1][j] + row[2] * r[2][j];
  const n: M3 = [t[0], t[1], t[2]].map((row) => [col(0)(row), col(1)(row), col(2)(row)] as Row) as M3;
  const m13 = Math.max(-1, Math.min(1, n[0][2]));
  const ey = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-n[1][2], n[2][2]) / DEG, ey / DEG, Math.atan2(-n[0][1], n[0][0]) / DEG];
  return [Math.atan2(n[2][1], n[1][1]) / DEG, ey / DEG, 0];
}

const unitOf = (d: Vec3): Vec3 => {
  const n = Math.hypot(d[0], d[1], d[2]);
  return n < 1e-9 ? [0, 1, 0] : [d[0] / n, d[1] / n, d[2] / n];
};

/** A vector turned about an axis (0 x, 1 y, 2 z) by an angle in degrees. */
function turnAbout(v: Vec3, axis: Axis, deg: number): Vec3 {
  if (deg === 0) return v;
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return axis === 2 ? [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]] : axis === 0 ? [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c] : [v[2] * s + v[0] * c, v[1], v[2] * c - v[0] * s];
}

/** True while any part is turning. */
export function isMoving(motion: Motion): boolean {
  return motion.spins.some((s) => s.rate !== 0);
}

/** The motion `seconds` later, with every spin going on at the rate it has now. */
export function advanceMotion(motion: Motion, seconds: number): Motion {
  if (seconds === 0 || motion.spins.length === 0) return motion;
  const byKey = new Map(motion.spins.map((s) => [s.key, s] as const));
  const free = new Map<number, SpinState>();
  const resolve = (s: SpinState, depth: number): SpinState => {
    const done = free.get(s.key);
    if (done) return done;
    let next: SpinState;
    const by = s.lock && depth < 4 ? byKey.get(s.lock.byKey) : undefined;
    if (s.lock && by && by.key !== s.key) {
      const driver = resolve(by, depth + 1);
      next = { ...s, angle: driver.angle * s.lock.ratio + s.lock.phase, rate: driver.rate * s.lock.ratio };
    } else {
      next = { ...s, angle: s.angle + s.rate * seconds };
    }
    free.set(s.key, next);
    return next;
  };
  return { ...motion, spins: motion.spins.map((s) => resolve(s, 0)) };
}

/** The motion with every spin stopped where it is. */
export function freezeMotion(motion: Motion): Motion {
  if (!isMoving(motion)) return motion;
  return { ...motion, spins: motion.spins.map((s) => ({ key: s.key, axis: s.axis, angle: s.angle, rate: 0 })) };
}
