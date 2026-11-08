import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, sceneGuide, validateStep } from '../src/scene/index.ts';

// Every other op names the thing it acts on `id`; clear alone says `target`. A model that writes the id as `id` (seven times in one answer) meant the same.
const run = (...actions: unknown[]) => validateStep({ say: 'x', actions: [{ op: 'panel', x: 500, y: 100, w: 400, h: 600 }, { op: 'add', shape: 'box', id: 'eth', size: [1, 1, 1] }, ...actions] }, createSceneState());
const ops = (r: ReturnType<typeof run>) => (r.step?.actions ?? []).map((a) => a.op).join(',');

test('clear written with id is read as clear with target, with a note', () => {
  const r = run({ op: 'clear', id: 'eth' });
  assert.equal(ops(r), 'panel,add,clear', JSON.stringify(r.issues));
  assert.equal((r.step!.actions[2] as { target?: string }).target, 'eth');
  assert.ok(r.issues.some((i) => /clear takes target; id "eth" read as target/.test(i.message)), JSON.stringify(r.issues));
  assert.ok(!r.issues.some((i) => /missing target/.test(i.message)));
});

test('an explicit target wins over an id, and an unknown id is still refused', () => {
  const both = run({ op: 'clear', target: 'eth', id: 'other' });
  assert.equal((both.step!.actions[2] as { target?: string }).target, 'eth');
  const unknown = run({ op: 'clear', id: 'nothing' });
  assert.equal(ops(unknown), 'panel,add', 'a clear of an id that does not exist is dropped as before');
  assert.ok(unknown.issues.some((i) => /unknown id "nothing"/.test(i.message)), JSON.stringify(unknown.issues));
  const everything = run({ op: 'clear', id: 'all' });
  assert.equal((everything.step!.actions[2] as { target?: string }).target, 'all');
});

test('target written where the op wants id is read as id (highlight, move, spin)', () => {
  const r = run({ op: 'highlight', target: 'eth' }, { op: 'move', target: 'eth', to: [1, 0, 0] }, { op: 'spin', target: 'eth', rpm: 10 });
  assert.equal(ops(r), 'panel,add,highlight,move,spin', JSON.stringify(r.issues));
  assert.equal((r.step!.actions[2] as { id?: string }).id, 'eth');
  assert.ok(r.issues.some((i) => /highlight takes id; target "eth" read as id/.test(i.message)), JSON.stringify(r.issues));
});

test('the guide says clear takes target, and that it is the id', () => {
  assert.match(sceneGuide, /clear \{target at\?\}/);
  assert.match(sceneGuide, /clear \{target at\?\}: [^\n]*target is its id/);
});
