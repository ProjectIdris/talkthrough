import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, sceneGuide, sceneSchemaLean, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// The guide pass: what a model was seen to get wrong, said once; and the size the prompt is held to.

const check = (...actions: unknown[]) => validateStep({ say: 'x', actions }, createSceneState());
const posOf = (f: Frame, id: string) => {
  const o = f.objects.find((x) => x.id === id)!;
  return (o.pose?.pos ?? o.pos) as [number, number, number];
};
const play = (...actions: unknown[]) => {
  const checked = check(...actions);
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return planStep(emptyFrame(), checked.step);
};

test('a shape written as the op (op force, field, particles) is read as the add it was meant to be, with a note', () => {
  const base = { op: 'add', shape: 'box', id: 'weight', size: [1, 1, 1] };
  const force = check(base, { op: 'force', id: 'g', on: 'weight', dir: [0, -1, 0], strength: 2 });
  assert.equal(force.step?.actions.length, 2, 'the arrow is made');
  assert.deepEqual(force.step?.actions[1] && { op: (force.step.actions[1] as { op: string }).op, shape: (force.step.actions[1] as { shape?: string }).shape }, { op: 'add', shape: 'force' });
  assert.ok(force.issues.some((i) => /op "force" read as add with shape force/.test(i.message)), JSON.stringify(force.issues));
  const field = check({ op: 'field', id: 'f', kind: 'dipole' });
  assert.equal((field.step?.actions[0] as { shape?: string } | undefined)?.shape, 'field', JSON.stringify(field.issues));
  const cloud = check({ op: 'particles', id: 'p', from: [1, 1, 1], to: [4, 4, 4] });
  assert.equal((cloud.step?.actions[0] as { shape?: string } | undefined)?.shape, 'particles', JSON.stringify(cloud.issues));
});

test('any shape name written as an op is rewritten, each with a note (sphere, tube, array, group too)', () => {
  const box = { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] };
  for (const written of [
    { op: 'sphere', id: 's', size: [1, 1, 1] },
    { op: 'group', id: 'g' },
    { op: 'tube', id: 't', pts: [[0, 0, 0], [0, 2, 0]], radius: 0.2 },
    { op: 'array', id: 'a', of: 'b', count: 3, step: [1, 0, 0] },
  ]) {
    const r = check(box, written);
    assert.equal((r.step?.actions[1] as { shape?: string } | undefined)?.shape, written.op, `${written.op}: ${JSON.stringify(r.issues)}`);
    assert.ok(r.issues.some((i) => new RegExp(`op "${written.op}" read as add with shape ${written.op}`).test(i.message)), `${written.op} has its note`);
  }
});

test('a name that is no shape stays dropped, and so does an op whose shape is given as something else', () => {
  const nothing = check({ op: 'frobnicate', id: 'f' });
  assert.ok(nothing.issues.some((i) => /unknown action "frobnicate"/.test(i.message)), JSON.stringify(nothing.issues));
  const other = check({ op: 'force', shape: 'box', id: 'f', size: [1, 1, 1] });
  assert.ok(other.issues.some((i) => /unknown action "force"/.test(i.message)), JSON.stringify(other.issues));
});

const wheel = { op: 'add', shape: 'cylinder', id: 'drum', size: [1, 3, 1] };
const load = { op: 'add', shape: 'box', id: 'bucket', size: [1, 1, 1], pos: [3, -2, 0] };

test('a pulley load that would rise without end stops at max; without max it goes on', () => {
  const free = play(wheel, load, { op: 'pulley', id: 'bucket', wheel: 'drum', radius: 0.4, rpm: 60 });
  const stopped = play(wheel, load, { op: 'pulley', id: 'bucket', wheel: 'drum', radius: 0.4, rpm: 60, max: 2 });
  const rise = (plan: ReturnType<typeof play>, t: number) => Math.abs(posOf(evaluate(plan, t), 'bucket')[1] - -2);
  assert.ok(rise(free, 6) > 10, `free: ${rise(free, 6)}`);
  assert.ok(Math.abs(rise(stopped, 6) - 2) < 1e-6, `stopped: ${rise(stopped, 6)}`);
  assert.ok(rise(stopped, 0.3) < 2, 'and it was on its way before that');
});

test('a screw nut stops at max the same way', () => {
  const screw = { op: 'add', shape: 'cylinder', id: 'bolt', size: [0.5, 4, 0.5] };
  const nut = { op: 'add', shape: 'box', id: 'nut', size: [1, 0.4, 1] };
  const free = play(screw, nut, { op: 'screw', id: 'nut', screw: 'bolt', pitch: 0.5, rpm: 60 });
  const stopped = play(screw, nut, { op: 'screw', id: 'nut', screw: 'bolt', pitch: 0.5, rpm: 60, max: 1.5 });
  const travel = (plan: ReturnType<typeof play>, t: number) => Math.abs(posOf(evaluate(plan, t), 'nut')[1]);
  assert.ok(travel(free, 10) > 4, `free: ${travel(free, 10)}`);
  assert.ok(travel(stopped, 10) <= 1.5 + 1e-6, `stopped: ${travel(stopped, 10)}`);
});

test('the guide tells the model what the judge sets showed it missing', () => {
  assert.match(sceneGuide, /heart or bellows is a pump/);
  assert.match(sceneGuide, /surge and beat/);
  assert.match(sceneGuide, /never op force/);
  assert.match(sceneGuide, /A load that would rise or travel without end .* gets max/);
  assert.match(sceneGuide, /keep a part that travels along the tube .* off the ends/);
  assert.match(sceneGuide, /hang it from a part that does not slide, and write the pendulum after any loop/);
});

test('the prompt keeps to its budget: the guide and the lean schema are sent with every question', () => {
  assert.ok(sceneGuide.length <= 43500, `the guide is ${sceneGuide.length} characters`);
  assert.ok(JSON.stringify(sceneSchemaLean).length <= 33500, `the lean schema is ${JSON.stringify(sceneSchemaLean).length} characters`);
});
