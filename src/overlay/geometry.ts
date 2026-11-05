// Geometry builders for the modelling vocabulary: bevelled boxes, extrusions from an outline,
// lathes from a profile and tubes along a curve. They only make three.js geometry; nothing here
// touches the DOM.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, ExtrudeGeometry, LatheGeometry, Shape, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BLOB_CELLS, SCENE_BLOB_TRIANGLES } from './blob.ts';
import { catmull } from './timeline.ts';
import type { Vec2, Vec3 } from '../scene/types.ts';

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
  const r = Math.min(bevel, Math.min(size[0], size[1], size[2]) / 2 - 1e-4);
  if (!(r > 0.002)) return new BoxGeometry(size[0], size[1], size[2]);
  return new RoundedBoxGeometry(size[0], size[1], size[2], detail.bevel, r);
}

/** A flat outline pushed out `depth` along z and centred on z = 0. */
export function extrudeGeometry(outline: readonly Vec2[], depth: number, bevel: number, detail: Detail): BufferGeometry {
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
  return toCreasedNormals(geo, 0.6);
}

/** A profile of [radius, y] points spun round the y axis. */
export function latheGeometry(profile: readonly Vec2[], sides: number): BufferGeometry {
  const pts = profile.map((p) => new Vector2(Math.abs(p[0]), p[1]));
  const geo = new LatheGeometry(pts, Math.max(3, Math.round(sides)));
  return toCreasedNormals(geo, sides <= 8 ? 0.4 : 0.9);
}

/** Points along the path: smooth (a spline) for tubes, straight between the points for lines. */
export function samplePath(pts: readonly Vec3[], smooth: boolean, perSegment: number): Vec3[] {
  const raw = pts.map((p) => [p[0], p[1], p[2]]);
  const out: Vec3[] = [];
  const segments = raw.length - 1;
  for (let i = 0; i < segments; i++) {
    const n = smooth ? perSegment : 1;
    for (let k = 0; k < n; k++) {
      const u = (i + k / n) / segments;
      const p = smooth ? catmull(raw, u) : (raw[i] as number[]).map((a, c) => a + (((raw[i + 1] as number[])[c] ?? a) - a) * (k / n));
      out.push([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
    }
  }
  const end = raw[segments] as number[];
  out.push([end[0] ?? 0, end[1] ?? 0, end[2] ?? 0]);
  return out;
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

/**
 * A tube along the sampled points. `flat` squashes it into a ribbon whose wide side runs across the
 * path (across x for a path going up or along z, across z for a path going along x), so a cable seen from the front shows its width.
 * The index runs ring after ring, so `drawRange` reveals it from the start.
 */
export function tubeGeometry(path: readonly Vec3[], baseRadius: number, flat: number, radial: number, swell?: readonly Vec2[]): BufferGeometry {
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
  for (let i = 0; i < rings; i++) {
    const p = path[i] as Vec3;
    const prev = path[Math.max(0, i - 1)] as Vec3;
    const next = path[Math.min(rings - 1, i + 1)] as Vec3;
    tangent.set(next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 1);
    tangent.normalize();
    // The first ring's frame comes from the up direction (or forward, for a path going straight up). Each ring after that carries the last
    // ring's frame along (parallel transport), so the tube never twists where the path passes straight up or down: choosing a frame from "up" at
    // every ring flips it there, which drew a hard seam across a bent tube.
    if (i === 0) {
      const ref = Math.abs(tangent.dot(UP)) > 0.95 ? FORWARD : UP;
      wide.crossVectors(tangent, ref).normalize();
    } else {
      wide.addScaledVector(tangent, -wide.dot(tangent));
      if (wide.lengthSq() < 1e-12) wide.crossVectors(tangent, Math.abs(tangent.dot(UP)) > 0.95 ? FORWARD : UP);
      wide.normalize();
    }
    thin.crossVectors(wide, tangent).normalize();
    centre.set(p[0], p[1], p[2]);
    const radius = baseRadius * (swell ? swellAt(swell, rings > 1 ? i / (rings - 1) : 0) : 1);
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
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const p0 = i * row + j, p1 = p0 + 1, p2 = p0 + row, p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setIndex(idx);
  geo.userData.rings = rings;
  geo.userData.indicesPerRing = radial * 6;
  return geo;
}

/** Shows the first `fraction` of a tube made by `tubeGeometry`. */
export function drawFraction(geo: BufferGeometry, fraction: number): void {
  const rings = (geo.userData.rings as number | undefined) ?? 2;
  const per = (geo.userData.indicesPerRing as number | undefined) ?? 0;
  const segments = Math.max(0, Math.min(rings - 1, Math.round(fraction * (rings - 1))));
  geo.setDrawRange(0, segments * per);
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
