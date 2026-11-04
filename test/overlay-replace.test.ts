import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { REPLACE_SECONDS, emptyFrame, evaluate, planStep, settle, shiftCamera } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const named = (f: Frame, id: string) => f.objects.filter((o) => o.id === id);

const first = step(
  { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
  { op: 'add', shape: 'group', id: 'engine' },
  { op: 'add', shape: 'cylinder', id: 'shaft', parent: 'engine', size: [1, 4, 1], pos: [0, 0, 0], color: 'gray' },
  { op: 'add', shape: 'box', id: 'cap', parent: 'shaft', size: [1, 0.3, 1], pos: [0, 2, 0] },
  { op: 'pin', id: 'p', on: 'shaft', text: 'Shaft' },
  { op: 'spin', id: 'shaft', rpm: 60, dur: 0 },
);

test('an object added again under its id is swapped in place: the old one fades out as the new one fades in, and what hung from it hangs from the new', () => {
  const base = settle(planStep(emptyFrame(), first), 2);
  const oldKey = named(base, 'shaft')[0]!.key;
  const plan = planStep(base, step({ op: 'add', shape: 'part', part: 'crankshaft', id: 'shaft', parent: 'engine', size: [3, 3, 2] }));
  const mid = evaluate(plan, REPLACE_SECONDS / 2);
  const both = named(mid, 'shaft');
  assert.equal(both.length, 2, 'for a moment the old and the new are both there');
  const [oldOne, newOne] = [both.find((o) => o.key === oldKey)!, both.find((o) => o.key !== oldKey)!];
  assert.ok(oldOne.fade < 1 && oldOne.fade > 0 && newOne.appear > 0 && newOne.appear < 1, `${oldOne.fade} ${newOne.appear}`);
  const done = evaluate(plan, REPLACE_SECONDS + 0.05);
  assert.equal(named(done, 'shaft').length, 1);
  const swapped = named(done, 'shaft')[0]!;
  assert.equal(swapped.shape, 'part');
  assert.equal(swapped.parentKey, named(done, 'engine')[0]!.key, 'it stays in its group');
  assert.equal(named(done, 'cap')[0]!.parentKey, swapped.key, 'the cap that sat on the old shaft now sits on the new one');
  assert.equal(done.marks.find((m) => m.id === 'p')?.onKey, swapped.key, 'the tag follows');
  assert.equal(named(done, 'engine').length, 1, 'what the answer does not mention is left alone');
  // parents still come before their children
  const at = (id: string) => done.objects.findIndex((o) => o.id === id);
  assert.ok(at('engine') < at('shaft') && at('shaft') < at('cap'));
});

test('what was turning goes on turning through the swap, from the same angle', () => {
  const base = settle(planStep(emptyFrame(), first), 2.25);
  const plan = planStep(base, step({ op: 'add', shape: 'part', part: 'crankshaft', id: 'shaft', size: [3, 3, 2] }));
  const angle = (f: Frame) => named(f, 'shaft').find((o) => o.pose)?.pose?.rot?.[2];
  near(angle(evaluate(plan, 0)), 360 * 2.25);
  near(angle(evaluate(plan, 1)), 360 * 3.25);
});

test('the camera and the user\'s turn of it are not touched by a swap', () => {
  const base = settle(planStep(emptyFrame(), step(...first.actions, { op: 'orbit', az: 30, el: 20, dur: 0 })), 2);
  const plan = planStep(base, step({ op: 'add', shape: 'sphere', id: 'shaft', size: [1, 1, 1] }));
  shiftCamera(plan, 40, -5);
  const cam = evaluate(plan, 0.3).camera;
  near(cam.az, 70);
  near(cam.el, 15);
});

test('the 3D scene moves the parts to the new parent and drops the old object once it has faded', () => {
  const base = settle(planStep(emptyFrame(), first), 2);
  const scene = new PanelScene();
  scene.sync(base, 1);
  const plan = planStep(base, step({ op: 'add', shape: 'part', part: 'crankshaft', id: 'shaft', size: [3, 3, 2] }));
  scene.sync(evaluate(plan, 0.2), 1);
  const during = evaluate(plan, 0.2);
  const cap = during.objects.find((o) => o.id === 'cap')!;
  const fresh = during.objects.find((o) => o.id === 'shaft' && o.shape === 'part')!;
  assert.ok(scene.nodeOf(cap.key)?.parent === scene.nodeOf(fresh.key), 'the cap hangs from the new shaft in three.js too');
  const before = scene.count();
  scene.sync(evaluate(plan, REPLACE_SECONDS + 0.1), 1);
  assert.equal(scene.count(), before - 1, 'the old shaft is gone');
  assert.ok(scene.nodeOf(cap.key), 'and the cap was not taken with it');
});

test('a mark added again under its id replaces the first instead of doubling it', () => {
  const base = settle(planStep(emptyFrame(), step({ op: 'label', id: 'l', x: 10, y: 10, text: 'old', color: 'red' })), 2);
  const plan = planStep(base, step({ op: 'label', id: 'l', x: 10, y: 10, text: 'new', color: 'red' }));
  assert.equal(evaluate(plan, REPLACE_SECONDS + 0.1).marks.filter((m) => m.id === 'l').length, 1);
});

test('an answer that puts a part under what used to hold it cannot make a loop of parents', () => {
  const base = settle(planStep(emptyFrame(), step(
    { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
    { op: 'add', shape: 'group', id: 'x' },
    { op: 'add', shape: 'box', id: 'y', parent: 'x', size: [1, 1, 1] },
  )));
  // y is swapped first, then x is swapped and put under the new y: x's old child y would hang from the new x, which hangs from y
  const plan = planStep(base, step(
    { op: 'add', shape: 'box', id: 'y', size: [2, 2, 2] },
    { op: 'add', shape: 'group', id: 'x', parent: 'y' },
  ));
  const f = evaluate(plan, REPLACE_SECONDS + 0.1);
  const byKey = new Map(f.objects.map((o) => [o.key, o] as const));
  for (const o of f.objects) {
    const seen = new Set<number>();
    for (let k: number | null = o.key; k !== null; k = byKey.get(k)?.parentKey ?? null) {
      assert.ok(!seen.has(k), `${o.id} is in a loop of parents`);
      seen.add(k);
    }
  }
  const scene = new PanelScene();
  scene.sync(f, 1);
  for (const o of f.objects) {
    const n = scene.nodeOf(o.key);
    let depth = 0;
    for (let p = n?.parent; p; p = p.parent) assert.ok(++depth < 20, 'the three.js graph has a loop');
  }
});
