import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { validateScene, sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';
import type { Step, Vec3 } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { check } from './support/json-schema.ts';

const cube = { op: 'add', shape: 'box', id: 'solid', size: [4, 4, 4], bevel: 0 };
const step = (...actions: unknown[]): Step => ({ say: '', actions }) as Step;
const cut = (extra: object = {}) => ({ op: 'cut', id: 'solid', to: 0, dur: 0, ...extra });
const scene = (...actions: unknown[]) => ({ steps: [step(...actions)] });
const frame = (...actions: unknown[]) => settle(planStep(emptyFrame(), step(cube, ...actions)));
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
function planeOf(node: Object3D) {
  let material: Material | undefined;
  node.traverse(o => { const m = (o as Mesh).material; if (!material && m && !Array.isArray(m) && m.clippingPlanes?.length) material = m; });
  assert.ok(material?.clippingPlanes?.length);
  return material.clippingPlanes[0]!;
}
function nodeOf(panel: PanelScene, f: Frame, id = 'solid') { return panel.nodeOf(f.objects.find(o => o.id === id)!.key)!; }
function assertLocalPlane(node: Object3D, normal: Vec3, distance: number) {
  const plane = planeOf(node);
  const unit = new Vector3(...normal).normalize();
  const tangent = new Vector3().crossVectors(unit, Math.abs(unit.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
  const other = new Vector3().crossVectors(unit, tangent);
  const origin = unit.clone().multiplyScalar(distance);
  for (const [u, v] of [[0, 0], [2, 0], [-3, 1], [1, -2]]) {
    const p = origin.clone().addScaledVector(tangent, u!).addScaledVector(other, v!);
    near(plane.distanceToPoint(node.localToWorld(p)), 0);
  }
  assert.ok(plane.distanceToPoint(node.localToWorld(origin.clone().add(unit))) < 0, 'positive normal side is removed');
  assert.ok(plane.distanceToPoint(node.localToWorld(origin.clone().sub(unit))) > 0, 'negative normal side is retained');
}

test('oblique cut normal survives validation and is offered in both model schemas', () => {
  const raw = scene(cube, cut({ normal: [2, -1, 3] }));
  const result = validateScene(raw);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene, raw);
  for (const schema of [sceneSchema, sceneSchemaLean]) assert.deepEqual(check(schema, schema, raw, '$', true), []);
});

test('invalid or ambiguous cut directions reject the action without changing the scene', () => {
  for (const extra of [
    { normal: [0, 0, 0] }, { normal: [0, 0] }, { normal: [1, 2, 3, 4] }, { normal: [NaN, 0, 1] },
    { normal: [Infinity, 0, 1] }, { normal: ['1', 0, 1] }, { normal: [101, 0, 1] }, { normal: [-101, 1, 0] },
    { normal: [1, 0, 1], axis: 'x' }, { normal: 'z' },
  ]) {
    const result = validateScene(scene(cube, cut(extra), { op: 'style', id: 'solid', color: 'blue' }));
    assert.ok(result.scene);
    assert.deepEqual(result.scene.steps[0]!.actions.map(a => a.op), ['add', 'style'], JSON.stringify(extra));
    assert.ok(result.issues.some(i => i.kind === 'dropped' && /normal|direction|axis/.test(i.message)));
  }
  const raw = scene(cube, cut({ normal: null, axis: 'x' }));
  assert.deepEqual(validateScene(raw).issues, []);
});

test('normal magnitude does not change a cut and tiny nonzero directions remain finite', () => {
  for (const normal of [[1, 0, 1], [80, 0, 80], [Number.MIN_VALUE, 0, Number.MIN_VALUE]] as Vec3[]) {
    const f = frame(cut({ normal, to: 0.5 }));
    const panel = new PanelScene();
    try {
      panel.sync(f, 1);
      assertLocalPlane(nodeOf(panel, f), [1, 0, 1], 0.5);
    } finally { panel.destroy(); }
  }
});

test('an oblique cut follows nested rotation and nonuniform scaling as a plane', () => {
  const f = settle(planStep(emptyFrame(), step(
    { op: 'add', shape: 'group', id: 'outer', pos: [2, -3, 1], rot: [20, 30, 10] },
    { op: 'scale', id: 'outer', to: [3, 0.5, 2], dur: 0 },
    { ...cube, parent: 'outer', rot: [25, -40, 15] },
    { op: 'scale', id: 'solid', to: [0.7, 2, 1.3], dur: 0 },
    cut({ normal: [1, 2, -1], to: -0.35 }),
  )));
  const panel = new PanelScene();
  try { panel.sync(f, 1); assertLocalPlane(nodeOf(panel, f), [1, 2, -1], -0.35); } finally { panel.destroy(); }
});

test('axis cuts also remain planar under a rotated nonuniform ancestor', () => {
  const f = settle(planStep(emptyFrame(), step(
    { op: 'add', shape: 'group', id: 'outer' },
    { op: 'scale', id: 'outer', to: [3, 0.5, 2], dur: 0 },
    { ...cube, parent: 'outer', rot: [20, 40, -15] }, cut({ axis: 'x', to: 0.4 }),
  )));
  const panel = new PanelScene();
  try { panel.sync(f, 1); assertLocalPlane(nodeOf(panel, f), [1, 0, 0], 0.4); } finally { panel.destroy(); }
});

test('future axis and normal changes do not rewrite an earlier cut frame', () => {
  const plan = planStep(emptyFrame(), step(cube,
    cut({ normal: [1, 0, 1], at: 4 }),
    cut({ axis: 'x', at: 1 }),
    cut({ axis: 'y', at: 7 }),
  ));
  const panel = new PanelScene();
  try {
    assert.equal(evaluate(plan, 0.5).objects[0]?.cut, undefined);
    for (const [at, normal] of [[2, [1, 0, 0]], [5, [1, 0, 1]], [8, [0, 1, 0]], [2, [1, 0, 0]]] as Array<[number, Vec3]>) {
      const f = evaluate(plan, at);
      panel.sync(f, 1);
      assertLocalPlane(nodeOf(panel, f), normal, 0);
    }
  } finally { panel.destroy(); }
});

test('offset-only cuts carry the oblique direction across steps and replacement', () => {
  const first = frame(cut({ normal: [-2, 1, 3], to: 0.3 }));
  const next = planStep(first, step(cut({ to: -0.5, at: 1, dur: 2 }), { ...cube, size: [5, 3, 4], at: 4 }));
  const panel = new PanelScene();
  try {
    for (const [at, offset] of [[0.5, 0.3], [2, -0.1], [5, -0.5]]) {
      const f = evaluate(next, at!);
      panel.sync(f, 1);
      assertLocalPlane(nodeOf(panel, f), [-2, 1, 3], offset!);
    }
  } finally { panel.destroy(); }
});

test('parent, child and user cuts keep separate planes and cap helpers across all tiers', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    const f = settle(planStep(emptyFrame(), step(
      { op: 'add', shape: 'group', id: 'assembly' }, { ...cube, parent: 'assembly' },
      { ...cube, id: 'beside', pos: [7, 0, 0] },
      cut({ id: 'assembly', normal: [1, 0, 1], to: 0.5 }), cut({ normal: [-1, 1, 0], to: 0.2 }),
    )));
    try {
      panel.sync(f, 1);
      const node = nodeOf(panel, f);
      const material = (node as Mesh).material as Material;
      assert.equal(material.clippingPlanes?.length, 2);
      assert.equal(((nodeOf(panel, f, 'beside') as Mesh).material as Material).clippingPlanes, null);
      const caps = () => panel.scene.children.filter(o => (o as Mesh).isMesh && ((o as Mesh).material as Material).stencilWrite);
      assert.equal(caps().length, 2);
      for (const cap of caps()) {
        const m = (cap as Mesh).material as Material;
        assert.equal(m.clippingPlanes?.length, 1, 'each cap is clipped by the other owner plane');
        const normal = new Vector3(0, 0, 1).applyQuaternion(cap.quaternion);
        assert.ok(material.clippingPlanes!.some(p => Math.abs(p.distanceToPoint(cap.position)) < 1e-6 && normal.dot(p.normal) > 0.999999));
      }
      panel.sync({ ...f, userCut: 1 }, 1);
      assert.equal(material.clippingPlanes?.length, 3);
      assert.equal(caps().length, 4, '3 caps on solid, one on the independent beside box');
      panel.sync(f, 1);
      assert.equal(caps().length, 2);
      const removed = settle(planStep(f, step({ op: 'clear', target: 'assembly' })));
      panel.sync(removed, 1);
      assert.equal(caps().length, 0);
    } finally { panel.destroy(); }
  }
});

test('disabling a cut restores the surface and the next settled step defaults to +z', () => {
  const first = frame(cut({ normal: [1, 2, 3] }));
  const panel = new PanelScene();
  try {
    panel.sync(first, 1);
    const node = nodeOf(panel, first) as Mesh;
    const mat = node.material as Material;
    let disposed = 0;
    for (const child of panel.scene.children) if ((child as Mesh).isMesh && ((child as Mesh).material as Material).stencilWrite) {
      ((child as Mesh).material as Material).addEventListener('dispose', () => disposed++);
    }
    const off = settle(planStep(first, step(cut({ to: 100 }))));
    panel.sync(off, 1);
    assert.equal(mat.clippingPlanes, null);
    assert.equal(disposed, 1, 'cap material is released');
    assert.equal(off.objects.find(o => o.id === 'solid')?.cut, undefined);
    const again = settle(planStep(off, step(cut({ to: 0.2 }))));
    panel.sync(again, 1);
    assertLocalPlane(nodeOf(panel, again), [0, 0, 1], 0.2);
  } finally { panel.destroy(); }
});

test('an arriving future direction leaves the current streamed cut and first object visible', async () => {
  const { Player } = await import('../src/overlay/player.ts');
  let now = 0;
  const player = new Player({ clock: { now: () => now, after: () => () => {} }, voice: {
    id: 'cut-test', cancel() {},
    speak(_text, listener) {
      listener?.start?.({ estimatedMs: 10000 });
      return { finished: new Promise(() => {}), cancel() {} };
    },
  } });
  const panel = new PanelScene();
  try {
    player.beginTurn();
    player.openStep('The first section is already visible while more instructions arrive.');
    player.addAction(cube as never);
    player.addAction(cut({ axis: 'x' }) as never);
    now = 1000;
    let f = player.update();
    assert.equal(f.objects.length, 1);
    panel.sync(f, 1);
    assertLocalPlane(nodeOf(panel, f), [1, 0, 0], 0);
    player.addAction(cut({ normal: [1, 0, 1], at: 4 }) as never);
    f = player.update();
    panel.sync(f, 1);
    assertLocalPlane(nodeOf(panel, f), [1, 0, 0], 0);
    now = 15000;
    f = player.update();
    panel.sync(f, 1);
    assertLocalPlane(nodeOf(panel, f), [1, 0, 1], 0);
    assert.equal(f.objects.length, 1);
  } finally { player.clear(); panel.destroy(); }
});

test('a section cap covers its translated model instead of staying near the world origin', () => {
  const f = settle(planStep(emptyFrame(), step(
    { ...cube, pos: [-60, 60, 30] }, cut({ normal: [1, 1, 0], to: 0.25 }),
  )));
  const panel = new PanelScene();
  try {
    panel.sync(f, 1);
    const node = nodeOf(panel, f);
    const plane = planeOf(node);
    const cap = panel.scene.children.find(o => (o as Mesh).isMesh && ((o as Mesh).material as Material).stencilWrite)!;
    assert.ok(cap?.visible);
    for (const x of [-2, 2]) for (const y of [-2, 2]) for (const z of [-2, 2]) {
      const world = node.localToWorld(new Vector3(x, y, z));
      const onCap = cap.worldToLocal(plane.projectPoint(world, new Vector3()));
      assert.ok(Math.abs(onCap.x) <= 0.5 && Math.abs(onCap.y) <= 0.5, `projected corner is outside cap: ${onCap.toArray()}`);
      near(onCap.z, 0);
    }
  } finally { panel.destroy(); }
});
