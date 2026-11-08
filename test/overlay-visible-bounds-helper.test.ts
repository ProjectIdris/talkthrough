import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Sprite } from 'three';
import { visibleBounds } from '../src/overlay/visible-bounds.ts';

test('visible bounds preserve mesh children, instances and sprites under nested transforms', () => {
  const root = new Group();
  root.position.set(11, 12, 13);
  root.scale.set(2, 3, 4);
  root.rotation.set(0.1, 0.2, 0.3);
  const parent = new Mesh(new BoxGeometry(1, 2, 3));
  root.add(parent);
  parent.rotation.set(0.2, 0.4, 0.6);
  const child = new Mesh(new BoxGeometry(3, 4, 5));
  child.position.set(100, 7, 8);
  parent.add(child);
  const instances = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  instances.setMatrixAt(0, new Matrix4().makeTranslation(-70, 3, 4));
  instances.setMatrixAt(1, new Matrix4().makeTranslation(45, 6, 8));
  child.add(instances);
  const sprite = new Sprite();
  sprite.position.set(10, 20, 30);
  root.add(sprite);
  try {
    root.updateMatrixWorld(true);
    const expected = new Box3().setFromObject(root);
    assert.deepEqual(visibleBounds(root, new Box3()), expected);
    child.visible = false;
    const hidden = visibleBounds(root, new Box3());
    parent.remove(child);
    root.updateMatrixWorld(true);
    assert.deepEqual(hidden, new Box3().setFromObject(root));
    parent.add(child);
    child.visible = true;
    assert.deepEqual(visibleBounds(root, new Box3()), expected);
    root.visible = false;
    assert.equal(visibleBounds(child, new Box3()).isEmpty(), true);
  } finally {
    parent.geometry.dispose();
    child.geometry.dispose();
    instances.geometry.dispose();
    (parent.material as MeshBasicMaterial).dispose();
    (child.material as MeshBasicMaterial).dispose();
    instances.material.dispose();
    instances.dispose();
    sprite.material.dispose();
  }
});
