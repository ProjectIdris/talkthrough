// Soft blended blobs: smooth organic forms made of a few ellipsoid lumps that melt into one another, the way a heart, a
// plant bulb, a fruit or an animal's body is built from rounded masses. Each lump adds a bump to a field; the surface is
// where the field crosses a level, so lumps that touch grow a smooth neck between them and a lone lump is the exact
// ellipsoid it was asked to be. The surface is cut out of the field by marching tetrahedra, with the normals taken from
// the field itself, so it shades smooth. No DOM here; this only makes three.js geometry.

import { BufferAttribute, BufferGeometry } from 'three';
import type { Vec3 } from '../scene/types.ts';

/** How much surface a blob is cut into (grid cells over its bounds): a cheaper tier gets a coarser, still smooth, skin. */
export const BLOB_CELLS = { low: 14_000, mid: 40_000, high: 90_000 } as const;
/** The most triangles one blob may make, whatever its shape. */
export const BLOB_MAX_TRIANGLES = 160_000;
/** The triangles all the blobs of a scene may make together before later ones are cut finer-grained (coarser), by tier; a blob is never dropped, it gets at least BLOB_MIN_TRIANGLES. */
export const SCENE_BLOB_TRIANGLES = { low: 40_000, mid: 90_000, high: 180_000 } as const;
export const BLOB_MIN_TRIANGLES = 2_500;

type Lump = { c: Vec3; r: Vec3 };

/** Influence reaches this many (normalised) radii out; 1 is a hard union, more blends over a wider neck. */
function reach(soft: number): number {
  return 1 + 2 * Math.max(0.05, Math.min(1, soft));
}

/** The field of the lumps and its gradient at p; the surface is where the field equals `level`. */
class Field {
  readonly lumps: readonly Lump[];
  readonly q: number;
  readonly level: number;
  constructor(lumps: readonly Lump[], soft: number) {
    this.lumps = lumps;
    this.q = reach(soft);
    this.level = (1 - 1 / this.q) ** 2;
  }

  value(x: number, y: number, z: number): number {
    let f = 0;
    for (const { c, r } of this.lumps) {
      const dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
      const d = (dx * dx + dy * dy + dz * dz) / this.q;
      if (d < 1) f += (1 - d) * (1 - d);
    }
    return f;
  }

  /** The outward unit normal at p (down the field's slope). */
  normal(x: number, y: number, z: number, out: [number, number, number]): void {
    let gx = 0, gy = 0, gz = 0;
    for (const { c, r } of this.lumps) {
      const dx = (x - c[0]) / r[0], dy = (y - c[1]) / r[1], dz = (z - c[2]) / r[2];
      const d = (dx * dx + dy * dy + dz * dz) / this.q;
      if (d >= 1) continue;
      // d/dp of (1 - d)^2 = -2 (1 - d) * dd/dp, and dd/dp = 2 (p - c) / (q r^2)
      const k = (-4 * (1 - d)) / this.q;
      gx += (k * dx) / r[0];
      gy += (k * dy) / r[1];
      gz += (k * dz) / r[2];
    }
    const l = Math.hypot(gx, gy, gz) || 1;
    out[0] = -gx / l;
    out[1] = -gy / l;
    out[2] = -gz / l;
  }
}

/** The six tetrahedra a cube is cut into (corners numbered as in CORNERS), all sharing the diagonal 0-6. */
const TETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];
const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/**
 * A closed smooth surface through lumps given as centres and sizes (the bounding box of each ellipsoid), blended by
 * `soft` (0.05 almost hard, 1 very soft; about 0.5 is a usual organic neck). Centred where the centres are; returns the
 * mesh without an index (each triangle has its own vertices and the field's own normals).
 */
export function blobGeometry(centres: readonly Vec3[], sizes: readonly Vec3[], soft: number, cells: number, maxTriangles: number = BLOB_MAX_TRIANGLES): BufferGeometry {
  // Triangles grow with the cell count to about the two thirds power; a skin over its allowance is made again with fewer cells.
  let geo = cut(centres, sizes, soft, cells);
  for (let tries = 0; tries < 3 && geo.attributes.position!.count / 3 > maxTriangles; tries++) {
    const over = geo.attributes.position!.count / 3 / maxTriangles;
    cells = Math.max(200, Math.floor(cells / over ** 1.5 / 1.1));
    geo = cut(centres, sizes, soft, cells);
  }
  geo.userData.triangles = geo.attributes.position!.count / 3;
  return geo;
}

function cut(centres: readonly Vec3[], sizes: readonly Vec3[], soft: number, cells: number): BufferGeometry {
  const lumps: Lump[] = centres.map((c, i) => {
    const s = (sizes[Math.min(i, sizes.length - 1)] ?? [1, 1, 1]) as Vec3;
    return { c, r: [Math.max(1e-3, s[0] / 2), Math.max(1e-3, s[1] / 2), Math.max(1e-3, s[2] / 2)] as Vec3 };
  });
  const field = new Field(lumps, soft);
  const reachR = Math.sqrt(field.q);
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { c, r } of lumps) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a] as number, (c[a] as number) - (r[a] as number) * reachR);
      hi[a] = Math.max(hi[a] as number, (c[a] as number) + (r[a] as number) * reachR);
    }
  }
  const ext: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  // Cubic cells: fine enough for the thinnest side, and no more cells in all than the tier allows.
  const volume = ext[0] * ext[1] * ext[2];
  let h = Math.min(Math.cbrt(volume / cells), Math.min(ext[0], ext[1], ext[2]) / 7);
  const count = (hh: number): [number, number, number] => [Math.max(2, Math.ceil(ext[0] / hh)), Math.max(2, Math.ceil(ext[1] / hh)), Math.max(2, Math.ceil(ext[2] / hh))];
  let [nx, ny, nz] = count(h);
  while (nx * ny * nz > cells * 3) {
    h *= 1.15;
    [nx, ny, nz] = count(h);
  }
  const sx = ext[0] / nx, sy = ext[1] / ny, sz = ext[2] / nz;
  const gx = nx + 1, gy = ny + 1;
  const nodes = new Float32Array(gx * gy * (nz + 1));
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) nodes[i + gx * (j + gy * k)] = field.value(lo[0] + i * sx, lo[1] + j * sy, lo[2] + k * sz);
    }
  }

  const pos: number[] = [];
  const nor: number[] = [];
  const level = field.level;
  const vals = new Float64Array(8);
  const cut = (ax: number, ay: number, az: number, fa: number, bx: number, by: number, bz: number, fb: number): [number, number, number] => {
    const t = Math.abs(fb - fa) < 1e-12 ? 0.5 : (level - fa) / (fb - fa);
    return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
  };
  const push = (a: [number, number, number], b: [number, number, number], c: [number, number, number]): void => {
    const na: [number, number, number] = [0, 0, 0], nb: [number, number, number] = [0, 0, 0], nc: [number, number, number] = [0, 0, 0];
    field.normal(a[0], a[1], a[2], na);
    field.normal(b[0], b[1], b[2], nb);
    field.normal(c[0], c[1], c[2], nc);
    // Wind the triangle to face the way the field's normals do.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const flip = fx * (na[0] + nb[0] + nc[0]) + fy * (na[1] + nb[1] + nc[1]) + fz * (na[2] + nb[2] + nc[2]) < 0;
    const [p, q, r, np, nq, nr] = flip ? [a, c, b, na, nc, nb] : [a, b, c, na, nb, nc];
    pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    nor.push(np[0], np[1], np[2], nq[0], nq[1], nq[2], nr[0], nr[1], nr[2]);
  };

  for (let k = 0; k < nz && pos.length / 9 < BLOB_MAX_TRIANGLES; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const o = CORNERS[c] as readonly [number, number, number];
          const v = nodes[i + o[0] + gx * (j + o[1] + gy * (k + o[2]))] as number;
          vals[c] = v;
          if (v >= level) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        const at = (c: number): [number, number, number] => {
          const o = CORNERS[c] as readonly [number, number, number];
          return [lo[0] + (i + o[0]) * sx, lo[1] + (j + o[1]) * sy, lo[2] + (k + o[2]) * sz];
        };
        for (const tet of TETS) {
          const ins: number[] = [], out: number[] = [];
          for (const c of tet) ((vals[c] as number) >= level ? ins : out).push(c);
          if (ins.length === 0 || ins.length === 4) continue;
          const edge = (a: number, b: number): [number, number, number] => {
            const pa = at(a), pb = at(b);
            return cut(pa[0], pa[1], pa[2], vals[a] as number, pb[0], pb[1], pb[2], vals[b] as number);
          };
          if (ins.length === 1 || ins.length === 3) {
            const lone = ins.length === 1 ? (ins[0] as number) : (out[0] as number);
            const others = ins.length === 1 ? out : ins;
            push(edge(lone, others[0] as number), edge(lone, others[1] as number), edge(lone, others[2] as number));
          } else {
            const [i1, i2] = ins as [number, number];
            const [o1, o2] = out as [number, number];
            const a = edge(i1, o1), b = edge(i1, o2), c = edge(i2, o2), d = edge(i2, o1);
            push(a, b, c);
            push(a, c, d);
          }
        }
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.computeBoundingSphere();
  return geo;
}
