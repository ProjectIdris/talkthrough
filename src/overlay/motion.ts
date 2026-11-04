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

export type Motion = { spins: SpinState[]; cranks: CrankDef[]; cams: CamDef[]; flashes: FlashDef[] };
export type Pose = { pos?: Vec3; rot?: Vec3; opacity?: number };

export const emptyMotion = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [] });

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
  if (motion.spins.length + motion.cranks.length + motion.cams.length + motion.flashes.length === 0) return out;
  const byKey = new Map(objects.map((o) => [o.key, o] as const));
  const edit = (key: number): Pose => {
    let p = out.get(key);
    if (!p) {
      p = {};
      out.set(key, p);
    }
    return p;
  };
  /** The turn of an object about z, rest and spin together. */
  const turnZ = (key: number): number => out.get(key)?.rot?.[2] ?? byKey.get(key)?.rot[2] ?? 0;

  for (const s of motion.spins) {
    const o = byKey.get(s.key);
    if (!o) continue;
    const rot: Vec3 = [o.rot[0], o.rot[1], o.rot[2]];
    rot[s.axis] += s.angle;
    edit(s.key).rot = rot;
  }

  for (const c of motion.cranks) {
    const piston = byKey.get(c.key);
    const shaft = byKey.get(c.shaftKey);
    if (!piston || !shaft || piston.parentKey !== shaft.parentKey) continue;
    const rod = c.rodKey !== null ? byKey.get(c.rodKey) : undefined;
    if (rod && rod.parentKey !== shaft.parentKey) continue;
    const shaftSize = sizeOf(shaft.def, [1, 1, 1]);
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
    if (!valve) continue;
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
  return out;
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
