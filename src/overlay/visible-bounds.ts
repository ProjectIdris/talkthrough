// Three.js hides a whole subtree when any ancestor is invisible. Its generic
// Box3.setFromObject deliberately does not, so display bounds need this filter.
import { Box3, InstancedMesh, LineSegments, Mesh, Sprite } from 'three';
import type { Object3D } from 'three';

export function isVisible(object: Object3D): boolean {
  for (let p: Object3D | null = object; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Like setFromObject, but excludes hidden descendants. Includes visible children
 * of a mesh and every instance; never changes transforms, geometry or visibility. */
export function visibleBounds(object: Object3D, target: Box3): Box3 {
  target.makeEmpty();
  if (!isVisible(object)) return target;
  const box = new Box3();
  object.traverseVisible(o => {
    if (!(o instanceof Mesh || o instanceof LineSegments || o instanceof Sprite)) return;
    if (o instanceof InstancedMesh) {
      if (!o.boundingBox) o.computeBoundingBox();
      if (!o.boundingBox) return;
      box.copy(o.boundingBox);
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      box.copy(o.geometry.boundingBox);
    }
    o.updateWorldMatrix(true, false);
    target.union(box.applyMatrix4(o.matrixWorld));
  });
  return target;
}
