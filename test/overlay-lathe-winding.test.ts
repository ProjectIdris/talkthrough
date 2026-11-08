import test from 'node:test';
import assert from 'node:assert/strict';
import { LatheGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3 } from 'three';
import { latheGeometry } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import { readFileSync } from 'node:fs';
import type { Vec2, Action, Scene } from '../src/scene/types.ts';

const profiles: Vec2[][] = [
  [[0, -1], [0.7, -1], [1, -0.6], [0.9, 0.5], [0.5, 1], [0, 1]],
  [[0.6, -1], [1, -1], [1, 1], [0.6, 1], [0.6, -1]],
];
function hit(profile: Vec2[], sides: number, origin: [number, number, number], direction: [number, number, number]) {
  const geometry = latheGeometry(profile, sides), material = new MeshBasicMaterial();
  try {
    const mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    return new Raycaster(new Vector3(...origin), new Vector3(...direction)).intersectObject(mesh);
  } finally { geometry.dispose(); material.dispose(); }
}

test('closed full lathes expose their near outside wall in either profile direction', () => {
  for (const sides of [3, 8, 20, 36, 64]) for (const profile of profiles) {
    for (const p of [profile, [...profile].reverse()]) {
      const front = hit(p, sides, [0, 0, 3], [0, 0, -1]);
      assert.ok(front.length > 0 && front[0]!.point.z > 0.8, `near outside wall missing at ${sides} sides, start ${p[0]}`);
      assert.ok(front[0]!.face!.normal.z > 0, 'front wall faces the viewer');
    }
  }
});

test('a closed ring faces into its real central opening in either direction', () => {
  for (const sides of [3, 8, 20, 36, 64]) for (const p of [profiles[1]!, [...profiles[1]!].reverse()]) {
    const inner = hit(p, sides, [0, 0, 0], [0, 0, 1]);
    assert.ok(inner.length > 0 && Math.abs(inner[0]!.point.z - 0.6) < 1e-6, 'ray inside the cavity meets the near inner wall');
    assert.ok(inner[0]!.face!.normal.z < 0, 'inner wall faces the cavity');
    assert.equal(hit(p, sides, [0, 3, 0], [0, -1, 0]).length, 0, 'the centre remains a real through-hole');
  }
});

test('closed profile reversal preserves the solid buffers and does not mutate authored points', () => {
  for (const sides of [3, 8, 20, 36, 64]) for (const profile of profiles) {
    const variants: Vec2[][] = [profile, profile.map(([r, y]) => [-r, y]), [profile[0]!, ...profile, profile.at(-1)!]];
    for (const authored of variants) for (const scale of [1e-6, 0.001, 1, 10]) {
      const forward = authored.map(([r, y]) => [r * scale, y * scale + 40] as Vec2);
      const backward = [...forward].reverse(), snapshot = structuredClone(backward);
      const a = latheGeometry(forward, sides), b = latheGeometry(backward, sides);
      for (const attr of ['position', 'normal', 'uv']) assert.deepEqual(b.getAttribute(attr).array, a.getAttribute(attr).array, `${attr}, sides ${sides}, scale ${scale}`);
      assert.deepEqual(backward, snapshot, 'normalization leaves scene data unchanged');
      a.dispose(); b.dispose();
    }
  }
});

test('closed lathes keep both sharp caps facing out with either profile direction', () => {
  const profile: Vec2[] = [[0, -1], [1, -1], [1, 1], [0, 1]];
  for (const p of [profile, [...profile].reverse()]) for (const sign of [-1, 1]) {
    const cap = hit(p, 36, [0.3, sign * 3, 0.2], [0, -sign, 0]);
    assert.ok(cap.length > 0);
    assert.ok(Math.abs(cap[0]!.point.y - sign) < 1e-6, 'near cap is visible');
    assert.ok(Math.abs(cap[0]!.face!.normal.y - sign) < 1e-6, 'cap points away from enclosed volume');
  }
});

test('open sheets retain their authored visible side rather than inventing a volume', () => {
  const forward: Vec2[] = [[1, -1], [1, 1]], backward = [...forward].reverse();
  assert.ok(hit(forward, 36, [0, 0, 3], [0, 0, -1])[0]!.point.z > 0);
  assert.ok(hit(backward, 36, [0, 0, 3], [0, 0, -1])[0]!.point.z < 0);
});


test('zero-area profiles and already outward closed profiles retain their original positions and UVs', () => {
  for (const p of [...profiles, [[0, 1], [0, 0], [0, -1]], [[1, 1], [1, -1], [1, 1]]] as Vec2[][]) {
    const a = latheGeometry(p, 36), b = new LatheGeometry(p.map(([r, y]) => new Vector2(r, y)), 36).toNonIndexed();
    for (const attr of ['position', 'uv']) assert.deepEqual(a.getAttribute(attr).array, b.getAttribute(attr).array);
    a.dispose(); b.dispose();
  }
});

test('reversed closed lathes retain outward hits through parents, arrays and replacement at every tier', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    const actions: Action[] = [
      { op: 'add', shape: 'group', id: 'rig', pos: [2, 1, -3], rot: [20, 30, 10] },
      { op: 'scale', id: 'rig', to: [1.5, 0.7, 0.5], dur: 0 },
      { op: 'add', shape: 'lathe', id: 'part', parent: 'rig', profile: [...profiles[0]!].reverse() },
      { op: 'add', shape: 'array', id: 'copies', of: 'part', count: 3, step: [3, 0, 0] },
    ];
    const frame = frameAt([{ say: '', actions }], 0, 99);
    panel.sync(frame, 1.4);
    panel.scene.updateMatrixWorld(true);
    const original = panel.nodeOf(frame.objects.find(o => o.id === 'part')!.key) as Mesh;
    let disposed = 0;
    original.geometry.addEventListener('dispose', () => disposed++);
    for (const def of frame.objects.filter(o => o.shape === 'lathe')) {
      const mesh = panel.nodeOf(def.key) as Mesh;
      const origin = mesh.localToWorld(new Vector3(0.13, 0, 3));
      const target = mesh.localToWorld(new Vector3(0.13, 0, 0));
      const hits = new Raycaster(origin, target.sub(origin).normalize()).intersectObject(mesh, false);
      assert.ok(hits.length > 0);
      assert.ok(mesh.worldToLocal(hits[0]!.point.clone()).z > 0.8, `${tier}: transformed near face is present`);
    }
    panel.sync(frame, 1.4);
    assert.equal(disposed, 0);
    panel.sync(frameAt([{ say: '', actions: [...actions, { op: 'add', shape: 'lathe', id: 'part', profile: profiles[1]! }] }], 0, 99), 1.4);
    assert.equal(disposed, 1);
    panel.destroy();
    assert.equal(disposed, 1);
  }
});

test('paired winding sample validates unchanged and draws each quality tier', () => {
  const input: Scene = JSON.parse(readFileSync(new URL('../samples/scenes/lathe-winding.json', import.meta.url), 'utf8'));
  const checked = validateScene(input);
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  assert.deepEqual(checked.scene, input);
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    for (let step = 0; step < input.steps.length; step++) panel.sync(frameAt(input.steps, step, 99), 1.4);
    panel.destroy();
  }
});
