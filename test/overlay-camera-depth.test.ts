import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const tiers = ['low', 'mid', 'high'] as const;
const frame = (...actions: unknown[]): Frame => {
  const checked = validateScene({ v: 1, steps: [{ say: 'Inspect the model.', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'orbit', az: 0, el: 0, dur: 0 }, ...actions,
  ] }] });
  assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
  return frameAt(checked.scene.steps, 0, 99);
};
function contained(scene: PanelScene, f: Frame, id: string): void {
  let mesh: Mesh | undefined;
  scene.nodeOf(f.objects.find(o => o.id === id)!.key)!.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh);
  const p = mesh.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const projected = new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).project(scene.camera);
    assert.ok(projected.z > -1 && projected.z < 1, `${id} vertex ${i}: clip z ${projected.z}, near ${scene.camera.near}, far ${scene.camera.far}`);
  }
}

test('large validated models remain inside camera depth after nested enlargement', () => {
  const f = frame(
    { op: 'add', shape: 'group', id: 'rig', rot: [20, 30, 10] },
    { op: 'scale', id: 'rig', to: [100, 80, 60], dur: 0 },
    { op: 'add', shape: 'box', id: 'body', parent: 'rig', size: [100, 100, 100], bevel: 0 },
    { op: 'scale', id: 'body', to: [10, 10, 10], dur: 0 },
  );
  for (const tier of tiers) {
    const scene = new PanelScene({ tier });
    try { scene.sync(f, 1); contained(scene, f, 'body'); }
    finally { scene.destroy(); }
  }
});

test('minimum-size pieces remain visible at the permitted close zoom', () => {
  const f = frame({ op: 'add', shape: 'box', id: 'body', size: [0.01, 0.01, 0.01], bevel: 0 }, { op: 'zoom', to: 5, dur: 0 });
  for (const tier of tiers) {
    const scene = new PanelScene({ tier });
    try {
      scene.sync(f, 1); contained(scene, f, 'body');
      assert.ok(scene.project(f.objects[0]!.key, undefined, 1000, 800)?.visible, 'pins see the same retained surface');
    } finally { scene.destroy(); }
  }
});

test('drawn paths outside camera fitting still determine the far clipping range', () => {
  const f = frame(
    { op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 },
    { op: 'add', shape: 'group', id: 'remote', pos: [0, 0, -100] },
    { op: 'scale', id: 'remote', to: [100, 100, 100], dur: 0 },
    { op: 'add', shape: 'tube', id: 'path', parent: 'remote', pts: [[0, 0, -30], [0, 0, -40]], radius: 0.01 },
  );
  const scene = new PanelScene();
  try { scene.sync(f, 1); contained(scene, f, 'path'); }
  finally { scene.destroy(); }
});

test('depth range follows the live pose rather than only the resting camera fit', () => {
  const f = frame({ op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 });
  const scene = new PanelScene({ tier: 'low' });
  try {
    scene.sync(f, 1);
    const before = scene.camera.position.clone();
    const posed: Frame = { ...f, objects: f.objects.map(o => ({ ...o, pose: { pos: [0, 0, -6000] } })) };
    scene.sync(posed, 1); contained(scene, posed, 'body');
    assert.deepEqual(scene.camera.position, before, 'clipping does not move a camera fitted to rest');
    const far = scene.camera.far;
    scene.sync(f, 1); contained(scene, f, 'body');
    assert.ok(scene.camera.far < far / 100, 'returning to rest releases the distant range');
  } finally { scene.destroy(); }
});

test('an enlarged instanced kit keeps every instance within the depth range', () => {
  const f = frame(
    { op: 'add', shape: 'group', id: 'rig', rot: [25, 35, 10] },
    { op: 'scale', id: 'rig', to: [100, 100, 100], dur: 0 },
    { op: 'add', shape: 'part', part: 'header', id: 'chip', parent: 'rig', size: [100, 50, 80] },
  );
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    let instances = 0;
    scene.nodeOf(f.objects.find(o => o.id === 'chip')!.key)!.traverse(o => {
      if (!(o instanceof Mesh)) return;
      const geometry = o.geometry;
      const box = (o as Mesh & { boundingBox?: import('three').Box3 }).boundingBox ?? geometry.boundingBox;
      assert.ok(box);
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new Vector3(x, y, z).applyMatrix4(o.matrixWorld).project(scene.camera);
        assert.ok(p.z > -1 && p.z < 1);
      }
      if ('isInstancedMesh' in o) instances++;
    });
    assert.ok(instances > 0, 'fixture actually exercises instanced pins');
  } finally { scene.destroy(); }
});

test('invisible descendants do not expand depth beyond the visible model from the current camera', () => {
  const f = frame(
    { op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 },
    { op: 'add', shape: 'group', id: 'hidden' },
    { op: 'style', id: 'hidden', opacity: 0, dur: 0 },
    { op: 'scale', id: 'hidden', to: [100, 100, 100], dur: 0 },
    { op: 'add', shape: 'box', id: 'remote', parent: 'hidden', size: [100, 100, 100], pos: [0, 0, -100], bevel: 0 },
  );
  const scene = new PanelScene({ tier: 'low' });
  try {
    scene.sync(f, 1); contained(scene, f, 'body');
    // Camera framing has its own bounds policy. Only depth clipping is tested here.
    const furthest = -new Vector3(0, 0, -0.5).applyMatrix4(scene.camera.matrixWorldInverse).z;
    assert.ok(Math.abs(scene.camera.far - furthest * 1.1) < 1e-8);
  } finally { scene.destroy(); }
});

test('crossing the camera and clearing the model retain finite usable projection matrices', () => {
  const f = frame({ op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 }, { op: 'zoom', to: 5, dur: 0 });
  const scene = new PanelScene();
  try {
    scene.sync(f, 1);
    assert.ok(scene.camera.near > 0 && scene.camera.far > scene.camera.near);
    assert.ok(scene.camera.projectionMatrix.elements.every(Number.isFinite));
    for (const empty of [frame(), frame({ op: 'add', shape: 'group', id: 'empty' })]) {
      scene.sync(empty, 1);
      assert.equal(scene.camera.near, 0.3); assert.equal(scene.camera.far, 1500);
      assert.ok(scene.camera.projectionMatrix.elements.every(Number.isFinite));
    }
  } finally { scene.destroy(); }
});

test('a broad shadow receiver cannot collapse front and back surfaces to one depth value', () => {
  const f = frame({ op: 'add', shape: 'box', id: 'body', size: [10, 0.1, 0.1], bevel: 0 });
  for (const tier of ['mid', 'high'] as const) {
    const scene = new PanelScene({ tier });
    try {
      scene.sync(f, 1);
      const value = (z: number) => Math.round((new Vector3(0, 0, z).project(scene.camera).z * 0.5 + 0.5) * (2 ** 24 - 1));
      assert.ok(value(-0.05) - value(0.05) > 1000, 'thin opposite walls retain depth separation despite the oversized shadow plane');
    } finally { scene.destroy(); }
  }
});

test('pins on off-stage visible paths use axial clipping planes rather than ray distance', () => {
  const f = frame(
    { op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 },
    { op: 'add', shape: 'tube', id: 'path', pts: [[3, 0, 0], [3.5, 0, 0]], radius: 0.01 },
  );
  const scene = new PanelScene({ tier: 'low' });
  try {
    scene.sync(f, 1.2, { rect: { x: 100, y: 100, w: 600, h: 500 }, width: 2000, height: 1000 });
    const point = scene.project(f.objects.find(o => o.id === 'path')!.key, undefined, 2000, 1000);
    assert.ok(point?.visible, 'path remains visible beyond the stage rectangle');
    assert.ok(point.x > 700 && point.x < 2000);
  } finally { scene.destroy(); }
});

test('camera-crossing models keep their near plane when an unrelated distant cable is added', () => {
  const actions = [
    { op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 },
    { op: 'zoom', to: 5, dur: 0 },
  ];
  const first = frame(...actions);
  const distant = frame(...actions,
    { op: 'add', shape: 'group', id: 'remote' },
    { op: 'scale', id: 'remote', to: [100, 100, 100], dur: 0 },
    { op: 'add', shape: 'tube', id: 'cable', parent: 'remote', pts: [[0, 0, -90], [0, 0, -100]], radius: 0.01 },
  );
  const scene = new PanelScene({ tier: 'low' });
  try {
    scene.sync(first, 1);
    const position = scene.camera.position.clone(), near = scene.camera.near;
    scene.sync(distant, 1);
    assert.deepEqual(scene.camera.position, position);
    assert.equal(scene.camera.near, near);
    assert.ok(scene.camera.near > 0.0001, 'fallback retains meaningful depth precision');
    contained(scene, distant, 'cable');
  } finally { scene.destroy(); }
});

test('depth comparison sample validates unchanged and survives scale, cut and return states', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(await readFile(new URL('../samples/scenes/camera-depth-range.json', import.meta.url), 'utf8'));
  const checked = validateScene(source);
  assert.deepEqual(checked.issues, []); assert.deepEqual(checked.scene, source); assert.ok(checked.scene);
  for (const tier of tiers) {
    const scene = new PanelScene({ tier });
    try {
      const ranges: number[][] = [];
      for (let step = 0; step < checked.scene.steps.length; step++) {
        const f = frameAt(checked.scene.steps, step, 3);
        scene.sync(f, 1.3);
        for (const id of ['body', 'shell', 'ring']) contained(scene, f, id);
        const range = [scene.camera.near, scene.camera.far];
        ranges.push(range);
        for (let i = 0; i < 5; i++) scene.sync(f, 1.3);
        assert.deepEqual([scene.camera.near, scene.camera.far], range, 'stable states do not drift');
      }
      assert.deepEqual(ranges.at(-1), ranges[0], 'return restores clipping range');
      assert.ok(ranges[1]![1]! > 1500 && ranges[2]![0]! < 0.3);
    } finally { scene.destroy(); }
  }
});
