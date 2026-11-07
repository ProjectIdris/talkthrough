import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EdgesGeometry, LineSegments, Mesh, MeshPhysicalMaterial, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Action, Step, Vec3 } from '../src/scene/index.ts';

const tiers = ['low', 'mid', 'high'] as const;
const shapes = ['sphere', 'cylinder', 'torus'] as const;
const sizes: Vec3[] = [[3, 0.1, 2], [0.03, 0.01, 0.02], [10, 0.02, 0.01], [3, 1, 2]];
const steps = (...actions: Action[]): Step[] => [{ say: 'Continuous surface.', actions: [
  { op: 'panel', x: 100, y: 80, w: 700, h: 600 }, ...actions,
] }];
const lines = (mesh: Mesh): LineSegments[] => mesh.children.filter(child => child instanceof LineSegments);
const surface = (panel: PanelScene, frame: ReturnType<typeof frameAt>, id = 'body'): Mesh => {
  const mesh = panel.nodeOf(frame.objects.find(o => o.id === id)!.key);
  assert.ok(mesh instanceof Mesh);
  return mesh;
};

for (const shape of shapes) test(`${shape} keeps continuous surfaces free of false creases at every size and tier`, () => {
  for (const tier of tiers) for (const size of sizes) for (const edges of [undefined, true, false]) {
    const panel = new PanelScene({ tier });
    try {
      const frame = frameAt(steps({ op: 'add', shape, id: 'body', size, edges }), 0, 99);
      panel.sync(frame, 1);
      const segments = lines(surface(panel, frame)).reduce((sum, line) => sum + line.geometry.getAttribute('position').count / 2, 0);
      assert.equal(segments, 0, `${tier} ${shape} ${size} edges=${edges}`);
    } finally { panel.destroy(); }
  }
});

test('sharp solids, open boundaries and authored profiles keep the exact legacy edge buffers', () => {
  const controls: Action[] = [
    { op: 'add', id: 'body', shape: 'box', size: [2, 1, 3], bevel: 0 },
    { op: 'add', id: 'body', shape: 'cone', size: [3, 1, 2] },
    { op: 'add', id: 'body', shape: 'plane', size: [3, 2, 1] },
    { op: 'add', id: 'body', shape: 'lathe', sides: 6, profile: [[0, -1], [1, -1], [1, 1], [0, 1]] },
    { op: 'add', id: 'body', shape: 'extrude', bevel: 0, depth: 1, outline: [[-1, -1], [1, -1], [1, 1], [-1, 1]] },
  ];
  for (const tier of ['mid', 'high'] as const) for (const action of controls) {
    const panel = new PanelScene({ tier });
    try {
      const frame = frameAt(steps(action), 0, 99);
      panel.sync(frame, 1);
      const mesh = surface(panel, frame), outline = lines(mesh);
      const expected = new EdgesGeometry(mesh.geometry, 28);
      try {
        assert.equal(outline.length, 1);
        assert.ok(expected.getAttribute('position').count > 0);
        assert.deepEqual(outline[0]!.geometry.getAttribute('position').array, expected.getAttribute('position').array);
      } finally { expected.dispose(); }
    } finally { panel.destroy(); }
  }
});

test('nested enlargement and cutting retain the shared surface, material and clipping isolation', () => {
  for (const shape of shapes) for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    const first = frameAt(steps(
      { op: 'add', shape: 'group', id: 'assembly', rot: [20, 35, 10] },
      { op: 'scale', id: 'assembly', to: [10, 7, 9], dur: 0 },
      { op: 'add', shape, id: 'body', parent: 'assembly', size: [0.03, 0.01, 0.02], color: '#4488cc', roughness: 0.25 },
      { op: 'scale', id: 'body', to: [8, 9, 10], dur: 0 },
      { op: 'add', shape, id: 'peer', size: [0.03, 0.01, 0.02], color: '#4488cc', roughness: 0.25, edges: false, pos: [4, 0, 0] },
      { op: 'cut', id: 'body', axis: 'z', to: 0, dur: 0 },
    ), 0, 99);
    try {
      panel.sync(first, 1);
      const mesh = surface(panel, first), peer = surface(panel, first, 'peer');
      assert.equal(mesh.geometry, peer.geometry);
      const before = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attr]) => [name, Array.from(attr.array)]));
      const index = mesh.geometry.index && Array.from(mesh.geometry.index.array);
      assert.equal(lines(mesh).length, 0);
      const scale = mesh.getWorldScale(new Vector3());
      for (const [actual, expected] of [[scale.x, 80], [scale.y, 63], [scale.z, 90]]) assert.ok(Math.abs(actual! - expected!) < 1e-8);
      const material = mesh.material as MeshPhysicalMaterial;
      assert.equal(material.roughness, 0.25);
      assert.equal(material.clippingPlanes?.length, 1);
      assert.equal((peer.material as MeshPhysicalMaterial).clippingPlanes?.length ?? 0, 0);
      assert.notEqual(mesh.material, peer.material);
      for (let i = 0; i < 15; i++) panel.sync(first, 1);
      assert.equal(surface(panel, first), mesh);
      for (const [name, values] of Object.entries(before)) assert.deepEqual(Array.from(mesh.geometry.getAttribute(name).array), values);
      assert.deepEqual(mesh.geometry.index && Array.from(mesh.geometry.index.array), index);
    } finally { panel.destroy(); }
  }
});

test('shared smooth primitives are reused and released once after replacement, clear and destroy', () => {
  for (const shape of shapes) {
    const panel = new PanelScene({ tier: 'high' });
    const scene: Step[] = [
      ...steps({ op: 'add', id: 'body', shape, size: [3, 0.1, 2] }, { op: 'add', id: 'peer', shape, size: [3, 0.1, 2], pos: [4, 0, 0] }),
      { say: 'Replace.', actions: [{ op: 'add', id: 'body', shape, size: [1, 1, 1] }] },
      { say: 'Clear.', actions: [{ op: 'clear', target: 'all' }] },
    ];
    try {
      const first = frameAt(scene, 0, 99), next = frameAt(scene, 1, 99), empty = frameAt(scene, 2, 99);
      panel.sync(first, 1);
      const mesh = surface(panel, first), peer = surface(panel, first, 'peer');
      assert.equal(mesh.geometry, peer.geometry);
      assert.equal(lines(mesh).length + lines(peer).length, 0);
      let originalDisposed = 0, replacementDisposed = 0, materialDisposed = 0;
      mesh.geometry.addEventListener('dispose', () => originalDisposed++);
      (mesh.material as MeshPhysicalMaterial).addEventListener('dispose', () => materialDisposed++);
      for (let i = 0; i < 10; i++) panel.sync(first, 1);
      panel.sync(next, 1);
      assert.equal(originalDisposed, 0);
      assert.equal(materialDisposed, 1);
      const replacement = surface(panel, next);
      replacement.geometry.addEventListener('dispose', () => replacementDisposed++);
      assert.equal(surface(panel, next, 'peer').geometry, mesh.geometry);
      panel.sync(empty, 1);
      panel.destroy();
      assert.equal(originalDisposed, 1);
      assert.equal(replacementDisposed, 1);
      assert.equal(materialDisposed, 1);
    } finally { panel.destroy(); }
  }
});

test('the comparison sample validates without dropping its shapes, transforms, views or cuts', () => {
  const input = JSON.parse(readFileSync(new URL('../samples/scenes/continuous-surfaces.json', import.meta.url), 'utf8'));
  const result = validateScene(input, createSceneState());
  assert.deepEqual(result.issues, []);
  assert.ok(result.scene);
  assert.equal(result.scene.steps.length, 4);
  for (let i = 0; i < input.steps.length; i++) assert.equal(result.scene.steps[i]!.actions!.length, input.steps[i].actions.length);
  const first = result.scene.steps[0]!.actions!;
  for (const shape of shapes) {
    const pair = first.filter(a => a.op === 'add' && a.shape === shape);
    assert.equal(pair.length, 2, shape);
    const left = pair[0]!, right = pair[1]!;
    assert.equal('edges' in left && left.edges, false);
    assert.equal('edges' in right ? right.edges : undefined, undefined);
    for (const field of ['size', 'rot', 'material', 'color', 'roughness']) {
      assert.deepEqual((left as unknown as Record<string, unknown>)[field], (right as unknown as Record<string, unknown>)[field], field);
    }
  }
});
