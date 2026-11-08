import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';

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

test('the reverse order: the wheel spun first, then its holder about the same axis: the wheel\'s own spin is stopped, so it does not turn twice as fast', () => {
  const r = check([cyl('cog'), cyl('wheel', { parent: 'cog' }), { op: 'spin', id: 'wheel', rpm: 30, dur: 0 }, { op: 'spin', id: 'cog', rpm: 30, dur: 0 }]);
  const spins = (r.step?.actions ?? []).filter((a) => a.op === 'spin') as Array<{ id: string; rpm?: number }>;
  assert.deepEqual(spins.map((s) => [s.id, s.rpm]), [['wheel', 30], ['cog', 30], ['wheel', 0]], 'the holder spins and the part is stopped');
  assert.ok(r.issues.some((n) => /wheel.*inside cog.*stopped/.test(String(n.message ?? n))), JSON.stringify(r.issues));
  // In the world the wheel turns as fast as its holder and no faster (its own turn is stopped at the holder's start, so it adds nothing after).
  const plan = planStep(emptyFrame(), r.step!);
  const turn = (id: string, t: number) => (evaluate(plan, t).objects.find((o) => o.id === id)!.pose?.rot ?? [0, 0, 0]) as number[];
  const worldAt = (t: number) => (turn('cog', t)[2]! + turn('wheel', t)[2]!);
  const rate = (worldAt(3) - worldAt(2)) / 1;
  assert.ok(Math.abs(rate - 180) < 1, `the wheel turns ${rate} degrees a second in the world, not 360`);
  // A grandchild spun first is stopped too, and another axis or a part that is not inside is left alone.
  const deep = check([cyl('a'), cyl('b', { parent: 'a' }), cyl('c', { parent: 'b' }), { op: 'spin', id: 'c', rpm: 10 }, { op: 'spin', id: 'a', rpm: 10 }]);
  assert.deepEqual((deep.step?.actions ?? []).filter((x) => x.op === 'spin').map((x) => (x as { id: string; rpm?: number }).rpm), [10, 10, 0]);
  const other = check([cyl('a'), cyl('b', { parent: 'a' }), { op: 'spin', id: 'b', rpm: 10, axis: 'y' }, { op: 'spin', id: 'a', rpm: 10, axis: 'z' }]);
  assert.equal(kept(other, 'spin'), 2, 'a planet on its own axis keeps it');
});
