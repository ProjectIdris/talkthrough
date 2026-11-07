import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3 } from 'three';
import type { Object3D } from 'three';
import { validateScene } from '../src/scene/index.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';

const raw = JSON.parse(readFileSync(new URL('../samples/scenes/perforated-plate.json', import.meta.url), 'utf8'));
const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((object) => { if (object instanceof Mesh) out.push(object); });
  return out;
};

test('the perforated plate example validates without losing its openings or changing its data', () => {
  const result = validateScene(raw);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene, raw);
});

test('the sample builds actual open holes and its slider travels from behind the plate to the front', () => {
  const result = validateScene(raw);
  assert.ok(result.scene);
  const panel = new PanelScene();
  try {
    const first = frameAt(result.scene.steps, 0, 99);
    panel.sync(first, 1);
    const plateFrame = first.objects.find((object) => object.id === 'plate');
    assert.ok(plateFrame);
    const plate = panel.nodeOf(plateFrame.key);
    assert.ok(plate);
    const plateMeshes = meshes(plate);
    assert.equal(plateMeshes.length, 1, 'one plate mesh rather than a collection of bars');
    const hits = (x: number, y: number) => {
      const origin = new Vector3(x, y, 5).applyMatrix4(plate.matrixWorld);
      const direction = new Vector3(0, 0, -1).transformDirection(plate.matrixWorld);
      return new Raycaster(origin, direction).intersectObjects(plateMeshes, false);
    };
    for (const x of [0, -2.1, 2.1]) assert.equal(hits(x, 0).length, 0, `opening at x=${x}`);
    assert.ok(hits(1.4, 0).length > 0, 'the web between openings stays solid');

    for (const [time, expectedZ] of [[0.5, -1.7], [4, 1.5]] as const) {
      const frame = frameAt(result.scene.steps, 2, time);
      panel.sync(frame, 1);
      const sliderFrame = frame.objects.find((object) => object.id === 'slider');
      assert.ok(sliderFrame);
      const slider = panel.nodeOf(sliderFrame.key);
      assert.ok(slider);
      assert.ok(Math.abs(slider.getWorldPosition(new Vector3()).z - expectedZ) < 1e-6);
      const mesh = meshes(slider)[0];
      assert.ok(mesh);
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      assert.ok(bounds.min.x > -0.9 && bounds.max.x < 0.9);
      assert.ok(bounds.min.y > -0.65 && bounds.max.y < 0.65, 'the slider fits the central opening');
    }
  } finally { panel.destroy(); }
});
