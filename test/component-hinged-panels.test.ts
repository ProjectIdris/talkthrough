import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { hingedPanels } from '../scripts/components/hinged-panels.ts';
import { createSceneState, ID_PATTERN, LIMITS, validateScene } from '../src/scene/index.ts';
import type { AddAction, Scene } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

const sceneOf = (actions: AddAction[]): Scene => ({ steps: [{ say: 'Hinged panels', actions: [
  { op: 'panel', x: 100, y: 100, w: 800, h: 800 }, { op: 'orbit', az: 25, el: 15 }, ...actions,
] }] });
const rendered = (scene: Scene) => {
  const frame = frameAt(scene.steps, scene.steps.length - 1, 99);
  const panel = new PanelScene({ tier: 'high' });
  panel.sync(frame, 1);
  const node = (id: string) => panel.nodeOf(frame.objects.find((o) => o.id === id)!.key)!;
  panel.scene.updateMatrixWorld(true);
  return { frame, panel, node };
};

test('a hinge expands within one step and passes the real validator unchanged', () => {
  for (const width of [0.8, 2.4, 6]) for (const height of [2, 5, 12]) for (const knuckles of [3, 4, 5, 6, 7]) for (const fold of [0, 90, 180]) {
    const part = hingedPanels({ id: 'hinge', width, height, knuckles, fold });
    const raw = sceneOf(part.actions);
    const result = validateScene(raw);
    assert.deepEqual(result.issues, [], `${width}/${height}/${knuckles}/${fold}`);
    assert.deepEqual(result.scene, raw);
    assert.ok(raw.steps[0]!.actions.length <= LIMITS.maxActionsPerStep);
    assert.equal(part.ids.knuckles.length, knuckles);
    assert.equal(new Set(part.actions.map((a) => a.id)).size, part.actions.length);
    assert.ok(part.actions.every((a) => ID_PATTERN.test(a.id)));
  }
});

test('invalid controls and ambiguous prefixes are refused instead of silently clamped', () => {
  for (const bad of [null, undefined, [], 4, 'hinge', {}, { id: '' }, { id: 'all' }, { id: 'panel' }, { id: 'a'.repeat(21) }, { id: 'two words' },
    { id: 'h', width: 0.79 }, { id: 'h', width: 6.01 }, { id: 'h', height: 1.99 }, { id: 'h', height: 12.01 },
    { id: 'h', knuckles: 2 }, { id: 'h', knuckles: 8 }, { id: 'h', knuckles: 3.5 }, { id: 'h', fold: -1 }, { id: 'h', fold: 181 },
    { id: 'h', width: NaN }, { id: 'h', height: Infinity }, { id: 'h', knuckles: '5' }, { id: 'h', fold: null }, { id: 'h', widht: 4 },
  ]) assert.throws(() => hingedPanels(bad as never), JSON.stringify(bad));
  let read = false;
  assert.throws(() => hingedPanels({ id: 'h', get width() { read = true; return 3; } }));
  assert.equal(read, false, 'reject option accessors without executing them');
});

test('separate expansions keep stable role IDs without sharing mutable values', () => {
  const first = hingedPanels({ id: 'first' });
  const pristine = JSON.parse(JSON.stringify(first));
  const second = hingedPanels({ id: 'second' });
  const repeated = hingedPanels({ id: 'first' });
  assert.deepEqual(first, repeated);
  first.ids.knuckles[0] = 'changed';
  const leaf = first.actions.find((a) => a.id === first.ids.fixedLeaf)!;
  if (leaf.shape === 'extrude') leaf.outline[0]![0] = 999;
  assert.deepEqual(repeated, pristine);
  assert.ok(second.actions.every((a) => a.id.startsWith('second')));
  const together: Scene = { steps: [{ say: 'First', actions: repeated.actions }, { say: 'Second', actions: second.actions }] };
  assert.deepEqual(validateScene(together).issues, []);
});

test('every child remains addressable in a real follow-up, and clearing the root removes them', () => {
  const part = hingedPanels({ id: 'door', knuckles: 7 });
  const state = createSceneState();
  assert.deepEqual(validateScene(sceneOf(part.actions), state).issues, []);
  const followup = { steps: [{ say: 'Fold and inspect', actions: [
    { op: 'turn', id: part.ids.moving, to: [0, 135, 0], dur: 1 },
    { op: 'move', id: part.ids.pin, to: [0, 4, 0], dur: 1 },
    { op: 'highlight', id: part.ids.knuckles[0], color: 'yellow' },
    { op: 'pin', id: 'hinge_label', on: part.ids.movingLeaf, text: 'Moving leaf' },
  ] }] };
  assert.deepEqual(validateScene(followup, state).issues, []);
  const cleared = validateScene({ steps: [{ say: 'Clear assembly', actions: [{ op: 'clear', target: part.ids.root }] }] }, state);
  assert.deepEqual(cleared.issues, []);
  for (const action of part.actions) {
    const missing = validateScene({ steps: [{ say: 'Gone', actions: [{ op: 'highlight', id: action.id }] }] }, state);
    assert.ok(missing.issues.some((i) => i.message.includes('unknown id')), action.id);
  }
});

test('a 90-degree fold carries only the moving leaf around the pin axis', () => {
  const part = hingedPanels({ id: 'h', width: 2, height: 5, fold: 0 });
  const flat = rendered(sceneOf(part.actions));
  const moved = rendered({ steps: [...sceneOf(part.actions).steps, { say: 'Fold', actions: [{ op: 'turn', id: part.ids.moving, to: [0, 90, 0], dur: 0 }] }] });
  const pos = (r: ReturnType<typeof rendered>, id: string) => r.node(id).getWorldPosition(new Vector3());
  const before = pos(flat, part.ids.movingLeaf), after = pos(moved, part.ids.movingLeaf);
  assert.ok(Math.abs(after.x - before.z) < 1e-6 && Math.abs(after.z + before.x) < 1e-6);
  for (const id of [part.ids.fixedLeaf, part.ids.pin, part.ids.pinHead, part.ids.pinTip]) assert.ok(pos(flat, id).distanceTo(pos(moved, id)) < 1e-6, id);
  for (const id of part.ids.knuckles) assert.ok(pos(flat, id).distanceTo(pos(moved, id)) < 1e-6, 'knuckle centres remain on the pin axis');
  flat.panel.destroy(); moved.panel.destroy();
});

test('the real knuckle mesh has an open bore and closed annular ends', () => {
  const part = hingedPanels({ id: 'h', width: 2, height: 5 });
  const r = rendered(sceneOf(part.actions));
  const ring = r.node(part.ids.knuckles[0]!);
  const meshes: Mesh[] = [];
  ring.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
  const bounds = new Box3().setFromObject(ring);
  const y = bounds.max.y + 1;
  const throughBore = new Raycaster(new Vector3(0, y, 0), new Vector3(0, -1, 0));
  assert.equal(throughBore.intersectObjects(meshes, false).length, 0);
  const throughWall = new Raycaster(new Vector3(bounds.max.x * 0.82, y, 0), new Vector3(0, -1, 0));
  assert.ok(throughWall.intersectObjects(meshes, false).length > 0, 'the annular top is real geometry');
  const fromBore = new Raycaster(new Vector3(0, bounds.getCenter(new Vector3()).y, 0), new Vector3(1, 0, 0));
  assert.ok(fromBore.intersectObjects(meshes, false).length > 0, 'the inner wall faces the bore');
  r.panel.destroy();
});

test('pin end caps travel with the pin and a removed pin exposes the independent knuckles', () => {
  const part = hingedPanels({ id: 'h' });
  const base = sceneOf(part.actions);
  const moved = rendered({ steps: [...base.steps, { say: 'Withdraw pin', actions: [{ op: 'move', id: part.ids.pin, to: [0, 7, 0], dur: 0 }] }] });
  assert.ok(moved.node(part.ids.pinHead).getWorldPosition(new Vector3()).y > 9);
  assert.ok(moved.node(part.ids.pinTip).getWorldPosition(new Vector3()).y > 4);
  const removed = frameAt([...base.steps, { say: 'Remove pin', actions: [{ op: 'clear', target: part.ids.pin }] }], 1, 99);
  assert.ok(!removed.objects.some((o) => [part.ids.pin, part.ids.pinHead, part.ids.pinTip].includes(o.id)));
  assert.ok(part.ids.knuckles.every((id) => removed.objects.some((o) => o.id === id)));
  moved.panel.destroy();
});

test('boundary assemblies make finite nonempty meshes and stay compact', () => {
  for (const width of [0.8, 6]) for (const height of [2, 12]) for (const fold of [0, 180]) {
    const part = hingedPanels({ id: 'limits', width, height, fold, knuckles: 7 });
    const r = rendered(sceneOf(part.actions));
    let triangles = 0;
    for (const action of part.actions) {
      r.node(action.id).traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const p = o.geometry.getAttribute('position');
        assert.ok(Array.from(p.array).every(Number.isFinite));
      });
    }
    r.node(part.ids.root).traverse((o) => { if (o instanceof Mesh) triangles += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; });
    assert.ok(triangles > 0 && triangles < 40_000, `triangles ${triangles}`);
    const bounds = new Box3().setFromObject(r.node(part.ids.root));
    assert.ok(!bounds.isEmpty());
    assert.ok(bounds.max.y - bounds.min.y < height + 1);
    assert.ok(bounds.max.x - bounds.min.x < width * 2 + 2);
    r.panel.destroy();
  }
});

test('committed examples reproduce exactly and pass the real validator', async () => {
  const { hingeExamples } = await import('../scripts/components/hinged-panels-examples.ts');
  const { readFileSync } = await import('node:fs');
  const examples = hingeExamples();
  assert.equal(Object.keys(examples).length, 4);
  for (const [name, scene] of Object.entries(examples)) {
    assert.deepEqual(validateScene(scene).issues, [], name);
    assert.deepEqual(JSON.parse(readFileSync(new URL(`../samples/components/${name}.json`, import.meta.url), 'utf8')), scene, name);
  }
});


test('intermediate folds keep the two leaf volumes separate', () => {
  for (const width of [0.8, 3.2, 6]) for (const height of [2, 4.6, 12]) for (const fold of [0, 60, 90, 105, 110, 120, 135, 160, 180]) {
    const part = hingedPanels({ id: 'h', width, height, knuckles: 7, fold });
    const r = rendered(sceneOf(part.actions));
    try {
      const volume = (id: string): OBB => {
        const mesh = r.node(id) as Mesh;
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox!;
        const obb = new OBB(bounds.getCenter(new Vector3()), bounds.getSize(new Vector3()).multiplyScalar(0.5));
        return obb.applyMatrix4(r.node(id).matrixWorld);
      };
      assert.equal(volume(part.ids.fixedLeaf).intersectsOBB(volume(part.ids.movingLeaf)), false, `intersecting leaves at width ${width}, height ${height}, fold ${fold}`);
    } finally { r.panel.destroy(); }
  }
});

test('CPU preview export preserves each actual mesh identity and source hash', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const temp = mkdtempSync(join(tmpdir(), 'hinge-preview-'));
  try {
    const input = 'samples/components/hinged-panels-door.json', output = join(temp, 'meshes.json');
    const run = spawnSync(process.execPath, ['scripts/components/hinged-panels-preview.ts', input, output], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const exported = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(exported.meshes.map((m: { id: string }) => m.id).sort(), [
      'door_fixed_leaf', 'door_moving_leaf', 'door_pin', 'door_pin_head', 'door_pin_tip',
      'door_knuckle1', 'door_knuckle2', 'door_knuckle3', 'door_knuckle4', 'door_knuckle5',
      'door_neck1', 'door_neck2', 'door_neck3', 'door_neck4', 'door_neck5',
    ].sort());
    assert.equal(exported.sourceSha256, createHash('sha256').update(readFileSync(input)).digest('hex'));
    assert.ok(exported.meshes.every((m: { vertices: unknown[]; normals: unknown[]; faces: unknown[] }) => m.vertices.length > 0 && m.vertices.length === m.normals.length && m.faces.length > 0));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('finished leaves have rounded silhouettes and readable thickness in actual geometry', () => {
  const part = hingedPanels({ id: 'finish', width: 2.4, height: 6, fold: 0 });
  const leaf = part.actions.find((a) => a.id === part.ids.fixedLeaf)!;
  assert.equal(leaf.shape, 'extrude', 'round the leaf outline independently of its thin edge bevel');
  if (leaf.shape !== 'extrude') throw new Error('expected an extruded plate');
  assert.ok(leaf.outline.length >= 16 && leaf.outline.length <= LIMITS.maxOutline);
  assert.ok(leaf.depth >= 0.17, 'plate edge is not a razor-thin visual line');
  const r = rendered(sceneOf(part.actions));
  try {
    const mesh = r.node(part.ids.fixedLeaf) as Mesh;
    const box = new Box3().setFromObject(mesh);
    const corner = new Raycaster(new Vector3(box.max.x - 0.025, box.max.y - 0.025, box.max.z + 1), new Vector3(0, 0, -1));
    assert.equal(corner.intersectObject(mesh, false).length, 0, 'rounded silhouette removes the square corner');
    const face = new Raycaster(new Vector3(box.getCenter(new Vector3()).x, 0, box.max.z + 1), new Vector3(0, 0, -1));
    assert.ok(face.intersectObject(mesh, false).length > 0, 'the plate face is real and closed');
  } finally { r.panel.destroy(); }
});

test('machined profiles close up seams without losing independent necks, caps or bores', () => {
  const part = hingedPanels({ id: 'finish' });
  for (const id of part.ids.necks) assert.equal(part.actions.find((a) => a.id === id)!.shape, 'extrude', 'neck shoulders are tapered, not a block stuck to the leaf');
  for (const id of [part.ids.pinHead, part.ids.pinTip]) {
    const cap = part.actions.find((a) => a.id === id)!;
    assert.equal(cap.shape, 'lathe');
    if (cap.shape !== 'lathe') throw new Error('expected a turned cap');
    assert.ok(cap.profile.length >= 10, 'turn the shoulder and crown rather than using a plain cylinder');
    assert.equal(cap.parent, part.ids.pin);
  }
  const r = rendered(sceneOf(part.actions));
  try {
    const boxes = part.ids.knuckles.map((id) => new Box3().setFromObject(r.node(id)));
    const gap = boxes[1]!.min.y - boxes[0]!.max.y;
    assert.ok(gap > 0 && gap < 0.08, `separated but tightly fitted knuckles: ${gap}`);
  } finally { r.panel.destroy(); }
});

test('finished assemblies keep their full bore clear across boundary controls and quality tiers', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const width of [0.8, 6]) for (const height of [2, 12]) for (const knuckles of [3, 7]) for (const fold of [0, 90, 180]) {
    const part = hingedPanels({ id: 'clearance', width, height, knuckles, fold });
    const raw = sceneOf(part.actions.filter((a) => ![part.ids.pin, part.ids.pinHead, part.ids.pinTip].includes(a.id)));
    const frame = frameAt(raw.steps, 0, 99), panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1); panel.scene.updateMatrixWorld(true);
      const meshes: Mesh[] = [];
      panel.nodeOf(frame.objects.find((o) => o.id === part.ids.root)!.key)!.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
      const radius = Math.min(width * 0.12, height / (knuckles * 4));
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        const ray = new Raycaster(new Vector3(radius * 0.60 * Math.cos(angle), height, radius * 0.60 * Math.sin(angle)), new Vector3(0, -1, 0));
        assert.equal(ray.intersectObjects(meshes, false).length, 0, `${tier}/${width}/${height}/${knuckles}/${fold}/${i}`);
      }
    } finally { panel.destroy(); }
  }
});
