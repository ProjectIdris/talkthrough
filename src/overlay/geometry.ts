// Geometry builders for the modelling vocabulary: bevelled boxes, extrusions from an outline,
// lathes from a profile and tubes along a curve. They only make three.js geometry; nothing here
// touches the DOM.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, LatheGeometry, Path, Shape, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shadeExtrusion } from './extrusion-normals.ts';
import { BLOB_CELLS, SCENE_BLOB_TRIANGLES } from './blob.ts';
import { shadeLatheProfile } from './lathe.ts';
import { sampleOpenCurve } from './open-curve.ts';
import type { Vec2, Vec3 } from '../scene/types.ts';
import { normalizeExtrudeProfile } from '../scene/extrude-profile.ts';

export type Detail = { curve: number; bevel: number; radial: number; tube: number; blob: number; blobTriangles: number };
export const DETAIL: Record<'low' | 'mid' | 'high', Detail> = {
  low: { curve: 20, bevel: 2, radial: 10, tube: 8, blob: BLOB_CELLS.low, blobTriangles: SCENE_BLOB_TRIANGLES.low },
  mid: { curve: 36, bevel: 3, radial: 14, tube: 12, blob: BLOB_CELLS.mid, blobTriangles: SCENE_BLOB_TRIANGLES.mid },
  high: { curve: 64, bevel: 5, radial: 24, tube: 18, blob: BLOB_CELLS.high, blobTriangles: SCENE_BLOB_TRIANGLES.high },
};

/** The default rounding of a box edge: a small fraction of its smallest side, so parts look moulded rather than cut. */
export function defaultBevel(size: Vec3): number {
  return Math.min(0.12, Math.min(size[0], size[1], size[2]) * 0.1);
}

/** A box with rounded edges (a plain box when the rounding is nothing). */
export function boxGeometry(size: Vec3, bevel: number, detail: Detail): BufferGeometry {
  const shortest = Math.min(size[0], size[1], size[2]);
  // Keep rounding and the small flat seam proportional to the shape. Fixed unit cutoffs
  // made compact models (and thin panels enlarged by a parent) unexpectedly sharp.
  const r = Math.min(bevel, shortest * 0.4999);
  // Positions are Float32: a tiny radius on a wide, thin box can otherwise collapse
  // rounded triangles or reverse their winding. Base this precision floor on the long side.
  if (!(r > Math.max(...size) * 1e-6)) return new BoxGeometry(size[0], size[1], size[2]);
  return new RoundedBoxGeometry(size[0], size[1], size[2], detail.bevel, r);
}

/**
 * Earcut can bridge aligned openings with a cap edge that runs through other
 * boundary vertices. Split that edge at those vertices so the cap and the
 * independently built side walls have the same welded topology.
 */
function splitCapEdges(geo: BufferGeometry, rings: readonly (readonly Vec2[])[]): void {
  const points = rings.flat();
  const byPosition = new Map(points.map((p) => [`${Math.fround(p[0])},${Math.fround(p[1])}`, p]));
  const attrs = ['position', 'normal', 'uv'] as const;
  const source = attrs.map((name) => geo.getAttribute(name));
  const data: number[][] = attrs.map(() => []);
  type Vertex = { original: Vec2; values: number[][] };
  const vertex = (i: number): Vertex => {
    const values = source.map((a) => Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j)));
    const original = byPosition.get(`${values[0]![0]},${values[0]![1]}`);
    if (!original) throw new Error('Extrusion cap contains an unexpected vertex');
    return { original, values };
  };
  const split = (triangle: Vertex[]): Vertex[][] => {
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!, c = triangle[(edge + 2) % 3]!;
      const dx = b.original[0] - a.original[0], dy = b.original[1] - a.original[1];
      const length2 = dx * dx + dy * dy;
      for (const p of points) {
        if ((p[0] === a.original[0] && p[1] === a.original[1]) ||
            (p[0] === b.original[0] && p[1] === b.original[1]) ||
            (p[0] === c.original[0] && p[1] === c.original[1])) continue;
        const px = p[0] - a.original[0], py = p[1] - a.original[1];
        const t = (px * dx + py * dy) / length2;
        if (!(t > 0 && t < 1) || dx * py - dy * px !== 0) continue;
        const values = a.values.map((v, k) => v.map((x, j) => x + t * (b.values[k]![j]! - x)));
        values[0]![0] = Math.fround(p[0]); values[0]![1] = Math.fround(p[1]);
        const middle: Vertex = { original: p, values };
        return [...split([a, middle, c]), ...split([middle, b, c])];
      }
    }
    return [triangle];
  };
  const groups = geo.groups.map((group) => ({ ...group }));
  geo.clearGroups();
  let start = 0;
  for (const group of groups) {
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const triangles = group.materialIndex === 0 ? split([vertex(i), vertex(i + 1), vertex(i + 2)]) : undefined;
      if (triangles) {
        for (const triangle of triangles) for (const v of triangle) v.values.forEach((values, k) => data[k]!.push(...values));
      } else {
        for (let j = 0; j < 3; j++) source.forEach((a, k) => {
          for (let c = 0; c < a.itemSize; c++) data[k]!.push(a.getComponent(i + j, c));
        });
      }
    }
    const count = data[0]!.length / 3 - start;
    geo.addGroup(start, count, group.materialIndex);
    start += count;
  }
  attrs.forEach((name, i) => geo.setAttribute(name, new BufferAttribute(new Float32Array(data[i]!), source[i]!.itemSize)));
}

/** A flat outline pushed out `depth` along z and centred on z = 0. */
export function extrudeGeometry(outline: readonly Vec2[], depth: number, bevel: number, detail: Detail, holes?: readonly (readonly Vec2[])[]): BufferGeometry {
  if (holes?.length) {
    const normalized = normalizeExtrudeProfile(outline, holes);
    // The generated positions are Float32, so triangulate those same coordinates.
    const round = (ring: Vec2[]): Vec2[] => ring.map(([x, y]) => [Math.fround(x), Math.fround(y)]);
    const profile = { outline: round(normalized.outline), holes: normalized.holes.map(round) };
    const shape = new Shape();
    profile.outline.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
    shape.closePath();
    for (const ring of profile.holes) {
      const path = new Path();
      ring.forEach((p, i) => (i === 0 ? path.moveTo(p[0], p[1]) : path.lineTo(p[0], p[1])));
      path.closePath();
      shape.holes.push(path);
    }
    const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
    splitCapEdges(geo, [profile.outline, ...profile.holes]);
    geo.translate(0, 0, -depth / 2);
    // Use exact shared corners to smooth curved inner and outer walls without
    // blending nearby openings, sharp outline corners or the flat cap boundary.
    shadeExtrusion(geo);
    return geo;
  }
  const shape = new Shape();
  outline.forEach((p, i) => (i === 0 ? shape.moveTo(p[0], p[1]) : shape.lineTo(p[0], p[1])));
  shape.closePath();
  const b = Math.min(bevel, depth / 2 - 1e-3, 2);
  const useBevel = b > 0.004;
  const straight = Math.max(0.001, depth - (useBevel ? 2 * b : 0));
  const geo = new ExtrudeGeometry(shape, {
    depth: straight, bevelEnabled: useBevel, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: detail.bevel, curveSegments: 8,
  });
  geo.translate(0, 0, -straight / 2);
  shadeExtrusion(geo);
  return geo;
}

/** A profile of [radius, y] points spun round the y axis. */
export function latheGeometry(profile: readonly Vec2[], sides: number): BufferGeometry {
  const pts = profile.map((p) => new Vector2(Math.abs(p[0]), p[1]));
  const first = pts[0], last = pts.at(-1);
  if (first && last && (first.equals(last) || (first.x === 0 && last.x === 0))) {
    // A closed section has an outside regardless of the direction it was drawn.
    // Open sheets retain their authored direction, which chooses their visible side.
    // Translate before summing area so a small section far from y=0 stays stable.
    let area = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      area += (a.x - first.x) * (b.y - first.y) - (b.x - first.x) * (a.y - first.y);
    }
    if (area < 0) pts.reverse();
  }
  const segments = Math.max(3, Math.round(sides));
  const source = new LatheGeometry(pts, segments);
  const geo = source.toNonIndexed();
  source.dispose();
  shadeLatheProfile(geo, pts, segments);
  return geo;
}

/**
 * A cylinder (or an elliptic one: `sz` is its depth) with a small rounded rim, so its edge catches the light instead of ending in a razor line.
 * The rim is a quarter circle of about a seventh of the smaller of the radius and half the height, at most 0.12 (the same limit as a box's rounding).
 */
export function roundedCylinderGeometry(sx: number, sy: number, sz: number, sides: number): BufferGeometry {
  const r = Math.max(1e-4, sx / 2), h = Math.max(1e-4, sy);
  const b = Math.min(0.12, Math.min(r, h / 2) * 0.14);
  const profile: Vec2[] = [[0, -h / 2]];
  const steps = 4;
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    profile.push([r - b + b * Math.sin(a), -h / 2 + b - b * Math.cos(a)]);
  }
  for (let k = steps; k >= 0; k--) {
    const a = (k / steps) * (Math.PI / 2);
    profile.push([r - b + b * Math.sin(a), h / 2 - b + b * Math.cos(a)]);
  }
  profile.push([0, h / 2]);
  const geo = latheGeometry(profile, sides);
  return geo.scale(1, 1, sz / Math.max(sx, 1e-6));
}

/**
 * Light to shade over a blob: its vertices get a colour from the way each faces (up a little lighter, down a good deal darker), which the
 * material multiplies into its own colour. One flat colour made soft tissue read as a cut-out.
 */
export function shadeByHeight(geo: BufferGeometry): void {
  const normal = geo.getAttribute('normal');
  if (!normal) return;
  const colour = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const up = normal.getY(i) * 0.5 + 0.5;
    const v = 0.72 + 0.36 * up;
    colour[i * 3] = v; colour[i * 3 + 1] = v; colour[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(colour, 3));
}

/** Points along the path: smooth (a spline) for tubes, straight between the points for lines. */
export function samplePath(pts: readonly Vec3[], smooth: boolean, perSegment: number): Vec3[] {
  return smooth ? sampleOpenCurve(pts, perSegment) : pts.map(p => [...p]);
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

/** The radius factor a swell profile of [along 0..1, factor] points gives at `t` along a tube: smooth between the points, held beyond the ends, never below a sliver. */
export function swellAt(swell: readonly Vec2[], t: number): number {
  const pts = [...swell].sort((a, b) => a[0] - b[0]);
  const first = pts[0] as Vec2, last = pts[pts.length - 1] as Vec2;
  if (t <= first[0]) return Math.max(0.02, first[1]);
  if (t >= last[0]) return Math.max(0.02, last[1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as Vec2, b = pts[i + 1] as Vec2;
    if (t >= a[0] && t <= b[0]) {
      const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1;
      const s = u * u * (3 - 2 * u);
      return Math.max(0.02, a[1] + (b[1] - a[1]) * s);
    }
  }
  return Math.max(0.02, last[1]);
}

/** A tube thinner than this (flat) is a ribbon and is left as cut; rounder ones are capped. */
const CAP_MIN_FLAT = 0.5;
/** Rings in a rounded cap. */
const CAP_RINGS = 5;

/**
 * A tube along the sampled points. `flat` squashes it into a ribbon whose wide side runs across the
 * path (across x for a path going up or along z, across z for a path going along x), so a cable seen from the front shows its width.
 * `capDepth`, when given, is the most a rounded end may reach past its ring (a squashed end: shallower than it is wide); the end stays round when the tube is long.
 * The index runs ring after ring, so `drawRange` reveals it from the start. `across`, when given, is the way the wide side faces (a belt's width runs along its wheels' axis).
 */
export function tubeGeometry(path: readonly Vec3[], baseRadius: number, flat: number, radial: number, swell?: readonly Vec2[], across?: Vec3, capDepth?: number): BufferGeometry {
  const rings = path.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const tangent = new Vector3();
  const wide = new Vector3();
  const thin = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const centre = new Vector3();
  const frames: Array<{ centre: Vector3; wide: Vector3; thin: Vector3; tangent: Vector3; radius: number }> = [];
  for (let i = 0; i < rings; i++) {
    const p = path[i] as Vec3;
    const prev = path[Math.max(0, i - 1)] as Vec3;
    const next = path[Math.min(rings - 1, i + 1)] as Vec3;
    tangent.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 1);
    tangent.normalize();
    // A round tube carries the last ring's frame along (parallel transport), so it never twists where the path passes straight up or down:
    // choosing a frame from "up" at every ring flips it there, which drew a hard seam across a bent tube. A flat ribbon keeps its frame from "up"
    // (a ribbon that starts flat and bends up then faces the viewer, as the scene language says), made continuous: never turned over from one ring to the next.
    // The reference turns from up to forward smoothly as the path nears the vertical (a hard switch at 0.95 turned a ribbon a quarter turn between two rings).
    const lean = Math.abs(tangent.dot(UP));
    const k = Math.max(0, Math.min(1, (lean - 0.3) / 0.68));
    const mix = k * k * (3 - 2 * k);
    const ref = new Vector3().addScaledVector(UP, 1 - mix).addScaledVector(FORWARD, mix).normalize();
    if (flat === 1 && i > 0) {
      wide.addScaledVector(tangent, -wide.dot(tangent));
      if (wide.lengthSq() < 1e-12) wide.crossVectors(tangent, ref);
      wide.normalize();
    } else {
      const before = i > 0 ? wide.clone() : undefined;
      wide.crossVectors(tangent, ref);
      if (wide.lengthSq() < 1e-12) wide.crossVectors(tangent, Math.abs(tangent.dot(UP)) > 0.95 ? FORWARD : UP);
      wide.normalize();
      if (before && wide.dot(before) < 0) wide.negate();
    }
    // A given `across` (a belt's width along its wheels' axis) is the way the wide side faces, whatever the path does.
    if (across) {
      wide.set(across[0], across[1], across[2]).addScaledVector(tangent, -tangent.x * across[0] - tangent.y * across[1] - tangent.z * across[2]);
      if (wide.lengthSq() < 1e-8) wide.crossVectors(tangent, ref);
      wide.normalize();
    }
    thin.crossVectors(wide, tangent).normalize();
    centre.set(p[0], p[1], p[2]);
    const radius = baseRadius * (swell ? swellAt(swell, rings > 1 ? i / (rings - 1) : 0) : 1);
    frames.push({ centre: centre.clone(), wide: wide.clone(), thin: thin.clone(), tangent: tangent.clone(), radius });
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      a.copy(wide).multiplyScalar(c * radius);
      b.copy(thin).multiplyScalar(s * radius * flat);
      pos.push(centre.x + a.x + b.x, centre.y + a.y + b.y, centre.z + a.z + b.z);
      // The normal of an ellipse: scale the cosine part by the other radius.
      const nx = wide.x * c * flat + thin.x * s;
      const ny = wide.y * c * flat + thin.y * s;
      const nz = wide.z * c * flat + thin.z * s;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
    }
  }
  const row = radial + 1;
  // Follow the swept skin, including taper and a ribbon's changing orientation.
  // Radial-only normals make the shoulders of a swollen tube shade like a cylinder.
  // Keep the analytic direction around each ellipse to avoid radial faceting or a seam.
  const along = new Vector3(), around = new Vector3(), normal = new Vector3();
  for (let i = 0; i < rings; i++) {
    const frame = frames[i]!;
    const prev = Math.max(0, i - 1), next = Math.min(rings - 1, i + 1);
    for (let j = 0; j <= radial; j++) {
      const offset = (i * row + j) * 3;
      const before = (prev * row + j) * 3, after = (next * row + j) * 3;
      along.set(pos[after]! - pos[before]!, pos[after + 1]! - pos[before + 1]!, pos[after + 2]! - pos[before + 2]!);
      const angle = (j / radial) * Math.PI * 2;
      around.copy(frame.wide).multiplyScalar(-Math.sin(angle)).addScaledVector(frame.thin, flat * Math.cos(angle));
      normal.crossVectors(along, around);
      // A repeated point or folded/collapsed span has no usable surface derivative.
      // Retain the finite outward ellipse normal already assigned to that vertex.
      if (normal.lengthSq() > 0 && (normal.x * nor[offset]! + normal.y * nor[offset + 1]! + normal.z * nor[offset + 2]!) > 0) {
        normal.normalize();
        nor[offset] = normal.x; nor[offset + 1] = normal.y; nor[offset + 2] = normal.z;
      }
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  // A free end is closed with a rounded cap that follows the tube's taper (a stem's top, a vessel's open end), so nothing looks sawn off. The caps go after
  // the body in the vertex list; the index list is the start cap, the body, the end cap (see drawFraction). A ribbon is left as cut.
  const bodyIndices = idx.length;
  let startCap = 0, endCap = 0;
  if (flat >= CAP_MIN_FLAT && rings >= 2) {
    const cap = (frame: (typeof frames)[number], dir: 1 | -1): number[] => {
      const base = pos.length / 3;
      const out: number[] = [];
      for (let k = 1; k <= CAP_RINGS; k++) {
        const th = (k / CAP_RINGS) * (Math.PI / 2);
        const scale = Math.cos(th);
        // A flattened cap is an ellipsoid of depth D and radius R: its normal tilts along the tangent by R / D.
        const depth = capDepth === undefined ? frame.radius : Math.max(1e-6, Math.min(frame.radius, capDepth));
        const tilt = frame.radius / depth;
        const lift = depth * Math.sin(th) * dir;
        for (let j = 0; j <= radial; j++) {
          const ang = (j / radial) * Math.PI * 2;
          const c = Math.cos(ang), sn = Math.sin(ang);
          const r = frame.radius * scale;
          pos.push(
            frame.centre.x + frame.wide.x * c * r + frame.thin.x * sn * r * flat + frame.tangent.x * lift,
            frame.centre.y + frame.wide.y * c * r + frame.thin.y * sn * r * flat + frame.tangent.y * lift,
            frame.centre.z + frame.wide.z * c * r + frame.thin.z * sn * r * flat + frame.tangent.z * lift,
          );
          // Ellipsoid gradient: the thin axis needs the reciprocal flattening, including relative to the tangent.
          const nx = frame.wide.x * c * flat * scale + frame.thin.x * sn * scale + frame.tangent.x * Math.sin(th) * dir * flat * tilt;
          const ny = frame.wide.y * c * flat * scale + frame.thin.y * sn * scale + frame.tangent.y * Math.sin(th) * dir * flat * tilt;
          const nz = frame.wide.z * c * flat * scale + frame.thin.z * sn * scale + frame.tangent.z * Math.sin(th) * dir * flat * tilt;
          const l = Math.hypot(nx, ny, nz) || 1;
          nor.push(nx / l, ny / l, nz / l);
        }
      }
      // The first cap ring joins the tube's own end ring (same size), the others each the one before.
      const ends = dir === 1 ? (rings - 1) * row : 0;
      for (let k = 0; k < CAP_RINGS; k++) {
        for (let j = 0; j < radial; j++) {
          const a0 = k === 0 ? ends + j : base + (k - 1) * row + j;
          const b0 = base + k * row + j;
          if (dir === 1) out.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
          else out.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
        }
      }
      return out;
    };
    const first = cap(frames[0]!, -1);
    const last = cap(frames[rings - 1]!, 1);
    startCap = first.length;
    endCap = last.length;
    idx.unshift(...first);
    idx.push(...last);
  }
  void bodyIndices;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setIndex(idx);
  geo.userData.rings = rings;
  geo.userData.indicesPerRing = radial * 6;
  geo.userData.startCap = startCap;
  geo.userData.endCap = endCap;
  return geo;
}

/** Shows the first `fraction` of a tube made by `tubeGeometry`. */
export function drawFraction(geo: BufferGeometry, fraction: number): void {
  const rings = (geo.userData.rings as number | undefined) ?? 2;
  const per = (geo.userData.indicesPerRing as number | undefined) ?? 0;
  const segments = Math.max(0, Math.min(rings - 1, Math.round(fraction * (rings - 1))));
  // The start cap shows with the first piece of the tube, the end cap with the last: a tube being drawn on has no cap at its moving head.
  const startCap = (geo.userData.startCap as number | undefined) ?? 0;
  const endCap = (geo.userData.endCap as number | undefined) ?? 0;
  geo.setDrawRange(0, segments === 0 ? 0 : startCap + segments * per + (segments === rings - 1 ? endCap : 0));
}

/** The point `fraction` of the way along a sampled path (for the head of an arrow being drawn). */
export function pointAlong(path: readonly Vec3[], fraction: number): { p: Vec3; dir: Vec3 } {
  const last = path.length - 1;
  const f = Math.max(0, Math.min(1, fraction)) * last;
  const i = Math.min(last - 1, Math.floor(f));
  const t = f - i;
  const a = path[i] as Vec3, b = path[i + 1] as Vec3;
  const dir = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], dir: [dir.x, dir.y, dir.z] };
}
