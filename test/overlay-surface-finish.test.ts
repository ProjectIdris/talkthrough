import { variantDefinitions } from './support/json-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import type { Object3D } from 'three';
import { TIERS, makeSurface, applySurface } from '../src/overlay/materials.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, evaluate, planStep, settle, emptyFrame } from '../src/overlay/timeline.ts';
import { createSceneState, createDetailState, validateScene, sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';
import type { Step } from '../src/scene/types.ts';

const fields = ['roughness', 'metalness', 'clearcoat', 'clearcoatRoughness'] as const;
const finish = { roughness: 0.12, metalness: 0.8, clearcoat: 0.9, clearcoatRoughness: 0.07 };
const box = { op: 'add', shape: 'box', id: 'item', size: [2, 2, 2] };
const validate = (...actions: unknown[]) => {
  const result = validateScene({ steps: [{ say: 'Surface comparison.', actions }] }, createSceneState());
  assert.ok(result.scene);
  return { ...result, scene: result.scene };
};
const meshOf = (object: Object3D | undefined): Mesh => {
  let mesh: Mesh | undefined;
  object?.traverse((o) => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh, 'the real scene contains a mesh');
  return mesh;
};
const mat = (object: Object3D | undefined): MeshPhysicalMaterial => meshOf(object).material as MeshPhysicalMaterial;
const frame = (steps: Step[], time = 99, step = 0) => frameAt(steps, step, time);
const shapeActions = [
  ...['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'].map((shape) => ({ ...box, shape })),
  { op: 'add', shape: 'extrude', id: 'item', outline: [[-1,-1],[1,-1],[1,1],[-1,1]], depth: 1 },
  { op: 'add', shape: 'lathe', id: 'item', profile: [[0,-1],[1,-1],[1,1],[0,1]] },
  { op: 'add', shape: 'blob', id: 'item', pts: [[0,0,0]], sizes: [[2,2,2]] },
  { op: 'add', shape: 'tube', id: 'item', pts: [[0,0,0],[0,2,0]], radius: 0.2 },
  { op: 'add', shape: 'connector', id: 'item', from: 'left', to: 'right', radius: 0.1 },
];
const ends = [{ ...box, id: 'left', pos: [-4,0,0] }, { ...box, id: 'right', pos: [4,0,0] }];

test('surface finish reaches every material-bearing primitive through validation and the real scene', () => {
  for (const action of shapeActions) {
    const result = validate(...ends, { ...action, ...finish });
    assert.deepEqual(result.issues, [], action.shape);
    const f = frame(result.scene.steps);
    const panel = new PanelScene();
    try {
      panel.sync(f, 1);
      const surface = mat(panel.nodeOf(f.objects.find((o) => o.id === 'item')!.key));
      for (const name of fields) assert.equal(surface[name], finish[name], `${action.shape}.${name}`);
    } finally { panel.destroy(); }
  }
});

test('partial finish overrides inherit each named recipe and explicit zero disables coat', () => {
  for (const name of ['plastic','metal','rubber','pcb','glass','glow','paper','tissue']) {
    const original = makeSurface(name, TIERS.high);
    const changed = makeSurface(name, TIERS.high, { roughness: 0, clearcoat: 0 });
    try {
      assert.equal(changed.roughness, 0, name);
      assert.equal(changed.clearcoat, 0, name);
      assert.equal(changed.metalness, original.metalness);
      assert.equal(changed.clearcoatRoughness, original.clearcoatRoughness);
      assert.deepEqual(changed.userData, original.userData);
      assert.equal(changed.side, original.side);
      assert.equal(changed.depthWrite, original.depthWrite);
      assert.equal(changed.envMapIntensity, original.envMapIntensity);
    } finally { original.dispose(); changed.dispose(); }
  }
});

test('low tier keeps coat disabled while retaining authored base roughness and metalness', () => {
  for (const tier of ['low','mid','high'] as const) {
    const m = makeSurface('plastic', TIERS[tier], finish);
    try {
      assert.equal(m.roughness, 0.12);
      assert.equal(m.metalness, 0.8);
      assert.equal(m.clearcoat, tier === 'low' ? 0 : 0.9);
      assert.equal(m.clearcoatRoughness, 0.07);
    } finally { m.dispose(); }
  }
});

test('finish numbers use ordinary bounds and nullable fields without consuming invalid IDs', () => {
  for (const name of fields) {
    for (const [input, want] of [[-0.1, 0], [1.1, 1], [0, 0], [1, 1], [0.43, 0.43]]) {
      const result = validate({ ...box, [name]: input });
      assert.equal((result.scene.steps[0]!.actions[0] as unknown as Record<string, unknown>)[name], want);
      assert.equal(result.issues.length, input! < 0 || input! > 1 ? 1 : 0);
    }
    for (const invalid of [NaN, Infinity, '0.3', true, [], {}]) {
      const result = validate({ ...box, [name]: invalid }, box);
      assert.equal(result.scene.steps[0]!.actions.length, 1, `${name} ${String(invalid)}`);
      assert.equal(result.issues.some((i) => i.kind === 'dropped'), true);
      assert.deepEqual(result.scene.steps[0]!.actions[0], box);
    }
    const result = validate({ ...box, [name]: null });
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.scene.steps[0]!.actions[0], box);
  }
});

test('strict full and lean schemas expose nullable finish only on material-bearing actions', () => {
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    const defs = variantDefinitions(schema);
    for (const name of ['addSolid','addExtrude','addLathe','addBlob','addTube','addConnector']) {
      for (const field of fields) {
        assert.deepEqual((defs[name]!.properties![field] as { type: unknown })?.type, ['number','null'], `${name}.${field}`);
        assert.ok(defs[name]!.required!.includes(field));
      }
    }
    for (const name of ['addPart','addGroup','addPath','addText','addStream','style']) {
      for (const field of fields) assert.equal(defs[name]!.properties![field], undefined);
    }
  }
});

test('tint, opacity and highlight updates preserve the finish and glass behavior', () => {
  const m = makeSurface('glass', TIERS.mid, finish);
  try {
    applySurface(m, [255, 100, 50], 0.5, 0.8, [0, 255, 0]);
    assert.equal(m.opacity, 0.17);
    assert.equal(m.depthWrite, false);
    assert.equal(m.emissiveIntensity, 0.9 * 0.8);
    for (const name of fields) assert.equal(m[name], finish[name]);
    applySurface(m, [80, 120, 180], 1, 0, undefined);
    assert.equal(m.opacity, 0.34);
    assert.equal(m.emissiveIntensity, 0);
    for (const name of fields) assert.equal(m[name], finish[name]);
  } finally { m.dispose(); }
});

test('arrays inherit finish and sibling material instances stay independent through sync and disposal', () => {
  const result = validate(
    { ...box, ...finish },
    { ...box, id: 'other', pos: [3,0,0], roughness: 0.85, metalness: 0 },
    { op: 'add', shape: 'array', id: 'copies', of: 'item', count: 3, step: [0,3,0] },
  );
  assert.deepEqual(result.issues, []);
  const f = frame(result.scene.steps);
  const panel = new PanelScene();
  panel.sync(f, 1);
  const root = mat(panel.nodeOf(f.objects.find((o) => o.id === 'item')!.key));
  const other = mat(panel.nodeOf(f.objects.find((o) => o.id === 'other')!.key));
  const all: MeshPhysicalMaterial[] = [];
  panel.scene.traverse((o) => { if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) all.push(o.material); });
  assert.equal(all.length, 4);
  assert.equal(all.filter((m) => m.roughness === 0.12 && m.metalness === 0.8).length, 3);
  assert.notEqual(root, other);
  let disposed = 0;
  root.addEventListener('dispose', () => disposed++);
  for (let i = 0; i < 20; i++) panel.sync(f, 1);
  assert.equal(mat(panel.nodeOf(f.objects.find((o) => o.id === 'item')!.key)), root);
  assert.equal(other.roughness, 0.85);
  assert.equal(disposed, 0);
  panel.destroy();
  assert.equal(disposed, 1);
});

test('malformed finish cannot spend a replacement and valid replacement gets a fresh surface', () => {
  for (const name of fields) {
    const state = createSceneState();
    const initial = validateScene({ steps: [{ say: 'First.', actions: [{ ...box, ...finish }] }] }, state);
    assert.ok(initial.scene);
    const nextState = createDetailState(state);
    const replacement = { ...box, roughness: 0.66, metalness: 0, clearcoat: 0 };
    const detail = validateScene({ steps: [{ say: 'Next.', actions: [{ ...box, [name]: 'invalid' }, replacement] }] }, nextState);
    assert.ok(detail.scene);
    assert.deepEqual(detail.scene.steps[0]!.actions, [replacement]);
    assert.equal(detail.issues.filter((i) => i.kind === 'dropped').length, 1);
    const base = settle(planStep(emptyFrame(), initial.scene.steps[0]!));
    const next = planStep(base, detail.scene.steps[0]!);
    const panel = new PanelScene();
    try {
      panel.sync(base, 1);
      const oldMaterial = mat(panel.nodeOf(base.objects[0]!.key));
      let disposed = 0;
      oldMaterial.addEventListener('dispose', () => disposed++);
      panel.sync(evaluate(next, 0.15), 1);
      assert.equal(oldMaterial.roughness, 0.12);
      assert.equal(disposed, 0);
      const done = evaluate(next, 99);
      panel.sync(done, 1);
      const newMaterial = mat(panel.nodeOf(done.objects[0]!.key));
      assert.notEqual(newMaterial, oldMaterial);
      assert.equal(newMaterial.roughness, 0.66);
      assert.equal(newMaterial.metalness, 0);
      assert.equal(newMaterial.clearcoat, 0);
      assert.equal(disposed, 1);
    } finally { panel.destroy(); }
  }
});

test('moving a connector changes its geometry without resetting authored finish or material', () => {
  const result = validate(...ends, { ...shapeActions.at(-1), ...finish });
  const base = frame(result.scene.steps);
  const panel = new PanelScene();
  try {
    panel.sync(base, 1);
    const key = base.objects.find((o) => o.id === 'item')!.key;
    const mesh = meshOf(panel.nodeOf(key));
    const originalMaterial = mesh.material;
    const originalGeometry = mesh.geometry;
    const next = evaluate(planStep(base, { say: 'Move.', actions: [{ op: 'move', id: 'right', to: [3,2,0], dur: 0 }] }), 99);
    panel.sync(next, 1);
    assert.notEqual(mesh.geometry, originalGeometry);
    assert.equal(mesh.material, originalMaterial);
    for (const name of fields) assert.equal(mat(panel.nodeOf(key))[name], finish[name]);
  } finally { panel.destroy(); }
});

test('authored finish affects the outside without replacing the contrasting cut face', () => {
  const result = validate({ ...box, ...finish }, { op: 'cut', id: 'item', to: 0, dur: 0 });
  assert.deepEqual(result.issues, []);
  const f = frame(result.scene.steps);
  const panel = new PanelScene();
  try {
    panel.sync(f, 1);
    const material = mat(panel.nodeOf(f.objects[0]!.key));
    for (const name of fields) assert.equal(material[name], finish[name]);
    assert.ok(material.clippingPlanes?.length);
    const caps: MeshStandardMaterial[] = [];
    panel.scene.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshStandardMaterial && o.material !== material) caps.push(o.material);
    });
    assert.ok(caps.length > 0, 'the real cutaway has its own cap surface');
    for (const cap of caps) { assert.equal(cap.roughness, 0.82); assert.equal(cap.metalness, 0.02); }
  } finally { panel.destroy(); }
});

test('the authored surface comparison validates without repair and preserves paired geometry', () => {
  const sample = JSON.parse(readFileSync(new URL('../samples/scenes/surface-finishes.json', import.meta.url), 'utf8'));
  const result = validateScene(sample);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene, sample);
  assert.ok(result.scene);
  for (const tier of ['low','mid','high'] as const) {
    const f = frame(result.scene.steps);
    const panel = new PanelScene({ tier });
    try {
      panel.sync(f, 1);
      const byId = (id: string) => meshOf(panel.nodeOf(f.objects.find((o) => o.id === id)!.key));
      for (const [left, right] of [['copperPolished','copperRough'],['housingMatte','housingCoated'],['tubeGlossy','tubeMatte']]) {
        const a = byId(left!), b = byId(right!);
        assert.deepEqual(a.geometry.getAttribute('position').array, b.geometry.getAttribute('position').array);
        assert.deepEqual(a.geometry.getAttribute('normal').array, b.geometry.getAttribute('normal').array);
        assert.deepEqual((a.material as MeshPhysicalMaterial).color, (b.material as MeshPhysicalMaterial).color);
      }
      assert.equal((byId('housingCoated').material as MeshPhysicalMaterial).clearcoat, tier === 'low' ? 0 : 1);
    } finally { panel.destroy(); }
  }
});
