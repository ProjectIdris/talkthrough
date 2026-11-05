import { Raycaster, Vector2 } from 'three';
import type { Camera, Intersection, Material, Object3D } from 'three';

/** Ray-test drawn model objects; projected bounds alone include empty holes. */
export function hitVisibleModel(objects: readonly Object3D[], camera: Camera, width: number, height: number, x: number, y: number): boolean {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return false;
  const ray = new Raycaster();
  ray.params.Line.threshold = 0.02;
  ray.setFromCamera(new Vector2(x / width * 2 - 1, 1 - y / height * 2), camera);
  return ray.intersectObjects([...objects], true).some(visibleHit);
}

function visibleHit(hit: Intersection): boolean {
  for (let object: Object3D | null = hit.object; object; object = object.parent) if (!object.visible) return false;
  const material = (hit.object as Object3D & { material?: Material | Material[] }).material;
  const materials = Array.isArray(material) ? material : material ? [material] : [];
  return materials.some((m) => m.visible && m.opacity > 0.02 && !(m.clippingPlanes ?? []).some((p) => p.distanceToPoint(hit.point) < -1e-6));
}
