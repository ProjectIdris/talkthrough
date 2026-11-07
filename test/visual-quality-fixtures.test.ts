import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualFixtures, visualViews } from '../scripts/prototypes/visual-quality-fixtures.ts';
import { validateScene } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { Mesh, Raycaster, TorusGeometry, Vector3 } from 'three';
test('visual fixtures exercise distinct current-main geometry families and validate unchanged', () => {
  assert.equal(visualFixtures.length, 3);
  assert.equal(new Set(visualFixtures.map(f => f.id)).size, 3);
  for (const f of visualFixtures) {
    assert.match(f.id, /^[a-z-]+$/);
    assert.ok(f.inspect.length > 20);
    const result = validateScene(f.scene);
    assert.equal(result.ok, true, f.id);
    assert.deepEqual(result.issues, [], f.id);
    assert.deepEqual(result.scene, f.scene, f.id);
    assert.ok(f.scene.steps.every(s => s.say === '' && s.actions.every(a => ['panel', 'add', 'orbit'].includes(a.op))));
  }
  const shapes = visualFixtures.flatMap(f => f.scene.steps.flatMap(s => s.actions.filter(a => a.op === 'add').map(a => a.shape)));
  for (const required of ['box', 'sphere', 'torus', 'extrude', 'lathe', 'tube', 'part']) assert.ok(shapes.includes(required as typeof shapes[number]), required);
});

test('the torus fixture has a non-self-intersecting hole visible from both inspection views', () => {
  const fixture = visualFixtures.find(f => f.id === 'solids')!;
  const panel = new PanelScene({ tier: 'mid' });
  try {
    for (const view of visualViews) {
      const frame = frameAt(fixture.scene.steps, 0, 3);
      Object.assign(frame.camera, view);
      panel.sync(frame, 800 / 600);
      const torus = frame.objects.find(o => o.def.shape === 'torus')!;
      const mesh = panel.nodeOf(torus.key);
      assert.ok(mesh instanceof Mesh && mesh.geometry instanceof TorusGeometry);
      const { radius, tube } = mesh.geometry.parameters;
      assert.ok(radius > tube, 'the torus must have a positive inner radius, not a self-intersecting spindle');
      const centre = mesh.getWorldPosition(new Vector3());
      const origin = panel.camera.getWorldPosition(new Vector3());
      const ray = new Raycaster(origin, centre.clone().sub(origin).normalize());
      assert.equal(ray.intersectObject(mesh, false).length, 0, `${view.id}: the centre must look through the hole`);
    }
  } finally { panel.destroy(); }
});
