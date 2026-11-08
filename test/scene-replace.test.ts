import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, sceneGuide, startAnswer, validateStep } from '../src/scene/index.ts';

type Act = { op: string; id?: string; size?: number[]; target?: string };
const first = () => {
  const state = createSceneState();
  const r = validateStep({ say: 'x', actions: [
    { op: 'panel', x: 500, y: 100, w: 400, h: 600 },
    { op: 'add', shape: 'box', id: 'pcb', size: [6, 0.2, 4] },
    { op: 'add', shape: 'box', id: 'eth', parent: 'pcb', size: [1, 1, 1] },
    { op: 'pin', id: 'peth', on: 'eth', text: 'Ethernet' },
  ] }, state);
  assert.deepEqual(r.issues.map((i) => i.message), []);
  return state;
};
const ids = (r: ReturnType<typeof validateStep>) => (r.step?.actions ?? []).map((a) => `${a.op}:${(a as Act).id ?? (a as Act).target ?? ''}`);

test('in a follow-up, writing an id that is on screen replaces it, with a note', () => {
  const state = first();
  startAnswer(state); // the next answer
  const r = validateStep({ say: 'y', actions: [{ op: 'add', shape: 'box', id: 'eth', parent: 'pcb', size: [2, 1, 1] }] }, state);
  assert.deepEqual(ids(r), ['add:eth']);
  assert.ok(r.issues.some((i) => /"eth".*replaces/.test(i.message)), JSON.stringify(r.issues));
  assert.ok(!r.issues.some((i) => i.kind === 'dropped'));
});

test('a part written in this answer is not replaceable: a second write of it is refused', () => {
  const state = first();
  startAnswer(state);
  const r = validateStep({ say: 'y', actions: [
    { op: 'add', shape: 'box', id: 'eth', parent: 'pcb', size: [2, 1, 1] },
    { op: 'add', shape: 'box', id: 'eth', parent: 'pcb', size: [3, 1, 1] },
    { op: 'add', shape: 'box', id: 'usb', parent: 'pcb', size: [1, 1, 1] },
    { op: 'add', shape: 'box', id: 'usb', parent: 'pcb', size: [1, 2, 1] },
  ] }, state);
  assert.deepEqual(ids(r), ['add:eth', 'add:usb']);
  assert.equal(r.issues.filter((i) => /already in use/.test(i.message)).length, 2, JSON.stringify(r.issues));
});

test('within the answer that built it, an id is still unique (no turn has started since)', () => {
  const state = createSceneState();
  const r = validateStep({ say: 'x', actions: [
    { op: 'panel', x: 500, y: 100, w: 400, h: 600 },
    { op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] },
    { op: 'add', shape: 'box', id: 'a', size: [2, 1, 1] },
  ] }, state);
  assert.deepEqual(ids(r), ['panel:', 'add:a']);
});

test('a 3D object may be swapped for another 3D kind, a mark only for a mark, and clear then add still works', () => {
  const state = first();
  startAnswer(state);
  const swapped = validateStep({ say: 'y', actions: [{ op: 'add', shape: 'sphere', id: 'eth', parent: 'pcb', size: [1, 1, 1] }] }, state);
  assert.deepEqual(ids(swapped), ['add:eth']);
  const mark = validateStep({ say: 'y', actions: [{ op: 'box', id: 'pcb', x: 10, y: 10, w: 100, h: 100, color: 'red' }] }, state);
  assert.deepEqual(ids(mark), []);
  assert.ok(mark.issues.some((i) => /cannot be swapped/.test(i.message)));
  const again = first();
  startAnswer(again);
  const cleared = validateStep({ say: 'y', actions: [{ op: 'clear', target: 'eth' }, { op: 'add', shape: 'box', id: 'eth', parent: 'pcb', size: [2, 1, 1] }] }, again);
  assert.deepEqual(ids(cleared), ['clear:eth', 'add:eth']);
  assert.ok(!cleared.issues.some((i) => /replaces/.test(i.message)), 'a cleared id is a new one, not a replacement');
});

test('the guide says an id written again replaces it', () => {
  assert.match(sceneGuide, /write an id again to replace it/);
});
