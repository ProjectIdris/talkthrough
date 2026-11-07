import { BufferAttribute, BufferGeometry } from 'three';
import { preparePatch } from '../scene/patch.ts';
import type { Vec3 } from '../scene/types.ts';

/** The validator already preflights every supported resolution. Keep direct calls safe too. */
export function patchGeometry(pts: readonly Vec3[], segments: number): BufferGeometry {
  const grid = preparePatch(pts, segments), geometry = new BufferGeometry();
  if (!grid) return geometry;
  geometry.setAttribute('position', new BufferAttribute(grid.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(grid.normals, 3));
  geometry.setIndex(new BufferAttribute(grid.indices, 1));
  return geometry;
}

/** Only the four open boundaries: no triangulation diagonals or grid creases. */
export function patchEdges(geometry: BufferGeometry, segments: number): BufferGeometry {
  const p = geometry.getAttribute('position'), row = segments + 1;
  const edges = new BufferGeometry();
  if (!p || p.count !== row*row) return edges;
  const positions: number[] = [];
  const add = (a: number, b: number): void => {
    for (const k of [a,b]) positions.push(p.getX(k),p.getY(k),p.getZ(k));
  };
  for(let i=0;i<segments;i++) {
    add(i,i+1); add(segments*row+i,segments*row+i+1);
    add(i*row,(i+1)*row); add(i*row+segments,(i+1)*row+segments);
  }
  edges.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));
  return edges;
}
