import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { endPoint, roundOf } from '../src/overlay/connector.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import { buildPart } from '../src/overlay/parts.ts';
import type { BuiltPart } from '../src/overlay/parts.ts';
import { PARTS } from '../src/scene/spec.ts';
import type { AddPart, PartKind, PartVariant, Vec3 } from '../src/scene/types.ts';
import { normalSize, resolvePartGeometry } from '../src/scene/part-geometry.ts';
import type { PartGeometryInput } from '../src/scene/part-geometry.ts';

// Tests own the unrendered pieces they create, including their placeholder materials.
function dispose(built: BuiltPart): void {
  for (const { object } of built.pieces) {
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    if ('dispose' in object) object.dispose();
  }
  built.root.clear();
}

test('connectors use the normalized thickness of a gear authored on its edge', () => {
  const def = { shape: 'part', part: 'gear', size: [5, 1, 5] };
  const object = new Group();
  const round = roundOf(def, object);
  assert.equal(round?.radius, 2.5);
  assert.equal(round?.width, 1);
  assert.deepEqual(endPoint(object, def, 'front', undefined, undefined).toArray(), [0, 0, 0.5]);
});

test('every rendered part exposes its local origin for declarative assembly', () => {
  for (const part of PARTS) {
    const built = buildPart({ op: 'add', shape: 'part', id: 'p', part, size: [2, 3, 2] } as AddPart, DETAIL.low);
    try {
      assert.deepEqual(built.anchors.origin, [0, 0, 0], part);
    } finally {
      dispose(built);
    }
  }
});


type Fixture = { part: PartKind; written: Vec3; size: Vec3; anchors: Record<string, Vec3> };
const FIXTURES: Fixture[] = [
  { part: 'cylinder-block', written: [4, 6, 8], size: [4, 6, 8], anchors: { 'bore-top': [0, 3, 0], 'bore-bottom': [0, -3, 0], front: [0, 0, 4] } },
  { part: 'piston', written: [6, 4, 2], size: [2, 4, 2], anchors: { crown: [0, 2, 0], pin: [0, -0.4, 0] } },
  { part: 'connecting-rod', written: [6, 1, 2], size: [1, 6, 2], anchors: { 'big-end': [0, -2.5, 0], 'small-end': [0, 2.7, 0] } },
  { part: 'crankshaft', written: [4, 6, 8], size: [4, 6, 8], anchors: { pin: [0, 1.2, 0], 'axis-front': [0, 0, 4], 'axis-rear': [0, 0, -4], throw: [0, 1.2, 0] } },
  { part: 'valve', written: [8, 2, 3], size: [2, 8, 2], anchors: { head: [0, -4, 0], tip: [0, 4, 0] } },
  { part: 'camshaft', written: [8, 2, 3], size: [2, 2, 8], anchors: { 'axis-front': [0, 0, 4], 'axis-rear': [0, 0, -4] } },
  { part: 'spark-plug', written: [2, 3, 8], size: [2, 8, 2], anchors: { tip: [0, -4, 0], terminal: [0, 4, 0] } },
  { part: 'gear', written: [5, 1, 7], size: [5, 5, 1], anchors: { axis: [0, 0, 0.5] } },
  { part: 'spring', written: [2, 6, 4], size: [2, 6, 2], anchors: { top: [0, 3, 0], bottom: [0, -3, 0] } },
  { part: 'bearing', written: [6, 1.5, 4], size: [4, 4, 1.5], anchors: { axis: [0, 0, 0.75] } },
  { part: 'pipe', written: [6, 2, 4], size: [2, 6, 2], anchors: { top: [0, 3, 0], bottom: [0, -3, 0] } },
  { part: 'elbow', written: [4, 6, 8], size: [4, 6, 2.4], anchors: { a: [0.8, -0.8, 0], b: [-0.8, 0.8, 0] } },
  { part: 'housing', written: [4, 6, 8], size: [4, 6, 8], anchors: { front: [0, 0, 4], back: [0, 0, -4] } },
];

function anchorsNear(actual: Record<string, Vec3>, expected: Record<string, Vec3>, context: string): void {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${context}: anchor names`);
  for (const [name, want] of Object.entries(expected)) {
    const got = actual[name]!;
    for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(got[axis]! - want[axis]!) < 1e-12, `${context}: ${name}[${axis}] ${got[axis]} vs ${want[axis]}`);
  }
}

test('the pure description preserves every legacy mechanism anchor in normalized local space', () => {
  for (const { part, written, size, anchors } of FIXTURES) {
    const result = resolvePartGeometry({ part, size: written });
    assert.deepEqual(result.size, size, part);
    anchorsNear(result.anchors, { origin: [0, 0, 0], ...anchors }, part);
  }
});

test('the electronics kit keeps its authored dimensions and has only its new origin anchor', () => {
  for (const part of ['chip', 'header', 'port', 'lens', 'screen', 'button', 'fan', 'wheel'] as const) {
    assert.deepEqual(resolvePartGeometry({ part, size: [6, 2, 4] }), { size: [6, 2, 4], anchors: { origin: [0, 0, 0] } });
  }
});

test('crankshaft anchors preserve count defaults, numbering, phase and the one-to-eight clamp', () => {
  const fixed: Record<string, Vec3> = { origin: [0, 0, 0], 'axis-front': [0, 0, 4], 'axis-rear': [0, 0, -4], throw: [0, 1.2, 0] };
  const inputs: Array<{ n?: number; pins: Record<string, Vec3> }> = [
    { pins: { pin: [0, 1.2, 0] } },
    { n: 0, pins: { pin: [0, 1.2, 0] } },
    { n: 1, pins: { pin: [0, 1.2, 0] } },
    { n: 2, pins: { pin1: [0, 1.2, -2], pin2: [0, -1.2, 2] } },
    { n: 4, pins: { pin1: [0, 1.2, -3], pin2: [-1.2, 0, -1], pin3: [0, -1.2, 1], pin4: [1.2, 0, 3] } },
    { n: 128, pins: { pin1: [0, 1.2, -3.5], pin2: [-0.848528137423857, 0.848528137423857, -2.5], pin3: [-1.2, 0, -1.5], pin4: [-0.848528137423857, -0.848528137423857, -0.5], pin5: [0, -1.2, 0.5], pin6: [0.848528137423857, -0.848528137423857, 1.5], pin7: [1.2, 0, 2.5], pin8: [0.848528137423857, 0.848528137423857, 3.5] } },
  ];
  for (const { n, pins } of inputs) {
    const def: AddPart = { op: 'add', shape: 'part', id: 'crank', part: 'crankshaft', size: [4, 6, 8], ...(n === undefined ? {} : { n }) };
    const expected = { ...fixed, ...pins };
    anchorsNear(resolvePartGeometry(def).anchors, expected, `n=${n}`);
    const built = buildPart(def, DETAIL.low);
    try {
      anchorsNear(built.anchors, expected, `rendered n=${n}`);
    } finally {
      dispose(built);
    }
  }
});

test('renderer anchors agree with the pure description across dimensions, variants and detail counts', () => {
  const cases: Array<{ size: Vec3; variant?: PartVariant; n?: number }> = [
    { size: [2, 3, 2] },
    { size: [5, 1, 5], variant: 'cutaway', n: 2 },
    { size: [1, 2, 8], variant: 'finned', n: 48 },
    { size: [3.5, 0.9, 0.9], variant: 'metal', n: 1 },
  ];
  for (const part of PARTS) {
    for (const input of cases) {
      const def: AddPart = { op: 'add', shape: 'part', id: 'p', part, ...input };
      const built = buildPart(def, DETAIL.low);
      try {
        assert.deepEqual(built.anchors, resolvePartGeometry(def).anchors, `${part}, ${JSON.stringify(input)}`);
        assert.ok(built.pieces.length > 0, `${part}: still renders`);
      } finally {
        dispose(built);
      }
    }
  }
});

test('normalization is idempotent and descriptions do not mutate or retain the authored data', () => {
  const sizes: Vec3[] = [[6, 1, 2], [2, 6, 1], [1, 2, 6], [5, 1, 5], [3, 3, 3], [0.01, 100, 2], [1.35, 1, 0.5], [1.34, 1, 0.5]];
  for (const part of PARTS) {
    for (const size of sizes) {
      const input: PartGeometryInput = { part, size: [...size], n: 4 };
      Object.freeze(input.size);
      Object.freeze(input);
      const before = structuredClone(input);
      const result = resolvePartGeometry(input);
      assert.deepEqual(input, before, `${part}: authored data stays unchanged`);
      assert.deepEqual(normalSize(part, result.size), result.size, `${part}: normalized dimensions stay normalized`);
      assert.deepEqual(resolvePartGeometry({ ...input, size: result.size }), result, `${part}: repeated resolution`);
      result.size[0] = 999;
      result.anchors.origin![0] = 999;
      assert.deepEqual(input, before, `${part}: returned data is independent`);
      assert.deepEqual(resolvePartGeometry(input).anchors.origin, [0, 0, 0], `${part}: each result owns its anchors`);
    }
  }
});

test('connector faces and radii match thin-disc construction for both gears and bearings', () => {
  for (const part of ['gear', 'bearing'] as const) {
    for (const size of [[5, 1, 5], [1, 5, 5], [5, 5, 1]] as Vec3[]) {
      const def: AddPart = { op: 'add', shape: 'part', id: 'disc', part, size };
      const built = buildPart(def, DETAIL.low);
      try {
        const round = roundOf(def, built.root)!;
        assert.equal(round.radius, 2.5);
        assert.equal(round.width, 1);
        assert.deepEqual(endPoint(built.root, def, 'front', undefined, undefined).toArray(), built.anchors.axis);
        assert.deepEqual(endPoint(built.root, def, 'top', undefined, undefined).toArray(), [0, 2.5, 0]);
      } finally {
        dispose(built);
      }
    }
  }
});
