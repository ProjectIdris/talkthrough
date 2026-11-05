// Where a hand-built tube or line ends: if an end lies on (or a hair off) the surface of a 3D part, it is meant to touch it. Pure geometry, no renderer:
// the validator keeps the bodies it has been told of (shape, size, place) and asks which of them an end point is on.

import type { Vec3 } from './types.ts';

/** What the scene knows of one 3D object's shape and place, as written (no animation): enough to ask how far a point is from its surface. */
export type Body = {
  shape: 'box' | 'sphere' | 'cylinder' | 'blob' | 'group';
  /** Box and cylinder: the extents; sphere: the diameters. A group has none. */
  size?: Vec3;
  /** Blob: the lumps' centres and their sizes (diameters). */
  pts?: Vec3[];
  sizes?: Vec3[];
  pos: Vec3;
  rot: Vec3;
  parent?: string;
};

type Affine = { r: number[]; t: Vec3 }; // r: row-major 3x3

const RAD = Math.PI / 180;
const IDENTITY: Affine = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

/** Euler 'XYZ' as the renderer turns objects: R = Rx · Ry · Rz. */
function rotation(rot: Vec3): number[] {
  const [a, b, c] = [rot[0] * RAD, rot[1] * RAD, rot[2] * RAD];
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}

const apply = (m: Affine, p: Vec3): Vec3 => [
  m.r[0]! * p[0] + m.r[1]! * p[1] + m.r[2]! * p[2] + m.t[0],
  m.r[3]! * p[0] + m.r[4]! * p[1] + m.r[5]! * p[2] + m.t[1],
  m.r[6]! * p[0] + m.r[7]! * p[1] + m.r[8]! * p[2] + m.t[2],
];
/** The way back from a rotation and a shift (no scale: the language has none on objects). */
const applyInverse = (m: Affine, p: Vec3): Vec3 => {
  const q: Vec3 = [p[0] - m.t[0], p[1] - m.t[1], p[2] - m.t[2]];
  return [
    m.r[0]! * q[0] + m.r[3]! * q[1] + m.r[6]! * q[2],
    m.r[1]! * q[0] + m.r[4]! * q[1] + m.r[7]! * q[2],
    m.r[2]! * q[0] + m.r[5]! * q[1] + m.r[8]! * q[2],
  ];
};

/** Where an object stands in the scene: its own place after its holders' (a holder missing or a chain too long counts as the scene itself). */
export function worldOf(bodies: ReadonlyMap<string, Body>, id: string | undefined): Affine {
  const chain: Body[] = [];
  for (let cur = id, n = 0; cur !== undefined && n < 32; n++) {
    const b = bodies.get(cur);
    if (!b) break;
    chain.push(b);
    cur = b.parent;
  }
  let m = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) {
    const b = chain[i] as Body;
    const r = rotation(b.rot);
    const t = apply(m, b.pos);
    const q = m.r;
    m = { r: [
      q[0]! * r[0]! + q[1]! * r[3]! + q[2]! * r[6]!, q[0]! * r[1]! + q[1]! * r[4]! + q[2]! * r[7]!, q[0]! * r[2]! + q[1]! * r[5]! + q[2]! * r[8]!,
      q[3]! * r[0]! + q[4]! * r[3]! + q[5]! * r[6]!, q[3]! * r[1]! + q[4]! * r[4]! + q[5]! * r[7]!, q[3]! * r[2]! + q[4]! * r[5]! + q[5]! * r[8]!,
      q[6]! * r[0]! + q[7]! * r[3]! + q[8]! * r[6]!, q[6]! * r[1]! + q[7]! * r[4]! + q[8]! * r[7]!, q[6]! * r[2]! + q[7]! * r[5]! + q[8]! * r[8]!,
    ], t };
  }
  return m;
}

type Hit = { dist: number; closest: Vec3 };

const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** A box: the distance to its surface (negative inside) and the nearest point on it. */
function boxHit(p: Vec3, size: Vec3): Hit {
  const h: Vec3 = [Math.abs(size[0]) / 2, Math.abs(size[1]) / 2, Math.abs(size[2]) / 2];
  const out: Vec3 = [Math.max(Math.abs(p[0]) - h[0], 0), Math.max(Math.abs(p[1]) - h[1], 0), Math.max(Math.abs(p[2]) - h[2], 0)];
  const clamp = (v: number, hv: number): number => Math.max(-hv, Math.min(hv, v));
  if (out[0] > 0 || out[1] > 0 || out[2] > 0) return { dist: len(out), closest: [clamp(p[0], h[0]), clamp(p[1], h[1]), clamp(p[2], h[2])] };
  // Inside: out through the nearest face.
  const gap = [h[0] - Math.abs(p[0]), h[1] - Math.abs(p[1]), h[2] - Math.abs(p[2])];
  const axis = gap[0]! <= gap[1]! && gap[0]! <= gap[2]! ? 0 : gap[1]! <= gap[2]! ? 1 : 2;
  const closest: Vec3 = [p[0], p[1], p[2]];
  closest[axis] = (p[axis] >= 0 ? 1 : -1) * h[axis];
  return { dist: -(gap[axis] as number), closest };
}

/** An ellipsoid (a sphere is the equal-axes case): the first-order distance to its surface and the point straight out from the centre. */
function ellipsoidHit(p: Vec3, size: Vec3): Hit {
  const r: Vec3 = [Math.max(Math.abs(size[0]) / 2, 1e-6), Math.max(Math.abs(size[1]) / 2, 1e-6), Math.max(Math.abs(size[2]) / 2, 1e-6)];
  const k0 = Math.hypot(p[0] / r[0], p[1] / r[1], p[2] / r[2]);
  const k1 = Math.hypot(p[0] / (r[0] * r[0]), p[1] / (r[1] * r[1]), p[2] / (r[2] * r[2]));
  if (k0 < 1e-9) return { dist: -Math.min(r[0], r[1], r[2]), closest: [r[0], 0, 0] };
  return { dist: k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1, closest: [p[0] / k0, p[1] / k0, p[2] / k0] };
}

/** A cylinder along y (round, or oval by its x and z extents). */
function cylinderHit(p: Vec3, size: Vec3): Hit {
  const rx = Math.max(Math.abs(size[0]) / 2, 1e-6), rz = Math.max(Math.abs(size[2]) / 2, 1e-6), hy = Math.abs(size[1]) / 2;
  const rr = Math.hypot(p[0] / rx, p[2] / rz);
  const side = (y: number): Vec3 => (rr < 1e-9 ? [rx, y, 0] : [p[0] / rr, y, p[2] / rr]);
  const cap = (s: number): Vec3 => (rr <= 1 ? [p[0], s * hy, p[2]] : [p[0] / rr, s * hy, p[2] / rr]);
  const clampY = Math.max(-hy, Math.min(hy, p[1]));
  const outside = rr > 1 || Math.abs(p[1]) > hy;
  const candidates = outside ? [rr > 1 ? side(clampY) : cap(p[1] >= 0 ? 1 : -1)] : [side(p[1]), cap(1), cap(-1)];
  let best = candidates[0] as Vec3, bestD = Infinity;
  for (const c of candidates) {
    const d = len([c[0] - p[0], c[1] - p[1], c[2] - p[2]]);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { dist: outside ? bestD : -bestD, closest: best };
}

/** A blob: its lumps are ellipsoids that run together, so the nearest lump's surface stands for it. */
function blobHit(p: Vec3, pts: readonly Vec3[], sizes: readonly Vec3[]): Hit | undefined {
  let best: Hit | undefined;
  pts.forEach((c, i) => {
    const s = sizes[Math.min(i, sizes.length - 1)];
    if (!s) return;
    const h = ellipsoidHit([p[0] - c[0], p[1] - c[1], p[2] - c[2]], s);
    if (!best || h.dist < best.dist) best = { dist: h.dist, closest: [h.closest[0] + c[0], h.closest[1] + c[1], h.closest[2] + c[2]] };
  });
  return best;
}

function hitOf(b: Body, p: Vec3): Hit | undefined {
  switch (b.shape) {
    case 'box': return b.size ? boxHit(p, b.size) : undefined;
    case 'sphere': return b.size ? ellipsoidHit(p, b.size) : undefined;
    case 'cylinder': return b.size ? cylinderHit(p, b.size) : undefined;
    case 'blob': return b.pts && b.sizes && b.sizes.length > 0 ? blobHit(p, b.pts, b.sizes) : undefined;
    default: return undefined;
  }
}

export type Landing = {
  /** The part the point is on. */
  part: string;
  /** The nearest point on its surface, in the space the point was given in. */
  snapped: Vec3;
  /** The same point in the part's own space (it goes with the part wherever the part is taken). */
  local: Vec3;
  /** How far the point was from the surface. */
  gap: number;
};

/**
 * The part (other than `skip`) whose surface a point lies on, within `tolerance` either side of it; the nearest wins. The point is in the space of `holder`
 * (the object a tube or line hangs from, or the scene), and the answer comes back in that space.
 */
export function landOn(bodies: ReadonlyMap<string, Body>, holder: string | undefined, point: Vec3, tolerance: number, only?: string): Landing | undefined {
  const frame = worldOf(bodies, holder);
  const world = apply(frame, point);
  let best: Landing | undefined;
  for (const [id, b] of bodies) {
    if ((only !== undefined && id !== only) || b.shape === 'group') continue;
    const m = worldOf(bodies, id);
    const hit = hitOf(b, applyInverse(m, world));
    if (!hit || Math.abs(hit.dist) > tolerance || (best && Math.abs(hit.dist) >= best.gap)) continue;
    best = { part: id, snapped: applyInverse(frame, apply(m, hit.closest)), local: hit.closest, gap: Math.abs(hit.dist) };
  }
  return best;
}

/** How near an end of a tube or line must be to a part's surface to count as on it: a hair, or more for a fat pipe (its end cap has a radius of its own). */
export function attachTolerance(radius: number | undefined): number {
  return Math.min(0.5, Math.max(0.1, 1.5 * (radius ?? 0.06)));
}
