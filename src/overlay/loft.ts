import { BufferAttribute, BufferGeometry } from 'three';
import { LOFT_STRIPS, prepareLoft } from '../scene/loft.ts';
import type { AddLoft } from '../scene/types.ts';
import type { Tier } from './materials.ts';

export function loftGeometry(def: AddLoft, tier: Tier): BufferGeometry | undefined {
  const mesh = prepareLoft(def.outline, def.endOutline, def.depth, LOFT_STRIPS[tier]);
  if (!mesh) return;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(mesh.indices);
  geometry.userData.loftEdges = mesh.edges;
  return geometry;
}

export function loftEdges(geometry: BufferGeometry): BufferGeometry {
  return new BufferGeometry().setAttribute('position', new BufferAttribute(geometry.userData.loftEdges as Float32Array, 3));
}
