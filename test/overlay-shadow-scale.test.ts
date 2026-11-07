import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, DirectionalLight, Mesh, Raycaster, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const WIN = { width: 1920, height: 1080 };
const STAGE = { x: 900, y: 220, w: 700, h: 600 };
const fakeCanvas = (width: number, height: number) => ({ width, height, getContext: () => ({
  createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
}) }) as unknown as HTMLCanvasElement;
function fixture(scale: number, size = [3, 2, 3], tier: 'low' | 'mid' | 'high' = 'mid') {
  const frame = frameAt([{ say: 'Inspect the shadow.', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'add', shape: 'group', id: 'root' },
    { op: 'scale', id: 'root', to: [scale, scale, scale], dur: 0 },
    { op: 'add', shape: 'box', id: 'part', parent: 'root', size, bevel: 0 },
    { op: 'orbit', az: 20, el: 25, dur: 0 },
  ] }] as Step[], 0, 99);
  const scene = new PanelScene({ tier, makeCanvas: fakeCanvas });
  scene.sync(frame, STAGE.w / STAGE.h, { rect: STAGE, ...WIN });
  scene.scene.updateMatrixWorld(true);
  const floor = scene.scene.children.find(o => o instanceof Mesh && !Array.isArray(o.material) && o.material.type === 'ShadowMaterial') as Mesh;
  const blob = scene.scene.children.find(o => o instanceof Mesh && o !== floor) as Mesh;
  const light = scene.scene.children.find(o => o instanceof DirectionalLight) as DirectionalLight;
  return { scene, frame, floor, blob, light };
}
function near(a: number, b: number, message: string) {
  assert.ok(Math.abs(a - b) < 1e-5 * Math.max(1, Math.abs(b)), `${message}: ${a} versus ${b}`);
}

test('the same model at compact and enlarged scales keeps its contact shadow proportional', () => {
  const normal = fixture(1);
  try {
    for (const scale of [0.01, 0.1, 100]) {
      const scaled = fixture(scale);
      try {
        for (const name of ['floor', 'blob'] as const) {
          for (const axis of ['x', 'z'] as const) near(scaled[name].scale[axis] / scale, normal[name].scale[axis], `${name} ${axis} footprint`);
          near(scaled[name].position.y / scale, normal[name].position.y, `${name} height`);
        }
        near(scaled.light.shadow.normalBias / scale, normal.light.shadow.normalBias, 'surface shadow offset');
        const a = scaled.light.shadow.camera, b = normal.light.shadow.camera;
        for (const key of ['left', 'right', 'top', 'bottom', 'near', 'far'] as const) near(a[key] / scale, b[key], `shadow-map ${key}`);
      } finally { scaled.scene.destroy(); }
    }
  } finally { normal.scene.destroy(); }
});

test('a tall thin model receives its entire directional shadow rather than cutting it at a square floor', () => {
  const { scene, frame, floor, light } = fixture(1, [0.2, 20, 0.2]);
  try {
    const body = scene.nodeOf(frame.objects.find(o => o.id === 'part')!.key)!;
    const bounds = new Box3().setFromObject(body);
    const receiver = new Box3().setFromObject(floor);
    const dir = light.target.position.clone().sub(light.position).normalize();
    light.shadow.updateMatrices(light);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new Vector3(x, y, z).addScaledVector(dir, (floor.position.y - y) / dir.y);
      assert.ok(point.x > receiver.min.x && point.x < receiver.max.x && point.z > receiver.min.z && point.z < receiver.max.z,
        `projected caster corner ${point.toArray()} must lie inside the receiver ${receiver.min.toArray()} / ${receiver.max.toArray()}`);
      const clip = point.clone().project(light.shadow.camera);
      assert.ok(Math.max(Math.abs(clip.x), Math.abs(clip.y), Math.abs(clip.z)) < 1, 'the received shadow must also stay inside the light frustum');
    }
  } finally { scene.destroy(); }
});

test('the scissor includes the actual visible shadow planes on every quality tier', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const { scene, floor, blob } = fixture(1, [3, 2, 3], tier);
    try {
      const { drawn } = scene.screenBounds(WIN.width, WIN.height)!;
      for (const mesh of [floor, blob]) {
        if (!mesh.visible) continue;
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const v = new Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).project(scene.camera);
          const x = (v.x + 1) * WIN.width / 2, y = (1 - v.y) * WIN.height / 2;
          if (x < 0 || x > WIN.width || y < 0 || y > WIN.height) continue;
          assert.ok(x >= drawn.x && x <= drawn.x + drawn.w && y >= drawn.y && y <= drawn.y + drawn.h, `${tier}: shadow corner ${x}, ${y} is cut`);
        }
      }
    } finally { scene.destroy(); }
  }
});


test('compact shadows do not expand the render region of an otherwise identical framed model', () => {
  const large = fixture(1), compact = fixture(0.1);
  try {
    const a = large.scene.screenBounds(WIN.width, WIN.height)!;
    const b = compact.scene.screenBounds(WIN.width, WIN.height)!;
    for (const kind of ['model', 'drawn'] as const) for (const key of ['x', 'y', 'w', 'h'] as const) {
      near(a[kind][key], b[kind][key], `${kind} ${key}`);
    }
  } finally { large.scene.destroy(); compact.scene.destroy(); }
});

test('a long thin footprint does not acquire a broad contact halo on its narrow axis', () => {
  for (const size of [[20, 0.2, 0.2], [0.2, 0.2, 20], [20, 0.2, 0.02]]) {
    const { scene, blob } = fixture(1, size);
    try {
      assert.ok(blob.scale.x >= size[0]! && blob.scale.x <= size[0]! * 1.3, 'contact width stays close to the footprint');
      assert.ok(blob.scale.z >= size[2]! && blob.scale.z <= size[2]! * 1.3, 'contact depth stays close to the footprint');
    } finally { scene.destroy(); }
  }
});


test('a distant part cannot bias a local receiver past the part that casts its shadow', () => {
  for (const distance of [0, 40, 100]) {
    const frame = frameAt([{ say: 'A cover shadows its base.', actions: [
      { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
      { op: 'add', shape: 'box', id: 'base', size: [2, 0.2, 2], bevel: 0 },
      { op: 'add', shape: 'box', id: 'cover', size: [1, 0.2, 1], pos: [0, 0.35, 0], bevel: 0 },
      ...(distance ? [{ op: 'add', shape: 'box', id: 'remote', size: [2, 1, 2], pos: [distance, 0, 0], bevel: 0 }] : []),
    ] }] as Step[], 0, 99);
    const scene = new PanelScene();
    try {
      scene.sync(frame, 1);
      scene.scene.updateMatrixWorld(true);
      const light = scene.scene.children.find(o => o instanceof DirectionalLight) as DirectionalLight;
      const base = scene.nodeOf(frame.objects.find(o => o.id === 'base')!.key)!;
      const cover = scene.nodeOf(frame.objects.find(o => o.id === 'cover')!.key)!;
      const box = new Box3().setFromObject(base);
      const query = box.getCenter(new Vector3());
      // The renderer offsets the receiver's world position along its surface
      // normal before looking into the directional shadow map.
      query.y = box.max.y + light.shadow.normalBias;
      const towardLight = light.position.clone().sub(light.target.position).normalize();
      const solids: Mesh[] = [];
      cover.traverse(o => { if (o instanceof Mesh) solids.push(o); });
      const hits = new Raycaster(query, towardLight).intersectObjects(solids, false);
      assert.ok(hits.length > 0, `remote part at ${distance}: shadow lookup must still meet the cover, bias ${light.shadow.normalBias}`);
    } finally { scene.destroy(); }
  }
});
