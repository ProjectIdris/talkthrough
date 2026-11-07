import { variantDefinitions } from './support/json-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, LineSegments, Mesh, MeshPhysicalMaterial } from 'three';
import { createDetailState, createSceneState, sceneSchema, sceneSchemaLean, startTurn, validateScene, validateStep } from '../src/scene/index.ts';
import { emptyFrame, frameAt } from '../src/overlay/timeline.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';

const finish = { roughness: 0.17, metalness: 0.63, clearcoat: 0.82, clearcoatRoughness: 0.09 };
const square = [[-1,-1],[1,-1],[1,1],[-1,1]];
const shapes: Record<string, Record<string, unknown>> = {
  patch: { pts: Array.from({ length: 16 }, (_, i) => [i % 4 - 1.5, Math.floor(i / 4) - 1.5, 0.2 * (i % 4 - 1.5) * (Math.floor(i / 4) - 1.5)]) },
  sweep: { outline: [[-0.3,-0.2],[0.3,-0.2],[0.3,0.2],[-0.3,0.2]], pts: [[0,0,-2],[0,0,2]] },
  loft: { outline: square, endOutline: [[-.5,-.8],[1.5,-.4],[.8,1.4],[-.8,.6]], depth: 2 },
  hull: { pts: [[-1,-1,-1],[1,-1,-1],[0,1,-1],[0,0,1]] },
};
const meshOf = (panel: PanelScene, key: number): Mesh => {
  let mesh: Mesh | undefined;
  panel.nodeOf(key)?.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh); return mesh;
};

// Removing FINISH from any named shape's spec must fail admission, schema and real material checks.
for (const [shape, geometry] of Object.entries(shapes)) {
  test(`${shape}: merged shape retains finish in validation, both schemas and renderer`, () => {
    const raw = { op: 'add', shape, id: 'item', ...geometry, ...finish };
    const checked = validateScene({ steps: [{ say: 'A polished shape.', actions: [raw] }] });
    assert.deepEqual(checked.issues, []);
    assert.ok(checked.scene);
    const action = checked.scene.steps[0]!.actions[0] as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(finish)) assert.equal(action[field], value);
    for (const schema of [sceneSchema, sceneSchemaLean]) {
      const variant = `add${shape[0]!.toUpperCase()}${shape.slice(1)}`;
      const def = variantDefinitions(schema)[variant]!;
      for (const field of Object.keys(finish)) assert.ok(def.properties[field], `${variant}.${field}`);
    }
    for (const tier of ['low','mid','high'] as const) {
      const panel = new PanelScene({ tier });
      try {
        const frame = frameAt(checked.scene.steps, 0, 99);
        panel.sync(frame, 1);
        const material = meshOf(panel, frame.objects[0]!.key).material as MeshPhysicalMaterial;
        for (const [field, value] of Object.entries(finish)) {
          assert.equal(material[field as keyof typeof finish], field === 'clearcoat' && tier === 'low' ? 0 : value);
        }
      } finally { panel.destroy(); }
    }
  });
}

test('different finishes share primitive buffers, not materials or disposal ownership', () => {
  const checked = validateScene({ steps: [{ say: 'Independent finishes.', actions: [
    { op: 'add', shape: 'box', id: 'a', size: [1,2,3], ...finish },
    { op: 'add', shape: 'box', id: 'b', size: [1,2,3], roughness: 0.9, metalness: 0, clearcoat: 0 },
    { op: 'cut', id: 'a', normal: [1,0,1], to: 0, dur: 0 },
  ] }] });
  assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
  const frame = frameAt(checked.scene.steps, 0, 99), panel = new PanelScene();
  const disposals = new Map<BufferGeometry, number>();
  try {
    panel.sync(frame, 1);
    const a = meshOf(panel, frame.objects[0]!.key), b = meshOf(panel, frame.objects[1]!.key);
    assert.equal(a.geometry, b.geometry); assert.notEqual(a.material, b.material);
    assert.equal((a.material as MeshPhysicalMaterial).roughness, finish.roughness);
    assert.equal((b.material as MeshPhysicalMaterial).roughness, 0.9);
    assert.ok((a.material as MeshPhysicalMaterial).clippingPlanes?.length);
    assert.equal((b.material as MeshPhysicalMaterial).clippingPlanes?.length ?? 0, 0);
    for (const object of frame.objects) panel.nodeOf(object.key)?.traverse(o => {
      if (!(o instanceof Mesh || o instanceof LineSegments) || disposals.has(o.geometry)) return;
      disposals.set(o.geometry, 0);
      o.geometry.addEventListener('dispose', () => disposals.set(o.geometry, disposals.get(o.geometry)! + 1));
    });
    panel.sync({ ...frame, objects: frame.objects.slice(1) }, 1);
    assert.equal(disposals.get(a.geometry), 0);
    panel.sync(emptyFrame(), 1);
    assert.ok([...disposals.values()].every(n => n === 1));
    panel.destroy();
    assert.ok([...disposals.values()].every(n => n === 1));
  } finally { panel.destroy(); }
});

test('ordinary through-holes survive while taper and shift reject unsupported holes before replacement', () => {
  const state = createSceneState();
  const ordinary = { op: 'add', shape: 'extrude', id: 'part', outline: square, holes: [[[-0.3,-0.3],[0.3,-0.3],[0.3,0.3],[-0.3,0.3]]], depth: 1, bevel: 0 };
  assert.deepEqual(validateScene({ steps: [{ say: 'A slot.', actions: [ordinary] }] }, state).issues, []);
  const detail = createDetailState(state); startTurn(detail);
  const original = structuredClone(detail.bodies.get('part'));
  for (const deformation of [{ taper: 0.5 }, { shift: [0.3,0] }]) {
    const rejected = validateStep({ say: 'Invalid combined shape.', actions: [{ ...ordinary, ...deformation }] }, detail);
    assert.equal(rejected.step!.actions.length, 0);
    assert.deepEqual(detail.bodies.get('part'), original);
    assert.equal(detail.replaceable!.has('part'), true);
  }
  const accepted = validateStep({ say: 'Keep openings.', actions: [ordinary] }, detail);
  assert.equal(accepted.step!.actions.length, 1);
});
