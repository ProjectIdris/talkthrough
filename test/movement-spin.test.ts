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

test('the stop the validator writes is for the axis it stops: written out of time order, it does not freeze a spin about another axis', () => {
  // The wheel spins about z from 0; its holder is spun about z at 5 (the wheel's z spin is stopped then); written last, the wheel spins about x from 2.
  const r = check([cyl('cog'), cyl('wheel', { parent: 'cog' }),
    { op: 'spin', id: 'wheel', rpm: 30, axis: 'z', dur: 0, at: 0 }, { op: 'spin', id: 'cog', rpm: 30, axis: 'z', dur: 0, at: 5 }, { op: 'spin', id: 'wheel', rpm: 30, axis: 'x', dur: 0, at: 2 }]);
  const stops = (r.step?.actions ?? []).filter((a) => a.op === 'spin' && (a as { rpm?: number }).rpm === 0);
  assert.equal(stops.length, 1, 'the stop is written');
  assert.equal((stops[0] as { axis?: string }).axis, 'z', 'and says which axis it stops');
  const plan = planStep(emptyFrame(), r.step!);
  const xAt = (t: number) => (evaluate(plan, t).objects.find((o) => o.id === 'wheel')!.pose?.rot ?? [0, 0, 0])[0]!;
  assert.ok(Math.abs(xAt(7) - xAt(6) - 180) < 1, `the wheel goes on turning about x after 5 s: ${xAt(7) - xAt(6)} degrees a second`);
  // An author's own stop with an axis is as it was: it stops the spin and takes the axis it names.
  const own = check([cyl('w'), { op: 'spin', id: 'w', rpm: 30, axis: 'z', dur: 0, at: 0 }, { op: 'spin', id: 'w', rpm: 0, axis: 'x', dur: 0, at: 2 }]);
  const ownPlan = planStep(emptyFrame(), own.step!);
  const zAt = (t: number) => (evaluate(ownPlan, t).objects.find((o) => o.id === 'w')!.pose?.rot ?? [0, 0, 0])[2]!;
  assert.ok(Math.abs(zAt(4) - zAt(3)) < 1e-6, 'an author\'s stop with an axis still stops the spin');
});

test('a stop aimed at an axis the part is not spinning about does not make the validator forget the spin it has', () => {
  const r = check([cyl('cog'), cyl('wheel', { parent: 'cog' }),
    { op: 'spin', id: 'wheel', rpm: 30, axis: 'x', dur: 0 }, { op: 'spin', id: 'wheel', rpm: 0, axis: 'z', onlyAxis: true, dur: 0 }, { op: 'spin', id: 'cog', rpm: 30, axis: 'x', dur: 0 }]);
  const spins = (r.step?.actions ?? []).filter((a) => a.op === 'spin') as Array<{ id: string; rpm?: number; axis?: string }>;
  assert.deepEqual(spins.slice(-2).map((s) => [s.id, s.rpm, s.axis]), [['cog', 30, 'x'], ['wheel', 0, 'x']], 'the wheel still spinning about x is stopped when its holder spins about x');
  // A stop for the axis it does have, or an author's stop with no flag, forgets it as before.
  const right = check([cyl('cog'), cyl('wheel', { parent: 'cog' }), { op: 'spin', id: 'wheel', rpm: 30, axis: 'x', dur: 0 }, { op: 'spin', id: 'wheel', rpm: 0, axis: 'x', onlyAxis: true, dur: 0 }, { op: 'spin', id: 'cog', rpm: 30, axis: 'x', dur: 0 }]);
  assert.equal((right.step?.actions ?? []).filter((a) => a.op === 'spin').length, 3, 'no further stop');
  const own = check([cyl('cog'), cyl('wheel', { parent: 'cog' }), { op: 'spin', id: 'wheel', rpm: 30, axis: 'x', dur: 0 }, { op: 'spin', id: 'wheel', rpm: 0, axis: 'z', dur: 0 }, { op: 'spin', id: 'cog', rpm: 30, axis: 'x', dur: 0 }]);
  assert.equal((own.step?.actions ?? []).filter((a) => a.op === 'spin').length, 3, 'an author\'s stop is as it was');
});
