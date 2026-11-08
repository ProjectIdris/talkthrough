import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Vector3 } from 'three';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// A muscle: a connector that contracts between two points and turns the part it pulls, by the elastic rule (it swells as it shortens).

const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const posOf = (f: Frame, id: string) => (obj(f, id).pose?.pos ?? obj(f, id).pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id).pose?.rot ?? obj(f, id).rot) as [number, number, number];
const matrix = (rot: readonly number[]) => new Matrix4().makeRotationFromEuler(new Euler(rot[0]! * Math.PI / 180, rot[1]! * Math.PI / 180, rot[2]! * Math.PI / 180, 'XYZ'));
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues, step: checked.step };
};

const upper = { op: 'add', shape: 'box', id: 'upper', size: [1, 4, 1], pos: [0, 0, 0] };
const fore = (extra: object = {}) => ({ op: 'add', shape: 'box', id: 'fore', size: [0.8, 3, 0.8], parent: 'upper', parentAnchor: 'bottom', selfAnchor: 'top', ...extra });
const FROM: [number, number, number] = [0.6, -0.5, 0];
const TO: [number, number, number] = [0.5, 0.2, 0];
const bicep = (extra: object = {}) => ({ op: 'add', shape: 'connector', id: 'bicep', from: 'upper', to: 'fore', fromPoint: FROM, toPoint: TO, ...extra });
const hinge = (extra: object = {}) => ({ op: 'joint', id: 'fore', kind: 'hinge', about: 'top', axis: 'z', min: -120, max: 120, ...extra });
/** How far apart the two ends of the connector are at a time (the holder is the forearm's parent, so its point is in the same space the forearm is placed in). */
const span = (plan: ReturnType<typeof run>['plan'], t: number): number => {
  const f = evaluate(plan, t);
  const b = new Vector3(...TO).applyMatrix4(matrix(rotOf(f, 'fore'))).add(new Vector3(...posOf(f, 'fore')));
  return b.distanceTo(new Vector3(...FROM));
};

test('a muscle is as long as its cycle says: relaxed at the start, shortened by contract at the peak, and the part is turned to make it so', () => {
  const { plan, issues } = run(upper, fore(), bicep(), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.25, period: 4 });
  assert.deepEqual(issues, []);
  const relaxed = span(plan, 0);
  const peak = span(plan, 2);
  assert.ok(Math.abs(peak - relaxed * 0.75) < 1e-4, `${peak} is not 3/4 of ${relaxed}`);
  assert.ok(Math.abs(rotOf(evaluate(plan, 0), 'fore')[2]) < 1e-6, 'relaxed, the forearm is as it was set');
  assert.ok(Math.abs(rotOf(evaluate(plan, 2), 'fore')[2]) > 5, 'contracted, the forearm has been turned');
  // Every moment between: length follows (1 - contract x cycle), the cycle being (1 - cos) / 2 of a turn of the period.
  for (const t of [0.3, 0.9, 1.4, 2.7, 3.5]) {
    const cycle = (1 - Math.cos((2 * Math.PI * t) / 4)) / 2;
    const want = relaxed * (1 - 0.25 * cycle);
    assert.ok(Math.abs(span(plan, t) - want) < 1e-3, `at ${t}: ${span(plan, t)} wanted ${want}`);
  }
});

test('the connector gets its relaxed length for the swell when the model gave none, and keeps the one it gave', () => {
  const { plan } = run(upper, fore(), bicep(), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', period: 4 });
  const made = (obj(evaluate(plan, 0), 'bicep').def as { restLength?: number }).restLength;
  assert.ok(made !== undefined && Math.abs(made - span(plan, 0)) < 1e-6, `restLength ${made} vs ${span(plan, 0)}`);
  const given = run(upper, fore(), bicep({ restLength: 2.5 }), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', period: 4 });
  assert.equal((obj(evaluate(given.plan, 0), 'bicep').def as { restLength?: number }).restLength, 2.5);
});

test('a muscle cannot pull a joint past its limits: it stops there and the muscle stays longer than it wanted', () => {
  const { plan } = run(upper, fore(), bicep(), hinge({ min: -10, max: 10 }), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.6, period: 4 });
  const turned = [0.5, 1, 1.5, 2, 2.5, 3].map((t) => Math.abs(rotOf(evaluate(plan, t), 'fore')[2]));
  assert.ok(Math.max(...turned) <= 10 + 1e-6, `turned ${Math.max(...turned)}`);
  assert.ok(span(plan, 2) > span(plan, 0) * 0.4 + 1e-3, 'it could not reach the length it wanted');
});

test('a muscle replaces a loop on the part, and a loop after it replaces the muscle', () => {
  const first = run(upper, fore(), bicep(), hinge(), { op: 'loop', id: 'fore', kind: 'swing', amount: 40, period: 4 }, { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.25, period: 4 });
  assert.ok(Math.abs(span(first.plan, 2) - span(first.plan, 0) * 0.75) < 1e-4, 'the muscle drives it');
  const second = run(upper, fore(), bicep(), hinge(), { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.25, period: 4 }, { op: 'loop', id: 'fore', kind: 'swing', amount: 40, period: 4 });
  assert.ok(Math.abs(rotOf(evaluate(second.plan, 1), 'fore')[2]) > 30, 'the loop drives it');
  assert.ok(Math.abs(span(second.plan, 1) - span(second.plan, 0) * (1 - 0.25 * 0.5)) > 0.05, 'and the muscle no longer does');
});

/** A point of an object in the world: up through its parents, each as the frame has it placed. */
const world = (f: Frame, id: string, local: readonly number[]): Vector3 => {
  let o: Frame['objects'][number] | undefined = obj(f, id);
  const p = new Vector3(...local);
  while (o) {
    const pos = o.pose?.pos ?? o.pos, rot = o.pose?.rot ?? o.rot;
    p.multiply(new Vector3(...o.scale)).applyMatrix4(matrix(rot)).add(new Vector3(...pos));
    o = o.parentKey === null ? undefined : f.objects.find((x) => x.key === o!.parentKey);
  }
  return p;
};

test('the two ends can hang on different branches of the scene: the holder need not be the pulled parent or beside it', () => {
  const group = { op: 'add', shape: 'group', id: 'arm', pos: [1, 2, 0] };
  const humerus = { op: 'add', shape: 'box', id: 'upper', size: [1, 4, 1], parent: 'arm' };
  const elbow = { op: 'add', shape: 'sphere', id: 'elbow', size: [1, 1, 1], parent: 'arm', pos: [0, -2.4, 0] };
  const forearm = { op: 'add', shape: 'box', id: 'fore', size: [0.8, 3, 0.8], parent: 'elbow', parentAnchor: 'bottom', selfAnchor: 'top' };
  const conn = { op: 'add', shape: 'connector', id: 'bicep', parent: 'arm', from: 'upper', to: 'fore', fromPoint: [0.6, -0.5, 0], toPoint: [0.5, 0.2, 0] };
  const { plan, issues } = run(group, humerus, elbow, forearm, conn, { op: 'joint', id: 'fore', kind: 'hinge', about: 'top', axis: 'z', min: -120, max: 120 }, { op: 'muscle', id: 'bicep', pulls: 'fore', contract: 0.25, period: 4 });
  assert.deepEqual(issues, []);
  const gap = (t: number) => { const f = evaluate(plan, t); return world(f, 'upper', [0.6, -0.5, 0]).distanceTo(world(f, 'fore', [0.5, 0.2, 0])); };
  assert.ok(Math.abs(gap(2) - gap(0) * 0.75) < 1e-3, `${gap(2)} is not 3/4 of ${gap(0)}`);
  assert.ok(Math.abs(rotOf(evaluate(plan, 2), 'fore')[2]) > 5, 'the forearm is turned');
});

test('the end can be said as from or to, the connector own names for them', () => {
  const { plan, issues } = run(upper, fore(), bicep(), hinge(), { op: 'muscle', id: 'bicep', pulls: 'to', contract: 0.25, period: 4 });
  assert.deepEqual(issues, []);
  assert.ok(Math.abs(span(plan, 2) - span(plan, 0) * 0.75) < 1e-4, 'the part at the to end is pulled');
});

test('a muscle that cannot work is refused with the reason', () => {
  const reason = (...actions: unknown[]): string => {
    const checked = validateStep({ say: 'x', actions }, createSceneState());
    return checked.issues.map((i) => i.message).join(' | ');
  };
  assert.match(reason(upper, fore(), hinge(), { op: 'muscle', id: 'upper', pulls: 'fore' }), /id to be a connector/);
  assert.match(reason(upper, fore(), bicep(), hinge(), { op: 'add', shape: 'box', id: 'far', size: [1, 1, 1], pos: [5, 0, 0] }, { op: 'muscle', id: 'bicep', pulls: 'far' }), /not an end of connector/);
  assert.match(reason(upper, fore(), bicep(), { op: 'muscle', id: 'bicep', pulls: 'fore' }), /hinge or pivot joint/);
});
