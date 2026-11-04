// What every part builder shares: the piece a part is made of, the builder that collects them, and
// the named anchor points a part offers (a pin or a parent can land on one by name).

import { BufferGeometry, CylinderGeometry, Group, InstancedMesh, Mesh } from 'three';
import type { Object3D } from 'three';
import type { Vec3 } from '../scene/types.ts';
import type { Rgb } from './timeline.ts';

/** One drawable piece of a part. `tint` pieces take the object's colour; the others keep their own. */
export type Piece = {
  object: Mesh | InstancedMesh;
  surface: string;
  tint: boolean;
  color?: Rgb;
  /** Dark edge lines are drawn for this piece when the tier allows. */
  edges: boolean;
};

export type BuiltPart = { root: Group; pieces: Piece[]; /** Named points on the part, in its own space (see each part in docs/scene-language.md). */ anchors: Record<string, Vec3> };

export const GOLD: Rgb = [216, 172, 72];
export const BLACK: Rgb = [14, 15, 18];

export class Builder {
  readonly root = new Group();
  readonly pieces: Piece[] = [];
  readonly anchors: Record<string, Vec3> = {};

  add(geo: BufferGeometry, surface: string, opts: { tint?: boolean; color?: Rgb; pos?: Vec3; rot?: Vec3; edges?: boolean } = {}): Mesh {
    const mesh = new Mesh(geo);
    if (opts.pos) mesh.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
    if (opts.rot) mesh.rotation.set(opts.rot[0] * Math.PI / 180, opts.rot[1] * Math.PI / 180, opts.rot[2] * Math.PI / 180);
    this.root.add(mesh);
    this.pieces.push({ object: mesh, surface, tint: opts.tint ?? false, ...(opts.color ? { color: opts.color } : {}), edges: opts.edges ?? false });
    return mesh;
  }

  group(into: Object3D, pos: Vec3, rotY: number): Group {
    const g = new Group();
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.y = (rotY * Math.PI) / 180;
    into.add(g);
    return g;
  }
}

export const cyl = (rTop: number, rBottom: number, h: number, seg: number) => new CylinderGeometry(rTop, rBottom, h, seg);

