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
import { CAM_ROW, CRANK_ROW, FLASH_ROW, JOINT_ROWS, LOOP_ROWS, MUSCLE_ROW, bind, coupleAs, coupleRow, fresh, num } from '../scene/movement-rows.ts';
import type { JointName, LoopName } from '../scene/movement-rows.ts';

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
export type LoopKind = LoopName;
/**
 * `gate` swings a hinge open on one half of the cycle and shuts it on the other (a one-way valve); `float` bobs the object up and down by `amount`
 * units and rocks it `tilt` degrees about z (a boat on water). `damp` is the number of cycles for the motion to fall to a third (it settles); `start` is the
 * angle the loop began at, which the fall is counted from.
 */
export type LoopDef = { key: number; kind: LoopKind; axis: Axis; amount: number; pivot: Vec3; damp?: number; start?: number; tilt?: number; /** A swing about the middle of this object, wherever it stands (a pendulum hung from a part): the pivot is worked out each frame. */ pivotKey?: number };
/** How much of its swing a damped free loop still has when its angle is `a`: one for a loop that does not settle. */
export const loopFade = (l: LoopDef, a: number): number => (l.damp !== undefined && l.start !== undefined ? Math.exp(-Math.max(0, (a - l.start) / 360) / l.damp) : 1);
/** The key of the angle that drives the loop on object `key`; the same call gives the object back from the driver's key. */
export const loopDriver = (key: number): number => -1 - key;
/**
 * The angle that drives the loop on one axis of a ball joint (which has up to three, one for each axis): its own key range, below every other, and the
 * owner of any driver key (a loop's or a ball's) comes back from `driverOwner`.
 */
const BALL_BASE = -10_000_000;
export const ballDriver = (key: number, axis: Axis): number => BALL_BASE - key * 3 - axis;
/** The angle that drives the wave on a tube: its own key range, below the rest. */
const WAVE_BASE = -1_000_000_000;
export const waveDriver = (key: number): number => WAVE_BASE - key;
export const driverOwner = (driver: number): number => (driver <= WAVE_BASE ? WAVE_BASE - driver : driver <= BALL_BASE ? Math.floor((BALL_BASE - driver) / 3) : -1 - driver);
/** Where a free loop's angle starts, so it begins at rest: the cosine is 0 for slide and swing, and the pulse is at its smallest. */
export const loopStart = (kind: LoopKind): number => LOOP_ROWS[kind].start;
/** Whether a loop is a freedom of its part (a turn or a slide, worked out with the joints) rather than a swell or a bob on top. */
const isFreedom = (l: LoopDef): boolean => LOOP_ROWS[l.kind].motion === 'turn' || LOOP_ROWS[l.kind].motion === 'slide';
/** A loop's value now, from the row of its kind, when the angle of its cycle is `a` degrees; `rock` is a bob's turn about z. */
function loopValue(l: LoopDef, a: number): { value: number; rock: number } {
  const row = LOOP_ROWS[l.kind];
  const b = row.ease !== undefined && l.start !== undefined ? Math.min(1, Math.max(0, (a - l.start) / row.ease)) : 1;
  const scope = fresh({ a: a * DEG, amount: l.amount, tilt: l.tilt ?? 0, fade: loopFade(l, a), born: row.ease !== undefined ? b * b * (3 - 2 * b) : 1 });
  return { value: num(row.value, scope), rock: row.rock !== undefined ? num(row.rock, scope) : 0 };
}

/**
 * Joints and couplings (the mechanism layer). A joint is a freedom an object has: a hinge about `axis` through `pivot`, a slide along `axis` or `dir`,
 * a pivot (a turn about the part's own axis through its own middle: a forearm, a screw), a ball (a turn about all three axes of the parent about the
 * pivot point, each axis driven by its own spin or loop and held to `limit`) or fixed to ride with `toKey`; `min`/`max` stop its value (it is held at the limit, not turned back). Its value comes from a driver: a spin (the angle), a
 * loop (a swing in degrees, a slide in units) or a coupling to another object's value: ratio x that value + phase, or, between a hinge and a slide,
 * `pitch` units of travel for a whole turn. Every value is a function of the angles, so frames, clips and the live page agree.
 */
export type JointKind = JointName;
export type JointDef = { key: number; kind: JointKind; axis: Axis; dir: Vec3 | null; pivot: Vec3; min: number | undefined; max: number | undefined; toKey: number | null; /** ball: how far each axis may turn each way, degrees. */ limit: Vec3 | null };
export type CoupleDef = { key: number; byKey: number; ratio: number; pitch: number | undefined; phase: number };

/**
 * A muscle: a connector from a point of a holder to a point of the part it pulls, which contracts to (1 - contract x cycle) of its relaxed length and
 * turns the part's hinge or pivot to make it so. The cycle (0 relaxed to 1 most contracted) is the cosine of the angle kept under `loopDriver(key)`.
 */
export type MuscleDef = { key: number; holderKey: number; connectorKey: number; from: Vec3; to: Vec3; contract: number };
/**
 * A wave travelling along a tube: a swell (amount above 1) or a squeeze (below 1) of its radius, width (a fraction of the length) across, `count` of them spaced
 * evenly. Where it is is the angle kept under `waveDriver(key)`, in laps, the same as a stream's markers: a crest and a marker of the same period are together.
 */
export type WaveDef = { key: number; amount: number; width: number; count: number };
export type Motion = { spins: SpinState[]; cranks: CrankDef[]; cams: CamDef[]; flashes: FlashDef[]; loops: LoopDef[]; joints: JointDef[]; couples: CoupleDef[]; muscles?: MuscleDef[]; waves?: WaveDef[] };
export type Pose = { pos?: Vec3; rot?: Vec3; opacity?: number; /** A multiplier on the object's own scale. */ scale?: Vec3 };

export const emptyMotion = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [], loops: [], joints: [], couples: [], muscles: [], waves: [] });

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
export type PoseObject = { key: number; parentKey: number | null; def: AddAction; pos: Vec3; rot: Vec3; opacity: number; scale?: Vec3 };

const lengthOf = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Where the muscle's end on the pulled part is, in the space the part sits in, when its joint has the value `q`. */
function muscleEnd(o: PoseObject, j: JointDef, to: Vec3, q: number): Vec3 {
  const s = o.scale ?? [1, 1, 1];
  const local: Vec3 = [to[0] * s[0], to[1] * s[1], to[2] * s[2]];
  if (JOINT_ROWS[j.kind].own) {
    const v = applyM(matOf(turnedLocal(o.rot, j.axis, q)), local);
    return [o.pos[0] + v[0], o.pos[1] + v[1], o.pos[2] + v[2]];
  }
  const v = applyM(matOf(turned(o.rot, j.axis, q)), local);
  const t = turnAbout(j.pivot, j.axis, q);
  return [o.pos[0] + j.pivot[0] - t[0] + v[0], o.pos[1] + j.pivot[1] - t[1] + v[1], o.pos[2] + j.pivot[2] - t[2] + v[2]];
}

type Link = { pos: Vec3; m: M3; s: Vec3 };
/** The transforms from an object up through its parents to the top of the scene, each as it stands now (`posed` where the machine has moved it). */
function chainOf(byKey: ReadonlyMap<number, PoseObject>, posed: ReadonlyMap<number, Pose>, start: number | null): Link[] | undefined {
  const out: Link[] = [];
  for (let key = start, n = 0; key !== null && n < 64; n++) {
    const o = byKey.get(key);
    if (!o) return undefined;
    const at = posed.get(key);
    out.push({ pos: at?.pos ?? o.pos, m: matOf(at?.rot ?? o.rot), s: o.scale ?? [1, 1, 1] });
    key = o.parentKey;
  }
  return out;
}
/** A point of the first object of a chain, in the space the top of the chain is in. */
function upThrough(chain: readonly Link[], point: Vec3): Vec3 {
  let p = point;
  for (const t of chain) {
    const v = applyM(t.m, [p[0] * t.s[0], p[1] * t.s[1], p[2] * t.s[2]]);
    p = [t.pos[0] + v[0], t.pos[1] + v[1], t.pos[2] + v[2]];
  }
  return p;
}
/** The other way: a point of the top space, in the space of the first object of the chain. */
function downThrough(chain: readonly Link[], point: Vec3): Vec3 {
  let p = point;
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i]!;
    const v = applyM(transposeM(t.m), [p[0] - t.pos[0], p[1] - t.pos[1], p[2] - t.pos[2]]);
    p = [v[0] / (t.s[0] || 1), v[1] / (t.s[1] || 1), v[2] / (t.s[2] || 1)];
  }
  return p;
}

/**
 * A muscle is measured in the world: both its ends are taken up through their parents to the top of the scene, so a parent that is scaled differently on
 * each axis (a squashed holder) does not skew how long the muscle is. The far end is a point of the holder, which may be anywhere in the scene.
 */
function muscleWorld(byKey: ReadonlyMap<number, PoseObject>, posed: ReadonlyMap<number, Pose>, m: MuscleDef, pulled: PoseObject): { a: Vec3; up: Link[] } | undefined {
  const holder = chainOf(byKey, posed, m.holderKey);
  const above = chainOf(byKey, posed, pulled.parentKey);
  return holder && above ? { a: upThrough(holder, m.from), up: above } : undefined;
}

/**
 * How long a muscle is when relaxed, in the space the connector is drawn in (its own parents' space, where its restLength is read): the distance between
 * its ends with the joint at its rest value.
 */
export function muscleRest(objects: readonly PoseObject[], m: MuscleDef, joint: JointDef): number | undefined {
  const byKey = new Map(objects.map((o) => [o.key, o] as const));
  const pulled = byKey.get(m.key);
  const w = pulled ? muscleWorld(byKey, new Map(), m, pulled) : undefined;
  if (!pulled || !w) return undefined;
  const b = upThrough(w.up, muscleEnd(pulled, joint, m.to, 0));
  const home = chainOf(byKey, new Map(), byKey.get(m.connectorKey)?.parentKey ?? null) ?? [];
  return lengthOf(downThrough(home, w.a), downThrough(home, b));
}

/**
 * The value of the pulled part's joint that makes the muscle `cycle` (0..1) of the way to its contracted length. The joint is walked from its rest value
 * the way that shortens the muscle, to where the muscle is shortest inside the joint's limits; the target length is found between the two by bisection.
 * A target shorter than that stays at the shortest, one longer than the relaxed length stays at rest. Pure in its inputs.
 */
function muscleValue(m: MuscleDef, byKey: ReadonlyMap<number, PoseObject>, posed: ReadonlyMap<number, Pose>, pulled: PoseObject, joint: JointDef, cycle: number): number | undefined {
  const w = muscleWorld(byKey, posed, m, pulled);
  if (!w) return undefined;
  const lo = joint.min ?? MUSCLE_ROW.low, hi = joint.max ?? MUSCLE_ROW.high;
  const dist = (q: number): number => lengthOf(w.a, upThrough(w.up, muscleEnd(pulled, joint, m.to, q)));
  const q0 = Math.max(lo, Math.min(hi, 0));
  const target = num(MUSCLE_ROW.target, fresh({ rest: dist(0), contract: m.contract, cycle }));
  const d0 = dist(q0);
  if (target >= d0) return q0;
  // Walk from rest the way it shortens, to the first place it stops shortening.
  const step = (hi - lo) / MUSCLE_ROW.walk;
  const eps = step / 2;
  const dir = dist(Math.min(hi, q0 + eps)) < dist(Math.max(lo, q0 - eps)) ? 1 : -1;
  let qm = q0, dm = d0;
  for (let q = q0 + dir * step; q >= lo - 1e-9 && q <= hi + 1e-9; q += dir * step) {
    const d = dist(Math.max(lo, Math.min(hi, q)));
    if (d >= dm) break;
    qm = Math.max(lo, Math.min(hi, q));
    dm = d;
  }
  if (target <= dm) return qm;
  let near = q0, far = qm;
  for (let i = 0; i < MUSCLE_ROW.bisect; i++) {
    const mid = (near + far) / 2;
    if (dist(mid) > target) near = mid;
    else far = mid;
  }
  return (near + far) / 2;
}

/** Where a real model's part turns, from its own middle (a clock hand's boss), when its source says; a turn that names no pivot goes about it, not about the part's middle. */
function hubOf(o: PoseObject): Vec3 | undefined {
  const h = (o.def as { hub?: Vec3 }).hub;
  if (!h || (h[0] === 0 && h[1] === 0 && h[2] === 0)) return undefined;
  const s = o.scale ?? [1, 1, 1];
  return [h[0] * s[0], h[1] * s[1], h[2] * s[2]];
}

/** Moves a part so that a turn of `deg` about `axis` through the point `about` (from its middle) is what it makes, not a turn about its middle. */
function turnedAboutPoint(pose: Pose, o: PoseObject, about: Vec3, axis: Axis, deg: number): void {
  const t = turnAbout(about, axis, deg);
  const p = pose.pos ?? o.pos;
  pose.pos = [p[0] + about[0] - t[0], p[1] + about[1] - t[1], p[2] + about[2] - t[2]];
}

const sizeOf = (def: AddAction, fallback: Vec3): Vec3 => ('size' in def && Array.isArray(def.size) ? def.size : fallback);
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where the machine has put each moving object, given the angles. Objects not moved are not in the result. */
export function poses(objects: readonly PoseObject[], motion: Motion): Map<number, Pose> {
  const out = new Map<number, Pose>();
  if (motion.spins.length + motion.cranks.length + motion.cams.length + motion.flashes.length + motion.loops.length + motion.joints.length + motion.couples.length + (motion.muscles?.length ?? 0) === 0) return out;
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
    const jm = jointOf.has(s.key) ? JOINT_ROWS[jointOf.get(s.key)!.kind].motion : undefined;
    if (!o || jm === 'turn' || jm === 'ball') continue; // a joint is turned by the joint pass, about its own axis and pivot
    const spun = edit(s.key);
    spun.rot = turned(o.rot, s.axis, s.angle);
    const hub = hubOf(o);
    if (hub) turnedAboutPoint(spun, o, hub, s.axis, s.angle);
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
    const shaftSize: Vec3 = drawsOwnPin(shaft.def) ? [written[0], written[0], written[1]] : written;
    const throws = Math.max(1, Math.min('n' in shaft.def && shaft.def.n ? shaft.def.n : 1, 8));
    const r = crankThrow(shaftSize);
    const ends = rod ? rodEnds(sizeOf(rod.def, [1, 4 * r, 1])) : { big: 0, small: 0, length: 3.5 * r };
    const g = crankPinSize(shaft.def, rod?.def);
    const v = bind(fresh({
      shaftX: shaft.pos[0], shaftY: shaft.pos[1], shaftZ: shaft.pos[2], pistonX: piston.pos[0], pistonZ: piston.pos[2], turn: turnZ(c.shaftKey), throws, pin: c.pin, r,
      big: ends.big, length: ends.length, drop: pistonPinDrop(sizeOf(piston.def, [1, 1, 1])), plain: drawsOwnPin(shaft.def), thick: g.thick, rodD: g.rodD, pinH: g.pin[1], rodZ: rod ? rod.pos[2] : 0,
    }), CRANK_ROW.lets);
    edit(c.key).pos = [num(CRANK_ROW.piston[0], v), num(CRANK_ROW.piston[1], v), num(CRANK_ROW.piston[2], v)];
    if (rod) {
      edit(c.rodKey as number);
      const pose = out.get(c.rodKey as number) as Pose;
      pose.pos = [num(CRANK_ROW.rod.pos[0], v), num(CRANK_ROW.rod.pos[1], v), num(CRANK_ROW.rod.pos[2], v)];
      pose.rot = [rod.rot[0], rod.rot[1], num(CRANK_ROW.rod.rotZ, v)];
    }
    const pinObj = byKey.get(crankPinKey(c.key));
    if (pinObj) edit(pinObj.key).pos = [num(CRANK_ROW.pin[0], v), num(CRANK_ROW.pin[1], v), num(CRANK_ROW.pin[2], v)];
  }

  for (const cam of motion.cams) {
    const valve = byKey.get(cam.key);
    if (!valve || holders.has(cam.key)) continue;
    const pos = out.get(cam.key)?.pos ?? valve.pos;
    const v = bind(fresh({ turn: turnZ(cam.byKey), phase: cam.phase, open: cam.open, liftSet: cam.lift !== undefined, liftOpt: cam.lift ?? 0, valveH: sizeOf(valve.def, [1, 1, 1])[1], posY: pos[1] }), CAM_ROW.lets);
    edit(cam.key).pos = [pos[0], num(CAM_ROW.y, v), pos[2]];
  }

  for (const f of motion.flashes) {
    const o = byKey.get(f.key);
    if (!o) continue;
    const v = bind(fresh({ turn: turnZ(f.byKey), angle: f.angle, span: f.span, cycle: f.cycle, opacity: o.opacity }), FLASH_ROW.lets);
    edit(f.key).opacity = num(FLASH_ROW.opacity, v);
  }

  // Joints, loops and couplings go last and ride on whatever a spin, crank or cam already did to the same part.
  const loopOf = new Map(motion.loops.map((l) => [l.key, l] as const));
  const coupleOf = new Map(motion.couples.map((c) => [c.key, c] as const));
  const muscleOf = new Map((motion.muscles ?? []).map((m) => [m.key, m] as const));
  const angleOf = new Map(motion.spins.map((s) => [s.key, s.angle] as const));
  /** The kind of freedom an object has, if it has one (its joint, else what its loop or coupling needs). */
  const kindOf = (key: number, depth = 0): 'turn' | 'slide' | undefined => {
    const j = jointOf.get(key);
    if (j) return JOINT_ROWS[j.kind].as;
    const l = loopOf.get(key);
    if (l) return LOOP_ROWS[l.kind].motion === 'slide' ? 'slide' : LOOP_ROWS[l.kind].motion === 'turn' ? 'turn' : undefined;
    const c = coupleOf.get(key);
    if (c && depth < 8) {
      const by = kindOf(c.byKey, depth + 1) ?? 'turn';
      return coupleAs(coupleRow(c.pitch !== undefined, by), by);
    }
    return angleOf.has(key) ? 'turn' : undefined;
  };
  const memo = new Map<number, number | undefined>();
  /** The value of an object's joint now: degrees for a hinge, units for a slide; undefined when nothing drives it. */
  const valueOf = (key: number, depth: number): number | undefined => {
    if (memo.has(key)) return memo.get(key);
    let v: number | undefined;
    const c = coupleOf.get(key);
    const l = loopOf.get(key);
    const mu = muscleOf.get(key);
    if (mu) {
      // A muscle pulls its part: the value is where its joint must be for the connector to be as short as the cycle says. Its holder's pose is the one so far.
      const pulled = byKey.get(key), joint = jointOf.get(key);
      const a = angleOf.get(loopDriver(key));
      if (pulled && joint && JOINT_ROWS[joint.kind].motion === 'turn' && a !== undefined) v = muscleValue(mu, byKey, out, pulled, joint, num(MUSCLE_ROW.cycle, fresh({ a: a * DEG })));
    } else if (c) {
      const b = depth < 8 ? valueOf(c.byKey, depth + 1) : undefined; // a coupling that comes round to itself is cut here
      if (b !== undefined) {
        const by = kindOf(c.byKey) ?? 'turn';
        v = num(coupleRow(c.pitch !== undefined, by).value, fresh({ b, ratio: c.ratio, pitch: c.pitch ?? 0, phase: c.phase }));
      }
    } else if (l && isFreedom(l)) {
      const a = angleOf.get(loopDriver(key));
      if (a !== undefined) v = loopValue(l, a).value;
    } else {
      v = angleOf.get(key);
    }
    memo.set(key, v);
    return v;
  };
  const driven = new Set<number>([...jointOf.keys(), ...coupleOf.keys(), ...muscleOf.keys(), ...[...loopOf.values()].filter(isFreedom).map((l) => l.key)]);
  for (const key of driven) {
    const o = byKey.get(key);
    const joint = jointOf.get(key);
    if (!o || (joint && (JOINT_ROWS[joint.kind].motion === 'ride' || JOINT_ROWS[joint.kind].motion === 'ball'))) continue;
    const kind = kindOf(key);
    let q = valueOf(key, 0);
    if (kind === undefined || q === undefined) continue;
    const loop = loopOf.get(key);
    // The limits stop the value where they are; a driver that pushes past them is held there (not turned back).
    if (joint?.min !== undefined) q = Math.max(joint.min, q);
    if (joint?.max !== undefined) q = Math.min(joint.max, q);
    const pose = edit(key);
    if (kind === 'slide') {
      const axis = joint ? joint.axis : loop ? loop.axis : JOINT_ROWS.slide.axis;
      const unit: Vec3 = joint?.dir ? unitOf(joint.dir) : axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
      const p = pose.pos ?? o.pos;
      pose.pos = [p[0] + unit[0] * q, p[1] + unit[1] * q, p[2] + unit[2] * q];
    } else if (joint && JOINT_ROWS[joint.kind].own) {
      // About the part's own axis through its own middle: the turn comes after the rest orientation, not about the parent's axis.
      pose.rot = turnedLocal(pose.rot ?? o.rot, joint.axis, q);
      const hub = hubOf(o);
      if (hub) turnedAboutPoint(pose, o, hub, joint.axis, q);
    } else {
      const axis = joint ? joint.axis : loop ? loop.axis : JOINT_ROWS.hinge.axis;
      let pivot: Vec3 = joint ? joint.pivot : loop ? loop.pivot : [0, 0, 0];
      if (pivot[0] === 0 && pivot[1] === 0 && pivot[2] === 0) pivot = hubOf(o) ?? pivot;
      if (!joint && loop?.pivotKey !== undefined) {
        // The middle of the part it hangs from, taken to the world and into the space this part sits in, less where this part is.
        const held = chainOf(byKey, out, loop.pivotKey), home = chainOf(byKey, out, o.parentKey);
        if (held && (home || o.parentKey === null)) {
          const there = downThrough(home ?? [], upThrough(held, [0, 0, 0]));
          const here = pose.pos ?? o.pos;
          pivot = [there[0] - here[0], there[1] - here[1], there[2] - here[2]];
        }
      }
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
  // A ball joint turns about all three axes of the parent, x first, then y, then z, about its pivot point (its attached point when it names none and
  // is attached): each axis is a swing loop of its own and/or a spin about that axis, held to the limit on that axis.
  for (const j of motion.joints) {
    if (JOINT_ROWS[j.kind].motion !== 'ball') continue;
    const o = byKey.get(j.key);
    if (!o) continue;
    const q: Vec3 = [0, 0, 0];
    for (const l of motion.loops) {
      if (l.key !== j.key || l.kind !== 'swing') continue;
      const a = angleOf.get(ballDriver(j.key, l.axis));
      if (a !== undefined) q[l.axis] += Math.cos(a * DEG) * l.amount;
    }
    const sp = spinOf.get(j.key);
    if (sp) q[sp.axis] += sp.angle;
    if (j.limit) for (const i of [0, 1, 2] as const) q[i] = Math.max(-j.limit[i], Math.min(j.limit[i], q[i]));
    const turn = mulM(rotM(2, q[2]), mulM(rotM(1, q[1]), rotM(0, q[0])));
    const pose = edit(j.key);
    pose.rot = eulerOf(mulM(turn, matOf(pose.rot ?? o.rot)));
    const [px, py, pz] = j.pivot;
    if (px !== 0 || py !== 0 || pz !== 0) {
      const t = applyM(turn, j.pivot);
      const p = pose.pos ?? o.pos;
      pose.pos = [p[0] + px - t[0], p[1] + py - t[1], p[2] + pz - t[2]];
    }
  }
  // A swell enlarges the object about its own middle, on top of any scale it has; a bob moves it up and down and rocks it from side to side about z, a quarter of a
  // cycle apart, on top of whatever else has moved it (it eases in over the first half turn, so it begins at rest whatever the angle it begins at).
  for (const l of motion.loops) {
    const motionOf = LOOP_ROWS[l.kind].motion;
    if (motionOf !== 'scale' && motionOf !== 'bob') continue;
    const o = byKey.get(l.key);
    const a = angleOf.get(loopDriver(l.key));
    if (!o || a === undefined) continue;
    const { value, rock } = loopValue(l, a);
    const pose = edit(l.key);
    if (motionOf === 'scale') {
      const base = pose.scale ?? [1, 1, 1];
      pose.scale = [base[0] * value, base[1] * value, base[2] * value];
    } else {
      const p = pose.pos ?? o.pos;
      pose.pos = [p[0], p[1] + value, p[2]];
      pose.rot = turned(pose.rot ?? o.rot, 2, rock);
    }
  }
  // A fixed joint rides with the object it is fixed to: its move and its turn, about that object's middle (chains settle in a few passes).
  for (let pass = 0; pass < 4; pass++) {
    for (const j of motion.joints) {
      if (JOINT_ROWS[j.kind].motion !== 'ride' || j.toKey === null) continue;
      const o = byKey.get(j.key);
      const to = byKey.get(j.toKey);
      const moved = out.get(j.toKey);
      if (!o || !to || !moved || o.parentKey !== to.parentKey) continue;
      // The turn it has made is the rotation from the rest orientation to the one it has now, as a matrix (not a difference of angles: with a part laid
      // on its side the angles do not subtract).
      const delta = mulM(matOf(moved.rot ?? to.rot), transposeM(matOf(to.rot)));
      const dPos: Vec3 = [(moved.pos?.[0] ?? to.pos[0]) - to.pos[0], (moved.pos?.[1] ?? to.pos[1]) - to.pos[1], (moved.pos?.[2] ?? to.pos[2]) - to.pos[2]];
      const v = applyM(delta, [o.pos[0] - to.pos[0], o.pos[1] - to.pos[1], o.pos[2] - to.pos[2]]);
      const pose = edit(j.key);
      pose.pos = [to.pos[0] + dPos[0] + v[0], to.pos[1] + dPos[1] + v[1], to.pos[2] + dPos[2] + v[2]];
      pose.rot = eulerOf(mulM(delta, matOf(o.rot)));
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

/** The rotation an XYZ turn (three.js Euler order: Rx * Ry * Rz) stands for. */
function matOf(rot: Vec3): M3 {
  const [x, y, z] = [rot[0] * DEG, rot[1] * DEG, rot[2] * DEG];
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  return [
    [cy * cz, -cy * sz, sy],
    [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
  ];
}
const mulM = (p: M3, q: M3): M3 => p.map((row) => ([0, 1, 2] as const).map((j) => row[0] * q[0][j] + row[1] * q[1][j] + row[2] * q[2][j])) as M3;
const transposeM = (m: M3): M3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
const applyM = (m: M3, v: Vec3): Vec3 => [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
/** The XYZ turn (degrees) that stands for a rotation. */
function eulerOf(n: M3): Vec3 {
  const m13 = Math.max(-1, Math.min(1, n[0][2]));
  const ey = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-n[1][2], n[2][2]) / DEG, ey / DEG, Math.atan2(-n[0][1], n[0][0]) / DEG];
  return [Math.atan2(n[2][1], n[1][1]) / DEG, ey / DEG, 0];
}

/**
 * A turn of `deg` about the parent's axis (0 x, 1 y, 2 z) added to an object's rest turn. With the other two angles at 0 it is just the angle added; with
 * them set (a cylinder laid on its side is [90,0,0]) the part turns about the parent's axis, as the scene says, and does not tumble about its own: the
 * result is the same orientation written again as the XYZ turn the renderer draws.
 */
export function turned(rest: Vec3, axis: Axis, deg: number): Vec3 {
  if (rest[(axis + 1) % 3] === 0 && rest[(axis + 2) % 3] === 0) {
    const out: Vec3 = [rest[0], rest[1], rest[2]];
    out[axis] += deg;
    return out;
  }
  return eulerOf(mulM(rotM(axis, deg), matOf(rest)));
}

/** The rotation of `deg` about an axis (0 x, 1 y, 2 z). */
function rotM(axis: Axis, deg: number): M3 {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return axis === 2 ? [[c, -s, 0], [s, c, 0], [0, 0, 1]] : axis === 0 ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}

/** A turn of `deg` about the object's OWN axis, after the rest orientation (a forearm turning on its length, whatever way it is laid). */
export function turnedLocal(rest: Vec3, axis: Axis, deg: number): Vec3 {
  return eulerOf(mulM(matOf(rest), rotM(axis, deg)));
}

/** A point of an object (in its own space, at its own size) as it lies from the object's origin in the parent's space: turned by the rest orientation. */
export function restPoint(rot: Vec3, scale: Vec3, point: Vec3): Vec3 {
  return applyM(matOf(rot), [point[0] * scale[0], point[1] * scale[1], point[2] * scale[2]]);
}

/** The key of the pin a crank draws on a plain-shape crankshaft (below zero, so it never meets an object made by a scene). */
export const crankPinKey = (crankKey: number): number => -1_000_000 - crankKey;
/** Whether a crankshaft is a plain shape the crank must draw the pin for (a kit crankshaft draws its own): a cylinder, laid on its side as the disc. */
export const drawsOwnPin = (shaft: AddAction): boolean => shaft.shape === 'cylinder';
/** The pin drawn on a plain-shape disc and the room the rod needs on it, from the sizes of the disc and of the rod. */
export function crankPinSize(shaft: AddAction, rod: AddAction | undefined): { throwR: number; thick: number; rodW: number; rodD: number; pin: Vec3 } {
  const written = sizeOf(shaft, [1, 1, 1]);
  const throwR = crankThrow([written[0], written[0], written[1]]);
  const [rodW, , rodD] = rod ? sizeOf(rod, [0.3, 1, 0.3]) : [Math.max(0.16, throwR * 0.4), 1, Math.max(0.16, throwR * 0.4)];
  const d = Math.max(0.16, rodW * 0.9);
  const thick = written[1];
  return { throwR, thick, rodW, rodD, pin: [d, rodD + 0.18, d] };
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
