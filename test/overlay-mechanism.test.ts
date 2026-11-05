import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import { rodEnds } from '../src/overlay/mechanism-geometry.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// The mechanism layer: joints (hinge, slide, fixed) on any object, driven by spin or loop or coupled to another joint (ratio, or pitch between a
// hinge and a slide), with limits. Every pose is a function of time since the step began.

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id);
const posOf = (f: Frame, id: string) => (obj(f, id)?.pose?.pos ?? obj(f, id)?.pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id)?.pose?.rot ?? obj(f, id)?.rot) as [number, number, number];
const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const box = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const run = (...actions: unknown[]) => planStep(emptyFrame(), step(...actions));
const part = (id: string, p: string, extra: object = {}) => ({ op: 'add', shape: 'part', part: p, id, size: [1, 1, 1], ...extra });
const spin = (id: string, rpm: number) => ({ op: 'spin', id, rpm, dur: 0 }); // 30 rpm is 180 degrees a second

test('a hinge with a pivot turns the object about that point, driven by a spin', () => {
  // a door 1 to the right of its hinge line; the pivot is given from the door to the hinge
  const plan = run(box('door', { pos: [1, 0, 0] }), { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', pivot: [-1, 0, 0] }, spin('door', 15));
  const f = evaluate(plan, 1); // 15 rpm: 90 degrees in a second
  near(rotOf(f, 'door')[1], 90);
  const p = posOf(f, 'door');
  near(p[0], 0); near(p[1], 0); near(p[2], -1);
  near(posOf(evaluate(plan, 0), 'door')[0], 1);
});

test('limits hold a joint at the limit when a driver pushes past them, and it does not turn back', () => {
  const plan = run(box('lid'), { op: 'joint', id: 'lid', kind: 'hinge', axis: 'z', min: -10, max: 10 }, { op: 'loop', id: 'lid', amount: 30, period: 2 });
  const z = (t: number) => rotOf(evaluate(plan, t), 'lid')[2];
  near(z(0.5), 10); // the swing would be 30
  near(z(0.4), 10); // still held a little before the peak, and again a little after
  near(z(0.6), 10);
  near(z(1.5), -10);
  near(z(0), 0);
  assert.ok(z(0.05) > 0 && z(0.05) < 10); // inside the limits it moves freely
  // a slide is held the same way
  const slide = run(box('p'), { op: 'joint', id: 'p', kind: 'slide', axis: 'y', max: 0.5 }, { op: 'loop', id: 'p', amount: 4, period: 2 });
  near(posOf(evaluate(slide, 0.5), 'p')[1], 0.5);
  near(posOf(evaluate(slide, 1.5), 'p')[1], -2);
});

test('a slide on a tilted direction moves along it (an inclined plane)', () => {
  const plan = run(box('b'), { op: 'joint', id: 'b', kind: 'slide', dir: [3, 4, 0] }, { op: 'loop', id: 'b', amount: 10, period: 2 });
  const p = posOf(evaluate(plan, 0.5), 'b'); // a quarter of the way round: 5 along the slope
  near(p[0], 3); near(p[1], 4); near(p[2], 0);
});

test('a ratio couples two hinges, a gear or belt, and a chain of them is a gear train', () => {
  const plan = run(box('a'), box('b'), box('c'), spin('a', 30),
    { op: 'couple', id: 'b', by: 'a', ratio: -2 }, { op: 'couple', id: 'c', by: 'b', ratio: 0.5, phase: 10 });
  const f = evaluate(plan, 1); // a has turned 180
  near(rotOf(f, 'a')[2], 180);
  near(rotOf(f, 'b')[2], -360);
  near(rotOf(f, 'c')[2], -180 + 10);
});

test('between a hinge and a slide the coupling is a pitch: units of travel for one turn, either way round', () => {
  // a wheel of radius 1 lifts a weight on a rope: 2 x pi units for a whole turn
  const lift = run(box('wheel'), box('weight', { pos: [2, 0, 0] }), { op: 'joint', id: 'weight', kind: 'slide', axis: 'y' }, spin('wheel', 30),
    { op: 'couple', id: 'weight', by: 'wheel', pitch: 2 * Math.PI });
  near(posOf(evaluate(lift, 1), 'weight')[1], Math.PI); // half a turn
  near(posOf(evaluate(lift, 2), 'weight')[1], 2 * Math.PI);
  // a rack drives a pinion: one turn of the pinion for each pitch of travel of the rack
  const rack = run(box('rack'), box('pinion'), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'loop', id: 'rack', amount: 4, period: 2 },
    { op: 'couple', id: 'pinion', by: 'rack', pitch: 2 });
  near(rotOf(evaluate(rack, 0.5), 'pinion')[2], 360); // the rack is 2 along: a whole turn of a pitch-2 pinion
  // a screw: a nut with no joint of its own, coupled by pitch to a turning shaft, becomes a slide along y
  const screw = run(box('shaft'), box('nut'), spin('shaft', 30), { op: 'couple', id: 'nut', by: 'shaft', pitch: 0.5 });
  near(posOf(evaluate(screw, 1), 'nut')[1], 0.25); // half a turn
  near(posOf(evaluate(screw, 2), 'nut')[1], 0.5); // a whole turn: one pitch
});

test('a fixed joint rides with the part it is fixed to, in its move and its turn', () => {
  const plan = run(box('arm'), box('hand', { pos: [2, 0, 0] }), { op: 'joint', id: 'hand', kind: 'fixed', to: 'arm' }, { op: 'loop', id: 'arm', kind: 'swing', amount: 30, period: 2 });
  const f = evaluate(plan, 0.5); // the arm is 30 degrees round
  near(posOf(f, 'hand')[0], 2 * Math.cos(Math.PI / 6));
  near(posOf(f, 'hand')[1], 2 * Math.sin(Math.PI / 6));
  near(rotOf(f, 'hand')[2], 30);
});

test('a coupling that comes round to itself is cut, not followed for ever', () => {
  // the validator refuses this (below); a scene could still arrive by another road
  const plan = run(box('a'), box('b'), { op: 'couple', id: 'a', by: 'b' }, { op: 'couple', id: 'b', by: 'a' });
  const f = evaluate(plan, 1);
  assert.deepEqual(posOf(f, 'a'), [0, 0, 0]);
});

// ---- the validator ---------------------------------------------------------------------------------------------------------------

const validate = (...actions: unknown[]) => {
  const r = validateScene({ steps: [{ say: 'x', actions }] }, createSceneState());
  return { kept: ((r.scene as Scene | null)?.steps ?? []).flatMap((s) => s.actions) as unknown as Array<Record<string, unknown>>, issues: r.issues };
};
const ops = (r: { kept: Array<Record<string, unknown>> }, op: string) => r.kept.filter((a) => a.op === op);

test('a joint is taken on any object; a fixed one needs the object it rides with, and never one that rides with it', () => {
  const ok = validate(box('a'), box('b'), { op: 'joint', id: 'a', kind: 'hinge', pivot: [0, 1, 0] }, { op: 'joint', id: 'b', kind: 'fixed', to: 'a' });
  assert.equal(ops(ok, 'joint').length, 2);
  assert.deepEqual(ok.issues, []);
  const noTo = validate(box('a'), { op: 'joint', id: 'a', kind: 'fixed' });
  assert.equal(ops(noTo, 'joint').length, 0);
  assert.ok(noTo.issues.some((i) => /fixed joint needs to/.test(i.message)));
  const selfRide = validate(box('a'), { op: 'joint', id: 'a', kind: 'fixed', to: 'a' });
  assert.equal(ops(selfRide, 'joint').length, 0);
  const cycle = validate(box('a'), box('b'), { op: 'joint', id: 'a', kind: 'fixed', to: 'b' }, { op: 'joint', id: 'b', kind: 'fixed', to: 'a' });
  assert.equal(ops(cycle, 'joint').length, 1);
  assert.ok(cycle.issues.some((i) => /already/.test(i.message)), JSON.stringify(cycle.issues));
  const swapped = validate(box('a'), { op: 'joint', id: 'a', kind: 'hinge', min: 20, max: -20 });
  assert.deepEqual([ops(swapped, 'joint')[0]?.min, ops(swapped, 'joint')[0]?.max], [-20, 20]);
});

test('a loop takes its kind from the joint the object has, and needs one or a kind', () => {
  const hinge = validate(box('a'), { op: 'joint', id: 'a', kind: 'hinge' }, { op: 'loop', id: 'a', amount: 20 });
  assert.equal(ops(hinge, 'loop').length, 1);
  assert.deepEqual(hinge.issues, []);
  const none = validate(box('a'), { op: 'loop', id: 'a', amount: 20 });
  assert.equal(ops(none, 'loop').length, 0);
  assert.ok(none.issues.some((i) => /needs a kind/.test(i.message)));
});

test('a coupling to itself, or round a loop (a follows b follows a), is refused with a line saying so; stop frees it', () => {
  const self = validate(box('a'), { op: 'couple', id: 'a', by: 'a' });
  assert.equal(ops(self, 'couple').length, 0);
  assert.ok(self.issues.length > 0 && self.issues.every((i) => i.kind !== 'clamped'));
  const loop = validate(box('a'), box('b'), box('c'), { op: 'couple', id: 'a', by: 'b' }, { op: 'couple', id: 'b', by: 'c' }, { op: 'couple', id: 'c', by: 'a' });
  assert.equal(ops(loop, 'couple').length, 2);
  assert.ok(loop.issues.some((i) => /coupling loop/.test(i.message)), JSON.stringify(loop.issues));
  const freed = validate(box('a'), box('b'), { op: 'couple', id: 'a', by: 'b' }, { op: 'couple', id: 'a', stop: true }, { op: 'couple', id: 'b', by: 'a' });
  assert.equal(ops(freed, 'couple').length, 3);
  assert.equal(validate(box('a'), { op: 'couple', id: 'a' }).kept.filter((a) => a.op === 'couple').length, 0);
});

test('a hinge and a slide are coupled with pitch, not ratio, when both joints are declared', () => {
  const both = [box('w'), box('s'), { op: 'joint', id: 'w', kind: 'hinge' }, { op: 'joint', id: 's', kind: 'slide' }];
  const bad = validate(...both, { op: 'couple', id: 's', by: 'w', ratio: 0.1 });
  assert.equal(ops(bad, 'couple').length, 0);
  assert.ok(bad.issues.some((i) => /with pitch/.test(i.message)), JSON.stringify(bad.issues));
  assert.equal(ops(validate(...both, { op: 'couple', id: 's', by: 'w', pitch: 1 }), 'couple').length, 1);
});

// ---- a lock to a part that only follows another: refused, with the part to lock to ---------------------------------------------------------

test('a loop, spin, cam or flash locked to a part that is driven only by a coupling is refused, with a line naming the part that spins', () => {
  const base = [box('a'), box('b'), box('c'), { op: 'spin', id: 'a', rpm: 60 }, { op: 'couple', id: 'b', by: 'a', ratio: 0.5 }];
  for (const lock of [{ op: 'loop', id: 'c', kind: 'slide', amount: 2, by: 'b' }, { op: 'spin', id: 'c', by: 'b' }, { op: 'cam', id: 'c', by: 'b' }, { op: 'flash', id: 'c', by: 'b', angle: 0, span: 90 }]) {
    const r = validate(...base, lock);
    assert.equal(ops(r, lock.op).length, lock.op === 'spin' ? 1 : 0, lock.op); // the one spin is a's own
    assert.ok(r.issues.some((i) => /follows 'a'|follows "a"/.test(i.message) && /lock it to/.test(i.message)), `${lock.op}: ${JSON.stringify(r.issues)}`);
  }
  // locked to the part that spins, it is taken as before
  assert.equal(ops(validate(...base, { op: 'loop', id: 'c', kind: 'slide', amount: 2, by: 'a' }), 'loop').length, 1);
  // and once the coupling is stopped the part is a plain one again
  assert.equal(ops(validate(...base, { op: 'couple', id: 'b', stop: true }, { op: 'loop', id: 'c', kind: 'slide', amount: 2, by: 'b' }), 'loop').length, 1);
});

// ---- a hand-built crank: plain shapes only ---------------------------------------------------------------------------------------------

/** A point turned by a rest angle set the way the renderer does it: three.js Euler XYZ, the z turn first. */
function eulerXYZ(v: [number, number, number], rot: [number, number, number]): [number, number, number] {
  const [a, b, c] = rot.map((d) => (d * Math.PI) / 180) as [number, number, number];
  let [x, y, z] = v;
  [x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  return [x, y, z];
}

test('a plain cylinder laid on its side (rot 90 about x) spins in its own plane with the default axis, and does not tumble', () => {
  const plan = run({ op: 'add', shape: 'cylinder', id: 'wheel', size: [2, 0.4, 2], rot: [90, 0, 0] }, { op: 'spin', id: 'wheel', rpm: 30, dur: 0 });
  for (const t of [0.2, 0.5, 1, 1.7]) {
    const rot = rotOf(evaluate(plan, t), 'wheel');
    const axis = eulerXYZ([0, 1, 0], rot); // the cylinder's own axis stays pointing at the viewer
    near(axis[0], 0, 1e-9); near(axis[1], 0, 1e-9); near(axis[2], 1, 1e-9);
    const rim = eulerXYZ([1, 0, 0], rot); // a point on the rim goes round
    near(rim[0], Math.cos((180 * t * Math.PI) / 180), 1e-9);
    near(rim[1], Math.sin((180 * t * Math.PI) / 180), 1e-9);
  }
});

test('the crank preset on plain shapes: the rod joins the crank pin to the piston and swings, and the piston is at the top when the pin is', () => {
  // a wheel of 2.2 across, laid on its side, with a marker on its rim where the pin is at angle 0 (straight up)
  const throwR = 0.3 * 2.2;
  const plan = run(
    { op: 'add', shape: 'cylinder', id: 'wheel', size: [2.2, 0.4, 2.2], pos: [0, -2.6, 0], rot: [90, 0, 0] },
    { op: 'add', shape: 'box', id: 'pis', size: [2.2, 1, 2], pos: [0, 0.6, 0] },
    { op: 'add', shape: 'box', id: 'rod', size: [0.3, 2.6, 0.3], pos: [0, -0.9, 0] },
    { op: 'spin', id: 'wheel', rpm: 10, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'wheel', rod: 'rod' });
  const ends = rodEnds([0.3, 2.6, 0.3]);
  const crownAt = (deg: number) => posOf(evaluate(plan, deg / 60), 'pis')[1];
  for (const deg of [0, 37, 90, 133, 180, 250, 311]) {
    const f = evaluate(plan, deg / 60);
    // where the marker sits now: its place on the wheel, turned as the renderer turns the wheel
    const pin = eulerXYZ([0, 0.25, -throwR], rotOf(f, 'wheel'));
    const pinWorld: [number, number] = [posOf(f, 'wheel')[0] + pin[0], posOf(f, 'wheel')[1] + pin[1]];
    const rp = posOf(f, 'rod');
    const tilt = ((rotOf(f, 'rod')[2] ?? 0) * Math.PI) / 180;
    near(rp[0] + ends.big * -Math.sin(tilt), pinWorld[0], 1e-9); // the big end of the rod is on the pin
    near(rp[1] + ends.big * Math.cos(tilt), pinWorld[1], 1e-9);
    const wrist: [number, number] = [posOf(f, 'pis')[0], posOf(f, 'pis')[1] + 0.1];
    near(rp[0] + ends.small * -Math.sin(tilt), wrist[0], 1e-9); // and the small end is on the piston's pin
    near(rp[1] + ends.small * Math.cos(tilt), wrist[1], 1e-9);
  }
  assert.ok(crownAt(0) > crownAt(90) && crownAt(0) > crownAt(180) && crownAt(0) > crownAt(311)); // the pin straight up: the piston at the top
  assert.ok(Math.abs(crownAt(180) - (crownAt(0) - 2 * throwR)) < 0.2); // and its stroke is about twice the throw
  assert.notEqual(rotOf(evaluate(plan, 1), 'rod')[2], 0); // the rod swings
});

// ---- a rider fixed to a part that is laid down and spinning ------------------------------------------------------------------------

test('a part fixed to a cylinder laid on its side and spinning goes round in the plane, and its z stays put', () => {
  const plan = run({ op: 'add', shape: 'cylinder', id: 'a', size: [2, 0.4, 2], rot: [90, 0, 0] }, box('b', { pos: [2, 0, 0] }),
    { op: 'joint', id: 'b', kind: 'fixed', to: 'a' }, { op: 'spin', id: 'a', rpm: 30, dur: 0 }); // 180 degrees a second
  for (const t of [0.25, 0.5, 1, 1.3, 2]) {
    const f = evaluate(plan, t);
    const th = (180 * t * Math.PI) / 180;
    near(posOf(f, 'b')[0], 2 * Math.cos(th), 1e-9); near(posOf(f, 'b')[1], 2 * Math.sin(th), 1e-9); near(posOf(f, 'b')[2], 0, 1e-9);
    const side = eulerXYZ([1, 0, 0], rotOf(f, 'b')); // and it turns with the cylinder
    near(side[0], Math.cos(th), 1e-9); near(side[1], Math.sin(th), 1e-9); near(side[2], 0, 1e-9);
  }
});

// ---- a crank on plain shapes draws its own pin, and the rod runs on it in front of the disc --------------------------------------

test('on a plain-shape crank the crank draws the pin at the throw, in front of the disc, and the rod ends on that very pin', () => {
  const plan = run(
    { op: 'add', shape: 'cylinder', id: 'wheel', size: [2.2, 0.4, 2.2], pos: [0, -2.6, 0], rot: [90, 0, 0] },
    { op: 'add', shape: 'box', id: 'pis', size: [2.2, 1, 2], pos: [0, 0.6, 0] },
    { op: 'add', shape: 'box', id: 'rod', size: [0.3, 2.6, 0.3], pos: [0, -0.9, 0] },
    { op: 'spin', id: 'wheel', rpm: 10, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'wheel', rod: 'rod' });
  const ends = rodEnds([0.3, 2.6, 0.3]);
  const throwR = 0.3 * 2.2;
  for (const deg of [0, 45, 90, 180, 270, 333]) {
    const f = evaluate(plan, deg / 60);
    const pin = obj(f, 'wheel-pin');
    assert.ok(pin, 'the crank made its own pin');
    const p = posOf(f, 'wheel-pin');
    const a = (deg * Math.PI) / 180;
    near(p[0], -Math.sin(a) * throwR, 1e-9); near(p[1], -2.6 + Math.cos(a) * throwR, 1e-9); // on the throw circle
    assert.ok(p[2] > 0.2, 'in front of the disc face'); // the disc is 0.4 thick, its face at z 0.2
    const rp = posOf(f, 'rod');
    const tilt = ((rotOf(f, 'rod')[2] ?? 0) * Math.PI) / 180;
    near(rp[0] + ends.big * -Math.sin(tilt), p[0], 1e-9); // the rod's big end is on the pin the person sees
    near(rp[1] + ends.big * Math.cos(tilt), p[1], 1e-9);
    assert.ok(rp[2] > 0.2 && Math.abs(rp[2] - p[2]) < 0.3, 'the rod runs in front of the disc, on the pin');
  }
});

test('the pin the crank draws rests where its shaft is, not at the origin (what fits the camera to the model sees the rest values)', () => {
  const plan = run(
    { op: 'add', shape: 'cylinder', id: 'wheel', size: [2.2, 0.4, 2.2], pos: [30, -2.6, 0], rot: [90, 0, 0] },
    { op: 'add', shape: 'box', id: 'pis', size: [2.2, 1, 2], pos: [30, 0.6, 0] },
    { op: 'spin', id: 'wheel', rpm: 10, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'wheel' });
  const f = evaluate(plan, 0.5);
  assert.deepEqual(obj(f, 'wheel-pin')?.pos, [30, -2.6, 0]);
});

test('a kit crankshaft draws its own pin already: the crank adds none', () => {
  const plan = run(part('crank', 'crankshaft', { size: [4, 4, 2], pos: [0, -2, 0] }), part('rod', 'connecting-rod', { size: [0.8, 4, 0.5] }), part('pis', 'piston', { size: [2, 2, 2], pos: [0, 3, 0] }),
    { op: 'spin', id: 'crank', rpm: 10, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'crank', rod: 'rod' });
  assert.equal(evaluate(plan, 1).objects.length, 3);
});
