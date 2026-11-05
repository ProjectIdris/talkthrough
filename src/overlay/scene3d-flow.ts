// Connectors and streams on the 3D stage. A connector is a tube whose points are worked out from where its two objects are in the scene
// (connector.ts), rebuilt only when they have moved; a stream is a few markers placed along a path from the stream's lap count (stream.ts).
// Both are redone on every frame after the scene's matrices are up to date, so they follow the parts they hang on, however those were moved.

import { BufferGeometry, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Rgb } from '../scene/colors.ts';
import type { AddConnector, AddStream, Vec3 } from '../scene/types.ts';
import { arcPoint, beltPoints, endPoint, ropePoints, roundOf } from './connector.ts';
import { drawFraction, tubeGeometry } from './geometry.ts';
import { applySurface } from './materials.ts';
import type { Surface } from './materials.ts';
import { markerPlaces, markerSize, streamColour } from './stream.ts';
import { parseColor } from './timeline.ts';
import type { Frame, ObjectFrame } from './timeline.ts';

/** What this file needs of a node of the stage (the stage's own Node has these and more). */
export type FlowNode = {
  obj: Object3D;
  pieces: Array<{ object: Object3D; surface: Surface | undefined; tint: boolean; color: Rgb | undefined }>;
  geometries: BufferGeometry[];
  anchors?: Record<string, Vec3>;
  alpha: number;
  path?: { geo: BufferGeometry; sampled: Vec3[]; head: Mesh | undefined; body: boolean };
  connector?: { mesh: Mesh; signature: string };
  stream?: { markers: Mesh[]; kind: 'dot' | 'dash' | 'arrow' };
};
export type AddMesh = (geo: BufferGeometry, surface: string | undefined, edges: boolean) => Mesh;

const ROPE_RADIUS = 0.05;
const UP = new Vector3(0, 1, 0);

/** A connector starts as a speck; the first frame gives it its points. */
export function buildConnector(node: FlowNode, o: ObjectFrame, addMesh: AddMesh, radial: number): void {
  const def = o.def as AddConnector;
  const sampled: Vec3[] = [[0, 0, 0], [0, 0.001, 0]];
  const geo = tubeGeometry(sampled, def.radius ?? ROPE_RADIUS, 1, radial);
  const mesh = addMesh(geo, def.material ?? 'rubber', false);
  const group = new Group();
  group.add(mesh);
  node.obj = group;
  node.path = { geo, sampled, head: undefined, body: false };
  node.connector = { mesh, signature: '' };
}

/** Puts every connector of the frame between its two objects. True when there is one (the matrices need updating again for what hangs on it). */
export function updateConnectors(nodes: ReadonlyMap<number, FlowNode>, frame: Frame, radial: number): boolean {
  const byId = new Map<string, ObjectFrame>();
  for (const o of frame.objects) byId.set(o.id, o);
  let any = false;
  const v = new Vector3();
  for (const o of frame.objects) {
    if (o.shape !== 'connector') continue;
    const node = nodes.get(o.key);
    if (!node?.connector || !node.path) continue;
    const def = o.def as AddConnector;
    const fa = byId.get(def.from), fb = byId.get(def.to);
    const na = fa && nodes.get(fa.key), nb = fb && nodes.get(fb.key);
    if (!fa || !fb || !na || !nb || !na.obj.visible || !nb.obj.visible) {
      node.obj.visible = false;
      continue;
    }
    any = true;
    const a = endPoint(na.obj, fa.def, def.fromSide, def.fromAnchor, na.anchors);
    const b = endPoint(nb.obj, fb.def, def.toSide, def.toAnchor, nb.anchors);
    const thick = def.radius ?? ROPE_RADIUS;
    let world: Vec3[];
    let across: Vector3 | undefined;
    let radius = thick, flat = 1;
    const wheels = def.kind === 'wrapped' ? [roundOf(fa.def, na.obj), roundOf(fb.def, nb.obj)] : [];
    const belt = wheels[0] && wheels[1] ? beltPoints(wheels[0], wheels[1], thick) : undefined;
    if (belt && wheels[0] && wheels[1]) {
      // A flat belt: as wide as most of the wheels, as thick as the radius says, its wide side along the wheels' axis.
      world = belt;
      across = wheels[0].axis;
      radius = Math.max(thick * 1.5, Math.min(wheels[0].width, wheels[1].width) * 0.42);
      flat = Math.min(1, thick / radius);
    } else world = ropePoints(a, b, def.kind === 'slack' ? def.sag ?? 0.2 : 0);
    // Into the connector's own space (it may hang from a group that is moved or turned).
    const inverse = new Matrix4().copy(node.obj.matrixWorld).invert();
    const local: Vec3[] = world.map((p) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(inverse);
      return [v.x, v.y, v.z];
    });
    const along = across ? across.clone().transformDirection(inverse) : undefined;
    const signature = [radius, flat, ...(along ? [along.x, along.y, along.z] : []), ...local.flat()].map((x) => Math.round(x * 1e5)).join(',');
    if (signature !== node.connector.signature) {
      const geo = tubeGeometry(local, radius, flat, radial, undefined, along ? [along.x, along.y, along.z] : undefined);
      const old = node.path.geo;
      node.connector.mesh.geometry = geo;
      const at = node.geometries.indexOf(old);
      if (at >= 0) node.geometries[at] = geo;
      else node.geometries.push(geo);
      old.dispose();
      node.path.geo = geo;
      node.path.sampled = local;
      node.connector.signature = signature;
    }
    drawFraction(node.path.geo, o.draw);
  }
  return any;
}

// ---- Streams ----------------------------------------------------------------------------------------------------------------------

const MAX_MARKERS = 40;

/** A stream's markers, one mesh each (they differ in colour along the path); their places are set on each frame. */
export function buildStream(node: FlowNode, o: ObjectFrame, addMesh: AddMesh): void {
  const def = o.def as AddStream;
  const kind = def.mark ?? 'dot';
  const count = Math.max(1, Math.min(MAX_MARKERS, def.count ?? 6));
  const geo = kind === 'dot' ? new SphereGeometry(0.5, 14, 10) : kind === 'dash' ? new CylinderGeometry(0.4, 0.4, 1, 12) : new ConeGeometry(0.5, 1.2, 16);
  const group = new Group();
  const markers: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = addMesh(geo, 'glow', false);
    const piece = node.pieces[node.pieces.length - 1];
    if (piece) piece.tint = false;
    group.add(m);
    markers.push(m);
  }
  node.obj = group;
  node.stream = { markers, kind };
}

/** How big the markers of a stream are when the scene does not say: a bead a little wider than the pipe they run in. */
function defaultSize(path: ObjectFrame): number {
  const radius = (path.def as { radius?: number }).radius;
  return Math.max(0.07, (radius ?? ROPE_RADIUS) * 1.6);
}

const tmp = { p: new Vector3(), dir: new Vector3() };
const quat = new Quaternion();

/** Puts the markers of every stream along its path, after the path has been set for this frame. */
export function updateStreams(nodes: ReadonlyMap<number, FlowNode>, frame: Frame): void {
  const byKey = new Map(frame.objects.map((o) => [o.key, o] as const));
  for (const o of frame.objects) {
    if (o.shape !== 'stream') continue;
    const node = nodes.get(o.key);
    const stream = node?.stream;
    if (!node || !stream) continue;
    // It sits on its path whatever the spread does to the parts round it.
    node.obj.position.set(0, 0, 0);
    const holder = o.parentKey !== null ? byKey.get(o.parentKey) : undefined;
    const sampled = o.parentKey !== null ? nodes.get(o.parentKey)?.path?.sampled : undefined;
    if (!holder || !sampled || sampled.length < 2 || holder.draw < 0.02) {
      node.obj.visible = false;
      continue;
    }
    const def = o.def as AddStream;
    const size = def.size ?? defaultSize(holder);
    const to = def.toColor !== undefined ? parseColor(def.toColor) : undefined;
    const places = markerPlaces(o.phase ?? 0, stream.markers.length);
    stream.markers.forEach((m, i) => {
      const u = places[i] as number;
      arcPoint(sampled, u * holder.draw, tmp);
      const grow = markerSize(u) * size;
      m.visible = grow > 0.002;
      m.position.copy(tmp.p);
      if (stream.kind === 'dot') m.scale.setScalar(grow);
      else {
        quat.setFromUnitVectors(UP, tmp.dir);
        m.quaternion.copy(quat);
        m.scale.set(grow * (stream.kind === 'dash' ? 0.8 : 1), grow * (stream.kind === 'dash' ? 2.6 : 1), grow * (stream.kind === 'dash' ? 0.8 : 1));
      }
      const piece = node.pieces[i];
      if (piece?.surface) {
        piece.color = streamColour(o.color, to, u, def.shiftAt ?? 0.5);
        applySurface(piece.surface, piece.color, node.alpha, 0, undefined);
      }
    });
  }
}
