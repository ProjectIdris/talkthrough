import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';

const cyl = (id: string, extra: object = {}) => ({ op: 'add', shape: 'cylinder', id, size: [2, 0.4, 2], rot: [90, 0, 0], ...extra });
const check = (actions: unknown[]) => validateStep({ say: 'x', actions }, createSceneState());
const kept = (r: ReturnType<typeof check>, op: string) => (r.step?.actions ?? []).filter((a) => a.op === op).length;

test('a spin on a part inside a part that already spins about the same axis is dropped: it turns with it already (the bicycle wheel spun twice)', () => {
  const r = check([cyl('cog'), cyl('wheel', { parent: 'cog' }), { op: 'spin', id: 'cog', rpm: 20 }, { op: 'spin', id: 'wheel', rpm: 20 }]);
  assert.equal(kept(r, 'spin'), 1, 'only the holder spins');
  assert.ok(r.issues.some((n) => /wheel is inside cog.*twice as fast/.test(String(n.message ?? n))), JSON.stringify(r.issues));
});

test('the same holds for a spin locked to another part, and a grandchild', () => {
  const r = check([cyl('a'), cyl('b', { parent: 'a' }), cyl('c', { parent: 'b' }), cyl('d'), { op: 'spin', id: 'a', rpm: 10 }, { op: 'spin', id: 'c', by: 'd', ratio: 2 }]);
  assert.equal(kept(r, 'spin'), 1);
});

test('what is not a double turn is kept: another axis, a part that is not inside, a holder that was stopped', () => {
  const another = check([cyl('a'), cyl('b', { parent: 'a' }), { op: 'spin', id: 'a', rpm: 10, axis: 'z' }, { op: 'spin', id: 'b', rpm: 10, axis: 'y' }]);
  assert.equal(kept(another, 'spin'), 2, 'a planet turning on its own axis as its carrier turns');
  const apart = check([cyl('a'), cyl('b'), { op: 'spin', id: 'a', rpm: 10 }, { op: 'spin', id: 'b', rpm: 10 }]);
  assert.equal(kept(apart, 'spin'), 2);
  const stopped = check([cyl('a'), cyl('b', { parent: 'a' }), { op: 'spin', id: 'a', rpm: 10 }, { op: 'spin', id: 'a', rpm: 0 }, { op: 'spin', id: 'b', rpm: 10 }]);
  assert.equal(kept(stopped, 'spin'), 3);
});

test('across steps of one scene: a holder that spins in step 1 makes a spin on its part in step 2 a double turn', () => {
  const state = createSceneState();
  validateStep({ say: 'one', actions: [cyl('cog'), cyl('wheel', { parent: 'cog' }), { op: 'spin', id: 'cog', rpm: 20 }] }, state);
  const second = validateStep({ say: 'two', actions: [{ op: 'spin', id: 'wheel', rpm: 20 }] }, state);
  assert.equal(kept(second, 'spin'), 0);
});
