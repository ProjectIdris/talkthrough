import assert from 'node:assert/strict';
import test from 'node:test';
import { Euler, Matrix4, Vector3 } from 'three';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// The lever and the pulley: one op each, over the hinge, the swing, the spin and the coupling that are already there.

const near = (a: number | undefined, b: number, eps = 1e-5) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-5) => a.forEach((v, i) => near(v, b[i]!, eps));
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const posOf = (f: Frame, id: string) => (obj(f, id).pose?.pos ?? obj(f, id).pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id).pose?.rot ?? obj(f, id).rot) as [number, number, number];
const matrix = (rot: readonly number[]) => new Matrix4().makeRotationFromEuler(new Euler(rot[0]! * Math.PI / 180, rot[1]! * Math.PI / 180, rot[2]! * Math.PI / 180, 'XYZ'));
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues };
};
const beam = { op: 'add', shape: 'box', id: 'beam', size: [6, 0.4, 1], pos: [0, 2, 0] };
/** Where a point of the beam, written in its own space, is in the world at a time. */
const spot = (plan: ReturnType<typeof run>['plan'], t: number, local: [number, number, number]) => {
  const f = evaluate(plan, t);
  return new Vector3(...local).applyMatrix4(matrix(rotOf(f, 'beam'))).add(new Vector3(...posOf(f, 'beam')));
};

test('a lever on its middle is a seesaw: the middle stays, the ends rise and fall', () => {
  const { plan, issues } = run(beam, { op: 'lever', id: 'beam', swing: 20, period: 4 });
  assert.deepEqual(issues, []);
  for (const t of [0.5, 1.3, 2.6]) nearV(spot(plan, t, [0, 0, 0]).toArray(), [0, 2, 0]);
  const rise = (t: number) => spot(plan, t, [3, 0, 0]).y - 2;
  assert.ok(Math.max(...[0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(rise)) > 0.9, 'the right end rises');
  assert.ok(Math.min(...[0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(rise)) < -0.9, 'and falls');
  const left = (t: number) => spot(plan, t, [-3, 0, 0]).y - 2;
  near(left(1.2), -rise(1.2));
});

test('a lever on an end keeps that end where it is (the second and third classes)', () => {
  const { plan } = run(beam, { op: 'lever', id: 'beam', fulcrum: 'left', swing: 15, period: 4 });
  for (const t of [0.4, 1.1, 2.3, 3.2]) nearV(spot(plan, t, [-3, 0, 0]).toArray(), [-3, 2, 0]);
  assert.ok(Math.abs(spot(plan, 1.5, [3, 0, 0]).y - 2) > 0.5, 'the far end swings');
});

test('a lever turns about a point the part names, and refuses one it does not have', () => {
  const named = run(beam, { op: 'anchor', id: 'beam', name: 'peg', pos: [1, 0, 0] }, { op: 'lever', id: 'beam', fulcrum: 'peg', swing: 25, period: 4 });
  for (const t of [0.6, 1.9]) nearV(spot(named.plan, t, [1, 0, 0]).toArray(), [1, 2, 0]);
  const checked = validateStep({ say: 'x', actions: [beam, { op: 'lever', id: 'beam', fulcrum: 'hinge' }] }, createSceneState());
  assert.ok(checked.issues.some((i) => /unknown point "hinge" on "beam"/.test(i.message)), JSON.stringify(checked.issues));
});

test('a part attached to the beam is carried by it: its point stays on the beam point while the beam rocks, so it rises and falls', () => {
  const { plan } = run(beam, { op: 'add', shape: 'sphere', id: 'load', size: [0.6, 0.6, 0.6], parent: 'beam', parentAnchor: 'right', selfAnchor: 'bottom' }, { op: 'lever', id: 'beam', swing: 20, period: 4 });
  const times = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
  const ys = times.map((t) => {
    const f = evaluate(plan, t);
    const child = obj(f, 'load');
    assert.equal(child.parentKey, obj(f, 'beam').key, 'it rides in the beam');
    const p = child.pose?.pos ?? child.pos;
    nearV(p, (obj(evaluate(plan, 0.5), 'load').pose?.pos ?? obj(evaluate(plan, 0.5), 'load').pos) as number[], 1e-9);
    return spot(plan, t, [p[0], p[1], p[2]]).y;
  });
  assert.ok(Math.max(...ys) - Math.min(...ys) > 1.5, `the load travels ${Math.max(...ys) - Math.min(...ys)}`);
});

const wheel = { op: 'add', shape: 'cylinder', id: 'wheel', size: [2, 0.4, 2] };
const load = { op: 'add', shape: 'box', id: 'bucket', size: [1, 1, 1], pos: [3, -2, 0] };

test('a pulley turns the wheel and lifts the load by the rope that comes off it: 2 x pi x radius a turn', () => {
  const { plan, issues } = run(wheel, load, { op: 'pulley', id: 'bucket', wheel: 'wheel', radius: 1.5, rpm: 60 });
  assert.deepEqual(issues, []);
  const turned = (t: number) => rotOf(evaluate(plan, t), 'wheel')[2];
  const risen = (t: number) => posOf(evaluate(plan, t), 'bucket')[1] + 2;
  for (const t of [0.5, 1.7, 3]) near(risen(t), (2 * Math.PI * 1.5 * turned(t)) / 360, 1e-4);
  assert.ok(Math.abs(turned(3)) > 90, 'the wheel really turns');
  assert.ok(Math.abs(risen(3)) > 2, 'and the load moves');
});

test('a pulley reads the radius off the wheel when left out (half its width), and a negative rpm lowers the load', () => {
  const { plan } = run(wheel, load, { op: 'pulley', id: 'bucket', wheel: 'wheel', rpm: -60 });
  const turned = rotOf(evaluate(plan, 3), 'wheel')[2];
  const risen = posOf(evaluate(plan, 3), 'bucket')[1] + 2;
  near(risen, (2 * Math.PI * 1 * turned) / 360, 1e-4);
  assert.ok(turned < 0 && risen < 0, 'the other way round');
});

test('a pulley of a part with itself, or a loop of couplings, is refused', () => {
  const same = validateStep({ say: 'x', actions: [wheel, { op: 'pulley', id: 'wheel', wheel: 'wheel' }] }, createSceneState());
  assert.ok(same.issues.some((i) => /different parts/.test(i.message)), JSON.stringify(same.issues));
});
