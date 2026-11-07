import { BufferAttribute, BufferGeometry } from 'three';
import { prepareShell } from '../scene/shell.ts';
import type { AddShell } from '../scene/types.ts';
import type { Tier } from './materials.ts';

export function shellGeometry(def: AddShell, tier: Tier): BufferGeometry | undefined {
  const mesh = prepareShell(def.size, def.inner, def.latitude, def.sweep, tier);
  if (!mesh) return;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(mesh.indices);
  geometry.userData.shellEdges = mesh.edges;
  return geometry;
}

export function shellEdges(geometry: BufferGeometry): BufferGeometry {
  return new BufferGeometry().setAttribute('position', new BufferAttribute(geometry.userData.shellEdges as Float32Array, 3));
}
