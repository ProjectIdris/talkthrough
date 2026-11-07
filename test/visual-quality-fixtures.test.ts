import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualFixtures } from '../scripts/prototypes/visual-quality-fixtures.ts';
import { validateScene } from '../src/scene/index.ts';
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
