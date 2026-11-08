import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';

// Parts said to turn together must stand where that can be true: meshed gears the sum of their pitch radii apart on parallel axes, bevel gears at right
// angles with their points together, a belt or chain round both its wheels, a rope leaving a wheel along a tangent.

type Act = Record<string, unknown>;
const gear = (id: string, pos: number[], size: number, n: number, extra: Act = {}): Act => ({ op: 'add', shape: 'part', part: 'gear', id, pos, size: [size, size, 0.5], n, at: 0.5, ...extra });
const run = (actions: Act[]) => {
  const state = createSceneState();
  const v = validateStep({ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, ...actions] }, state);
  const acts = (v.step?.actions ?? []) as unknown as Act[];
  const notes = v.issues.map((i) => `${i.kind}: ${i.message}`);
  return { acts, notes, repairs: notes.filter((n) => n.includes('repaired')), dropped: notes.filter((n) => n.startsWith('dropped')), find: (id: string) => acts.find((a) => a.op === 'add' && a.id === id) as Act, moves: acts.filter((a) => a.op === 'move') };
};
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
// Pitch radius of a kit gear: half way between the tips and the roots (a root is 0.86 of the tip radius up to 40 teeth, 0.93 above).
const rp = (size: number, n: number) => (size / 2) * (1 + (n > 40 ? 0.93 : 0.86)) / 2;

test('a gear said to turn with a far gear is moved to mesh it, the sum of the pitch radii apart, and the gear on its shaft goes with it', () => {
  const r = run([
    gear('p1', [-2.5, 2, 0.6], 1, 8),
    gear('g2', [0.4, 1.2, 0.6], 3, 32, { at: 0.9 }),
    gear('p2', [0.4, 1.2, 1.2], 0.9, 8, { at: 1.2 }),
    { op: 'spin', id: 'p1', rpm: 4, at: 1.8 },
    { op: 'spin', id: 'g2', by: 'p1', ratio: -0.25, at: 1.8 },
  ]);
  const g2 = r.moves.find((m) => m.id === 'g2')!.to as number[];
  const p2 = r.moves.find((m) => m.id === 'p2')!.to as number[];
  assert.ok(Math.abs(dist(g2, [-2.5, 2, 0.6]) - (rp(1, 8) + rp(3, 32))) < 0.01, `g2 stands ${dist(g2, [-2.5, 2, 0.6])} from p1`);
  assert.deepEqual([p2[0], p2[1]], [g2[0], g2[1]], 'p2 stays on g2 shaft');
  assert.equal(p2[2], 1.2, 'and keeps its place along the shaft');
  assert.ok(r.repairs.some((n) => n.includes('g2 turns with p1')), r.notes.join('\n'));
  assert.ok(r.acts.some((a) => a.op === 'spin' && a.id === 'g2' && a.by === 'p1'), 'the coupling stays');
});

test('gears already meshed (within a few percent) are left alone', () => {
  const want = rp(2, 16) + rp(3, 24);
  const r = run([gear('a', [0, 0, 0], 2, 16), gear('b', [want * 1.03, 0, 0], 3, 24), { op: 'spin', id: 'a', rpm: 10, at: 1 }, { op: 'spin', id: 'b', by: 'a', ratio: -(16 / 24), at: 1 }]);
  assert.deepEqual(r.repairs, []);
  assert.deepEqual(r.moves, []);
});

test('a coupled gear too far away to be a slip is refused with the nearest valid place named', () => {
  const r = run([gear('a', [0, 0, 0], 2, 16), gear('b', [30, 0, 0], 2, 16), { op: 'spin', id: 'a', rpm: 10, at: 1 }, { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 }]);
  assert.ok(r.dropped.some((n) => n.includes('b cannot turn with a') && n.includes('[1.86,0,0]')), r.notes.join('\n'));
  assert.ok(!r.acts.some((a) => a.op === 'spin' && a.by === 'a'));
});

test('gears whose axes are not parallel are refused (spur gears mesh only on parallel axes)', () => {
  const r = run([gear('a', [0, 0, 0], 2, 16), gear('b', [1.8, 0, 0], 2, 16, { rot: [0, 60, 0] }), { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 }]);
  assert.ok(r.dropped.some((n) => n.includes('parallel axes')), r.notes.join('\n'));
});

test('gears on one shaft are not a mesh, and turn the same way: a negative ratio is made positive', () => {
  const r = run([gear('a', [0, 0, 0], 3, 24), gear('b', [0, 0, 0.6], 1, 8), { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 }]);
  assert.deepEqual(r.moves, []);
  assert.equal((r.acts.find((a) => a.op === 'spin') as Act).ratio, 1);
  assert.ok(r.repairs.some((n) => n.includes('ratio -1 made 1')), r.notes.join('\n'));
});

test('meshed gears turn opposite ways: a positive ratio is made negative, the rate is left as written', () => {
  const want = rp(2, 16) + rp(4, 32);
  const base = [gear('a', [0, 0, 0], 2, 16), gear('b', [want, 0, 0], 4, 32)];
  const flipped = run([...base, { op: 'spin', id: 'b', by: 'a', ratio: 0.5, at: 1 }]);
  assert.equal((flipped.acts.find((a) => a.op === 'spin') as Act).ratio, -0.5);
  const rate = run([...base, { op: 'spin', id: 'b', by: 'a', ratio: -0.9, at: 1 }]);
  assert.equal((rate.acts.find((a) => a.op === 'spin') as Act).ratio, -0.9);
  assert.deepEqual(rate.repairs, []);
});

test('a crown wheel and its pinion (axes at a right angle) are a pair this does not place', () => {
  const r = run([gear('ring', [0, 0, 0], 4, 40), gear('pinion', [3, 0, 0], 1, 10, { rot: [0, 90, 0] }), { op: 'spin', id: 'pinion', by: 'ring', ratio: -4, at: 1 }]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.repairs, []);
});

test('a chain between two gears makes them turn the same way (bicycle): the wrapped chain replaces the strand across both tops, the other strand is dropped', () => {
  const r = run([
    gear('ring', [-2.4, 0, 0], 3.6, 28), gear('spro', [2.4, 0, 0], 1.4, 11),
    { op: 'add', shape: 'connector', id: 'top', from: 'ring', to: 'spro', fromSide: 'top', toSide: 'top', radius: 0.08, at: 1.2 },
    { op: 'add', shape: 'connector', id: 'bot', from: 'ring', to: 'spro', fromSide: 'bottom', toSide: 'bottom', radius: 0.08, at: 1.4 },
    { op: 'spin', id: 'ring', rpm: 30, at: 1.5 },
    { op: 'spin', id: 'spro', by: 'ring', ratio: -2.55, at: 1.5 },
  ]);
  const top = r.find('top');
  assert.equal(top.kind, 'wrapped');
  assert.equal(top.fromSide, undefined);
  assert.equal(r.find('bot'), undefined, 'the second strand is the same belt');
  assert.ok(r.dropped.some((n) => n.includes('other strand of the belt "top"')), r.notes.join('\n'));
  assert.equal((r.acts.find((a) => a.op === 'spin' && a.by === 'ring') as Act).ratio, 2.55);
  assert.deepEqual(r.moves, [], 'a chained pair is not moved to mesh');
});

test('two wheels of one size along their tops need no belt: a straight strand there is already a tangent', () => {
  const r = run([
    gear('a', [-2, 0, 0], 2, 16), gear('b', [2, 0, 0], 2, 16),
    { op: 'add', shape: 'connector', id: 'top', from: 'a', to: 'b', fromSide: 'top', toSide: 'top', radius: 0.05, at: 1 },
  ]);
  assert.equal(r.find('top').kind, undefined);
  assert.deepEqual(r.repairs, []);
});

test('bevel gears are brought to right angles with their points together: the cones of a differential', () => {
  const cone = (id: string, pos: number[], rot: number[], size: number[], at: number): Act => ({ op: 'add', shape: 'cone', id, pos, rot, size, at });
  const r = run([
    cone('sideL', [-1, 0, 0], [0, 0, -90], [1.6, 1.2, 1.6], 1.4),
    cone('sideR', [1, 0, 0], [0, 0, 90], [1.6, 1.2, 1.6], 1.7),
    cone('spiderF', [0, 0, 1], [-90, 0, 0], [1, 0.9, 1], 2),
    cone('spiderB', [0, 0, -1], [90, 0, 0], [1, 0.9, 1], 2.2),
  ]);
  // Every point (apex) stands at the middle.
  const tip = (id: string, axis: number[], height: number) => {
    const to = (r.moves.find((m) => m.id === id)?.to ?? (r.find(id).pos as number[])) as number[];
    return to.map((v, i) => Math.round((v + axis[i]! * height / 2) * 100) / 100);
  };
  assert.deepEqual(tip('sideL', [1, 0, 0], 1.2), [0, 0, 0]);
  assert.deepEqual(tip('sideR', [-1, 0, 0], 1.2), [0, 0, 0]);
  assert.deepEqual(tip('spiderF', [0, 0, -1], 0.9), [0, 0, 0]);
  assert.deepEqual(tip('spiderB', [0, 0, 1], 0.9), [0, 0, 0]);
  assert.ok(r.repairs.length >= 1, r.notes.join('\n'));
});

test('cones whose points already meet, or that stand far from each other, are left as written', () => {
  const cone = (id: string, pos: number[], rot: number[]): Act => ({ op: 'add', shape: 'cone', id, pos, rot, size: [1.6, 1.2, 1.6], at: 1 });
  const met = run([cone('a', [-0.6, 0, 0], [0, 0, -90]), cone('b', [0, 0.6, 0], [180, 0, 0])]);
  assert.deepEqual(met.repairs, []);
  const far = run([cone('a', [-6, 0, 0], [0, 0, -90]), cone('b', [6, 0, 5], [-90, 0, 0])]);
  assert.deepEqual(far.repairs, []);
});

test('a gear that arrives beside another in the same plane, a near miss from meshing, is fitted before it is shown; one far off is not', () => {
  const want = rp(2, 16) + rp(2, 16);
  const near = run([gear('a', [0, 0, 0], 2, 16), gear('b', [want * 1.18, 0.3, 0], 2, 16)]);
  const b = near.find('b').pos as number[];
  assert.ok(Math.abs(dist(b, [0, 0, 0]) - want) < 0.01, `b stands ${dist(b, [0, 0, 0])} from a`);
  assert.ok(near.repairs.some((n) => n.includes('b stands beside a')), near.notes.join('\n'));
  const far = run([gear('a', [0, 0, 0], 2, 16), gear('b', [want * 2.2, 0, 0], 2, 16)]);
  assert.deepEqual(far.find('b').pos, [want * 2.2, 0, 0]);
  const planes = run([gear('a', [0, 0, 0], 2, 16), gear('b', [want * 1.18, 0, 3], 2, 16)]);
  assert.deepEqual(planes.repairs, [], 'gears in different planes along the axis are not touching');
});

test('a rope that runs in through the wheel it leaves from leaves along the tangent instead; one that leaves along it is left', () => {
  const wheel = { op: 'add', shape: 'part', part: 'wheel', id: 'w', pos: [0, 0, 0], size: [2, 2, 0.4], at: 0.5 };
  const weight = { op: 'add', shape: 'box', id: 'load', pos: [-3, -4, 0], size: [1, 1, 1], at: 0.5 };
  // From the top of the wheel straight down-left to a weight: in through the disc.
  const bad = run([wheel, weight, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', fromSide: 'top', toSide: 'top', radius: 0.05, at: 1 }]);
  const rope = bad.find('rope');
  assert.equal(rope.fromSide, undefined);
  const pt = rope.fromPoint as number[];
  assert.ok(Math.abs(Math.hypot(pt[0]!, pt[1]!) - 1) < 0.01 && Math.abs(pt[2]!) < 0.01, 'on the rim (a wheel part stands with its axis along z, so its own plane is x and y)');
  assert.ok(bad.repairs.some((n) => n.includes('tangent point')), bad.notes.join('\n'));
  // Down the left side: a vertical rope is a tangent there.
  const good = run([wheel, { ...weight, pos: [-1, -4, 0] }, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', fromSide: 'left', toSide: 'top', radius: 0.05, at: 1 }]);
  assert.equal(good.find('rope').fromSide, 'left');
  assert.deepEqual(good.repairs, []);
  // A wheel that turns keeps the rim end it was given: a point fixed to it would travel round.
  const turning = run([wheel, weight, { op: 'spin', id: 'w', rpm: 10, at: 0.6 }, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', fromSide: 'top', toSide: 'top', radius: 0.05, at: 1 }]);
  assert.equal(turning.find('rope').fromSide, 'top');
  // A plain disc (a cylinder the model draws, not a pulley wheel) keeps the end it was given.
  const disc = run([{ ...wheel, shape: 'cylinder', part: undefined, rot: [90, 0, 0], size: [2, 0.4, 2] }, weight, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', fromSide: 'top', toSide: 'top', radius: 0.05, at: 1 }]);
  assert.equal(disc.find('rope').fromSide, 'top');
  assert.deepEqual(disc.repairs, []);
});

test('parts placed by a face of their holder are not moved (their place is an offset, not known by the words)', () => {
  const r = run([
    { op: 'add', shape: 'box', id: 'plate', pos: [0, 0, 0], size: [6, 1, 1], at: 0.2 },
    gear('a', [0, 0, 0], 2, 16),
    { op: 'add', shape: 'part', part: 'gear', id: 'b', parent: 'plate', parentAnchor: 'right', selfAnchor: 'center', pos: [0, 0, 0], size: [2, 2, 0.5], n: 16, at: 0.6 },
    { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 },
  ]);
  assert.deepEqual(r.moves, []);
  assert.deepEqual(r.repairs.filter((n) => n.includes('turns with')), []);
});

test('a belt round two wheels gives each a steel shaft through its middle, once; a wheel with a shaft of the scene through it gets none', () => {
  const wheel = (id: string, pos: number[], size: number): Act => ({ op: 'add', shape: 'part', part: 'wheel', id, pos, size: [size, size, 0.4], n: 6, at: 0.3 });
  const belt = { op: 'add', shape: 'connector', id: 'belt', from: 'a', to: 'b', kind: 'wrapped', radius: 0.05, at: 1 };
  const r = run([wheel('a', [-2, 0, 0], 2), wheel('b', [2, 0, 0], 1), belt]);
  assert.deepEqual(r.acts.filter((a) => a.op === 'add' && String(a.id).endsWith('-shaft')).map((a) => [a.id, a.parent]), [['a-shaft', 'a'], ['b-shaft', 'b']]);
  const rod = { op: 'add', shape: 'cylinder', id: 'rod', pos: [-2, 0, 0], rot: [90, 0, 0], size: [0.3, 3, 0.3], at: 0.1 };
  const held = run([rod, wheel('a', [-2, 0, 0], 2), wheel('b', [2, 0, 0], 1), belt]);
  assert.deepEqual(held.acts.filter((a) => a.op === 'add' && String(a.id).endsWith('-shaft')).map((a) => a.id), ['b-shaft']);
  const rope = run([wheel('a', [-2, 0, 0], 2), wheel('b', [2, 0, 0], 1), { ...belt, kind: 'straight', fromSide: 'top', toSide: 'top' }]);
  assert.equal(rope.find('belt').kind, 'wrapped', 'the strand made a belt');
  assert.equal(rope.acts.filter((a) => a.op === 'add' && String(a.id).endsWith('-shaft')).length, 2, 'and the belt it became has its shafts');
});
