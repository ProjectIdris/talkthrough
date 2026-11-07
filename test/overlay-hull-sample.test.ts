import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3 } from 'three';
import { validateScene } from '../src/scene/index.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';

const raw = JSON.parse(readFileSync(new URL('../samples/scenes/convex-housing.json', import.meta.url), 'utf8'));

test('the convex housing example validates without changing its authored corner coordinates', () => {
  const result = validateScene(raw);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene, raw);
});

test('the sample mesh has the eight outer corners and is hit by a center ray', () => {
  const result = validateScene(raw);
  assert.ok(result.scene);
  const panel = new PanelScene();
  try {
    const frame = frameAt(result.scene.steps, 1, 99);
    const hull = frame.objects.find((object) => object.id === 'housing');
    assert.ok(hull);
    panel.sync(frame, 1);
    const node = panel.nodeOf(hull.key);
    assert.ok(node instanceof Mesh);
    const positions = node.geometry.getAttribute('position');
    const vertices = new Set(Array.from({ length: positions.count }, (_, i) => [positions.getX(i), positions.getY(i), positions.getZ(i)].join(',')));
    const authored = raw.steps[1].actions.find((action: { id?: string }) => action.id === 'housing').pts;
    assert.deepEqual(vertices, new Set(authored.slice(0, 8).map((p: number[]) => p.map(Math.fround).join(','))));
    assert.equal(vertices.has('0,0,0'), false, 'the authored interior point is not a mesh vertex');
    assert.ok(new Raycaster(new Vector3(0, 0, 8), new Vector3(0, 0, -1)).intersectObject(node, false).length > 0, 'a center ray hits the hull mesh');
    assert.ok(panel.camera.position.toArray().every(Number.isFinite));

    const last = frameAt(result.scene.steps, 2, 99);
    panel.sync(last, 1);
    const inner = last.objects.find((object) => object.id === 'inner-point');
    assert.ok(inner && panel.nodeOf(inner.key));
    assert.deepEqual(panel.nodeOf(inner.key)!.getWorldPosition(new Vector3()).toArray(), [0, 0, 0]);
  } finally { panel.destroy(); }
});

test('the sample reveals corner markers, fades the housing, then labels the inner point', () => {
  const result = validateScene(raw);
  assert.ok(result.scene);
  const steps = result.scene.steps;
  const panel = new PanelScene();
  try {
    const corners = (time: number) => frameAt(steps, 1, time).objects.filter((object) => object.id.startsWith('corner-'));
    assert.deepEqual(corners(0.1).map((object) => object.id), []);
    assert.deepEqual(corners(0.3).map((object) => object.id), ['corner-1']);
    assert.equal(corners(1).length, 4);
    const all = frameAt(steps, 1, 2);
    assert.equal(corners(2).length, 8);
    panel.sync(all, 1);
    for (const corner of corners(2)) assert.ok(panel.nodeOf(corner.key), corner.id);

    const before = frameAt(steps, 2, 0.1);
    const middle = frameAt(steps, 2, 0.5);
    const after = frameAt(steps, 2, 2);
    const housing = (frame: typeof before) => frame.objects.find((object) => object.id === 'housing')!;
    assert.ok(housing(before).opacity > housing(middle).opacity);
    assert.ok(housing(middle).opacity > housing(after).opacity);
    assert.ok(Math.abs(housing(after).opacity - 0.32) < 1e-6);
    panel.sync(after, 1);
    const mesh = panel.nodeOf(housing(after).key);
    assert.ok(mesh instanceof Mesh);
    const material = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    assert.ok(Math.abs(material.opacity - 0.32) < 1e-6);

    assert.equal(frameAt(steps, 2, 0.5).objects.some((object) => object.id === 'inner-point'), false);
    assert.ok(frameAt(steps, 2, 0.8).objects.some((object) => object.id === 'inner-point'));
    assert.equal(frameAt(steps, 2, 1).marks.some((mark) => mark.id === 'inner-label'), false);
    const inner = after.objects.find((object) => object.id === 'inner-point');
    const label = after.marks.find((mark) => mark.id === 'inner-label');
    assert.ok(inner && label);
    assert.equal(label.onKey, inner.key);
    assert.equal(label.mark.op, 'pin');
    assert.equal(label.mark.text, 'Interior point: no cavity');
  } finally { panel.destroy(); }
});
