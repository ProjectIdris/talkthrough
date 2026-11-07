import type { BufferGeometry } from 'three';

/**
 * Loft and sweep walls contain one pair of vertices per ring for each profile
 * edge, followed by separate cap vertices. Use those neighbours, not coordinate
 * buckets: compact profiles and distant touches must never borrow lighting.
 * Returns only end perimeters and the longitudinal edges that remain sharp.
 */
export function shadeProfileWalls(geometry: BufferGeometry, sectionSize: number, wallRings: number, straight: boolean): Float32Array {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), index = geometry.getIndex()!;
  const stride = wallRings * 2, wallVertices = sectionSize * stride;
  const blended = new Float32Array(wallVertices * 3);
  const smooth = new Uint8Array(sectionSize * wallRings);
  const crease = Math.cos(0.6);
  const pair = (corner: number, ring: number): [number, number] => [
    corner * stride + 2 * ring,
    ((corner + sectionSize - 1) % sectionSize) * stride + 2 * ring + 1,
  ];
  for (let corner = 0; corner < sectionSize; corner++) for (let ring = 0; ring < wallRings; ring++) {
    const [a, b] = pair(corner, ring);
    if (n.getX(a) * n.getX(b) + n.getY(a) * n.getY(b) + n.getZ(a) * n.getZ(b) <= crease) continue;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const length = Math.hypot(x, y, z);
    for (const id of [a, b]) blended.set([x / length, y / length, z / length], id * 3);
    smooth[corner * wallRings + ring] = 1;
  }
  const cornerOf = (vertex: number): number => (Math.floor(vertex / stride) + vertex % 2) % sectionSize;
  const ringOf = (vertex: number): number => Math.floor(vertex % stride / 2);
  // A heavily warped accepted wall can approach a tangent triangle. Retain its
  // original crease rather than let an averaged normal turn against that face.
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    if (a >= wallVertices) continue; // caps keep their original independent normals
    const ux = p.getX(b) - p.getX(a), uy = p.getY(b) - p.getY(a), uz = p.getZ(b) - p.getZ(a);
    const vx = p.getX(c) - p.getX(a), vy = p.getY(c) - p.getY(a), vz = p.getZ(c) - p.getZ(a);
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const threshold = Math.hypot(x, y, z) * 1e-6;
    for (const id of [a, b, c]) {
      const key = cornerOf(id) * wallRings + ringOf(id);
      if (smooth[key] && !(x * blended[id * 3]! + y * blended[id * 3 + 1]! + z * blended[id * 3 + 2]! > threshold)) smooth[key] = 0;
    }
  }
  const edges: number[] = [];
  const line = (a: number, b: number): void => { for (const id of [a, b]) edges.push(p.getX(id), p.getY(id), p.getZ(id)); };
  for (let corner = 0; corner < sectionSize; corner++) {
    const base = corner * stride;
    for (let ring = 0; ring < wallRings; ring++) if (smooth[corner * wallRings + ring]) {
      for (const id of pair(corner, ring)) n.setXYZ(id, blended[id * 3]!, blended[id * 3 + 1]!, blended[id * 3 + 2]!);
    }
    const sharp = (ring: number): boolean => !(smooth[corner * wallRings + ring] && smooth[corner * wallRings + ring + 1]);
    for (let ring = 0; ring < wallRings - 1; ring++) if (sharp(ring)) {
      let end = ring + 1;
      // Loft corner paths are straight. Keep each uninterrupted sharp run as
      // one line instead of multiplying an angular loft's outline budget.
      if (straight) while (end < wallRings - 1 && sharp(end)) end++;
      line(base + ring * 2, base + end * 2); ring = end - 1;
    }
    line(base, base + 1);
    line(base + stride - 2, base + stride - 1);
  }
  return new Float32Array(edges);
}
