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

test('a material name is read by its whole words: light-wood or sealed or slice is opaque, glass or neon-tube is not', () => {
  for (const material of ['light-wood', 'sealed-steel', 'slice-bread']) assert.equal(run([{ ...sclera, material }, lens]).styled.length, 1, material);
  for (const material of ['glass', 'neon-tube', 'clear-plastic']) assert.deepEqual(run([{ ...sclera, material }, lens]).styled, [], material);
});

test('a shaft through a solid wheel, or a hub no bigger than its thickness, is not a part hidden inside it', () => {
  const wheel = { op: 'add', shape: 'cylinder', id: 'wheel', parent: 'g', pos: [0, 0, 0], size: [4, 0.5, 4], color: 'gray', at: 0.3 };
  const shaft = { op: 'add', shape: 'cylinder', id: 'shaft', parent: 'g', pos: [0, 0, 0], size: [0.4, 2, 0.4], color: 'silver', at: 0.6 };
  assert.deepEqual(run([wheel, shaft]).styled, []);
  assert.deepEqual(run([shaft, wheel]).styled, []);
  // a part really buried in a thick solid is still found
  assert.equal(run([{ ...wheel, size: [4, 4, 4] }, { ...shaft, size: [0.4, 0.4, 0.4] }]).styled.length, 1);
});

// The eye answer as the model wrote it: the globe is a closed white sphere, and the cornea, lens and retina are its children (parent: globe), not siblings under a group.
const globe: Record<string, unknown> = { op: 'add', shape: 'sphere', id: 'globe', size: [4, 4, 4], color: 'white', material: 'foam' };
const eyeCornea: Record<string, unknown> = { op: 'add', shape: 'shell', id: 'cornea', parent: 'globe', parentAnchor: 'front', selfAnchor: 'center', pos: [0, 0, 0.3], rot: [90, 0, 0], size: [2.2, 2.2, 1.4], latitude: [0, 90], material: 'glass', opacity: 0.5, at: 0.5 };
const eyeLens: Record<string, unknown> = { op: 'add', shape: 'cylinder', id: 'lens', parent: 'globe', pos: [0, 0, 1], size: [1.4, 0.5, 1.4], rot: [90, 0, 0], material: 'crystal', opacity: 0.7, at: 1 };
const eyeRetina: Record<string, unknown> = { op: 'add', shape: 'shell', id: 'retina', parent: 'globe', pos: [0, 0, 0], rot: [90, 0, 0], size: [3.9, 3.9, 3.9], latitude: [-90, -30], color: 'orange', material: 'muscle', at: 1.5 };
const eye = [eyeCornea, eyeLens, eyeRetina];

test('a part held by the closed solid itself (a lens as a child of the globe) is a part inside it: the globe is made see-through', () => {
  const r = run([globe, ...eye]);
  assert.deepEqual(r.styled.map((a) => a.id), ['globe']);
  assert.equal(r.styled[0]?.opacity, 0.3);
  assert.equal(r.styled[0]?.at, 1, 'from the moment the first part arrives inside it');
  assert.ok(r.issues.some((m) => /repaired.*"lens".*"globe"/.test(m)), r.issues.join(' | '));
  assert.equal(run([globe, { ...eyeLens, pos: [0, 0, 1.2] }]).styled.length, 1, 'the lens at 1.2, as it was logged, lies just inside');
});

test('the solid arriving after its children is found as well, and a child standing out in front (the cornea on the anchor, an optic tube behind) is not inside', () => {
  assert.deepEqual(run([...[eyeLens, eyeRetina], globe]).styled.map((a) => a.id), ['globe']);
  assert.deepEqual(run([globe, eyeCornea]).styled, [], 'a cornea mounted on the front face is out in front');
  const tube = { op: 'add', shape: 'cylinder', id: 'nerve', parent: 'globe', pos: [0, 0, -3], size: [0.6, 2, 0.6], rot: [90, 0, 0], at: 1 };
  assert.deepEqual(run([globe, tube]).styled, []);
});

test('a child of a see-through or cut-open solid is left alone, and so is a child as big as the solid', () => {
  assert.deepEqual(run([{ ...globe, material: 'glass' }, eyeLens]).styled, []);
  assert.deepEqual(run([{ ...globe, opacity: 0.4 }, eyeLens]).styled, []);
  assert.deepEqual(run([globe, { ...eyeLens, size: [3.9, 3.9, 3.9] }]).styled, [], 'a part as big as the solid is no part inside it');
});
