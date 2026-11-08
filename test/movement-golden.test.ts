import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';

// The engine's motion, recorded before the movement work: a piston and rod on a crank, a valve on a cam, and the two whole engines the model has written.
// The poses of every object at forty-one times must stay exactly as they were (to the sixth decimal): the general movement ops are built over them, not instead.

const fx = JSON.parse(readFileSync(new URL('./fixtures/engine-answers.json', import.meta.url), 'utf8')) as Record<string, unknown[]>;
const golden = JSON.parse(readFileSync(new URL('./fixtures/motion-golden.json', import.meta.url), 'utf8')) as Record<string, Record<string, Array<[string, number[], number[]]>>>;
const part = (id: string, p: string, extra: object = {}) => ({ op: 'add', shape: 'part', part: p, id, size: [1, 1, 1], ...extra });
const scenes: Record<string, unknown[]> = {
  D1: fx.D1!, X3: fx.X3!,
  plainCrank: [{ op: 'add', shape: 'cylinder', id: 'wheel', size: [4, 0.6, 4], rot: [90, 0, 0], pos: [0, -2, 0] }, { op: 'add', shape: 'box', id: 'rod', size: [0.3, 5, 0.3], pos: [0, 1, 0.5] }, { op: 'add', shape: 'box', id: 'pis', size: [2, 2, 2], pos: [0, 4, 0] }, { op: 'spin', id: 'wheel', rpm: 10, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'wheel', rod: 'rod' }],
  kitCrank: [part('crank', 'crankshaft', { size: [4, 4, 2], pos: [0, -2, 0] }), part('rod', 'connecting-rod', { size: [0.8, 4, 0.5] }), part('pis', 'piston', { size: [2, 2, 2], pos: [0, 3, 0] }), { op: 'spin', id: 'crank', rpm: 12, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'crank', rod: 'rod' }],
  offsetCrank: [part('crank', 'crankshaft', { size: [4, 4, 2], pos: [0, -2, 0], n: 2 }), part('rod', 'connecting-rod', { size: [0.8, 4, 0.5] }), part('pis', 'piston', { size: [2, 2, 2], pos: [0.6, 3, 0] }), { op: 'spin', id: 'crank', rpm: 20, dur: 0 }, { op: 'crank', id: 'pis', shaft: 'crank', rod: 'rod', pin: 2 }],
  cam: [part('cam', 'camshaft', { size: [3, 1, 1], pos: [0, 4, 0] }), part('valve', 'valve', { size: [0.5, 3, 0.5], pos: [0, 2, 0] }), { op: 'spin', id: 'cam', rpm: 15, dur: 0 }, { op: 'cam', id: 'valve', by: 'cam', lift: 0.8, open: 100, phase: 170 }],
  camDefault: [{ op: 'add', shape: 'cylinder', id: 'shaft', size: [1, 3, 1], pos: [0, 4, 0], rot: [90, 0, 0] }, { op: 'add', shape: 'cylinder', id: 'valve', size: [0.4, 2, 0.4], pos: [0, 2, 0] }, { op: 'spin', id: 'shaft', rpm: 30, dur: 0 }, { op: 'cam', id: 'valve', by: 'shaft' }],
};

const r = (n: number) => Math.round(n * 1e6) / 1e6 + 0; // + 0: the recording is JSON, which has no negative zero

for (const [name, actions] of Object.entries(scenes)) {
  test(`the ${name} engine scene moves exactly as it was recorded`, () => {
    const v = validateStep({ say: 'x', actions }, createSceneState());
    assert.ok(v.step, 'the scene is accepted');
    const plan = planStep(emptyFrame(), v.step);
    // The times the recording was made at: i x 0.15 as the sum comes out (0.8999999999999999 is before a part that comes in at 0.9, 0.9 is not).
    for (let i = 0; i <= 40; i++) {
      const t = i * 0.15, time = String(r(t)), want = golden[name]![time]!;
      const got = evaluate(plan, t).objects.map((o) => [o.id, (o.pose?.pos ?? o.pos).map(r), (o.pose?.rot ?? o.rot).map(r)]);
      assert.deepEqual(got, want, `${name} at ${time}`);
    }
  });
}
