import { BufferGeometry, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { resolveHullPoints } from '../scene/hull-points.ts';
import type { Vec3 } from '../scene/types.ts';

export type HullGeometryResult = { ok: true; geometry: BufferGeometry } | { ok: false; message: string };

/** Build a flat-faced convex surface, containing construction failures to this object. */
export function buildHullGeometry(pts: readonly Vec3[]): HullGeometryResult {
  const resolved = resolveHullPoints(pts);
  if (!resolved.ok) return resolved;
  let geometry: BufferGeometry | undefined;
  try {
    geometry = new ConvexGeometry(resolved.points.map((p) => new Vector3(...p)));
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    if (!position || !normal || position.count < 12 || position.count % 3 !== 0 ||
        normal.count !== position.count || position.count / 3 > 2 * resolved.points.length - 4) {
      throw new Error('empty or invalid hull geometry');
    }
    for (const attr of [position, normal]) {
      for (let i = 0; i < attr.count; i++) {
        if (![attr.getX(i), attr.getY(i), attr.getZ(i)].every(Number.isFinite)) throw new Error('non-finite hull geometry');
      }
    }
    return { ok: true, geometry };
  } catch (error) {
    geometry?.dispose();
    return { ok: false, message: error instanceof Error ? error.message : 'hull construction failed' };
  }
}
