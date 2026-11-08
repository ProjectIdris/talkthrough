// The mechanism part kit, drawn. A kit part (piston, crankshaft, gear, valve, a pipe...) is a row of data in src/scene/kit-presets.ts: its fitting, its
// settings, its named points and the list of shapes it is made of, with their numbers as formulas of its size. This file holds the general generators
// those rows call (a lathe, a cylinder, an extruded outline, a box, a sphere, a torus, a coil, instanced bolts) and the few lines that read a row and
// run them. There is no code per part: a new part, or another count or proportion for an old one, is a row. Cylindrical parts have their axis along y
// (the crank, cam, gear and bearing along z); the origin is the middle of the size box. The details of each part (proportions, anchors, what `n`
// counts) are in docs/scene-language.md, "The mechanism kit".

import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, InstancedMesh, LatheGeometry, Matrix4, Path, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { evaluate, num } from '../scene/kit-expr.ts';
import type { Scope } from '../scene/kit-expr.ts';
import { expand, KIT_PRESETS, rowScope } from '../scene/kit-presets.ts';
import type { Feature, Flow, Outline, PathOp, PointItem, Shape as ShapeRow, Transform } from '../scene/kit-presets.ts';
import { resolvePartGeometry } from '../scene/part-geometry.ts';
import type { AddPart, Vec3 } from '../scene/types.ts';
import { boxGeometry } from './geometry.ts';
import type { Detail } from './geometry.ts';
import { SECTION } from './materials.ts';
import { Builder, cyl } from './parts-base.ts';
import type { Rgb } from './timeline.ts';

/** The colours a row can name. */
const PALETTE: Readonly<Record<string, Rgb>> = {
  steel: [176, 182, 194], darkSteel: [92, 98, 110], bright: [214, 219, 228], ceramic: [238, 240, 244], liner: [78, 84, 96], rubber: [38, 40, 46], section: SECTION,
};

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
function bolts(b: Builder, at: ReadonlyArray<Vec3>, r: number, h: number, axis: 'y' | 'z', color: Rgb): void {
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

/** A coil of round wire: `turns` turns of radius `r` climbing `rise` from `y0`, `per` points to a turn. */
function coil(turns: number, per: number, r: number, y0: number, rise: number, wire: number, sides: number, crease: number): BufferGeometry {
  const pts: Vector3[] = [];
  const total = turns * per;
  for (let i = 0; i <= total; i++) {
    const t = i / total;
    const a = t * turns * Math.PI * 2;
    pts.push(new Vector3(Math.cos(a) * r, y0 + rise * t, Math.sin(a) * r));
  }
  return toCreasedNormals(new TubeGeometry(new CatmullRomCurve3(pts), total * 2, wire, sides, false), crease);
}

// ---- Reading a row ----------------------------------------------------------------------------------------------------

const triple = (e: readonly [never, never, never] | readonly (string | number | boolean)[], s: Scope): Vec3 => [num(e[0]!, s), num(e[1]!, s), num(e[2]!, s)];

function points(items: readonly PointItem[], s: Scope, out: Array<[number, number]> = []): Array<[number, number]> {
  for (const item of items) {
    if (Array.isArray(item)) out.push([num(item[0], s), num(item[1], s)]);
    else expand(item as Flow, s, (here) => points((item as { points: readonly PointItem[] }).points, here, out));
  }
  return out;
}

function trace(shape: Shape, op: PathOp, s: Scope, started: { done: boolean }): void {
  const a = (i: number) => num(op[i + 1] as never, s);
  switch (op[0]) {
    case 'M': shape.moveTo(a(0), a(1)); break;
    case 'L': shape.lineTo(a(0), a(1)); break;
    case 'P': if (started.done) shape.lineTo(a(0), a(1)); else shape.moveTo(a(0), a(1)); started.done = true; break;
    case 'A': shape.absarc(a(0), a(1), a(2), a(3), a(4), evaluate(op[6] as never, s) as boolean); break;
    case 'Z': shape.closePath(); break;
  }
}

function outlineShape(o: Outline, s: Scope): Shape {
  let shape: Shape;
  if ('ring' in o) return ringShape(num(o.ring[0], s), num(o.ring[1], s));
  if ('disc' in o) shape = disc(num(o.disc, s));
  else if ('roundRect' in o) shape = roundRect(num(o.roundRect[0], s), num(o.roundRect[1], s), num(o.roundRect[2], s));
  else {
    shape = new Shape();
    const started = { done: false };
    for (const item of o.path) {
      if (Array.isArray(item)) trace(shape, item as PathOp, s, started);
      else expand(item as Flow, s, (here) => { for (const op of (item as { ops: readonly PathOp[] }).ops) trace(shape, op, here, started); });
    }
  }
  for (const hole of o.holes ?? []) {
    expand(hole, s, (here) => {
      const [cx, cy, r] = triple(hole.circle, here);
      const path = new Path();
      path.absarc(cx, cy, r, 0, Math.PI * 2, true);
      shape.holes.push(path);
    });
  }
  return shape;
}

function transformed<T extends BufferGeometry>(geo: T, xf: readonly Transform[] | undefined, s: Scope): T {
  for (const op of xf ?? []) {
    if (op[0] === 'translate') geo.translate(num(op[1], s), num(op[2], s), num(op[3], s));
    else if (op[0] === 'rotateX') geo.rotateX(num(op[1], s));
    else if (op[0] === 'rotateY') geo.rotateY(num(op[1], s));
    else geo.rotateZ(num(op[1], s));
  }
  return geo;
}

function shapeGeometry(f: ShapeRow, s: Scope, d: Detail): BufferGeometry {
  const v = (e: Parameters<typeof num>[0]) => num(e, s);
  switch (f.kind) {
    case 'lathe': return transformed(spin(points(f.points, s), v(f.sides), v(f.crease)), f.xf, s);
    case 'cylinder': {
      const r = v(f.r), h = v(f.h), sides = v(f.sides);
      const geo = f.ends === false || f.arc ? new CylinderGeometry(r, r, h, sides, 1, f.ends === false, f.arc ? v(f.arc[0]) : 0, f.arc ? v(f.arc[1]) : Math.PI * 2) : cyl(r, r, h, sides);
      return transformed(f.axis === 'z' ? alongZ(geo) : geo, f.xf, s);
    }
    case 'slab': return transformed(slab(outlineShape(f.outline, s), v(f.depth), v(f.bevel), d), f.xf, s);
    case 'box': return boxGeometry(triple(f.size, s), v(f.radius), d);
    case 'sphere': return new SphereGeometry(v(f.r), v(f.across), v(f.down));
    case 'plane': return new PlaneGeometry(v(f.w), v(f.h));
    case 'torus': return transformed(toCreasedNormals(new TorusGeometry(v(f.R), v(f.r), v(f.radial), v(f.tubular), v(f.arc)), v(f.crease)), f.xf, s);
    case 'helix': return coil(v(f.turns), v(f.per), v(f.r), v(f.y0), v(f.rise), v(f.wire), v(f.sides), v(f.crease));
    default: throw new Error(`kit: ${(f as { kind: string }).kind} is not a shape`);
  }
}

const colour = (name: string | undefined): Rgb | undefined => {
  if (name === undefined) return undefined;
  const c = PALETTE[name];
  if (!c) throw new Error(`kit: ${name} is not a colour`);
  return c;
};

function run(b: Builder, features: readonly Feature[], scope: Scope, d: Detail): void {
  for (const f of features) {
    expand(f, scope, (s) => {
      if ('features' in f) { run(b, f.features, s, d); return; }
      if (f.kind === 'bolts') {
        const at: Vec3[] = [];
        for (const item of f.at) expand(item, s, (here) => at.push(triple(item.p, here)));
        bolts(b, at, num(f.r, s), num(f.h, s), f.axis, colour(f.color) ?? PALETTE.bright!);
        return;
      }
      b.add(shapeGeometry(f, s, d), f.surface, { tint: f.tint, color: colour(f.color), pos: f.pos && triple(f.pos, s), rot: f.rot && triple(f.rot, s), edges: f.edges, open: f.open });
    });
  }
}

/** Builds a mechanism part into the builder from its row of the kit table; false when `part` is not one of them. */
export function buildMechanismPart(b: Builder, def: AddPart, d: Detail): boolean {
  const row = KIT_PRESETS[def.part];
  if (!row) return false;
  const { size, anchors } = resolvePartGeometry(def);
  Object.assign(b.anchors, anchors);
  run(b, row.features, rowScope(row, size, def.n, def.variant, { curve: d.curve, radial: d.radial }), d);
  return true;
}
