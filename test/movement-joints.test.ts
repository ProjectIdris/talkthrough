import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Vector3 } from 'three';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// Pivot and ball joints, and a point named for a joint to turn about. Every pose is a function of time since the step began.

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-6) => a.forEach((v, i) => near(v, b[i]!, eps));
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const posOf = (f: Frame, id: string) => (obj(f, id).pose?.pos ?? obj(f, id).pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id).pose?.rot ?? obj(f, id).rot) as [number, number, number];
const matrix = (rot: readonly number[]) => new Matrix4().makeRotationFromEuler(new Euler(rot[0]! * Math.PI / 180, rot[1]! * Math.PI / 180, rot[2]! * Math.PI / 180, 'XYZ'));
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues, step: checked.step };
};
const limb = (id: string, extra: object = {}) => ({ op: 'add', shape: 'cylinder', id, size: [0.5, 3, 0.5], ...extra });
const rad = (deg: number) => (deg * Math.PI) / 180;

test('a pivot turns a part about its own long axis, however it is laid: the long axis stays where it points', () => {
  const { plan } = run(limb('arm', { rot: [0, 0, 30], pos: [1, 2, 0] }), { op: 'joint', id: 'arm', kind: 'pivot', min: -90, max: 90 }, { op: 'loop', id: 'arm', amount: 60, period: 4 });
  const axisAt = (t: number) => new Vector3(0, 1, 0).applyMatrix4(matrix(rotOf(evaluate(plan, t), 'arm')));
  const sideAt = (t: number) => new Vector3(1, 0, 0).applyMatrix4(matrix(rotOf(evaluate(plan, t), 'arm')));
  nearV(axisAt(0).toArray(), axisAt(1).toArray());
  nearV(axisAt(0).toArray(), [-Math.sin(rad(30)), Math.cos(rad(30)), 0]);
  // A swing of 60 a side, a quarter-period in: its own x has turned 60 degrees about its own y (the loop starts at rest and swings by the cosine).
  const a = sideAt(0), b = sideAt(1);
  assert.ok(Math.abs(a.angleTo(b) - rad(60)) < 1e-6 || Math.abs(a.angleTo(b) - rad(60)) < 1e-3, `turned ${((a.angleTo(b) * 180) / Math.PI).toFixed(3)} degrees`);
  nearV(posOf(evaluate(plan, 1), 'arm'), [1, 2, 0]);
  // A hinge about the parent's z would have tipped the axis: the pivot does not.
  const hinge = run(limb('arm', { rot: [0, 0, 30], pos: [1, 2, 0] }), { op: 'joint', id: 'arm', kind: 'hinge', axis: 'y' }, { op: 'loop', id: 'arm', amount: 60, period: 4 });
  const hingeAxis = new Vector3(0, 1, 0).applyMatrix4(matrix(rotOf(evaluate(hinge.plan, 1), 'arm')));
  assert.ok(hingeAxis.distanceTo(axisAt(0)) > 0.3, 'a hinge about the parent y moves the tilted axis; the pivot keeps it');
});

test('a pivot holds to its limits and takes a spin or a coupling like a hinge', () => {
  const { plan } = run(limb('a'), { op: 'joint', id: 'a', kind: 'pivot', min: -20, max: 20 }, { op: 'spin', id: 'a', rpm: 30, dur: 0 });
  const yAt = (t: number) => rotOf(evaluate(plan, t), 'a')[1];
  near(yAt(0.05), 9);
  near(yAt(1), 20);
  const coupled = run(limb('a'), limb('b', { pos: [2, 0, 0] }), { op: 'joint', id: 'a', kind: 'pivot' }, { op: 'joint', id: 'b', kind: 'hinge', axis: 'y' }, { op: 'spin', id: 'a', rpm: 10, dur: 0 }, { op: 'couple', id: 'b', by: 'a', ratio: 2 });
  assert.deepEqual(coupled.issues, [], 'a pivot and a hinge are coupled by ratio');
  near(rotOf(evaluate(coupled.plan, 1), 'b')[1], 120);
});

test('a ball joint turns about all three axes about its pivot point: x first, then y, then z, each axis its own loop', () => {
  const { plan } = run(limb('arm', { pos: [0, -1.5, 0] }), { op: 'joint', id: 'arm', kind: 'ball', pivot: [0, 1.5, 0] },
    { op: 'loop', id: 'arm', kind: 'swing', axis: 'x', amount: 40, period: 4 }, { op: 'loop', id: 'arm', kind: 'swing', axis: 'z', amount: 25, period: 4, phase: 90 });
  for (const t of [0.5, 1.3, 2.2]) {
    const f = evaluate(plan, t);
    // The angle of a loop of period 4 started at the rest angle 270: cos(270 + 90 t)*amount; the second is a quarter-cycle ahead.
    const qx = Math.cos(rad(270 + 90 * t)) * 40, qz = Math.cos(rad(270 + 90 + 90 * t)) * 25;
    const turn = new Matrix4().makeRotationZ(rad(qz)).multiply(new Matrix4().makeRotationY(0)).multiply(new Matrix4().makeRotationX(rad(qx)));
    // The pivot is written from the part's middle ([0,1.5,0] above it), so it lies at the origin, and the part's middle swings about it.
    const expected = new Vector3(0, -1.5, 0).applyMatrix4(turn);
    nearV(posOf(f, 'arm'), expected.toArray(), 1e-5);
    nearV(new Vector3(0, 1, 0).applyMatrix4(matrix(rotOf(f, 'arm'))).toArray(), new Vector3(0, 1, 0).applyMatrix4(turn).toArray(), 1e-5);
  }
  // The top of the arm (the pivot) never moves.
  const top = (t: number) => new Vector3(0, 1.5, 0).applyMatrix4(matrix(rotOf(evaluate(plan, t), 'arm'))).add(new Vector3(...posOf(evaluate(plan, t), 'arm')));
  nearV(top(0.7).toArray(), [0, 0, 0], 1e-5);
  nearV(top(2.9).toArray(), [0, 0, 0], 1e-5);
});

test('a ball joint holds each axis to its limit, and a spin on an axis is that axis', () => {
  const { plan } = run(limb('a'), { op: 'joint', id: 'a', kind: 'ball', limit: [30, 15, 90] }, { op: 'loop', id: 'a', kind: 'swing', axis: 'x', amount: 80, period: 4 }, { op: 'spin', id: 'a', axis: 'y', rpm: 60, dur: 0 });
  const f = evaluate(plan, 1); // the x swing is at 80 x cos(270 + 90) = 80 (held to 30); the y twist 360 degrees (held to 15)
  const turn = new Matrix4().makeRotationY(rad(15)).multiply(new Matrix4().makeRotationX(rad(30)));
  nearV(new Vector3(0, 0, 1).applyMatrix4(matrix(rotOf(f, 'a'))).toArray(), new Vector3(0, 0, 1).applyMatrix4(turn).toArray(), 1e-5);
});

test('a ball joint on a part attached at a point turns about that point, with no pivot written', () => {
  const { plan } = run(limb('upper', { pos: [0, 2, 0] }), limb('lower', { parent: 'upper', parentAnchor: 'bottom', selfAnchor: 'top' }),
    { op: 'joint', id: 'lower', kind: 'ball', limit: [90, 90, 90] }, { op: 'loop', id: 'lower', kind: 'swing', axis: 'x', amount: 50, period: 4 });
  assert.ok(Math.abs(rotOf(evaluate(plan, 1), 'lower')[0]) > 10, 'the lower part swings');
  for (const t of [0, 1, 1.7]) {
    const f = evaluate(plan, t);
    const m = new Matrix4().multiplyMatrices(new Matrix4().makeTranslation(...posOf(f, 'lower')), matrix(rotOf(f, 'lower')));
    // The top of the lower part stays at the bottom of the upper part ([0,-1.5,0] in the upper part's own space, where the lower part is placed).
    nearV(new Vector3(0, 1.5, 0).applyMatrix4(m).toArray(), [0, -1.5, 0], 1e-5);
  }
});

test('about names the point a joint turns about: the same pose as writing the pivot, and an unknown point is refused with the points there are', () => {
  const named = run({ op: 'add', shape: 'box', id: 'door', size: [2, 4, 0.2], pos: [1, 0, 0] }, { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', about: 'left' }, { op: 'loop', id: 'door', amount: 60, period: 4 });
  const written = run({ op: 'add', shape: 'box', id: 'door', size: [2, 4, 0.2], pos: [1, 0, 0] }, { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', pivot: [-1, 0, 0] }, { op: 'loop', id: 'door', amount: 60, period: 4 });
  for (const t of [0.4, 1, 2.5]) {
    nearV(posOf(evaluate(named.plan, t), 'door'), posOf(evaluate(written.plan, t), 'door'));
    nearV(rotOf(evaluate(named.plan, t), 'door'), rotOf(evaluate(written.plan, t), 'door'));
  }
  const bad = validateStep({ say: 'x', actions: [{ op: 'add', shape: 'box', id: 'door', size: [2, 4, 0.2] }, { op: 'joint', id: 'door', kind: 'hinge', about: 'hinge' }] }, createSceneState());
  assert.ok(!bad.step!.actions.some((a) => a.op === 'joint'));
  assert.ok(bad.issues.some((n) => /unknown point "hinge" on "door"; available: origin, center, top/.test(n.message)), JSON.stringify(bad.issues));
});

test('about turns by the part\'s own orientation: a limb laid on its side hinges about its own end', () => {
  const { plan } = run(limb('bar', { rot: [0, 0, 90], pos: [0, 0, 0] }), { op: 'joint', id: 'bar', kind: 'hinge', axis: 'z', about: 'top' }, { op: 'loop', id: 'bar', amount: 90, period: 4 });
  // Laid on its side by [0,0,90], the part's top (+y, 1.5 from its middle) points to -x: the point to turn about is at [-1.5, 0, 0] from its middle.
  const f = evaluate(plan, 1);
  const top = new Vector3(0, 1.5, 0).applyMatrix4(matrix(rotOf(f, 'bar'))).add(new Vector3(...posOf(f, 'bar')));
  nearV(top.toArray(), [-1.5, 0, 0], 1e-5);
});

test('a ball joint is not coupled, and its loops are one for each axis', () => {
  const r = validateStep({ say: 'x', actions: [limb('a'), limb('b'), { op: 'joint', id: 'a', kind: 'ball' }, { op: 'joint', id: 'b', kind: 'hinge' }, { op: 'couple', id: 'b', by: 'a' }] }, createSceneState());
  assert.ok(!r.step!.actions.some((a) => a.op === 'couple'));
  assert.ok(r.issues.some((n) => /ball joint is driven by a swing loop or spin on each axis/.test(n.message)));
  const { plan } = run(limb('a'), { op: 'joint', id: 'a', kind: 'ball' }, { op: 'loop', id: 'a', axis: 'x', amount: 20 }, { op: 'loop', id: 'a', axis: 'z', amount: 30 }, { op: 'loop', id: 'a', axis: 'x', amount: 10 });
  const f = evaluate(plan, 0.5);
  assert.ok(rotOf(f, 'a')[0] !== 0 || rotOf(f, 'a')[2] !== 0, 'it moves');
  assert.equal(plan.loops.filter((l) => l.axis === 0).length, 1, 'a second loop on the same axis replaces the first');
  assert.equal(plan.loops.length, 2);
});
