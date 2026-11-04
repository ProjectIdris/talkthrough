import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { orderScore, sceneGuide, sceneGuideExample } from '../src/scene/index.ts';

const samplesDir = new URL('../samples/scenes/', import.meta.url);
const group = (id: string) => ({ op: 'add', shape: 'group', id });
const part = (id: string, parent?: string) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...(parent ? { parent } : {}) });
const steps = (...actions: object[][]) => actions.map((a) => ({ say: 's', actions: a }));

test('an answer that builds in order scores 1: group, parts in it, a move, then the pin on a part', () => {
  const r = orderScore(steps(
    [group('g'), part('base', 'g'), part('lid', 'g')],
    [{ op: 'move', id: 'lid', to: [0, 1, 0] }, { op: 'pin', id: 't', on: 'lid', text: 'Lid' }],
  ));
  assert.equal(r.refs, 4);
  assert.equal(r.score, 1);
  assert.deepEqual(r.examples, []);
});

test('a pin before its part, a part before its group, and an array before its source are early', () => {
  const r = orderScore(steps(
    [{ op: 'pin', id: 't', on: 'lid', text: 'Lid' }, part('base', 'g'), { op: 'add', shape: 'array', id: 'row', of: 'base', count: 3 }],
    [group('g'), part('lid')],
  ));
  assert.equal(r.early, 2, 'the pin on lid and the part in g; the array of base comes after base');
  assert.equal(r.refs, 3);
  assert.ok(Math.abs(r.score - 1 / 3) < 1e-9);
  assert.deepEqual(r.examples, ['pin t -> lid', 'add base -> g']);
});

test('a reference to something the answer never makes counts as missing, unless the scene already had it', () => {
  const answer = steps([part('a', 'nowhere'), { op: 'move', id: 'old', to: [1, 0, 0] }]);
  const r = orderScore(answer);
  assert.deepEqual([r.refs, r.early, r.missing], [2, 0, 2]);
  const withHistory = orderScore(answer, ['old']);
  assert.deepEqual([withHistory.refs, withHistory.early, withHistory.missing], [1, 0, 1], 'an object from an earlier turn is not part of this answer\'s order');
});

test('reserved clear targets and screen marks are not references; odd input does not throw', () => {
  const r = orderScore([
    { actions: [{ op: 'clear', target: 'marks' }, { op: 'clear', target: 'all' }] },
    null,
    { actions: 'not a list' },
    { actions: [null, 7, { op: 'nope' }, { op: 'add', shape: 'nonsense' }, { op: 'box', id: 'b', x: 1, y: 1, w: 5, h: 5, color: 'red' }] },
  ] as never);
  assert.deepEqual([r.refs, r.score], [0, 1]);
});

test('the prompt asks for assembly order, and its example follows it', () => {
  assert.ok(sceneGuide.includes('order a person would assemble it'));
  const r = orderScore((sceneGuideExample as { steps: never[] }).steps);
  assert.equal(r.score, 1);
  assert.ok(r.refs >= 4, 'the example has things to put in order');
});

test('every hand-written sample builds in order', () => {
  for (const name of readdirSync(samplesDir).filter((f) => f.endsWith('.json'))) {
    const scene = JSON.parse(readFileSync(new URL(name, samplesDir), 'utf8')) as { steps: never[] };
    // A follow-up may refer to any id its first turn made.
    const first = name.includes('followup') ? (JSON.parse(readFileSync(new URL(name.replace('-followup', ''), samplesDir), 'utf8')) as { steps: Array<{ actions: Array<{ id?: unknown }> }> }).steps : [];
    const known = collectIds(first);
    const r = orderScore(scene.steps, known);
    assert.equal(r.score, 1, `${name}: ${r.examples.join(', ')}`);
  }
});

function collectIds(steps: Array<{ actions: Array<{ id?: unknown }> }>): string[] {
  return steps.flatMap((s) => s.actions.map((a) => a.id).filter((id): id is string => typeof id === 'string'));
}
