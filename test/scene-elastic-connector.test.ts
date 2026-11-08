import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene } from '../src/scene/index.ts';

const run = (extra: object) => validateScene({ steps: [{ say: 'Two attachment points.', actions: [
  { op: 'add', shape: 'group', id: 'a' }, { op: 'add', shape: 'group', id: 'b', pos: [0, 4, 0] },
  { op: 'add', shape: 'connector', id: 'link', from: 'a', to: 'b', ...extra },
] }] });
const link = (extra: object) => run(extra).scene?.steps[0]?.actions.find(a => 'id' in a && a.id === 'link');

test('local attachment points, a radius profile and a reference length survive declarative validation', () => {
  const extra = { fromPoint: [0, 1, 0], toPoint: [0, -1, 0], swell: [[0, 0.15], [0.5, 1], [1, 0.15]], restLength: 2 };
  const r = run(extra);
  assert.deepEqual(r.issues, []);
  for (const [key, value] of Object.entries(extra)) assert.deepEqual((link(extra) as unknown as Record<string, unknown>)[key], value);
});

test('attachment points, radius profile and reference length remain bounded data', () => {
  const a = link({ fromPoint: [-999, 1, 999], toPoint: [0, 999, 0], restLength: 0, swell: [[0, -1], [1, 999]] }) as unknown as Record<string, unknown>;
  assert.deepEqual(a.fromPoint, [-100, 1, 100]);
  assert.deepEqual(a.toPoint, [0, 100, 0]);
  assert.equal(a.restLength, 0.01);
  assert.deepEqual(a.swell, [[0, 0], [1, 10]]);
  assert.equal((link({ restLength: 10000 }) as unknown as Record<string, unknown>).restLength, 400);
});

test('wrapped belts refuse profiled elastic or local endpoint settings rather than ignore them', () => {
  for (const extra of [{ restLength: 4 }, { swell: [[0, 0.2], [1, 1]] }, { fromPoint: [0, 1, 0] }, { toPoint: [0, 1, 0] }]) {
    const r = run({ kind: 'wrapped', ...extra });
    assert.equal(r.scene?.steps[0]?.actions.some(a => 'id' in a && a.id === 'link'), false);
    assert.ok(r.issues.some(i => /wrapped/.test(i.message)));
  }
  assert.ok(link({ kind: 'wrapped' }), 'existing wrapped connectors remain supported');
});
