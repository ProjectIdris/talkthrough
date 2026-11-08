import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateStep } from '../src/scene/index.ts';

// An opaque closed solid with a part inside it hides the part for good; the validator makes the solid see-through (a `style` action) when the part and it are both in.

const run = (actions: Record<string, unknown>[]) => {
  const state = createSceneState();
  const v = validateStep({ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, { op: 'add', shape: 'group', id: 'g', at: 0 }, ...actions] }, state);
  const styled = (v.step?.actions ?? []).filter((a) => a.op === 'style') as { id: string; opacity: number; at?: number }[];
  return { styled, issues: v.issues.map((i) => i.message) };
};
const sclera = { op: 'add', shape: 'shell', id: 'sclera', parent: 'g', pos: [0, 0, 0], size: [5, 5, 5], inner: 0.92, color: 'white', at: 0.3 };
const lens = { op: 'add', shape: 'sphere', id: 'lens', parent: 'g', pos: [0, 0, 1.5], size: [1.8, 1.8, 0.8], color: 'teal', at: 1.8 };

test('a part that arrives inside a closed opaque shell makes the shell see-through from then on', () => {
  const r = run([sclera, lens]);
  assert.deepEqual(r.styled.map((a) => [a.id, a.opacity, a.at]), [['sclera', 0.3, 1.8]]);
  assert.ok(r.issues.some((m) => m.includes('"lens" is inside "sclera"')), r.issues.join('; '));
});

test('a solid that arrives round a part already there is made see-through too, and only once', () => {
  const r = run([lens, { op: 'add', shape: 'sphere', id: 'seed', parent: 'g', pos: [0, 0, 0], size: [0.5, 0.5, 0.5], at: 0.5 }, { ...sclera, at: 2.5 }]);
  assert.deepEqual(r.styled.map((a) => [a.id, a.at]), [['sclera', 2.5]]);
});

test('a shell cut open, a see-through material or opacity, a part outside it, and another parent are left alone', () => {
  assert.deepEqual(run([{ ...sclera, latitude: [-50, 50] }, lens]).styled, []);
  assert.deepEqual(run([{ ...sclera, material: 'glass' }, lens]).styled, []);
  assert.deepEqual(run([{ ...sclera, opacity: 0.4 }, lens]).styled, []);
  assert.deepEqual(run([sclera, { ...lens, pos: [0, 0, 3.5] }]).styled, []);
  assert.deepEqual(run([{ op: 'add', shape: 'group', id: 'h', at: 0 }, sclera, { ...lens, parent: 'h' }]).styled, []);
});

test('a solid box holds a part only if the whole part is inside it', () => {
  const body = { op: 'add', shape: 'box', id: 'body', parent: 'g', pos: [0, 0, 0], size: [6, 3, 4], at: 0 };
  const pin = { op: 'add', shape: 'cylinder', id: 'pin', parent: 'g', pos: [0, 0, 0], size: [0.6, 1.2, 0.6], at: 1 };
  assert.deepEqual(run([body, pin]).styled.map((a) => a.id), ['body']);
  assert.deepEqual(run([body, { ...pin, size: [0.6, 3.4, 0.6] }]).styled, [], 'a pin that stands out of the top is seen');
});
