import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
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
