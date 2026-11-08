import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';

// More of the coupling checks: a gear that meshes one that is moved goes with it, a belt written after the spin is seen, a rack touches its pinion, a rope
// seats in the rim of a pulley wheel.

type Act = Record<string, unknown>;
const gear = (id: string, pos: number[], size: number, n: number, extra: Act = {}): Act => ({ op: 'add', shape: 'part', part: 'gear', id, pos, size: [size, size, 0.5], n, at: 0.5, ...extra });
const run = (actions: Act[], more: Act[][] = []) => {
  const state = createSceneState();
  const acts: Act[] = [];
  const notes: string[] = [];
  for (const batch of [actions, ...more]) {
    const v = validateStep({ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, ...batch] }, state);
    acts.push(...((v.step?.actions ?? []) as unknown as Act[]));
    notes.push(...v.issues.map((i) => `${i.kind}: ${i.message}`));
  }
  return { acts, notes, repairs: notes.filter((n) => n.includes('repaired')), dropped: notes.filter((n) => n.startsWith('dropped')), find: (id: string) => acts.find((a) => a.op === 'add' && a.id === id) as Act, moves: acts.filter((a) => a.op === 'move') };
};
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
const rp = (size: number, n: number) => (size / 2) * (1 + (n > 40 ? 0.93 : 0.86)) / 2;

test('a gear that meshes the gear being moved, and was never coupled, goes with it, and still meshes it', () => {
  const r = run([
    gear('p1', [0, 0, 0], 1, 8),
    gear('g2', [3, 0, 0], 3, 32, { at: 0.9 }),
    gear('g3', [3 + rp(3, 32) + rp(2, 16), 0, 0], 2, 16, { at: 1.2 }),
    { op: 'spin', id: 'g2', by: 'p1', ratio: -0.25, at: 1.8 },
  ]);
  const g2 = r.moves.find((m) => m.id === 'g2')!.to as number[];
  const g3 = r.moves.find((m) => m.id === 'g3')!.to as number[];
  assert.ok(Math.abs(dist(g2, [0, 0, 0]) - (rp(1, 8) + rp(3, 32))) < 0.01, 'g2 meshes p1');
  assert.ok(Math.abs(dist(g3, g2) - (rp(3, 32) + rp(2, 16))) < 0.01, `g3 stays meshed with g2 (${dist(g3, g2)})`);
  assert.ok(r.repairs.some((n) => n.includes('g3 meshes it, so it goes along')), r.notes.join('\n'));
});

test('a gear that meshes the fixed gear as well is not taken along (that would break the mesh it keeps)', () => {
  const r = run([
    gear('p1', [0, 0, 0], 1, 8),
    gear('g2', [3, 0, 0], 3, 32, { at: 0.9 }),
    gear('g3', [0.923, 1.046, 0], 2, 16, { at: 1.2 }),
    { op: 'spin', id: 'g2', by: 'p1', ratio: -0.25, at: 1.8 },
  ]);
  assert.ok(r.moves.some((m) => m.id === 'g2'), 'g2 is brought to mesh p1');
  assert.ok(!r.moves.some((m) => m.id === 'g3'), 'g3 meshes p1, which stays, so it stays');
});

test('a train of gears that mesh one another goes along whole', () => {
  const want = rp(3, 32) + rp(2, 16);
  const r = run([
    gear('p1', [0, 0, 0], 1, 8),
    gear('g2', [3, 0, 0], 3, 32, { at: 0.9 }),
    gear('g3', [3 + want, 0, 0], 2, 16, { at: 1.2 }),
    gear('g4', [3 + want, rp(2, 16) * 2, 0], 2, 16, { at: 1.3 }),
    { op: 'spin', id: 'g2', by: 'p1', ratio: -0.25, at: 1.8 },
  ]);
  for (const id of ['g3', 'g4']) assert.ok(r.moves.some((m) => m.id === id), id + ' goes along');
  assert.ok(r.repairs.some((n) => n.includes('g3, g4 mesh it')), r.notes.join('\n'));
});

test('a belt written after the spin: gears the check had moved go back, a coupling it had refused is written again, and the way is the same', () => {
  const far = run([
    gear('a', [0, 0, 0], 2, 16),
    gear('b', [30, 0, 0], 2, 16),
    { op: 'spin', id: 'a', rpm: 10, at: 1 },
    { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 },
  ], [[{ op: 'add', shape: 'connector', id: 'chain', from: 'a', to: 'b', kind: 'wrapped', at: 2 }]]);
  assert.ok(far.dropped.some((n) => n.includes('b cannot turn with a')), 'refused first');
  const again = far.acts.filter((a) => a.op === 'spin' && a.id === 'b' && a.by === 'a');
  assert.equal(again.length, 1, 'and written again once the chain is seen');
  assert.equal(again[0]!.ratio, 1, 'turning the same way');
  assert.ok(far.repairs.some((n) => n.includes('chain joins') && n.includes('turns with a after all')), far.notes.join('\n'));

  const near = run([
    gear('a', [0, 0, 0], 2, 16),
    gear('b', [2.6, 0, 0], 2, 16),
    { op: 'spin', id: 'a', rpm: 10, at: 1 },
    { op: 'spin', id: 'b', by: 'a', ratio: -1, at: 1 },
  ], [[{ op: 'add', shape: 'connector', id: 'chain', from: 'a', to: 'b', kind: 'wrapped', at: 2 }]]);
  const back = near.moves.filter((m) => m.id === 'b');
  assert.equal(back.length, 2, 'moved to mesh, then back');
  assert.deepEqual(back[1]!.to, [2.6, 0, 0]);
  assert.ok(near.acts.some((a) => a.op === 'spin' && a.id === 'b' && a.ratio === 1), 'the same way');
});

const rack = (extra: Act = {}): Act => ({ op: 'add', shape: 'box', id: 'rack', pos: [0, 0, 0], size: [6, 0.4, 0.5], at: 0.3, ...extra });

test('a pinion over its rack is brought to touch it with its pitch circle; the later of the two moves', () => {
  const r = run([rack(), gear('pin', [0, 1.5, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'spin', id: 'pin', rpm: 10, at: 1 }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  const pin = r.moves.find((m) => m.id === 'pin')!.to as number[];
  assert.ok(Math.abs(pin[1]! - (0.2 + rp(2, 16))) < 0.01, `the pitch circle stands on the face (${pin[1]})`);
  assert.ok(r.repairs.some((n) => n.includes('rack rack and pinion pin')), r.notes.join('\n'));
  const rackLater = run([gear('pin', [0, 1.5, 0], 2, 16, { at: 0.3 }), rack({ at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  const moved = rackLater.moves.find((m) => m.id === 'rack')!.to as number[];
  assert.ok(Math.abs(1.5 - moved[1]! - 0.2 - rp(2, 16)) < 0.01, 'the rack comes up to the pinion when it is the later');
});

test('a pinion below the rack, a rack that runs up, and a pinion already touching all come out right or are left alone', () => {
  const below = run([rack(), gear('pin', [0.5, -1.4, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.ok(Math.abs((below.moves.find((m) => m.id === 'pin')!.to as number[])[1]! + 0.2 + rp(2, 16)) < 0.01, 'below the rack');
  const up = run([rack({ rot: [0, 0, 90] }), gear('pin', [1.5, 0.5, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'y' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.ok(Math.abs((up.moves.find((m) => m.id === 'pin')!.to as number[])[0]! - 0.2 - rp(2, 16)) < 0.01, 'a rack standing up');
  const ok = run([rack(), gear('pin', [0, 0.2 + rp(2, 16), 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.deepEqual(ok.repairs, []);
  assert.deepEqual(ok.moves, []);
});

test('a pinion not over its rack along its axis is brought over it; a pinion far from it, or turned to run along it, is refused', () => {
  const off = run([rack(), gear('pin', [0, 1.13, 2], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  const to = off.moves.find((m) => m.id === 'pin')!.to as number[];
  assert.equal(to[2], 0, 'in the plane of the rack');
  const far = run([rack(), gear('pin', [0, 12, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.ok(far.dropped.some((n) => n.includes('rack cannot follow pin') && n.includes('nearest place')), far.notes.join('\n'));
  const square = run([rack(), gear('pin', [0, 1.13, 0], 2, 16, { at: 0.6, rot: [0, 90, 0] }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.ok(square.dropped.some((n) => n.includes('axis does not run across the rack')), square.notes.join('\n'));
});

test('a slide loop of the rack by the pinion fits it as a couple does; a short box with a pitch (a nut on a screw) is no rack', () => {
  const loop = run([rack(), gear('pin', [0, 1.5, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'loop', id: 'rack', kind: 'slide', by: 'pin', amount: 2, at: 1 }]);
  assert.ok(loop.repairs.some((n) => n.includes('rack rack and pinion pin')), loop.notes.join('\n'));
  const nut = run([rack({ size: [0.6, 0.4, 0.5] }), gear('pin', [0, 1.5, 0], 2, 16, { at: 0.6 }), { op: 'joint', id: 'rack', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'rack', by: 'pin', pitch: 5.8, at: 1 }]);
  assert.deepEqual(nut.repairs, []);
  assert.deepEqual(nut.moves, []);
});

const wheel = (extra: Act = {}): Act => ({ op: 'add', shape: 'part', part: 'wheel', id: 'w', pos: [0, 3, 0], size: [2, 2, 0.5], n: 6, at: 0.2, ...extra });
const load = (): Act => ({ op: 'add', shape: 'box', id: 'load', pos: [4, 0, 0], size: [1, 1, 1], at: 0.4 });

test('a rope that ends on a pulley wheel with no side is seated in the rim along the tangent; one on a spinning wheel or a tall post is left', () => {
  const r = run([wheel(), load(), { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', toSide: 'top', radius: 0.06, at: 0.8 }]);
  const rope = r.find('rope');
  const p = rope.fromPoint as number[];
  assert.ok(p && Math.abs(Math.hypot(p[0]!, p[1]!) - 1) < 0.01, `on the rim (${p})`);
  assert.ok(r.repairs.some((n) => n.includes('ended at the middle of the wheel w')), r.notes.join('\n'));
  const spin = run([wheel(), load(), { op: 'spin', id: 'w', rpm: 5, at: 0.5 }, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', toSide: 'top', radius: 0.06, at: 0.8 }]);
  assert.equal(spin.find('rope').fromPoint, undefined, 'a spinning wheel carries a point round');
  const post = run([{ op: 'add', shape: 'cylinder', id: 'w', pos: [0, 3, 0], size: [1, 4, 1], at: 0.2 }, load(), { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'load', toSide: 'top', radius: 0.06, at: 0.8 }]);
  assert.equal(post.find('rope').fromPoint, undefined, 'a tall cylinder is a post, not a pulley');
});
