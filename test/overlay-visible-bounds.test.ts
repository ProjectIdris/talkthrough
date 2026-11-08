import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectionalLight, Mesh } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Action, Step } from '../src/scene/index.ts';

const view = { width: 1400, height: 900, rect: { x: 100, y: 100, w: 600, h: 500 } };
const fakeCanvas = (width: number, height: number) => {
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 50 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, {
    get: (t, k: string) => k in t ? t[k] : () => {}, set: () => true,
  });
  return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
};
const body: Action = { op: 'add', shape: 'box', id: 'body', size: [1, 1, 1], bevel: 0 };
const frame = (...actions: Action[]) => {
  const source = { v: 1, steps: [{ say: 'Inspect.', actions: [
    { op: 'panel', ...view.rect }, { op: 'orbit', az: 0, el: 0, dur: 0 }, ...actions,
  ] }] };
  const checked = validateScene(source); assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
  return frameAt(checked.scene.steps, 0, 99);
};
const hidden: Action[] = [
  { op: 'add', shape: 'group', id: 'hidden' },
  { op: 'style', id: 'hidden', opacity: 0, dur: 0 },
  { op: 'add', shape: 'group', id: 'nested', parent: 'hidden', rot: [15, 20, 5] },
  { op: 'add', shape: 'box', id: 'remote', parent: 'nested', size: [100, 100, 100], pos: [100, 0, 0], bevel: 0 },
  { op: 'add', shape: 'part', part: 'header', id: 'pins', parent: 'hidden', size: [80, 40, 60], pos: [-100, 0, 0] },
];
function snapshot(scene: PanelScene) {
  const light = scene.scene.children.find(o => o instanceof DirectionalLight) as DirectionalLight;
  const shadows = scene.scene.children.filter(o => o instanceof Mesh && !(o.material as { stencilWrite?: boolean }).stencilWrite) as Mesh[];
  return {
    camera: scene.camera.position.toArray(), quaternion: scene.camera.quaternion.toArray(),
    bounds: scene.screenBounds(view.width, view.height), silhouette: scene.silhouette(view.width, view.height),
    shadows: shadows.map(o => ({ position: o.position.toArray(), scale: o.scale.toArray(), visible: o.visible })),
    light: [light.position.toArray(), light.target.position.toArray(), light.shadow.normalBias],
  };
}
for (const tier of ['low', 'mid', 'high'] as const) test(`${tier}: hidden nested models leave visible framing, shadows and label space unchanged`, () => {
  const plain = new PanelScene({ tier, makeCanvas: fakeCanvas }), extra = new PanelScene({ tier, makeCanvas: fakeCanvas });
  try {
    plain.sync(frame(body), 1.2, view); extra.sync(frame(body, ...hidden), 1.2, view);
    assert.deepEqual(snapshot(extra), snapshot(plain));
  } finally { plain.destroy(); extra.destroy(); }
});

test('a visible mesh parent does not smuggle hidden child geometry into drawn or shadow bounds', () => {
  const plain = new PanelScene({ makeCanvas: fakeCanvas }), extra = new PanelScene({ makeCanvas: fakeCanvas });
  try {
    plain.sync(frame(body), 1.2, view);
    extra.sync(frame(body, { op: 'add', shape: 'box', id: 'remote', parent: 'body', size: [100, 100, 100], pos: [100, 0, 0], opacity: 0 }), 1.2, view);
    assert.deepEqual(snapshot(extra), snapshot(plain));
  } finally { plain.destroy(); extra.destroy(); }
});

test('hiding and showing an existing cut assembly removes and restores its caps and bounds', () => {
  const scene = new PanelScene({ makeCanvas: fakeCanvas }), reference = new PanelScene({ makeCanvas: fakeCanvas });
  const steps: Step[] = [
    { say: 'Whole.', actions: [{ op: 'panel', ...view.rect }, body,
      { op: 'add', shape: 'group', id: 'assembly' },
      { op: 'add', shape: 'box', id: 'cut-body', parent: 'assembly', size: [8, 6, 4], pos: [15, 0, 0], bevel: 0 },
      { op: 'cut', id: 'assembly', axis: 'z', to: 0, dur: 0 }] },
    { say: 'Hide.', actions: [{ op: 'style', id: 'assembly', opacity: 0, dur: 0 }] },
    { say: 'Show.', actions: [{ op: 'style', id: 'assembly', opacity: 1, dur: 0 }] },
  ];
  const caps = () => scene.scene.children.filter(o => o instanceof Mesh && (o.material as { stencilWrite?: boolean }).stencilWrite) as Mesh[];
  try {
    scene.sync(frameAt(steps, 0, 99), 1.2, view);
    const original = snapshot(scene); assert.equal(caps().filter(o => o.visible).length, 1);
    const cap = caps()[0]!; let disposed = 0; (cap.material as import('three').Material).addEventListener('dispose', () => disposed++);
    scene.sync(frameAt(steps, 1, 99), 1.2, view);
    assert.equal(caps().filter(o => o.visible).length, 0, 'detached cap must follow ancestor visibility');
    const bare = frameAt([{ say: 'Body only.', actions: [{ op: 'panel', ...view.rect }, body] }], 0, 99);
    reference.sync(bare, 1.2, view);
    assert.deepEqual(snapshot(scene), snapshot(reference));
    scene.sync(frameAt(steps, 2, 99), 1.2, view); assert.equal(caps()[0], cap); assert.deepEqual(snapshot(scene), original);
    scene.destroy(); assert.equal(disposed, 1);
  } finally { scene.destroy(); reference.destroy(); }
});

test('only hidden text does not reserve a scissor rectangle or push visible text away', () => {
  const plain = new PanelScene({ makeCanvas: fakeCanvas }), extra = new PanelScene({ makeCanvas: fakeCanvas });
  const text: Action = { op: 'add', shape: 'text', id: 'label', text: 'Visible', pos: [0, 0.5, 0], height: 0.4, color: 'white' };
  try {
    const f = frame(body, text), g = frame(body, ...hidden, text, { op: 'add', shape: 'text', id: 'ghost', parent: 'hidden', text: 'Hidden distant annotation', pos: [80, 50, 0], height: 0.4, color: 'white' });
    plain.sync(f, 1.2, view); extra.sync(g, 1.2, view);
    assert.deepEqual(extra.screenBounds(view.width, view.height), plain.screenBounds(view.width, view.height));
  } finally { plain.destroy(); extra.destroy(); }
});

test('an entirely hidden model has no visible bounds, shadow or cut cap', () => {
  const scene = new PanelScene({ makeCanvas: fakeCanvas });
  try {
    scene.sync(frame(...hidden, { op: 'cut', id: 'hidden', axis: 'z', to: 0, dur: 0 }), 1.2, view);
    assert.equal(scene.screenBounds(view.width, view.height), undefined);
    assert.deepEqual(scene.silhouette(view.width, view.height), []);
    for (const o of scene.scene.children) if (o instanceof Mesh) assert.equal(o.visible, false);
    assert.ok(scene.camera.position.toArray().every(Number.isFinite));
  } finally { scene.destroy(); }
});

test('a hidden owner cannot leave detached cut caps in an otherwise visible scene', () => {
  const scene = new PanelScene();
  try {
    scene.sync(frame(body, ...hidden, { op: 'cut', id: 'hidden', axis: 'z', to: 0, dur: 0 }), 1.2, view);
    const caps = scene.scene.children.filter(o => o instanceof Mesh && (o.material as { stencilWrite?: boolean }).stencilWrite);
    assert.ok(caps.length > 0, 'fixture actually constructs cap helpers');
    assert.ok(caps.every(o => !o.visible), 'every detached cap obeys its hidden owner');
  } finally { scene.destroy(); }
});

test('the user cut plane depends only on visible contents, including children of mesh parents', () => {
  const plain = new PanelScene(), extra = new PanelScene();
  const visibleChild: Action = { op: 'add', shape: 'box', id: 'child', parent: 'body', size: [0.5, 0.5, 0.5], pos: [0, 0, 2], bevel: 0 };
  try {
    const f = frame(body, visibleChild), g = frame(body, visibleChild, ...hidden);
    plain.sync({ ...f, userCut: 0.5 }, 1.2, view); extra.sync({ ...g, userCut: 0.5 }, 1.2, view);
    for (const id of ['body', 'child']) {
      const a = plain.nodeOf(f.objects.find(o => o.id === id)!.key) as Mesh;
      const b = extra.nodeOf(g.objects.find(o => o.id === id)!.key) as Mesh;
      const planes = (m: Mesh) => (m.material as import('three').Material).clippingPlanes;
      assert.deepEqual(planes(a), planes(b));
      assert.ok(planes(a)?.length);
    }
    assert.deepEqual(snapshot(extra), snapshot(plain));
  } finally { plain.destroy(); extra.destroy(); }
});

test('the visibility comparison sample validates and preserves its visible model when hidden detail arrives', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(await readFile(new URL('../samples/scenes/visible-model-bounds.json', import.meta.url), 'utf8'));
  const checked = validateScene(source); assert.deepEqual(checked.issues, []); assert.deepEqual(checked.scene, source);
  const scene = new PanelScene({ makeCanvas: fakeCanvas });
  try {
    scene.sync(frameAt(checked.scene!.steps, 0, 99), 1.2, view); const initial = snapshot(scene);
    scene.sync(frameAt(checked.scene!.steps, 1, 99), 1.2, view); assert.deepEqual(snapshot(scene), initial);
    scene.sync(frameAt(checked.scene!.steps, 2, 99), 1.2, view); assert.notDeepEqual(snapshot(scene).camera, initial.camera);
    scene.sync(frameAt(checked.scene!.steps, 3, 99), 1.2, view); assert.deepEqual(snapshot(scene), initial);
  } finally { scene.destroy(); }
});
