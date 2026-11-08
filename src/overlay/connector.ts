// Connectors: a rope, belt, wire, chain or pipe between two objects, drawn as a tube that follows them as they move. Where the ends are, and the
// points of the tube between them, are worked out afresh from where the two objects are in the scene at each frame (nothing is kept from the last
// one), so a frame grab, a clip and the live page agree. The sampled points are in world space; the renderer brings them into the tube's own.
//
// An end sits on an object: its middle, or the point of a side of it as seen from the front (the rim of a wheel, the top of a weight), or a named
// anchor of a ready-made part. A straight rope is the line between its ends; a slack one hangs between them; a belt goes round two wheels.

import { Box3, Quaternion, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Side, Vec3 } from '../scene/types.ts';
import { resolvePartGeometry } from '../scene/part-geometry.ts';

/** A round object (a wheel, a gear, a disc): where it is, which way its axis points, how wide across and how thick, all in the scene's units. */
export type Round = { centre: Vector3; axis: Vector3; radius: number; width: number };

const SIDES: Record<Side, Vec3> = { left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1] };

type Def = { shape?: string; part?: string; size?: unknown };
const sizeOf = (def: Def): Vec3 | undefined => (Array.isArray(def.size) && def.size.length === 3 ? (def.size as Vec3) : undefined);

/** What makes an object round, and about which of its own axes: a cylinder about y, a wheel, gear or bearing about z, a fan about y, a sphere about z. */
export function roundOf(def: Def, obj: Object3D): Round | undefined {
  const written = sizeOf(def);
  if (!written) return undefined;
  const size = def.shape === 'part' && (def.part === 'gear' || def.part === 'bearing')
    ? resolvePartGeometry({ part: def.part, size: written }).size
    : written;
  let axis: Vec3, radius: number, width: number;
  if (def.shape === 'cylinder' || def.shape === 'cone') [axis, radius, width] = [[0, 1, 0], Math.max(size[0], size[2]) / 2, size[1]];
  else if (def.shape === 'sphere') [axis, radius, width] = [[0, 0, 1], size[0] / 2, size[0]];
  else if (def.shape === 'part' && (def.part === 'wheel' || def.part === 'gear' || def.part === 'bearing')) [axis, radius, width] = [[0, 0, 1], Math.max(size[0], size[1]) / 2, size[2]];
  else if (def.shape === 'part' && def.part === 'fan') [axis, radius, width] = [[0, 1, 0], Math.max(size[0], size[2]) / 2, size[1]];
  else return undefined;
  const centre = obj.getWorldPosition(new Vector3());
  const scale = obj.getWorldScale(new Vector3());
  const k = (scale.x + scale.y + scale.z) / 3;
  return { centre, axis: new Vector3(...axis).applyQuaternion(obj.getWorldQuaternion(new Quaternion())).normalize(), radius: radius * k, width: width * k };
}

/** Where an end of a connector meets an object, in world space. */
export function endPoint(obj: Object3D, def: Def, side: Side | undefined, anchor: string | undefined, anchors: Record<string, Vec3> | undefined, out = new Vector3(), point?: Vec3): Vector3 {
  if (point) return obj.localToWorld(out.set(...point));
  const named = anchor !== undefined && anchors && Object.hasOwn(anchors, anchor) ? anchors[anchor] : undefined;
  if (named) return obj.localToWorld(out.set(named[0], named[1], named[2]));
  if (side === undefined) return obj.getWorldPosition(out);
  const d = new Vector3(...SIDES[side]);
  const round = roundOf(def, obj);
  if (round) {
    // The rim in that direction: the direction taken flat into the wheel's plane. Straight along the axis, the face of it.
    const flat = d.clone().addScaledVector(round.axis, -d.dot(round.axis));
    if (flat.lengthSq() < 1e-6) return out.copy(round.centre).addScaledVector(round.axis, (Math.sign(d.dot(round.axis)) * round.width) / 2);
    return out.copy(round.centre).addScaledVector(flat.normalize(), round.radius);
  }
  // Anything else: the middle of the face of its box that way.
  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return obj.getWorldPosition(out);
  box.getCenter(out);
  if (d.x !== 0) out.x = d.x < 0 ? box.min.x : box.max.x;
  if (d.y !== 0) out.y = d.y < 0 ? box.min.y : box.max.y;
  if (d.z !== 0) out.z = d.z < 0 ? box.min.z : box.max.z;
  return out;
}

/** Points along a rope from a to b: straight, or hanging in a sag (a parabola down by `sag` of its length). */
export function ropePoints(a: Vector3, b: Vector3, sag: number, steps = 24): Vec3[] {
  const chord = a.distanceTo(b);
  const out: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    out.push([a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s - sag * chord * 4 * s * (1 - s), a.z + (b.z - a.z) * s]);
  }
  return out;
}

/**
 * A belt round two wheels whose axes run the same way: the two straight strands between them and the arcs round the far sides, as a closed run of
 * points (the last is the first). `lift` stands the belt off the rim by half its thickness. Undefined when the wheels do not suit a belt: axes not
 * parallel, or one wheel inside the other.
 */
export function beltPoints(r1: Round, r2: Round, lift: number, arc = (8 * Math.PI) / 180): Vec3[] | undefined {
  if (Math.abs(r1.axis.dot(r2.axis)) < 0.95) return undefined;
  const n = r1.axis;
  const between = r2.centre.clone().sub(r1.centre);
  const along = between.clone().addScaledVector(n, -between.dot(n));
  const d = along.length();
  const a1 = r1.radius + lift, a2 = r2.radius + lift;
  if (d <= Math.abs(a1 - a2) + 1e-6) return undefined;
  const e1 = along.divideScalar(d);
  const e2 = new Vector3().crossVectors(n, e1);
  const phi = Math.acos((a1 - a2) / d);
  const at = (r: Round, radius: number, theta: number): Vec3 => {
    const p = r.centre.clone().addScaledVector(e1, radius * Math.cos(theta)).addScaledVector(e2, radius * Math.sin(theta));
    return [p.x, p.y, p.z];
  };
  const out: Vec3[] = [];
  const strand = (from: Vec3, to: Vec3): void => {
    for (let i = 0; i < 6; i++) out.push([from[0] + (to[0] - from[0]) * (i / 6), from[1] + (to[1] - from[1]) * (i / 6), from[2] + (to[2] - from[2]) * (i / 6)]);
  };
  const sweep = (r: Round, radius: number, from: number, to: number): void => {
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) / arc));
    for (let i = 0; i < steps; i++) out.push(at(r, radius, from + ((to - from) * i) / steps));
  };
  strand(at(r1, a1, phi), at(r2, a2, phi));
  sweep(r2, a2, phi, -phi);
  strand(at(r2, a2, -phi), at(r1, a1, -phi));
  sweep(r1, a1, 2 * Math.PI - phi, phi);
  out.push(at(r1, a1, phi));
  return out;
}

/** The point `u` (0 to 1) of the way along a run of points by length, and which way it heads there. */
export function arcPoint(path: readonly Vec3[], u: number, out: { p: Vector3; dir: Vector3 }): void {
  const last = path.length - 1;
  if (last < 1) {
    const only = path[0] ?? [0, 0, 0];
    out.p.set(only[0], only[1], only[2]);
    out.dir.set(0, 1, 0);
    return;
  }
  let total = 0;
  const lens: number[] = [0];
  for (let i = 1; i <= last; i++) {
    const a = path[i - 1] as Vec3, b = path[i] as Vec3;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    lens.push(total);
  }
  const want = Math.max(0, Math.min(1, u)) * total;
  let i = 1;
  while (i < last && (lens[i] as number) < want) i++;
  const a = path[i - 1] as Vec3, b = path[i] as Vec3;
  const span = (lens[i] as number) - (lens[i - 1] as number);
  const t = span > 1e-9 ? (want - (lens[i - 1] as number)) / span : 0;
  out.p.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  out.dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (out.dir.lengthSq() < 1e-12) out.dir.set(0, 1, 0);
  out.dir.normalize();
}
