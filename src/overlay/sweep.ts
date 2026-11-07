import { BufferAttribute, BufferGeometry } from 'three';
import { prepareSweep, SWEEP_SUBDIVISIONS } from '../scene/sweep.ts';
import type { AddSweep } from '../scene/types.ts';
import type { Tier } from './materials.ts';

/** Invalid direct callers get no mesh, never a silently different solid. */
export function sweepGeometry(def: AddSweep, tier: Tier): BufferGeometry | undefined {
  const mesh=prepareSweep(def.outline,def.pts,def.up,SWEEP_SUBDIVISIONS[tier]);
  if (!mesh) return undefined;
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3));
  geometry.setAttribute('normal',new BufferAttribute(mesh.normals,3));
  geometry.setIndex(new BufferAttribute(mesh.indices,1));
  geometry.userData.sweepEdges=mesh.edges;
  return geometry;
}

export function sweepEdges(geometry: BufferGeometry): BufferGeometry {
  const edges=new BufferGeometry();
  edges.setAttribute('position',new BufferAttribute(geometry.userData.sweepEdges as Float32Array,3));
  return edges;
}
