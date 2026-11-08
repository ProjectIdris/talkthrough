import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';

// A gear in a train sits on a shaft: when a second ready-made gear arrives, each gear that nothing holds the middle of gets a thin steel shaft through it.

const gear = (id: string, pos: number[], extra: Record<string, unknown> = {}) => ({ op: 'add', shape: 'part', part: 'gear', id, pos, size: [2, 2, 0.5], n: 16, at: 0.5, ...extra });
const run = (actions: Record<string, unknown>[]) => {
  const state = createSceneState();
  const v = validateStep({ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, ...actions] }, state);
  const shafts = (v.step?.actions ?? []).filter((a) => a.op === 'add' && String(a.id).endsWith('-shaft')) as unknown as { id: string; parent: string; shape: string; material: string; at: number; size: number[] }[];
  return { shafts, issues: v.issues, dropped: v.issues.filter((i) => i.kind === 'dropped') };
};

test('two gears each get a steel shaft through the middle, a child of the gear', () => {
  const r = run([gear('g1', [-1, 0, 0]), gear('g2', [1, 0, 0])]);
  assert.deepEqual(r.shafts.map((s) => [s.id, s.parent, s.shape, s.material]), [['g1-shaft', 'g1', 'cylinder', 'steel'], ['g2-shaft', 'g2', 'cylinder', 'steel']]);
  assert.ok(r.shafts.every((s) => s.at >= 0.5), 'a shaft comes no earlier than its gear');
  assert.ok(r.shafts[0]!.size[1]! > 0.5 * 2, 'it stands out of the gear on both sides');
  assert.deepEqual(r.dropped, []);
});

test('one gear alone is left as it is (a picture of a gear, a pulley wheel)', () => {
  assert.deepEqual(run([gear('g1', [0, 0, 0])]).shafts, []);
});

test('a gear that a shaft of the scene already runs through gets none, turned or not; the other gear still does', () => {
  const rod = { op: 'add', shape: 'cylinder', id: 'rod', pos: [-1, 0, 0], rot: [90, 0, 0], size: [0.3, 3, 0.3], at: 0.2 };
  const r = run([rod, gear('g1', [-1, 0, 0]), gear('g2', [1, 0, 0])]);
  assert.deepEqual(r.shafts.map((s) => s.id), ['g2-shaft']);
  const sideways = run([{ ...rod, rot: [0, 0, 90], pos: [0, 0, 0], size: [0.3, 5, 0.3] }, gear('g1', [-1, 0, 0]), gear('g2', [1, 0, 0])]);
  assert.deepEqual(sideways.shafts.map((s) => s.id), [], 'a shaft lying along x through both middles holds them');
});

test('a see-through gear gets no shaft, and a gear drawn alone first gets its shaft when the second arrives', () => {
  assert.deepEqual(run([gear('g1', [-1, 0, 0], { opacity: 0.3 }), gear('g2', [1, 0, 0], { opacity: 0.3 })]).shafts.map((s) => s.id), []);
  const state = createSceneState();
  const first = validateStep({ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, gear('g1', [-1, 0, 0])] }, state);
  assert.equal(first.step?.actions.some((a) => a.op === 'add' && String(a.id).endsWith('-shaft')), false);
  const second = validateStep({ say: 'y', actions: [gear('g2', [1, 0, 0], { at: 0 })] }, state);
  assert.deepEqual((second.step?.actions ?? []).filter((a) => a.op === 'add').map((a) => (a as unknown as { id: string }).id), ['g2', 'g1-shaft', 'g2-shaft']);
});
