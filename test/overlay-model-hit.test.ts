import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, TorusGeometry, Vector3 } from 'three';
import { hitVisibleModel } from '../src/overlay/model-hit.ts';

test('model hit uses drawn geometry rather than the empty middle of its bounds', () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 5; camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const torus = new Mesh(new TorusGeometry(1, 0.18, 12, 48), new MeshBasicMaterial());
  torus.updateMatrixWorld(true);
  const projected = new Vector3(1, 0, 0).project(camera);
  const x = (projected.x + 1) * 500;
  assert.equal(hitVisibleModel([torus], camera, 1000, 1000, x, 500), true);
  assert.equal(hitVisibleModel([torus], camera, 1000, 1000, 500, 500), false, 'empty hole is background');
  torus.visible = false;
  assert.equal(hitVisibleModel([torus], camera, 1000, 1000, x, 500), false);
});
