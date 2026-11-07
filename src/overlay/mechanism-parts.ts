// The mechanism part kit: the ready-made parts of an engine, a gearbox or a pump, each built from plain
// three.js shapes and fitted to the box `size` it is given, so one short action gives a part that looks
// engineered. Every part has good proportions, its own materials and named anchor points. Cylindrical
// parts have their axis along y (the crank, cam, gear and bearing along z); the origin is the middle of
// the size box. The details of each part (proportions, anchors, what `n` counts) are in
// docs/scene-language.md, "The mechanism kit".

import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, InstancedMesh, LatheGeometry, Matrix4, Path, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AddPart, Vec3 } from '../scene/types.ts';
import { boxGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { crankThrow, pistonPinDrop, resolvePartGeometry, rodEnds } from '../scene/part-geometry.ts';
import { SECTION } from './materials.ts';
import { Builder, cyl } from './parts-base.ts';
import type { Rgb } from './timeline.ts';

const STEEL: Rgb = [176, 182, 194];
const DARK_STEEL: Rgb = [92, 98, 110];
const BRIGHT: Rgb = [214, 219, 228];
const CERAMIC: Rgb = [238, 240, 244];
const DEG = Math.PI / 180;

/** An outline (and optional holes) pushed out `depth` along z, centred on z = 0, with a small rounding. */
function slab(shape: Shape, depth: number, bevel: number, d: Detail): BufferGeometry {
  const b = Math.min(bevel, depth / 2 - 1e-3);
  const on = b > 0.004;
  const straight = Math.max(0.001, depth - (on ? 2 * b : 0));
  const geo = new ExtrudeGeometry(shape, { depth: straight, bevelEnabled: on, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: Math.max(1, d.bevel - 1), curveSegments: Math.max(10, d.curve / 2) });
  geo.translate(0, 0, -straight / 2);
  return toCreasedNormals(geo, 0.7);
}

const disc = (r: number): Shape => {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
};

const ringShape = (ro: number, ri: number): Shape => {
  const s = disc(ro);
  const h = new Path();
  h.absarc(0, 0, ri, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
};

/** A rounded rectangle centred on the origin. */
function roundRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = w / 2, y = h / 2, c = Math.min(r, x, y);
  s.moveTo(-x + c, -y);
  s.lineTo(x - c, -y);
  s.quadraticCurveTo(x, -y, x, -y + c);
  s.lineTo(x, y - c);
  s.quadraticCurveTo(x, y, x - c, y);
  s.lineTo(-x + c, y);
  s.quadraticCurveTo(-x, y, -x, y - c);
  s.lineTo(-x, -y + c);
  s.quadraticCurveTo(-x, -y, -x + c, -y);
  return s;
}

/** A profile of [radius, y] points spun round the y axis (smooth shading where the line is smooth). */
function spin(points: ReadonlyArray<readonly [number, number]>, sides: number, crease = 0.9): BufferGeometry {
  const geo = new LatheGeometry(points.map((p) => new Vector2(p[0], p[1])), Math.max(6, sides));
  return toCreasedNormals(geo, crease);
}

const alongZ = <T extends BufferGeometry>(geo: T): T => geo.rotateX(Math.PI / 2);

/**
 * Hex-headed bolts, one instanced draw for all of them. The head stands `h` proud of where it is placed (axis y: pointing
 * up; axis z: pointing towards the viewer) and has a washer face under it. An instanced piece is not capped when cut.
 */
function bolts(b: Builder, at: ReadonlyArray<Vec3>, r: number, h: number, axis: 'y' | 'z', color: Rgb = BRIGHT): void {
  if (at.length === 0) return;
  const head = new CylinderGeometry(r, r, h * 0.7, 6).translate(0, h * 0.35 + h * 0.3, 0);
  const washer = new CylinderGeometry(r * 1.25, r * 1.25, h * 0.3, 14).translate(0, h * 0.15, 0);
  const merged = mergeGeometries([head, washer].map((g) => g.toNonIndexed()))!;
  const geo = toCreasedNormals(axis === 'z' ? alongZ(merged) : merged, 0.6);
  const mesh = new InstancedMesh(geo, undefined as never, at.length);
  const m = new Matrix4();
  at.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
  mesh.instanceMatrix.needsUpdate = true;
  b.root.add(mesh);
  b.pieces.push({ object: mesh, surface: 'metal', tint: false, color, edges: false, closed: false });
}

// ---- Cylinder block: a block with a bore, optionally cut open to show inside, optionally finned ----------

function cylinderBlock(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const bore = Math.min(sx, sz) * 0.36;
  const cut = def.variant === 'cutaway';
  const shape = new Shape();
  if (cut) {
    // The back half only (z <= 0), with the bore as a half-round channel: the section is open to the viewer.
    shape.moveTo(-sx / 2, 0);
    shape.lineTo(-bore, 0);
    shape.absarc(0, 0, bore, Math.PI, 0, true);
    shape.lineTo(sx / 2, 0);
    shape.lineTo(sx / 2, sz / 2);
    shape.lineTo(-sx / 2, sz / 2);
    shape.closePath();
  } else {
    const outer = roundRect(sx, sz, Math.min(sx, sz) * 0.08);
    outer.holes.push((() => { const h = new Path(); h.absarc(0, 0, bore, 0, Math.PI * 2, true); return h; })());
    shape.copy(outer);
  }
  const geo = slab(shape, sy, 0.02 * sy, d).rotateX(-Math.PI / 2);
  b.add(geo, 'cast', { tint: true, edges: true });
  // The cut face of the half block: the two walls either side of the bore, hatched like a section drawing.
  if (cut) {
    const wall = sx / 2 - bore;
    for (const side of [-1, 1]) b.add(new PlaneGeometry(wall, sy * 0.999), 'section', { color: SECTION, pos: [side * (bore + wall / 2), 0, 0.003], open: true });
  }
  // Head bolts at the corners of the deck.
  const m = Math.min(sx, sz) * 0.11;
  const bz = cut ? [-(sz / 2 - m)] : [-(sz / 2 - m), sz / 2 - m];
  bolts(b, [-1, 1].flatMap((i) => bz.map((z): Vec3 => [i * (sx / 2 - m), sy / 2, z])), m * 0.42, m * 0.5, 'y', STEEL);
  // The bore wall, a darker honed liner, so the hole reads as a hole.
  const liner = new CylinderGeometry(bore * 1.004, bore * 1.004, sy * 0.98, d.curve, 1, true, cut ? Math.PI / 2 : 0, cut ? Math.PI : Math.PI * 2);
  b.add(liner, 'metal', { color: [78, 84, 96], open: true });
  if (def.variant === 'finned') {
    const n = def.n ?? 6;
    for (let i = 0; i < n; i++) {
      const y = -sy / 2 + sy * (0.18 + (0.62 * i) / Math.max(1, n - 1));
      for (const side of [-1, 1]) b.add(boxGeometry([sx * 0.16, sy * 0.028, sz * 0.96], 0.01, d), 'cast', { tint: true, pos: [side * (sx / 2 + sx * 0.06), y, 0] });
    }
  }
}

// ---- Piston: a crown, three rings and a wrist pin -------------------------------------------------------

function piston(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const r = sx / 2;
  // The crown is rounded over, and three ring grooves are cut into the land (the rings sit proud in them).
  const top = sy / 2;
  const profile: Array<[number, number]> = [[0, -sy / 2], [r * 0.92, -sy / 2], [r * 0.97, -sy / 2 + sy * 0.05], [r, -sy / 2 + sy * 0.12]];
  const groove = sy * 0.045, depth = r * 0.07;
  const centres = [0.1, 0.18, 0.26].map((k) => top - sy * k - sy * 0.04);
  profile.push([r, top - sy * 0.3 - groove]);
  for (const y of centres.slice().reverse()) profile.push([r, y - groove / 2], [r - depth, y - groove / 2], [r - depth, y + groove / 2], [r, y + groove / 2]);
  profile.push([r, top - sy * 0.035], [r * 0.97, top - sy * 0.012], [r * 0.9, top], [0, top]);
  b.add(spin(profile, d.curve, 0.6), 'metal', { tint: true, edges: false });
  for (const y of centres) b.add(cyl(r * 1.006, r * 1.006, groove * 0.72, d.curve), 'metal', { color: DARK_STEEL, pos: [0, y, 0] });
  b.add(cyl(r * 0.62, r * 0.62, sy * 0.012, d.curve), 'metal', { color: BRIGHT, pos: [0, sy / 2 + 0.002, 0] });
  b.add(alongZ(cyl(r * 0.2, r * 0.2, def.size[2] * 0.96, 18)), 'metal', { color: STEEL, pos: [0, -pistonPinDrop(def.size), 0] });
}

// ---- Connecting rod: big end, tapered shaft, small end ----------------------------------------------------

function connectingRod(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const rb = sx / 2;
  const rs = sx * 0.3;
  const { big: yb, small: ys } = rodEnds(def.size);
  b.add(slab(ringShape(rb, rb * 0.62), sz, 0.02 * sz, d), 'metal', { tint: true, pos: [0, yb, 0], edges: true });
  b.add(slab(ringShape(rs, rs * 0.55), sz * 0.8, 0.02 * sz, d), 'metal', { tint: true, pos: [0, ys, 0], edges: true });
  const shaft = new Shape();
  shaft.moveTo(-rb * 0.62, yb + rb * 0.7);
  shaft.lineTo(rb * 0.62, yb + rb * 0.7);
  shaft.lineTo(rs * 0.62, ys - rs * 0.7);
  shaft.lineTo(-rs * 0.62, ys - rs * 0.7);
  shaft.closePath();
  b.add(slab(shaft, sz * 0.66, 0.03 * sz, d), 'metal', { tint: true, edges: true });
  // The rib down the shaft (an I-beam's web) catches the light.
  const rib = new Shape();
  rib.moveTo(-rb * 0.2, yb + rb * 0.7);
  rib.lineTo(rb * 0.2, yb + rb * 0.7);
  rib.lineTo(rs * 0.2, ys - rs * 0.7);
  rib.lineTo(-rs * 0.2, ys - rs * 0.7);
  rib.closePath();
  b.add(slab(rib, sz, 0.02 * sz, d), 'metal', { color: BRIGHT });
  for (const side of [-1, 1]) b.add(cyl(sx * 0.055, sx * 0.055, sz * 1.04, 12), 'metal', { color: DARK_STEEL, rot: [90, 0, 0], pos: [side * rb * 0.82, yb - rb * 0.55, 0] });
}

// ---- Crankshaft: main journal along z, a throw (two webs, a counterweight and a pin) for each of n --------

function crankshaft(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const m = Math.min(sx, sy);
  const throwR = crankThrow(def.size);
  const rj = m * 0.11;
  const rp = rj * 0.92;
  const n = Math.max(1, Math.min(def.n ?? 1, 8));
  b.add(alongZ(cyl(rj, rj, sz, d.curve)), 'metal', { color: STEEL, edges: true });
  const pitch = sz / n;
  const web = Math.min(pitch * 0.16, sz * 0.12);
  for (let i = 0; i < n; i++) {
    const z = -sz / 2 + pitch * (i + 0.5);
    const a = (n > 1 ? (i * 360) / n : 0) * DEG;
    const rot = (g: BufferGeometry) => g.rotateZ(a);
    // Two webs, each a slot from the journal out to the pin; the counterweight is a wedge opposite the pin, a little
    // thicker than the web so the faces never lie in one plane.
    for (const side of [-1, 1]) {
      const zz = z + side * pitch * 0.2;
      const slot = roundRect(rj * 3, throwR + rj * 3, rj * 1.4);
      b.add(rot(slab(slot, web, web * 0.2, d).translate(0, throwR / 2, 0)).translate(0, 0, zz), 'cast', { tint: true, edges: true });
      const cw = new Shape();
      const half = 62 * DEG;
      cw.moveTo(0, 0);
      cw.absarc(0, 0, m * 0.44, -Math.PI / 2 - half, -Math.PI / 2 + half, false);
      cw.closePath();
      b.add(rot(slab(cw, web * 1.14, web * 0.2, d)).translate(0, 0, zz), 'cast', { tint: true, edges: true });
    }
    const pin = alongZ(cyl(rp, rp, pitch * 0.4, d.curve));
    pin.translate(0, throwR, 0);
    b.add(rot(pin).translate(0, 0, z), 'metal', { color: BRIGHT, edges: true });
  }
}

// ---- Valve: a lathe-turned stem and head; the head points down (-y) ----------------------------------------

function valve(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const rh = sx / 2;
  const rs = sx * 0.09;
  const y0 = -sy / 2;
  b.add(spin([[0, y0], [rh, y0], [rh * 0.97, y0 + sy * 0.035], [rs * 1.7, y0 + sy * 0.13], [rs, y0 + sy * 0.2], [rs, sy / 2 - sy * 0.05], [rs * 0.78, sy / 2 - sy * 0.025], [rs * 0.78, sy / 2], [0, sy / 2]], d.curve, 0.7), 'metal', { tint: true, edges: false });
  b.add(cyl(rs * 1.5, rs * 1.5, sy * 0.025, 14), 'metal', { color: DARK_STEEL, pos: [0, sy / 2 - sy * 0.09, 0] });
}

// ---- Camshaft: a shaft along z with n lobes, each with its nose at +y when the shaft is at angle 0 ---------

function camshaft(b: Builder, def: AddPart, d: Detail): void {
  const [sx, , sz] = def.size;
  const rs = sx * 0.15;
  const rBase = sx * 0.27;
  const rNose = sx / 2;
  const n = Math.max(1, Math.min(def.n ?? 4, 12));
  // The shaft runs the whole length with a bearing journal near each end, so a lobe sits on a shaft, not on a point.
  b.add(alongZ(cyl(rs, rs, sz, d.curve)), 'metal', { color: STEEL, edges: true });
  for (const end of [-1, 1]) {
    b.add(alongZ(cyl(rs * 1.3, rs * 1.3, sz * 0.1, d.curve)), 'metal', { color: BRIGHT, pos: [0, 0, end * sz * 0.4], edges: true });
    b.add(alongZ(cyl(rs * 1.3, rs * 1.3, sz * 0.04, d.curve)), 'metal', { color: DARK_STEEL, pos: [0, 0, end * sz * 0.485] });
  }
  const pitch = sz / n;
  const lobeW = Math.min(pitch * 0.34, sz * 0.3);
  // A real lobe: a round base circle over most of the turn, two smooth flanks rising to a rounded nose (a quarter turn
  // either side of the nose is flank, the rest is base circle).
  const steps = 72;
  const flank = 64 * DEG;
  for (let i = 0; i < n; i++) {
    const s = new Shape();
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const away = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
      const lift = away >= flank ? 0 : 0.5 * (1 + Math.cos((Math.PI * away) / flank));
      const r = rBase + (rNose - rBase) * lift;
      if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    const z = -sz / 2 + pitch * (i + 0.5);
    b.add(slab(s, lobeW, lobeW * 0.1, d), 'metal', { tint: true, pos: [0, 0, z], edges: true });
    // The journal either side of the lobe, a little wider than the shaft.
    for (const side of [-1, 1]) b.add(alongZ(cyl(rs * 1.35, rs * 1.35, lobeW * 0.35, d.curve)), 'metal', { color: DARK_STEEL, pos: [0, 0, z + side * (lobeW / 2 + lobeW * 0.17)] });
  }
}

// ---- Spark plug: thread, hex, ceramic, terminal and the electrode --------------------------------------------

function sparkPlug(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const y0 = -sy / 2;
  const shellR = sx * 0.34;
  const threads: Array<[number, number]> = [[0, y0 + sy * 0.06]];
  const teeth = 9;
  for (let i = 0; i <= teeth; i++) {
    const y = y0 + sy * (0.06 + (0.22 * i) / teeth);
    threads.push([shellR * (i % 2 ? 0.93 : 1), y]);
  }
  threads.push([shellR * 0.93, y0 + sy * 0.3], [0, y0 + sy * 0.3]);
  b.add(spin(threads, d.curve, 0.5), 'metal', { color: STEEL, edges: false });
  b.add(cyl(sx * 0.5, sx * 0.5, sy * 0.1, 6), 'metal', { color: BRIGHT, pos: [0, y0 + sy * 0.35, 0], edges: true });
  b.add(spin([[0, y0 + sy * 0.4], [sx * 0.26, y0 + sy * 0.4], [sx * 0.26, y0 + sy * 0.62], [sx * 0.3, y0 + sy * 0.64], [sx * 0.3, y0 + sy * 0.67], [sx * 0.26, y0 + sy * 0.69], [sx * 0.26, y0 + sy * 0.78], [sx * 0.3, y0 + sy * 0.8], [sx * 0.3, y0 + sy * 0.83], [sx * 0.23, y0 + sy * 0.85], [sx * 0.23, y0 + sy * 0.92], [0, y0 + sy * 0.92]], d.curve, 0.6), 'plastic', { color: CERAMIC });
  b.add(cyl(sx * 0.09, sx * 0.09, sy * 0.1, 14), 'metal', { color: STEEL, pos: [0, sy / 2 - sy * 0.04, 0] });
  b.add(cyl(sx * 0.15, sx * 0.15, sy * 0.025, 6), 'metal', { color: BRIGHT, pos: [0, sy / 2 - sy * 0.06, 0] });
  b.add(cyl(sx * 0.045, sx * 0.045, sy * 0.09, 10), 'metal', { color: BRIGHT, pos: [0, y0 + sy * 0.015, 0] });
  b.add(boxGeometry([sx * 0.4, sy * 0.02, sx * 0.07], 0, d), 'metal', { color: STEEL, pos: [sx * 0.17, y0 + sy * 0.02, 0] });
}

// ---- Gear: n teeth, a hub and lightening holes; the axis is z -------------------------------------------------

function gear(b: Builder, def: AddPart, d: Detail): void {
  const [sx, , sz] = def.size;
  const n = Math.max(6, Math.min(def.n ?? 16, 120));
  const rOut = sx / 2;
  const rRoot = rOut * (n > 40 ? 0.93 : 0.86);
  const pitch = (Math.PI * 2) / n;
  const s = new Shape();
  for (let i = 0; i < n; i++) {
    const a = i * pitch;
    const at = (r: number, k: number): [number, number] => [Math.cos(a + k * pitch) * r, Math.sin(a + k * pitch) * r];
    const pts = [at(rRoot, -0.31), at(rOut, -0.15), at(rOut, 0.15), at(rRoot, 0.31)];
    pts.forEach((p, k) => (i === 0 && k === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1])));
  }
  s.closePath();
  const bore = new Path();
  bore.absarc(0, 0, rOut * 0.16, 0, Math.PI * 2, true);
  s.holes.push(bore);
  if (n >= 14) {
    const holes = Math.min(6, Math.floor(n / 3));
    for (let i = 0; i < holes; i++) {
      const h = new Path();
      const a = (i / holes) * Math.PI * 2;
      h.absarc(Math.cos(a) * rOut * 0.5, Math.sin(a) * rOut * 0.5, rOut * 0.11, 0, Math.PI * 2, true);
      s.holes.push(h);
    }
  }
  b.add(slab(s, sz, Math.min(sz * 0.12, 0.05), d), 'metal', { tint: true, edges: true });
  b.add(alongZ(cyl(rOut * 0.26, rOut * 0.26, sz * 1.25, d.curve)), 'metal', { color: DARK_STEEL, edges: true });
}

// ---- Spring: a coil of wire along y --------------------------------------------------------------------------

function spring(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const turns = Math.max(2, Math.min(def.n ?? 8, 40));
  const wire = Math.max(0.01, Math.min(sx * 0.07, (sy / turns) * 0.34));
  const r = sx / 2 - wire;
  const pts: Vector3[] = [];
  const per = 14;
  const total = turns * per;
  for (let i = 0; i <= total; i++) {
    const t = i / total;
    const a = t * turns * Math.PI * 2;
    // The end coils sit flat on their seats; the ones between climb evenly.
    const y = -sy / 2 + wire + (sy - 2 * wire) * t;
    pts.push(new Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  const geo = new TubeGeometry(new CatmullRomCurve3(pts), total * 2, wire, 8, false);
  b.add(toCreasedNormals(geo, 0.8), 'metal', { tint: true });
}

// ---- Bearing: outer race, inner race and balls; the axis is z -----------------------------------------------

function bearing(b: Builder, def: AddPart, d: Detail): void {
  const [sx, , sz] = def.size;
  const ro = sx / 2;
  b.add(slab(ringShape(ro, ro * 0.8), sz, sz * 0.08, d), 'metal', { tint: true, edges: true });
  b.add(slab(ringShape(ro * 0.6, ro * 0.34), sz, sz * 0.08, d), 'metal', { color: BRIGHT, edges: true });
  const n = Math.max(5, Math.min(def.n ?? 9, 16));
  const rb = ro * 0.1;
  const pitch = ro * 0.7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    b.add(new SphereGeometry(rb, 14, 10), 'metal', { color: STEEL, pos: [Math.cos(a) * pitch, Math.sin(a) * pitch, 0] });
  }
  b.add(slab(ringShape(ro * 0.8, ro * 0.61), sz * 0.3, 0, d), 'rubber', { color: [38, 40, 46] });
}

// ---- Pipe and elbow: hollow tubes with flanges ----------------------------------------------------------------

function pipe(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy] = def.size;
  const ro = sx / 2 / 1.28; // the flanges are a little wider than the tube, and the box holds them
  const ri = ro * 0.84;
  const h = sy / 2;
  b.add(spin([[ri, -h], [ro, -h], [ro, h], [ri, h], [ri, -h]], d.curve, 0.8), 'metal', { tint: true, edges: false });
  for (const side of [-1, 1]) b.add(spin([[ri, -sy * 0.03], [ro * 1.28, -sy * 0.03], [ro * 1.28, sy * 0.03], [ri, sy * 0.03], [ri, -sy * 0.03]], d.curve, 0.6).translate(0, side * (h - sy * 0.04), 0), 'metal', { color: DARK_STEEL, edges: true });
}

function elbow(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const r = sz / 2;
  // The tube's outside, end to end, is the smaller of the box's two sides (bend plus a tube width).
  const bend = Math.max(r * 1.2, Math.min(sx, sy) - 2 * r);
  const cx = -bend / 2, cy = -bend / 2;
  b.add(toCreasedNormals(new TorusGeometry(bend, r, d.radial, d.curve, Math.PI / 2), 0.8).translate(cx, cy, 0), 'metal', { tint: true, edges: false });
  // Flanges at the two ends: one opens downwards at (bend, 0), the other to the left at (0, bend).
  b.add(cyl(r * 1.3, r * 1.3, r * 0.22, d.curve), 'metal', { color: DARK_STEEL, pos: [cx + bend, cy - r * 0.02, 0], edges: true });
  b.add(alongZ(cyl(r * 1.3, r * 1.3, r * 0.22, d.curve)).rotateZ(Math.PI / 2), 'metal', { color: DARK_STEEL, pos: [cx - r * 0.02, cy + bend, 0], edges: true });
}

// ---- Housing: a casing with a lip and bolts; "cutaway" leaves the front open so the inside shows --------------

function housing(b: Builder, def: AddPart, d: Detail): void {
  const [sx, sy, sz] = def.size;
  const t = Math.min(sx, sy, sz) * 0.07;
  if (def.variant === 'cutaway') {
    b.add(boxGeometry([sx, sy, t], t * 0.3, d), 'enamel', { tint: true, pos: [0, 0, -sz / 2 + t / 2], edges: true });
    for (const side of [-1, 1]) b.add(boxGeometry([t, sy, sz], t * 0.3, d), 'enamel', { tint: true, pos: [side * (sx / 2 - t / 2), 0, 0], edges: true });
    for (const side of [-1, 1]) b.add(boxGeometry([sx, t, sz], t * 0.3, d), 'enamel', { tint: true, pos: [0, side * (sy / 2 - t / 2), 0], edges: true });
  } else {
    b.add(boxGeometry(def.size, t * 0.5, d), 'enamel', { tint: true, edges: true });
  }
  // A lip round the open or front face, and a bolt in each corner.
  const lip = [sx * 1.04, sy * 1.04, t * 0.6] as Vec3;
  if (def.variant === 'cutaway') {
    for (const sideX of [-1, 1]) b.add(boxGeometry([t * 1.2, sy * 1.04, t * 0.6], t * 0.2, d), 'enamel', { tint: true, pos: [sideX * (sx / 2 - t * 0.1), 0, sz / 2], edges: true });
    for (const sideY of [-1, 1]) b.add(boxGeometry([sx * 1.04, t * 1.2, t * 0.6], t * 0.2, d), 'enamel', { tint: true, pos: [0, sideY * (sy / 2 - t * 0.1), sz / 2], edges: true });
  } else {
    b.add(boxGeometry(lip, t * 0.2, d), 'enamel', { tint: true, pos: [0, 0, sz / 2 - t * 0.3], edges: true });
  }
  bolts(b, [-1, 1].flatMap((sx1) => [-1, 1].map((sy1): Vec3 => [sx1 * (sx / 2 - t * 1.1), sy1 * (sy / 2 - t * 1.1), sz / 2 - t * 0.1])), t * 0.5, t * 0.6, 'z');
}

export const MECHANISM_PARTS = ['cylinder-block', 'piston', 'connecting-rod', 'crankshaft', 'valve', 'camshaft', 'spark-plug', 'gear', 'spring', 'bearing', 'pipe', 'elbow', 'housing'] as const;

const BUILDERS: Record<string, (b: Builder, def: AddPart, d: Detail) => void> = {
  'cylinder-block': cylinderBlock, piston, 'connecting-rod': connectingRod, crankshaft, valve, camshaft, 'spark-plug': sparkPlug, gear, spring, bearing, pipe, elbow, housing,
};

/** Builds a mechanism part into the builder; false when `part` is not one of them. */
export function buildMechanismPart(b: Builder, def: AddPart, d: Detail): boolean {
  const build = BUILDERS[def.part];
  if (!build) return false;
  const { size, anchors } = resolvePartGeometry(def);
  Object.assign(b.anchors, anchors);
  build(b, { ...def, size }, d);
  return true;
}

