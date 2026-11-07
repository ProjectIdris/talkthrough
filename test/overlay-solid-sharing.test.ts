import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import type { MeshPhysicalMaterial } from 'three';
import { validateScene } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, frameAt, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const primitive = (shape: string, id: string, extra: object = {}) => ({ op: 'add', shape, id, size: [2, 1, 3], ...extra });
const steps = (actions: unknown[]) => {
  const result = validateScene({ v: 1, steps: [{ say: 'A model.', actions }] });
  assert.deepEqual(result.issues, []);
  assert.ok(result.scene);
  return result.scene.steps;
};
const frame = (actions: unknown[]) => frameAt(steps(actions), 0, 99);
const mesh = (scene: PanelScene, f: Frame, id: string): Mesh => {
  const node = scene.nodeOf(f.objects.find((o) => o.id === id)!.key);
  assert.ok(node instanceof Mesh);
  return node;
};

for (const tier of ['low', 'mid', 'high'] as const) {
  test(`${tier}: identical immutable primitives share solid buffers but keep individual meshes and materials`, () => {
    const scene = new PanelScene({ tier });
    try {
      for (const shape of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane']) {
        const f = frame([primitive(shape, 'a'), primitive(shape, 'b', { color: 'red', pos: [3, 0, 0], edges: false })]);
        scene.sync(f, 1);
        const a = mesh(scene, f, 'a'), b = mesh(scene, f, 'b');
        assert.notEqual(a, b);
        assert.ok(a.geometry === b.geometry, shape);
        assert.notEqual(a.material, b.material, 'styling is per object');
        assert.notDeepEqual(a.position.toArray(), b.position.toArray());
        scene.sync(emptyFrame(), 1);
      }
    } finally { scene.destroy(); }
  });
}

test('geometry identity distinguishes shape, dimensions and bevel, including effective default bevel', () => {
  const f = frame([
    primitive('box', 'plain', { bevel: 0 }), primitive('box', 'rounded', { bevel: 0.1 }),
    primitive('box', 'wider', { size: [3, 1, 3], bevel: 0 }), primitive('sphere', 'sphere'),
    primitive('box', 'default'), primitive('box', 'explicit', { bevel: 0.1 }),
  ]);
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    const plain = mesh(scene, f, 'plain').geometry;
    for (const id of ['rounded', 'wider', 'sphere']) assert.notEqual(plain, mesh(scene, f, id).geometry);
    assert.ok(mesh(scene, f, 'default').geometry === mesh(scene, f, 'explicit').geometry);
  } finally { scene.destroy(); }
});

test('clearing a peer preserves the buffer; repeated sync never retains extra references', () => {
  const f = frame([primitive('sphere', 'a'), primitive('sphere', 'b')]);
  const scene = new PanelScene();
  scene.sync(f, 1);
  const geometry = mesh(scene, f, 'a').geometry;
  assert.ok(geometry === mesh(scene, f, 'b').geometry);
  let released = 0;
  geometry.addEventListener('dispose', () => released++);
  for (let i = 0; i < 25; i++) scene.sync(f, 1);
  const one = { ...f, objects: f.objects.filter((o) => o.id === 'b') };
  scene.sync(one, 1);
  assert.equal(released, 0);
  assert.equal(mesh(scene, one, 'b').geometry, geometry);
  scene.sync(emptyFrame(), 1);
  assert.equal(released, 1);
  scene.destroy();
  assert.equal(released, 1);
});

test('clear and rebuild cycles release each buffer and do not retain an unbounded history', () => {
  const scene = new PanelScene();
  let previous: Mesh['geometry'] | undefined;
  try {
    for (let i = 0; i < 20; i++) {
      const f = frame([primitive('box', 'a'), primitive('box', 'b')]);
      scene.sync(f, 1);
      const geometry = mesh(scene, f, 'a').geometry;
      assert.ok(geometry === mesh(scene, f, 'b').geometry);
      assert.notEqual(geometry, previous);
      let released = 0;
      geometry.addEventListener('dispose', () => released++);
      scene.sync(emptyFrame(), 1);
      assert.equal(released, 1);
      previous = geometry;
    }
  } finally { scene.destroy(); }
});

test('same-ID replacement changes its geometry without disposing a surviving peer', () => {
  const f = frame([primitive('box', 'a'), primitive('box', 'b')]);
  const scene = new PanelScene();
  scene.sync(f, 1);
  const old = mesh(scene, f, 'a').geometry;
  assert.ok(old === mesh(scene, f, 'b').geometry);
  let released = 0;
  old.addEventListener('dispose', () => released++);
  const next = evaluate(planStep(f, { say: 'Replace.', actions: [primitive('box', 'a', { size: [4, 1, 3] })] } as Parameters<typeof planStep>[1]), 99);
  scene.sync(next, 1);
  assert.notEqual(mesh(scene, next, 'a').geometry, old);
  assert.equal(mesh(scene, next, 'b').geometry, old);
  assert.equal(released, 0);
  scene.destroy();
  assert.equal(released, 1);
});

test('shared geometry does not share colors, opacity, transforms or cut planes', () => {
  const f = frame([
    primitive('box', 'a', { material: 'metal', color: 'red', pos: [-3, 0, 0] }),
    primitive('box', 'b', { material: 'glass', color: 'blue', pos: [3, 0, 0], opacity: 0.4 }),
    { op: 'cut', id: 'a', axis: 'x', to: 0, dur: 0 },
  ]);
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    const a = mesh(scene, f, 'a'), b = mesh(scene, f, 'b');
    assert.ok(a.geometry === b.geometry);
    const am = a.material as MeshPhysicalMaterial, bm = b.material as MeshPhysicalMaterial;
    assert.notEqual(am, bm);
    assert.notDeepEqual(am.color.toArray(), bm.color.toArray());
    assert.notEqual(am.opacity, bm.opacity);
    assert.ok(am.clippingPlanes && am.clippingPlanes.length > 0);
    assert.equal(bm.clippingPlanes?.length ?? 0, 0);
    assert.deepEqual(a.position.toArray(), [-3, 0, 0]);
    assert.deepEqual(b.position.toArray(), [3, 0, 0]);
  } finally { scene.destroy(); }
});

test('array copies share primitive buffers and remain independently addressable', () => {
  const f = frame([primitive('sphere', 'bead'), { op: 'add', shape: 'array', id: 'row', of: 'bead', count: 8, step: [3, 0, 0] }]);
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    const spheres = f.objects.filter((o) => o.shape === 'sphere').map((o) => mesh(scene, f, o.id));
    assert.equal(spheres.length, 8);
    assert.equal(new Set(spheres.map((m) => m.geometry)).size, 1);
    assert.equal(new Set(spheres.map((m) => m.material)).size, 8);
    assert.equal(new Set(f.objects.map((o) => o.id)).size, f.objects.length);
  } finally { scene.destroy(); }
});

test('mutable paths retain separate draw ranges when otherwise identical', () => {
  const path = (id: string, draw: number) => ({ op: 'add', shape: 'line', id, pts: [[0, 0, 0], [2, 1, 0], [3, 0, 0]], draw });
  const f = frame([path('a', 0.25), path('b', 0.75)]);
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    const geometry = (id: string) => {
      const node = scene.nodeOf(f.objects.find((o) => o.id === id)!.key)!;
      return (node.children.find((c) => c instanceof Mesh) as Mesh).geometry;
    };
    assert.notEqual(geometry('a'), geometry('b'));
    assert.notEqual(geometry('a').drawRange.count, geometry('b').drawRange.count);
  } finally { scene.destroy(); }
});

test('separate panels never share ownership of solid buffers', () => {
  const f = frame([primitive('sphere', 'a'), primitive('sphere', 'b')]);
  const a = new PanelScene(), b = new PanelScene();
  a.sync(f, 1); b.sync(f, 1);
  const ag = mesh(a, f, 'a').geometry, bg = mesh(b, f, 'a').geometry;
  assert.ok(ag === mesh(a, f, 'b').geometry);
  assert.notEqual(ag, bg);
  let bReleased = 0;
  bg.addEventListener('dispose', () => bReleased++);
  a.destroy();
  assert.equal(bReleased, 0);
  b.destroy();
  assert.equal(bReleased, 1);
});
