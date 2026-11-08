import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { ballDriver, loopDriver, poses, waveDriver } from '../src/overlay/motion.ts';
import type { Axis, CoupleDef, JointDef, JointKind, LoopDef, MuscleDef, Motion, PoseObject, SpinState, WaveDef } from '../src/overlay/motion.ts';
import { fallCurve, fallSeconds } from '../src/overlay/fall.ts';
import { waveFactor } from '../src/overlay/scene3d-flow.ts';
import { markerPlaces, markerSize, streamColour } from '../src/overlay/stream.ts';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { AddAction, Vec3 } from '../src/scene/types.ts';

// The movements that were still code in the pose pass and the timeline (the joints hinge, slide, fixed, pivot and ball; the couplings by ratio and by pitch; the
// muscle; the wave; the stream markers and the fall; and the presets lever, pulley, pendulum, oscillate, float, pump, incline, wedge, screw and drop), recorded from
// that code before it became rows of a catalogue. Every pose, to the sixth decimal, must be what it was. To record again after a change that is meant (never to make
// a failure go away): MOVEMENT_ROWS3_WRITE=1 node --test test/movement-rows-3-golden.test.ts

const FIXTURE = new URL('./fixtures/movement-rows-3-golden.json', import.meta.url);
const r = (n: number): number => Math.round(n * 1e6) / 1e6 + 0;
const rv = (v: readonly number[] | undefined): number[] | null => (v ? v.map(r) : null);
const out: Record<string, unknown> = {};

// ---- the pose pass, directly -----------------------------------------------------------------------------------------------------
const emptyMotion = (): Motion => ({ spins: [], cranks: [], cams: [], flashes: [], loops: [], joints: [], couples: [], muscles: [], waves: [] });
let next = 1;
const box = (pos: Vec3, rot: Vec3 = [0, 0, 0], size: Vec3 = [1, 1, 1], extra: Partial<PoseObject> = {}): PoseObject => ({ key: next++, parentKey: null, def: { op: 'add', shape: 'box', id: `o${next}`, size } as AddAction, pos, rot, opacity: 1, ...extra });
const spin = (key: number, angle: number, axis: Axis = 2, rate = 0): SpinState => ({ key, axis, angle, rate });
const joint = (key: number, kind: JointKind, axis: Axis, over: Partial<JointDef> = {}): JointDef => ({ key, kind, axis, dir: null, pivot: [0, 0, 0], min: undefined, max: undefined, toKey: null, limit: null, ...over });
const ANGLES = [0, 37, 90, 135, 180, 270, 359, 725];
const record = (label: string, objects: PoseObject[], motion: Motion): void => {
  const got = poses(objects, motion);
  out[label] = [...got.entries()].sort((a, b) => a[0] - b[0]).map(([key, p]) => [key, rv(p.pos), rv(p.rot), p.opacity === undefined ? null : r(p.opacity), rv(p.scale)]);
};

// each joint kind, on each axis, laid three ways, turned about two pivots, held or not, driven by a spin or by a loop
for (const kind of ['hinge', 'slide', 'pivot', 'ball'] as const) {
  for (const axis of [0, 1, 2] as Axis[]) {
    for (const rest of [[0, 0, 0], [90, 0, 0], [10, 20, 30]] as Vec3[]) {
      for (const pivot of [[0, 0, 0], [1, -1, 0.5]] as Vec3[]) {
        for (const limits of [{}, { min: -20, max: 50 }, { min: 10 }]) {
          for (const driver of ['spin', 'loop'] as const) {
            if (kind === 'ball' && Object.keys(limits).length) continue;
            const o = box([1, 2, 0.5], rest, [1, 2, 1]);
            const j = joint(o.key, kind, axis, { pivot: kind === 'pivot' ? [0, 0, 0] : pivot, ...limits, ...(kind === 'slide' && axis === 1 ? { dir: [1, 1, 0] as Vec3 } : {}), ...(kind === 'ball' ? { limit: [30, 60, 90] as Vec3 } : {}) });
            const loop: LoopDef | undefined = driver === 'loop' ? { key: o.key, kind: kind === 'slide' ? 'slide' : 'swing', axis, amount: kind === 'slide' ? 3 : 45, pivot: [0, 0, 0] } : undefined;
            for (const a of ANGLES) {
              const spins = driver === 'spin' ? [spin(o.key, a, axis)] : [spin(kind === 'ball' ? ballDriver(o.key, axis) : loopDriver(o.key), a)];
              record(`${kind} axis${axis} rest${rest} pivot${pivot} ${JSON.stringify(limits)} ${driver} @${a}`, [o], { ...emptyMotion(), joints: [j], loops: loop ? [loop] : [], spins });
            }
          }
        }
      }
    }
  }
}
// a ball turned about all three axes at once, with a spin on one
{
  const o = box([1, 2, 0], [0, 0, 0], [1, 3, 1]);
  const j = joint(o.key, 'ball', 2, { pivot: [0, 1.5, 0], limit: [40, 70, 100] });
  const loops: LoopDef[] = ([0, 1, 2] as Axis[]).map((axis) => ({ key: o.key, kind: 'swing', axis, amount: 50 + axis * 20, pivot: [0, 0, 0] }));
  for (const a of ANGLES) record(`ball three loops @${a}`, [o], { ...emptyMotion(), joints: [j], loops, spins: [0, 1, 2].map((ax) => spin(ballDriver(o.key, ax as Axis), a + ax * 33)) });
  for (const a of ANGLES) record(`ball loops and spin @${a}`, [o], { ...emptyMotion(), joints: [j], loops, spins: [spin(o.key, a, 1), ...[0, 1, 2].map((ax) => spin(ballDriver(o.key, ax as Axis), a))] });
}
// the parts of a hinge's parent: a child hung under a turning parent
{
  const parent = box([0, 0, 0], [0, 0, 20], [2, 2, 2]);
  const child = box([1, 1, 0], [0, 0, 0], [1, 1, 1], { parentKey: parent.key });
  for (const a of ANGLES) record(`hinge in a parent @${a}`, [parent, child], { ...emptyMotion(), joints: [joint(child.key, 'hinge', 2, { pivot: [0.5, 0, 0] })], loops: [{ key: child.key, kind: 'swing', axis: 2, amount: 30, pivot: [0, 0, 0] }], spins: [spin(loopDriver(child.key), a)] });
}
// a fixed joint rides with what it is fixed to, in a chain, through every kind of motion
for (const kind of ['hinge', 'slide', 'pivot'] as const) {
  const a = box([0, 0, 0], [0, 0, 15], [1, 3, 1]);
  const b = box([2, 1, 0], [10, 0, 0], [1, 1, 1]);
  const c = box([3, 3, 0], [0, 25, 0], [1, 1, 1]);
  for (const angle of ANGLES) record(`fixed to ${kind} @${angle}`, [a, b, c], { ...emptyMotion(), joints: [joint(a.key, kind, 2, { pivot: [0, 1, 0] }), joint(b.key, 'fixed', 2, { toKey: a.key }), joint(c.key, 'fixed', 2, { toKey: b.key })], loops: [{ key: a.key, kind: kind === 'slide' ? 'slide' : 'swing', axis: 2, amount: kind === 'slide' ? 2 : 40, pivot: [0, 0, 0] }], spins: [spin(loopDriver(a.key), angle)] });
}

// ---- couplings ---------------------------------------------------------------------------------------------------------------------
const hingeOf = (o: PoseObject, over: Partial<JointDef> = {}) => joint(o.key, 'hinge', 2, { pivot: [0.5, 0, 0], ...over });
const slideOf = (o: PoseObject, axis: Axis = 1, over: Partial<JointDef> = {}) => joint(o.key, 'slide', axis, over);
for (const ratio of [1, -2, 0.5]) {
  for (const phase of [0, 30]) {
    for (const kinds of ['hinge-hinge', 'slide-slide', 'hinge-slide', 'slide-hinge'] as const) {
      for (const pitch of [undefined, 1.5, -0.4]) {
        if ((kinds === 'hinge-hinge' || kinds === 'slide-slide') && pitch !== undefined && ratio !== 1) continue;
        const [first, second] = kinds.split('-') as ['hinge' | 'slide', 'hinge' | 'slide'];
        const a = box([0, 0, 0]);
        const b = box([3, 0, 0]);
        const ja = first === 'hinge' ? hingeOf(a) : slideOf(a);
        const jb = second === 'hinge' ? hingeOf(b, { min: -50, max: 80 }) : slideOf(b);
        const couple: CoupleDef = { key: b.key, byKey: a.key, ratio, pitch, phase };
        for (const angle of ANGLES) record(`couple ${kinds} ratio${ratio} phase${phase} pitch${pitch} @${angle}`, [a, b], { ...emptyMotion(), joints: [ja, jb], couples: [couple], spins: [spin(a.key, angle)] });
      }
    }
  }
}
// a chain of three, a coupling to a part with a loop, and one that comes round to itself
{
  const a = box([0, 0, 0]), b = box([3, 0, 0]), c = box([6, 0, 0]);
  const motion = (extra: Partial<Motion>): Motion => ({ ...emptyMotion(), joints: [hingeOf(a), hingeOf(b), slideOf(c)], ...extra });
  for (const angle of ANGLES) {
    record(`chain @${angle}`, [a, b, c], motion({ couples: [{ key: b.key, byKey: a.key, ratio: -1.5, pitch: undefined, phase: 5 }, { key: c.key, byKey: b.key, ratio: 1, pitch: 2, phase: 0 }], spins: [spin(a.key, angle)] }));
    record(`couple to a loop @${angle}`, [a, b, c], motion({ loops: [{ key: a.key, kind: 'swing', axis: 2, amount: 30, pivot: [0, 0, 0] }], couples: [{ key: b.key, byKey: a.key, ratio: 2, pitch: undefined, phase: 0 }], spins: [spin(loopDriver(a.key), angle)] }));
    record(`couple round @${angle}`, [a, b, c], motion({ couples: [{ key: b.key, byKey: a.key, ratio: 2, pitch: undefined, phase: 0 }, { key: a.key, byKey: b.key, ratio: 2, pitch: undefined, phase: 0 }], spins: [spin(b.key, angle)] }));
  }
}
// gears: a spin locked to another (ratio and phase), and a lock to a lock
{
  const a = box([0, 0, 0]), b = box([2, 0, 0]), c = box([4, 0, 0]);
  for (const angle of ANGLES) {
    record(`gear lock @${angle}`, [a, b, c], { ...emptyMotion(), spins: [spin(a.key, angle, 2, 40), { ...spin(b.key, angle * -0.5 + 12, 2, -20), lock: { byKey: a.key, ratio: -0.5, phase: 12 } }, { ...spin(c.key, angle * 0.25, 2, 10), lock: { byKey: b.key, ratio: 2, phase: 0 } }] });
  }
}

// ---- the muscle ------------------------------------------------------------------------------------------------------------------
for (const kind of ['hinge', 'pivot'] as const) {
  for (const contract of [0.1, 0.25, 0.6]) {
    for (const lim of [{}, { min: -10, max: 10 }, { min: -120, max: 120 }]) {
      const upper = box([0, 0, 0], [0, 0, 0], [1, 4, 1]);
      const fore = box([0, -3, 0], [0, 0, 0], [0.8, 3, 0.8], { parentKey: upper.key });
      const conn = box([0, 0, 0], [0, 0, 0], [1, 1, 1], { parentKey: upper.key });
      const muscle: MuscleDef = { key: fore.key, holderKey: upper.key, connectorKey: conn.key, from: [0.6, -0.5, 0], to: [0.5, 0.2, 0], contract };
      const j = kind === 'hinge' ? joint(fore.key, 'hinge', 2, { pivot: [0, 1.5, 0], ...lim }) : joint(fore.key, 'pivot', 1, lim);
      for (const angle of ANGLES) record(`muscle ${kind} contract${contract} ${JSON.stringify(lim)} @${angle}`, [upper, fore, conn], { ...emptyMotion(), joints: [j], muscles: [muscle], spins: [spin(loopDriver(fore.key), angle)] });
    }
  }
}

// ---- waves, markers and falls, as functions -----------------------------------------------------------------------------------------
{
  const w: Record<string, number[]> = {};
  for (const phase of [0, 0.3, 0.77, -0.4, 1.9]) for (const count of [1, 2, 3]) for (const width of [0.03, 0.2, 0.6]) for (const amount of [0.4, 1.6, 3]) {
    w[`${phase} ${count} ${width} ${amount}`] = Array.from({ length: 21 }, (_, i) => r(waveFactor(i / 20, phase, count, width, amount)));
  }
  out['waveFactor'] = w;
  const m: Record<string, unknown> = {};
  for (const phase of [0, 0.25, 0.9, -0.3, 2.6]) for (const count of [1, 3, 7]) m[`${phase} ${count}`] = markerPlaces(phase, count).map(r);
  out['markerPlaces'] = m;
  out['markerSize'] = Array.from({ length: 41 }, (_, i) => r(markerSize(i / 40 + (i === 40 ? 0 : 0))));
  const colours: Record<string, number[][]> = {};
  for (const shiftAt of [undefined, 0.3, 0.8]) colours[`${shiftAt}`] = Array.from({ length: 21 }, (_, i) => streamColour([10, 200, 90], [240, 30, 60], i / 20, shiftAt).map(r));
  out['streamColour'] = colours;
  const fall: Record<string, number[]> = {};
  for (const bounce of [0, 0.3, 0.5, 0.8, 1.2, -0.2]) fall[`${bounce}`] = [...Array.from({ length: 61 }, (_, i) => r(fallCurve(i / 60, bounce))), r(fallCurve(-0.5, bounce)), r(fallCurve(1.5, bounce))];
  out['fallCurve'] = fall;
  const secs: Record<string, number[]> = {};
  for (const bounce of [0, 0.3, 0.8, 2]) secs[`${bounce}`] = [0, 0.01, 1, 4, 9.5, -6, 40].map((h) => r(fallSeconds(h, bounce)));
  out['fallSeconds'] = secs;
}

// ---- the scenes, through the validator and the timeline, as the model writes them ---------------------------------------------
const TIMES = [0, 0.2, 0.5, 0.9, 1.4, 2, 2.7, 3.5, 4.4, 5.6, 7.5];
const play = (label: string, actions: unknown[], dropped = false): void => {
  const v = validateStep({ say: 'x', actions }, createSceneState());
  if (!v.step) { out[`scene ${label}`] = { refused: v.issues.map((i) => i.message) }; return; }
  const plan = planStep(emptyFrame(), v.step);
  const times = TIMES.map((t) => [t, evaluate(plan, t)] as const);
  out[`scene ${label}`] = {
    issues: dropped ? v.issues.map((i) => i.message) : v.issues.length,
    duration: r(plan.duration),
    frames: times.map(([t, f]) => [t, f.objects.map((o) => [o.id, rv(o.pos), rv(o.rot), rv(o.scale), r(o.opacity), rv(o.pose?.pos), rv(o.pose?.rot), rv(o.pose?.scale), o.pose?.opacity === undefined ? null : r(o.pose.opacity), o.wave ? [r(o.wave.phase), r(o.wave.amount), r(o.wave.width), o.wave.count] : null, o.phase === undefined ? null : r(o.phase), (o.def as { restLength?: number }).restLength === undefined ? null : r((o.def as { restLength?: number }).restLength as number)])]),
  };
};
const b = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const cyl = (id: string, extra: object = {}) => ({ op: 'add', shape: 'cylinder', id, size: [1, 2, 1], ...extra });
const beam = b('beam', { size: [6, 0.4, 1], pos: [0, 2, 0] });
const load = b('bucket', { size: [1, 1, 1], pos: [3, -2, 0] });
const wheelFlat = cyl('wheel', { size: [2, 0.4, 2] });

// joints and the loop kinds
play('hinge about a point with a swing', [b('door', { size: [2, 3, 0.2], pos: [1, 0, 0] }), { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', about: 'left', min: -80, max: 80 }, { op: 'loop', id: 'door', amount: 70, period: 3 }]);
play('hinge by pivot and a spin', [b('flap', { pos: [2, 0, 0] }), { op: 'joint', id: 'flap', kind: 'hinge', pivot: [-0.5, 0, 0], min: 0, max: 60 }, { op: 'spin', id: 'flap', rpm: 20, dur: 0 }]);
play('slide along a tilted dir with a held range', [b('carriage'), { op: 'joint', id: 'carriage', kind: 'slide', dir: [1, 0.5, 0], min: -1, max: 2 }, { op: 'loop', id: 'carriage', amount: 6, period: 2.5 }]);
play('slide on x by a spin', [b('slider'), { op: 'joint', id: 'slider', kind: 'slide', axis: 'x' }, { op: 'spin', id: 'slider', rpm: 6, dur: 0 }]);
play('pivot on a tilted limb', [cyl('arm', { size: [0.5, 3, 0.5], rot: [0, 0, 30], pos: [1, 2, 0] }), { op: 'joint', id: 'arm', kind: 'pivot', min: -90, max: 90 }, { op: 'loop', id: 'arm', amount: 60, period: 4 }]);
play('ball with three loops', [cyl('leg', { size: [0.5, 3, 0.5], pos: [0, -1.5, 0] }), { op: 'joint', id: 'leg', kind: 'ball', pivot: [0, 1.5, 0], limit: [30, 40, 20] }, { op: 'loop', id: 'leg', kind: 'swing', axis: 'x', amount: 25, period: 3 }, { op: 'loop', id: 'leg', kind: 'swing', axis: 'z', amount: 50, period: 4 }, { op: 'loop', id: 'leg', kind: 'swing', axis: 'y', amount: 60, period: 5 }]);
play('fixed rides a hinged arm', [b('arm', { size: [3, 0.4, 0.4], pos: [1.5, 0, 0] }), b('hand', { pos: [3.4, 0, 0], size: [0.6, 0.6, 0.6] }), { op: 'joint', id: 'arm', kind: 'hinge', pivot: [-1.5, 0, 0] }, { op: 'joint', id: 'hand', kind: 'fixed', to: 'arm' }, { op: 'loop', id: 'arm', amount: 40, period: 2 }]);
for (const kind of ['slide', 'swing', 'pulse', 'gate', 'float'] as const) {
  play(`loop ${kind}`, [b('p', { pos: [1, 1, 0] }), { op: 'loop', id: 'p', kind, amount: kind === 'pulse' ? 1.6 : kind === 'float' ? 0.4 : 30, period: 2, ...(kind === 'swing' || kind === 'gate' ? { axis: 'x' } : {}) }]);
  play(`loop ${kind} damped`, [b('p', { pos: [1, 1, 0] }), { op: 'loop', id: 'p', kind, amount: kind === 'pulse' ? 1.6 : kind === 'float' ? 0.4 : 30, period: 2, damp: 1.5, phase: 40 }]);
}
play('loop by another part', [b('crank'), b('slider', { pos: [2, 0, 0] }), { op: 'spin', id: 'crank', rpm: 30, dur: 0 }, { op: 'loop', id: 'slider', kind: 'slide', amount: 2, by: 'crank', ratio: 2, phase: 20 }]);

// couplings
play('couple hinge to hinge (a belt)', [b('a'), b('b', { pos: [3, 0, 0] }), { op: 'joint', id: 'a', kind: 'hinge' }, { op: 'joint', id: 'b', kind: 'hinge' }, { op: 'spin', id: 'a', rpm: 12, dur: 0 }, { op: 'couple', id: 'b', by: 'a', ratio: -2, phase: 10 }]);
play('couple slide to hinge by pitch', [b('rack', { pos: [0, 0, 0] }), cyl('pinion', { pos: [2, 0, 0] }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'joint', id: 'pinion', kind: 'hinge' }, { op: 'loop', id: 'rack', amount: 3, period: 4 }, { op: 'couple', id: 'pinion', by: 'rack', pitch: 2 }]);
play('couple hinge to slide by pitch', [cyl('crankwheel'), b('nut', { pos: [2, 0, 0] }), { op: 'joint', id: 'crankwheel', kind: 'hinge' }, { op: 'joint', id: 'nut', kind: 'slide', axis: 'y' }, { op: 'spin', id: 'crankwheel', rpm: 20, dur: 0 }, { op: 'couple', id: 'nut', by: 'crankwheel', pitch: 0.5 }]);
play('couple then stop', [b('a'), b('b', { pos: [3, 0, 0] }), { op: 'joint', id: 'a', kind: 'hinge' }, { op: 'joint', id: 'b', kind: 'hinge' }, { op: 'spin', id: 'a', rpm: 12, dur: 0 }, { op: 'couple', id: 'b', by: 'a', ratio: 2 }, { op: 'couple', id: 'b', stop: true, at: 3 }]);
play('gears locked by spin', [cyl('g1', { size: [2, 0.4, 2] }), cyl('g2', { size: [1, 0.4, 1], pos: [1.5, 0, 0] }), { op: 'spin', id: 'g1', rpm: 20, dur: 0 }, { op: 'spin', id: 'g2', by: 'g1', ratio: -2 }]);

// the muscle
{
  const upper = b('upper', { size: [1, 4, 1], pos: [0, 0, 0] });
  const fore = (extra: object = {}) => b('fore', { size: [0.8, 3, 0.8], parent: 'upper', parentAnchor: 'bottom', selfAnchor: 'top', ...extra });
  const bicep = (extra: object = {}) => ({ op: 'add', shape: 'connector', id: 'bicep', from: 'upper', to: 'fore', fromPoint: [0.6, -0.5, 0], toPoint: [0.5, 0.2, 0], ...extra });
  const hinge = (extra: object = {}) => ({ op: 'joint', id: 'fore', kind: 'hinge', about: 'top', axis: 'z', min: -120, max: 120, ...extra });
  play('muscle on a hinge', [upper, fore(), bicep(), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.25, period: 4 }]);
  play('muscle with a given rest length and phase', [upper, fore(), bicep({ restLength: 2.5 }), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.4, period: 3, phase: 90 }]);
  play('muscle held by limits', [upper, fore(), bicep(), hinge({ min: -10, max: 10 }), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.6, period: 4 }]);
  play('muscle on a pivot', [upper, fore(), bicep(), { op: 'joint', id: 'fore', kind: 'pivot', min: -90, max: 90 }, { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.3, period: 4 }]);
}

// waves
{
  const tube = { op: 'add', shape: 'tube', id: 'gut', pts: [[-4, 0, 0], [0, 1, 0], [4, 0, 0]], radius: 0.3 };
  play('wave on a tube', [tube, { op: 'wave', id: 'gut', amount: 1.8, width: 0.25, period: 4 }, { op: 'add', shape: 'stream', id: 'bolus', along: 'gut', count: 1, period: 4 }]);
  play('wave defaults', [tube, { op: 'wave', id: 'gut' }]);
  play('wave backwards, several, then stopped', [tube, { op: 'wave', id: 'gut', amount: 0.5, count: 3, period: -3 }, { op: 'wave', id: 'gut', stop: true, at: 3 }]);
  play('wave on a line is refused', [{ op: 'add', shape: 'line', id: 'l', pts: [[0, 0, 0], [3, 0, 0]] }, { op: 'wave', id: 'l' }], true);
}

// the presets
play('lever on its middle', [beam, { op: 'lever', id: 'beam', swing: 20, period: 4 }]);
play('lever on an end, with a load', [beam, { op: 'add', shape: 'sphere', id: 'load', size: [0.6, 0.6, 0.6], parent: 'beam', parentAnchor: 'right', selfAnchor: 'bottom' }, { op: 'lever', id: 'beam', fulcrum: 'left', swing: 15, period: 3, phase: 50 }]);
play('lever on a named point and an axis', [beam, { op: 'anchor', id: 'beam', name: 'peg', pos: [1, 0, 0] }, { op: 'lever', id: 'beam', fulcrum: 'peg', swing: 25, period: 4, axis: 'x' }]);
play('lever defaults', [beam, { op: 'lever', id: 'beam' }]);
play('pulley with a radius', [wheelFlat, load, { op: 'pulley', id: 'bucket', wheel: 'wheel', radius: 0.4, rpm: 60 }]);
play('pulley reads the radius', [wheelFlat, load, { op: 'pulley', id: 'bucket', wheel: 'wheel', rpm: -45, min: -2, max: 3 }]);
play('pulley on a lying axle', [cyl('axle', { size: [0.8, 3.8, 0.8], rot: [0, 0, 90] }), load, { op: 'pulley', id: 'bucket', wheel: 'axle', radius: 0.4 }]);
play('pulley on a kit wheel with an axis', [{ op: 'add', shape: 'part', part: 'gear', id: 'cog', size: [2, 2, 0.5] }, load, { op: 'pulley', id: 'bucket', wheel: 'cog', rpm: 30, axis: 'z' }]);
{
  const support = b('support', { pos: [0, 4, 0], size: [1, 0.3, 1] });
  const bob = { op: 'add', shape: 'sphere', id: 'bob', size: [0.6, 0.6, 0.6], pos: [0, 1, 0] };
  play('pendulum from a part', [support, bob, { op: 'pendulum', id: 'bob', from: 'support', swing: 25 }]);
  play('pendulum with a period and damping', [support, bob, { op: 'pendulum', id: 'bob', from: 'support', swing: 30, period: 2.5, damp: 1 }]);
  play('pendulum on a longer string and another axis', [support, { ...bob, pos: [0, -4, 0] }, { op: 'pendulum', id: 'bob', from: 'support', swing: 30, axis: 'x' }]);
  play('pendulum by a pivot point', [bob, { op: 'pendulum', id: 'bob', pivot: [0, 3, 0], swing: 40 }]);
  play('pendulum that is refused', [bob, { op: 'pendulum', id: 'bob' }], true);
}
play('oscillate', [b('weight', { pos: [0, 0, 0] }), { op: 'oscillate', id: 'weight', amount: 0.8, period: 1.5 }]);
play('oscillate damped on x', [b('weight', { pos: [0, 0, 0] }), { op: 'oscillate', id: 'weight', amount: 1.5, period: 2, damp: 2, axis: 'x' }]);
play('oscillate defaults', [b('weight'), { op: 'oscillate', id: 'weight' }]);
play('float', [b('boat', { pos: [0, 0, 0] }), { op: 'float', id: 'boat', bob: 0.3, tilt: 6, period: 3 }]);
play('float damped', [b('boat'), { op: 'float', id: 'boat', damp: 1.5 }]);
play('drop with a bounce', [{ op: 'add', shape: 'sphere', id: 'ball', size: [1, 1, 1], pos: [1, 6, 0] }, { op: 'drop', id: 'ball', to: 0.5, bounce: 0.5 }]);
play('drop dead', [{ op: 'add', shape: 'sphere', id: 'ball', size: [1, 1, 1], pos: [1, 6, 0] }, { op: 'drop', id: 'ball', to: 0, bounce: 0, dur: 1.2 }]);
{
  const pump = [
    { op: 'add', shape: 'sphere', id: 'chamber', size: [2, 2, 2], pos: [0, 0, 0] },
    { op: 'add', shape: 'box', id: 'inlet', size: [1, 0.1, 1], pos: [-2, 0, 0] },
    { op: 'add', shape: 'box', id: 'outlet', size: [1, 0.1, 1], pos: [2, 0, 0] },
  ];
  play('pump with two valves', [...pump, { op: 'pump', id: 'chamber', inlet: 'inlet', outlet: 'outlet', squeeze: 0.6, open: 60, period: 2 }]);
  play('pump defaults and a named hinge', [...pump, { op: 'pump', id: 'chamber', inlet: 'inlet', outlet: 'outlet', hinge: 'right', axis: 'x' }]);
  play('pump with no valves', [pump[0], { op: 'pump', id: 'chamber', squeeze: 0.5 }]);
}
play('incline by a ramp', [b('ramp', { size: [6, 0.3, 2], rot: [0, 0, 30], pos: [0, 0, 0] }), b('crate', { pos: [-1, 1, 0] }), { op: 'incline', id: 'crate', ramp: 'ramp', travel: 4, period: 4 }]);
play('incline by an angle', [b('crate', { pos: [-1, 1, 0] }), { op: 'incline', id: 'crate', angle: 30, travel: 4, period: 4 }]);
play('incline defaults', [b('crate'), { op: 'incline', id: 'crate', angle: -20 }]);
{
  const wedge = { op: 'add', shape: 'cone', id: 'wedge', size: [2, 3, 2], pos: [0, 2, 0], rot: [0, 0, 180] };
  const left = b('left', { size: [1, 2, 1], pos: [-1.5, 0, 0] });
  const right = b('right', { size: [1, 2, 1], pos: [1.5, 0, 0] });
  play('wedge driving both sides', [wedge, left, right, { op: 'wedge', id: 'wedge', drives: 'left', angle: 30, travel: 2, period: 4 }, { op: 'wedge', id: 'wedge', drives: 'right', angle: 30, travel: 2, period: 4 }]);
  play('wedge along x', [{ ...wedge, rot: [0, 0, 90], pos: [3, 0, 0] }, b('top', { pos: [0, 1.5, 0] }), b('bottom', { pos: [0, -1.5, 0] }), { op: 'wedge', id: 'wedge', drives: 'top', axis: 'x', travel: 3 }, { op: 'wedge', id: 'wedge', drives: 'bottom', axis: 'x', travel: 3 }]);
}
{
  const screw = cyl('screw', { size: [0.6, 6, 0.6], pos: [0, 0, 0] });
  const nut = b('nut', { size: [1, 0.5, 1], pos: [0, -2, 0] });
  play('screw standing', [screw, nut, { op: 'screw', id: 'nut', screw: 'screw', pitch: 0.5, rpm: 60 }]);
  play('screw lying, held', [{ ...screw, rot: [0, 0, 90] }, { ...nut, pos: [-1, 0, 0] }, { op: 'screw', id: 'nut', screw: 'screw', pitch: -0.7, rpm: 45, min: -1, max: 2 }]);
  play('screw with an axis', [screw, nut, { op: 'screw', id: 'nut', screw: 'screw', axis: 'x' }]);
}

test('every movement that was code poses exactly as it was recorded, case by case', () => {
  if (process.env.MOVEMENT_ROWS3_WRITE) { writeFileSync(FIXTURE, JSON.stringify(out) + '\n'); return; }
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(out), Object.keys(golden), 'the same cases');
  const bad = Object.keys(out).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(golden[k]));
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${Object.keys(out).length} cases differ`);
});

test('the recording reaches every kind, and the movements it holds move something', () => {
  const keys = Object.keys(out);
  for (const k of ['hinge', 'slide', 'pivot', 'ball', 'fixed', 'couple', 'chain', 'gear', 'muscle', 'waveFactor', 'markerPlaces', 'markerSize', 'streamColour', 'fallCurve', 'fallSeconds']) assert.ok(keys.some((c) => c.startsWith(k)), k);
  for (const k of ['lever', 'pulley', 'pendulum', 'oscillate', 'float', 'drop', 'pump', 'incline', 'wedge', 'screw', 'wave', 'muscle', 'couple', 'hinge', 'slide', 'pivot', 'ball']) assert.ok(keys.some((c) => c.startsWith(`scene ${k}`)), `a scene for ${k}`);
  const moved = (c: string): boolean => {
    const s = out[c] as { frames?: Array<[number, unknown]> };
    return !!s.frames && new Set(s.frames.map((f) => JSON.stringify(f[1]))).size > 1;
  };
  for (const c of keys.filter((k) => k.startsWith('scene ') && !/refused|round|stop|no valves|muscle on a pivot/.test(k))) assert.ok(moved(c), `${c} moves something`);
  assert.ok(keys.filter((k) => !k.startsWith('scene ')).length > 1000, 'many direct cases');
});
