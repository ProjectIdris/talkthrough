import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareVisualFrame } from '../scripts/prototypes/visual-quality-sequence.ts';
import { visualFixtures, visualViews } from '../scripts/prototypes/visual-quality-fixtures.ts';
import type { Scene } from '../src/scene/types.ts';
test('a fully acknowledged empty scene separates reused renderer keys before fixture capture', async () => {
  const calls: Scene[] = [];
  let acknowledgeReset!: () => void;
  const reset = new Promise<void>(done => { acknowledgeReset = done; });
  const expected = { seekClock: 1, camera: { az: 0, el: 10, zoom: 1 }, worldCamera: null };
  const pending = prepareVisualFrame(visualFixtures[0]!.scene, visualViews[0], async scene => { calls.push(scene); if (calls.length === 1) await reset; return expected; });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { steps: [{ say: '', actions: [] }] });
  acknowledgeReset();
  assert.deepEqual(await pending, expected);
  assert.deepEqual(calls.slice(1), [visualFixtures[0]!.scene, visualFixtures[0]!.scene]);
});

import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { Mesh } from 'three';
test('capture sequence rebuilds actual geometry when unrelated fixtures reuse numeric object keys', async () => {
  const panel = new PanelScene({ tier: 'mid' });
  const seek = async (scene: Scene) => { panel.sync(frameAt(scene.steps, 0, 3), 1); return undefined; };
  try {
    await prepareVisualFrame(visualFixtures[0]!.scene, visualViews[0], seek);
    const solids = frameAt(visualFixtures[0]!.scene.steps, 0, 3);
    const original = panel.nodeOf(solids.objects[0]!.key) as Mesh;
    assert.equal(original.geometry.type, 'RoundedBoxGeometry');
    await prepareVisualFrame(visualFixtures[1]!.scene, visualViews[0], seek);
    const profiles = frameAt(visualFixtures[1]!.scene.steps, 0, 3);
    const replacement = panel.nodeOf(profiles.objects[0]!.key) as Mesh;
    assert.equal(replacement.geometry.type, 'ExtrudeGeometry');
    assert.notEqual(replacement, original);
  } finally { panel.destroy(); }
});

import { cameraMatchesView } from '../scripts/prototypes/visual-quality-sequence.ts';
test('camera evidence must be finite and match the requested view', () => {
  const view = visualViews[1];
  const metadata = { seekClock: 1, camera: { az: view.az, el: view.el, zoom: view.zoom }, worldCamera: null };
  assert.equal(cameraMatchesView(metadata, view), true);
  assert.equal(cameraMatchesView(undefined, view), false);
  assert.equal(cameraMatchesView({ ...metadata, camera: null }, view), false);
  assert.equal(cameraMatchesView({ ...metadata, camera: { ...metadata.camera, az: 0 } }, view), false);
  assert.equal(cameraMatchesView({ ...metadata, camera: { ...metadata.camera, el: NaN } }, view), false);
});
