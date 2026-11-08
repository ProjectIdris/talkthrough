import { setPathSurfaceCoordinates, treatmentOf } from './surface-treatment.ts';
// Connectors and streams on the 3D stage. A connector is a tube whose points are worked out from where its two objects are in the scene
// (connector.ts), rebuilt only when they have moved; a stream is a few markers placed along a path from the stream's lap count (stream.ts).
// Both are redone on every frame after the scene's matrices are up to date, so they follow the parts they hang on, however those were moved.

import { Box3, BufferGeometry, ConeGeometry, CylinderGeometry, Group, Matrix4, Mesh, Quaternion, Sphere, SphereGeometry, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { Rgb } from '../scene/colors.ts';
import type { AddConnector, AddForce, AddParticles, AddPath, AddStream, AddTube, Vec2, Vec3 } from '../scene/types.ts';
import { arcPoint, beltPoints, endPoint, ropePoints, roundOf } from './connector.ts';
import { drawFraction, swellAt, tubeGeometry } from './geometry.ts';
import { applySurface, setSurfaceOpacity } from './materials.ts';
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
  path?: { geo: BufferGeometry; sampled: Vec3[]; head: Mesh | undefined; body: boolean; radius?: number };
  connector?: { mesh: Mesh; signature: string };
  stream?: { markers: Mesh[]; kind: 'dot' | 'dash' | 'arrow' };
  attached?: { base: Vec3[]; along: number[]; signature: string };
  /** A tube a wave runs along: what it was last drawn with, and its bounds at rest (so the camera does not breathe with the swell). */
  wave?: { signature: string; sphere: Sphere; box: Box3 };
  /** A cloud of particles: where each starts, where it ends up and how it jostles. */
  particles?: { beads: Mesh[]; start: Vec3[]; end: Vec3[]; shake: Array<{ freq: Vec3; phase: Vec3 }> };
  /** A force arrow: its shaft and head. */
  force?: { shaft: Mesh; head: Mesh };
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

const box = new Box3(), boxSize = new Vector3();

const corner = new Vector3(), toSpace = new Matrix4();

/**
 * How wide a part stands across the line from one anchor to the other: the widest of its bounding box's sides that the line does not run along. The box is
 * built in the space the line is in (the connector's own, which may hang from a group turned or scaled any way): each drawn piece's own box, its corners
 * taken through the piece's place and into that space, so nothing is boxed twice. a and b are in that space too.
 */
function partWidth(obj: Object3D, a: Vector3, b: Vector3, into: Matrix4): number {
  box.makeEmpty();
  obj.traverse((o) => {
    const geometry = (o as Mesh).geometry as BufferGeometry | undefined;
    if (!(o as Mesh).isMesh || !geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const g = geometry.boundingBox;
    if (!g || g.isEmpty()) return;
    o.updateWorldMatrix(true, false);
    toSpace.multiplyMatrices(into, o.matrixWorld);
    for (const x of [g.min.x, g.max.x]) for (const y of [g.min.y, g.max.y]) for (const z of [g.min.z, g.max.z]) box.expandByPoint(corner.set(x, y, z).applyMatrix4(toSpace));
  });
  // A part with nothing drawn in it (a bare group) says nothing about width: it bounds nothing.
  if (box.isEmpty()) return Infinity;
  box.getSize(boxSize);
  if (Math.max(boxSize.x, boxSize.y, boxSize.z) < 1e-6) return Infinity;
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  if (len < 1e-9) return Math.max(boxSize.x, boxSize.y, boxSize.z);
  d.divideScalar(len);
  return Math.max(boxSize.x * (1 - Math.abs(d.x)), boxSize.y * (1 - Math.abs(d.y)), boxSize.z * (1 - Math.abs(d.z)));
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
    // It is no more there than the ends it hangs on: while either is coming in (or going), the connector comes in (goes) with it.
    const held = Math.min(fa.appear * fa.fade, fb.appear * fb.fade);
    if (held < 0.003) {
      node.obj.visible = false;
      continue;
    }
    for (const p of node.pieces) if (p.surface) setSurfaceOpacity(p.surface, p.surface.opacity * held);
    const a = endPoint(na.obj, fa.def, def.fromSide, def.fromAnchor, na.anchors, undefined, def.fromPoint);
    const b = endPoint(nb.obj, fb.def, def.toSide, def.toAnchor, nb.anchors, undefined, def.toPoint);
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
    let capDepth: number | undefined;
    if (def.restLength !== undefined && def.kind !== 'wrapped') {
      // Use the full local path, not a first-frame measurement or the world chord:
      // slack, parent scale and reverse seeks must all give the same shape.
      let length = 0;
      for (let i = 1; i < local.length; i++) {
        const p = local[i]!, prev = local[i - 1]!;
        length += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      }
      const scale = Math.max(0.25, Math.min(4, Math.sqrt(def.restLength / Math.max(length, 1e-9))));
      radius *= scale;
      if (scale > 1) {
        // Thickening is bounded by what the span and the joined parts allow: the widest ring, at the authored look at least, no wider than half the span and
        // 3/4 of the narrower part. A cord shortened a great deal is squashed, never a ball over what it joins.
        const peak = def.swell ? Math.max(...local.map((_, i) => swellAt(def.swell!, i / Math.max(1, local.length - 1)))) : 1;
        // The parts are measured in the connector's own space, where the span and the radius are (it may hang from a group scaled differently on each axis).
        const first = new Vector3(...local[0]!), last = new Vector3(...local[local.length - 1]!);
        const room = Math.min(0.5 * length, 0.75 * Math.min(partWidth(na.obj, first, last, inverse), partWidth(nb.obj, first, last, inverse)));
        radius = Math.min(radius, Math.max(thick * peak, room) / peak);
      }
      capDepth = 0.25 * length;
    }
    const signature = [radius, flat, ...(along ? [along.x, along.y, along.z] : []), ...local.flat()].map((x) => Math.round(x * 1e5)).join(',');
    if (signature !== node.connector.signature) {
      const geo = tubeGeometry(local, radius, flat, radial, def.kind === 'wrapped' ? undefined : def.swell, along ? [along.x, along.y, along.z] : undefined, capDepth);
      setPathSurfaceCoordinates(geo, treatmentOf(def));
      const old = node.path.geo;
      node.connector.mesh.geometry = geo;
      const at = node.geometries.indexOf(old);
      if (at >= 0) node.geometries[at] = geo;
      else node.geometries.push(geo);
      old.dispose();
      node.path.geo = geo;
      node.path.sampled = local;
      // Streams must clear the widest current ring, including contraction and
      // taper. A uniform marker size avoids pulsing as it traverses the profile.
      node.path.radius = def.kind !== 'wrapped' && (def.swell || def.restLength !== undefined)
        ? radius * (def.swell ? Math.max(...local.map((_, i) => swellAt(def.swell!, i / Math.max(1, local.length - 1)))) : 1)
        : undefined;
      node.connector.signature = signature;
    }
    drawFraction(node.path.geo, o.draw);
  }
  return any;
}

// ---- Tubes and lines with an end on a part ---------------------------------------------------------------------------------------

const SETTLED = '0,0,0,0,0,0';

/**
 * A tube or line whose end lies on a part (the validator found it so and set `attach`) keeps that end on the part wherever the part goes: the end is the
 * point of the part it was on, and the points between follow by their length along the tube, so the tube leans toward the part as it moves. It is not
 * drawn while a part it is on is not there. At rest nothing changes, and the tube is not rebuilt.
 */
export function updateAttached(nodes: ReadonlyMap<number, FlowNode>, frame: Frame, radial: number, pathRadius: number): void {
  const byId = new Map<string, ObjectFrame>();
  for (const o of frame.objects) byId.set(o.id, o);
  const v = new Vector3();
  for (const o of frame.objects) {
    if (o.shape !== 'tube' && o.shape !== 'line') continue;
    const def = o.def as AddTube | AddPath;
    if (!def.attach) continue;
    const node = nodes.get(o.key);
    if (!node?.path || !node.obj.visible) continue;
    let held = 1;
    const there: Array<ObjectFrame | undefined> = [];
    let missing = false;
    for (const end of def.attach) {
      const part = end ? byId.get(end.to) : undefined;
      const n = part && nodes.get(part.key);
      if (end && (!part || !n || !n.obj.visible)) missing = true;
      there.push(end && part && n ? part : undefined);
      if (part) held = Math.min(held, part.appear * part.fade);
    }
    if (missing || held < 0.003) {
      node.obj.visible = false;
      continue;
    }
    for (const p of node.pieces) if (p.surface) setSurfaceOpacity(p.surface, p.surface.opacity * held);
    if (!node.attached) {
      const base = node.path.sampled.map((p): Vec3 => [p[0], p[1], p[2]]);
      const along = [0];
      for (let i = 1; i < base.length; i++) along.push((along[i - 1] as number) + Math.hypot(base[i]![0] - base[i - 1]![0], base[i]![1] - base[i - 1]![1], base[i]![2] - base[i - 1]![2]));
      const total = along[along.length - 1] || 1;
      node.attached = { base, along: along.map((x) => x / total), signature: SETTLED };
    }
    const st = node.attached;
    const inverse = new Matrix4().copy(node.obj.matrixWorld).invert();
    const push: Vec3[] = [[0, 0, 0], [0, 0, 0]];
    def.attach.forEach((end, slot) => {
      const part = there[slot];
      const n = part && nodes.get(part.key);
      if (!end || !part || !n) return;
      const rest = (slot === 0 ? st.base[0] : st.base[st.base.length - 1]) as Vec3;
      v.set(end.at[0], end.at[1], end.at[2]).applyMatrix4(n.obj.matrixWorld).applyMatrix4(inverse);
      push[slot] = [v.x - rest[0], v.y - rest[1], v.z - rest[2]];
    });
    const signature = push.flat().map((x) => Math.round(x * 1e5)).join(',');
    if (signature !== st.signature) {
      const a = push[0] as Vec3, b = push[1] as Vec3;
      const moved: Vec3[] = st.base.map((p, i) => {
        const u = st.along[i] as number;
        return [p[0] + a[0] * (1 - u) + b[0] * u, p[1] + a[1] * (1 - u) + b[1] * u, p[2] + a[2] * (1 - u) + b[2] * u];
      });
      const tube = o.shape === 'tube';
      const geo = tubeGeometry(moved, tube ? (def as AddTube).radius : pathRadius, tube ? (def as AddTube).flat ?? 1 : 1, radial, tube ? (def as AddTube).swell : undefined);
      const mesh = node.obj.children[0] as Mesh;
      setPathSurfaceCoordinates(geo, treatmentOf(def));
      const old = node.path.geo;
      mesh.geometry = geo;
      const at = node.geometries.indexOf(old);
      if (at >= 0) node.geometries[at] = geo;
      else node.geometries.push(geo);
      old.dispose();
      node.path.geo = geo;
      node.path.sampled = moved;
      st.signature = signature;
    }
    drawFraction(node.path.geo, o.draw);
  }
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
    const m = addMesh(geo, 'bead', false);
    const piece = node.pieces[node.pieces.length - 1];
    if (piece) piece.tint = false;
    group.add(m);
    markers.push(m);
  }
  node.obj = group;
  node.stream = { markers, kind };
}

/** The least size of the markers of a stream, and their size when the scene does not say: a bead clearly wider than the pipe they run in. */
function defaultSize(path: ObjectFrame, effectiveRadius?: number): number {
  const radius = effectiveRadius ?? (path.def as { radius?: number }).radius;
  return Math.max(0.11, (radius ?? ROPE_RADIUS) * 3);
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
    const path = o.parentKey !== null ? nodes.get(o.parentKey)?.path : undefined;
    const sampled = path?.sampled;
    if (!holder || !sampled || sampled.length < 2 || holder.draw < 0.02) {
      node.obj.visible = false;
      continue;
    }
    const def = o.def as AddStream;
    // Never narrower than a bead that stands out of its pipe: a marker inside an opaque pipe is not there.
    const size = Math.max(def.size ?? 0, defaultSize(holder, path?.radius));
    const to = def.toColor !== undefined ? parseColor(def.toColor) : undefined;
    const places = markerPlaces(o.phase ?? 0, stream.markers.length);
    const closed = holder.shape === 'tube' && (holder.def as AddTube).closed === true;
    // Release the endpoint fade over the last tenth of the reveal, rather than
    // popping a bead to full size on the frame where the loop finishes closing.
    const closing = closed ? Math.max(0, Math.min(1, (holder.draw - 0.9) / 0.1)) : 0;
    const joined = closing * closing * (3 - 2 * closing);
    stream.markers.forEach((m, i) => {
      const u = places[i] as number;
      arcPoint(sampled, u * holder.draw, tmp);
      const fade = markerSize(u);
      const grow = (fade + (1 - fade) * joined) * size;
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

// ---- Waves along a tube ----------------------------------------------------------------------------------------------------------

/** The factor a wave puts on the radius at `u` (0 to 1 along the tube), crests `count` apiece, each `width` of the length across, `phase` laps along. */
export function waveFactor(u: number, phase: number, count: number, width: number, amount: number): number {
  let bump = 0;
  const half = Math.max(0.01, width / 2);
  for (let j = 0; j < count; j++) {
    const c = (((phase + j / count) % 1) + 1) % 1;
    const d = Math.abs(u - c) / half;
    if (d < 1) bump = Math.max(bump, 0.5 * (1 + Math.cos(Math.PI * d)));
  }
  return 1 + (amount - 1) * bump;
}

/**
 * A tube with a wave on it is drawn again with its radius swelled (or squeezed) along its length, the crest where the laps say. The same laps run a stream's
 * markers, so a marker and a crest of the same period are together. A tube that has lost its wave is drawn as it was authored. A closed loop takes no wave.
 */
export function updateWaves(nodes: ReadonlyMap<number, FlowNode>, frame: Frame, radial: number): void {
  for (const o of frame.objects) {
    if (o.shape !== 'tube') continue;
    const node = nodes.get(o.key);
    const def = o.def as AddTube;
    if (!node?.path || def.closed === true || (!o.wave && !node.wave)) continue;
    const sampled = node.path.sampled;
    const n = sampled.length;
    if (n < 2) continue;
    const swell: Vec2[] = [];
    const w = o.wave;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const base = def.swell ? swellAt(def.swell, u) : 1;
      swell.push([u, base * (w ? waveFactor(u, w.phase, w.count, w.width, w.amount) : 1)]);
    }
    const signature = w ? swell.map((p) => Math.round(p[1] * 400)).join(',') + ':' + n : '';
    if (!node.wave) {
      const rest = node.path.geo;
      if (!rest.boundingSphere) rest.computeBoundingSphere();
      if (!rest.boundingBox) rest.computeBoundingBox();
      node.wave = { signature: '\u0000', sphere: (rest.boundingSphere as Sphere).clone(), box: (rest.boundingBox as Box3).clone() };
    }
    if (signature !== node.wave.signature) {
      const geo = tubeGeometry(sampled, def.radius, def.flat ?? 1, radial, w ? swell : def.swell);
      setPathSurfaceCoordinates(geo, treatmentOf(def));
      geo.boundingSphere = node.wave.sphere.clone();
      geo.boundingBox = node.wave.box.clone();
      const mesh = node.obj.children[0] as Mesh;
      const old = node.path.geo;
      mesh.geometry = geo;
      const at = node.geometries.indexOf(old);
      if (at >= 0) node.geometries[at] = geo;
      else node.geometries.push(geo);
      old.dispose();
      node.path.geo = geo;
      node.wave.signature = signature;
    }
    drawFraction(node.path.geo, o.draw);
    if (!w) delete node.wave;
  }
}

// ---- Particles that spread ----------------------------------------------------------------------------------------------------------

const MAX_PARTICLES = 80;
const unit = (s: number): number => {
  // A fixed pseudo-random number from 0 to 1 for a seed (the same every time, so a frame grab and the live page agree).
  const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (k: number): number => {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
};

export function buildParticles(node: FlowNode, o: ObjectFrame, addMesh: AddMesh): void {
  const def = o.def as AddParticles;
  const count = Math.max(1, Math.min(MAX_PARTICLES, def.count ?? 30));
  const shift = def.shift ?? [0, 0, 0];
  const geo = new SphereGeometry(0.5, 12, 9);
  const group = new Group();
  const beads: Mesh[] = [];
  const start: Vec3[] = [], end: Vec3[] = [];
  const shake: Array<{ freq: Vec3; phase: Vec3 }> = [];
  for (let i = 0; i < count; i++) {
    const m = addMesh(geo, 'bead', false);
    group.add(m);
    beads.push(m);
    const r = (k: number): number => unit(i * 7.31 + k * 13.17) - 0.5;
    start.push([r(1) * def.from[0], r(2) * def.from[1], r(3) * def.from[2]]);
    end.push([shift[0] + r(4) * def.to[0], shift[1] + r(5) * def.to[1], shift[2] + r(6) * def.to[2]]);
    shake.push({ freq: [1 + unit(i + 0.1) * 2, 1 + unit(i + 0.2) * 2, 1 + unit(i + 0.3) * 2], phase: [unit(i + 0.4) * 6.283, unit(i + 0.5) * 6.283, unit(i + 0.6) * 6.283] });
  }
  node.obj = group;
  node.particles = { beads, start, end, shake };
}

/** Puts the particles where the spread (the object's draw) and the jostle (its laps) say. */
export function updateParticles(nodes: ReadonlyMap<number, FlowNode>, frame: Frame): void {
  for (const o of frame.objects) {
    if (o.shape !== 'particles') continue;
    const node = nodes.get(o.key);
    const cloud = node?.particles;
    if (!node || !cloud) continue;
    const def = o.def as AddParticles;
    const k = smooth(o.draw);
    const jostle = def.jitter ?? 0.12;
    const laps = o.phase ?? 0;
    const size = def.size ?? 0.14;
    cloud.beads.forEach((m, i) => {
      const a = cloud.start[i] as Vec3, b = cloud.end[i] as Vec3, s = cloud.shake[i] as { freq: Vec3; phase: Vec3 };
      m.position.set(
        a[0] + (b[0] - a[0]) * k + jostle * Math.sin(2 * Math.PI * (laps * s.freq[0] + s.phase[0] / 6.283)),
        a[1] + (b[1] - a[1]) * k + jostle * Math.sin(2 * Math.PI * (laps * s.freq[1] + s.phase[1] / 6.283)),
        a[2] + (b[2] - a[2]) * k + jostle * Math.sin(2 * Math.PI * (laps * s.freq[2] + s.phase[2] / 6.283)),
      );
      m.scale.setScalar(size);
    });
  }
}

// ---- Force arrows -----------------------------------------------------------------------------------------------------------------

export function buildForce(node: FlowNode, o: ObjectFrame, addMesh: AddMesh): void {
  void o;
  const group = new Group();
  const shaft = addMesh(new CylinderGeometry(0.5, 0.5, 1, 14), 'plastic', false);
  const head = addMesh(new ConeGeometry(0.5, 1, 18), 'plastic', false);
  group.add(shaft, head);
  node.obj = group;
  node.force = { shaft, head };
}

const dirV = new Vector3(), startV = new Vector3(), mid = new Vector3();

/**
 * Puts each force arrow on the part it acts on: it starts at a point of the part and points the way the scene says, whatever the part does (gravity stays
 * down as the part turns), strength units long (the object's scale and pulse make it more or less) and thicker the stronger.
 */
export function updateForces(nodes: ReadonlyMap<number, FlowNode>, frame: Frame): void {
  const byId = new Map<string, ObjectFrame>();
  for (const o of frame.objects) byId.set(o.id, o);
  for (const o of frame.objects) {
    if (o.shape !== 'force') continue;
    const node = nodes.get(o.key);
    const arrow = node?.force;
    if (!node || !arrow) continue;
    const def = o.def as AddForce;
    const host = byId.get(def.on);
    const hostNode = host && nodes.get(host.key);
    if (!host || !hostNode || !hostNode.obj.visible) {
      node.obj.visible = false;
      continue;
    }
    // It is placed in the scene's own space: its own place and turn are not used.
    node.obj.position.set(0, 0, 0);
    node.obj.rotation.set(0, 0, 0);
    node.obj.scale.set(1, 1, 1);
    node.obj.updateWorldMatrix(true, false);
    const inverse = new Matrix4().copy(node.obj.matrixWorld).invert();
    endPoint(hostNode.obj, host.def, undefined, def.point, hostNode.anchors, startV);
    startV.applyMatrix4(inverse);
    dirV.set(def.dir[0], def.dir[1], def.dir[2]).transformDirection(inverse);
    const grown = o.pose?.scale ?? [1, 1, 1];
    const strength = Math.max(0.02, def.strength * ((o.scale[0] + o.scale[1] + o.scale[2]) / 3) * ((grown[0] + grown[1] + grown[2]) / 3));
    const length = strength;
    const r = 0.05 + 0.025 * Math.min(strength, 8);
    const headLen = Math.min(length * 0.45, 0.35 + 3 * r);
    const shaftLen = Math.max(0.001, length - headLen);
    quat.setFromUnitVectors(UP, dirV);
    arrow.shaft.quaternion.copy(quat);
    arrow.head.quaternion.copy(quat);
    arrow.shaft.scale.set(2 * r, shaftLen, 2 * r);
    arrow.head.scale.set(4.4 * r, headLen, 4.4 * r);
    arrow.shaft.position.copy(mid.copy(startV).addScaledVector(dirV, shaftLen / 2));
    arrow.head.position.copy(mid.copy(startV).addScaledVector(dirV, shaftLen + headLen / 2));
  }
}
