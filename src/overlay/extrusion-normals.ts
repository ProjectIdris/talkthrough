// Extrusions already emit matching Float32 coordinates at shared corners. Keep those
// exact joins: a fixed spatial bin can blend unrelated corners on a compact profile.
import { BufferAttribute, BufferGeometry } from 'three';

/** Smooth an unindexed extrusion at its real shared corners, keeping deliberate creases. */
export function shadeExtrusion(geometry: BufferGeometry): void {
  const positions = geometry.getAttribute('position');
  const count = positions.count;
  const faceNormals = new Float64Array(count);
  const angles = new Float64Array(count);
  const corners: number[][] = [];
  const vertexIds = new Int32Array(count);
  const coordinates = new Map<number, Map<number, Map<number, number>>>();
  for (let i = 0; i < count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    let ys = coordinates.get(x);
    if (!ys) { ys = new Map(); coordinates.set(x, ys); }
    let zs = ys.get(y);
    if (!zs) { zs = new Map(); ys.set(y, zs); }
    let id = zs.get(z);
    if (id === undefined) { id = corners.length; zs.set(z, id); corners.push([]); }
    corners[id]!.push(i); vertexIds[i] = id;
  }
  for (let start = 0; start < count; start += 3) {
    const ax = positions.getX(start + 1) - positions.getX(start), ay = positions.getY(start + 1) - positions.getY(start), az = positions.getZ(start + 1) - positions.getZ(start);
    const bx = positions.getX(start + 2) - positions.getX(start), by = positions.getY(start + 2) - positions.getY(start), bz = positions.getZ(start + 2) - positions.getZ(start);
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz);
    // A collapsed triangle has no surface and must not influence a visible neighbour.
    if (length > 0) {
      faceNormals[start] = nx / length; faceNormals[start + 1] = ny / length; faceNormals[start + 2] = nz / length;
      const dot = ax * bx + ay * by + az * bz;
      angles[start] = Math.atan2(length, dot);
      angles[start + 1] = Math.atan2(length, ax * ax + ay * ay + az * az - dot);
      angles[start + 2] = Math.atan2(length, bx * bx + by * by + bz * bz - dot);
    }
  }
  const creaseDot = Math.cos(0.6);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const face = i - i % 3;
    const nx = faceNormals[face]!, ny = faceNormals[face + 1]!, nz = faceNormals[face + 2]!;
    let x = 0, y = 0, z = 0;
    for (const other of corners[vertexIds[i]!]!) {
      const f = other - other % 3;
      const ox = faceNormals[f]!, oy = faceNormals[f + 1]!, oz = faceNormals[f + 2]!;
      if (nx * ox + ny * oy + nz * oz > creaseDot) {
        // Angle weighting removes the lighting bias from a triangulated quad's diagonal.
        const weight = angles[other]!;
        x += ox * weight; y += oy * weight; z += oz * weight;
      }
    }
    const length = Math.hypot(x, y, z);
    if (length > 0) { x /= length; y /= length; z /= length; }
    else { x = nx; y = ny; z = nz; }
    normals[i * 3] = x; normals[i * 3 + 1] = y; normals[i * 3 + 2] = z;
  }
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
}
