// Living forms as one field. Every soft solid the scene language can write (a blob's lumps, a ball, a rounded cylinder or box, a cone, a ring, a spun
// profile, a thick tube) is a signed distance here: negative inside, zero on its skin. Parts that touch are joined by a smooth minimum, so a finger grows
// out of a palm and a vessel out of a chamber with a fillet instead of a crease, and the same distances say what lies under the skin: how deep a point is
// (for the layers of a cut face) and where a hollow organ's cavity begins (its wall is a thickness of the same field). No three.js here: numbers only.

import type { Vec2, Vec3 } from '../scene/types.ts';

/** One soft solid in its own space. */
export type Prim =
  | { kind: 'lumps'; lumps: ReadonlyArray<{ c: Vec3; r: Vec3 }>; /** How far a lump's pull reaches, in its own radii squared (`lumpReach`); 1 is a hard union. */ reach: number }
  | { kind: 'tube'; pts: readonly Vec3[]; radii: readonly number[] }
  | { kind: 'cylinder'; r: number; half: number; round: number; depth: number }
  | { kind: 'cone'; r: number; half: number; depth: number }
  | { kind: 'box'; half: Vec3; round: number }
  | { kind: 'torus'; big: number; small: number; depth: number }
  | { kind: 'lathe'; profile: readonly Vec2[]; closing: boolean };

/** A part of a body: a solid, where it sits in the body's space, and how softly it joins what it touches. */
export type FieldPart = {
  prim: Prim;
  /** Body space to the part's own space: a 3 by 4 affine matrix, row major. */
  toLocal: Float64Array;
  /** How much longer a length of the part's own space is in body space (its smallest scale). */
  scale: number;
  /** The reach of its fillet where it meets another part, in body units; 0 is a crease. */
  soft: number;
  /** The thickness of its wall when it is hollow, in body units; 0 is solid. */
  wall: number;
  /** A box round it in body space. */
  lo: Vec3; hi: Vec3;
  /** A point inside it, in body space. */
  inside: Vec3;
  /** Its size: the smallest of its three extents (what a fillet is measured against), in body units. */
  size: number;
};

const hypot3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** The polynomial smooth minimum: the two meet over a band of width k. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 1e-9) return a < b ? a : b;
  const h = k - Math.abs(a - b);
  return h <= 0 ? (a < b ? a : b) : (a < b ? a : b) - (h * h) / (4 * k);
}

function ellipsoid(x: number, y: number, z: number, c: Vec3, r: Vec3): number {
  const px = x - c[0], py = y - c[1], pz = z - c[2];
  const ax = px / r[0], ay = py / r[1], az = pz / r[2];
  const k0 = hypot3(ax, ay, az);
  if (k0 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  const k1 = hypot3(ax / r[0], ay / r[1], az / r[2]);
  return (k0 * (k0 - 1)) / k1;
}

/**
 * How far a lump's pull reaches for a blob's softness, in radii squared: 1 is a hard union, more melts lumps over a wider neck. The blob has always been
 * this field (each lump a bump, the skin where the bumps add up to a level), and the scene language's advice on lumps is written for it: lumps that overlap
 * by a third are one mass at the usual softness of 0.5.
 */
export function lumpReach(soft: number): number {
  const s = Math.max(0.05, Math.min(1, soft));
  const eff = s <= 0.3 ? s : 0.3 + (s - 0.3) * 1.9;
  return 1 + 2 * eff;
}

/** How far past its own radii the skin of `count` lumps can swell where they lie on one another (1 for a lump alone). */
export function lumpSwell(reach: number, count: number): number {
  return count <= 1 ? 1 : Math.sqrt(reach * (1 - (1 - 1 / reach) / Math.sqrt(count)));
}

/** Lumps melted into one mass: the skin is where their bumps add up to the level a lump alone has at its own surface, read as a distance. */
function lumpsDistance(lumps: ReadonlyArray<{ c: Vec3; r: Vec3 }>, q: number, x: number, y: number, z: number): number {
  let f = 0, lengths = 0, far = Infinity;
  for (const { c, r } of lumps) {
    const ax = (x - c[0]) / r[0], ay = (y - c[1]) / r[1], az = (z - c[2]) / r[2];
    const rho2 = ax * ax + ay * ay + az * az;
    const rho = Math.sqrt(rho2);
    // a step of the lump's own measure, as a length, here: the ellipsoid's distance is that times how far the measure is from 1
    const k1 = hypot3(ax / r[0], ay / r[1], az / r[2]);
    const length = rho > 1e-9 ? rho / k1 : Math.min(r[0], r[1], r[2]);
    const e = (rho - 1) * length;
    if (e < far) far = e;
    const d = rho2 / q;
    if (d < 1) { const g = (1 - d) * (1 - d); f += g; lengths += g * length; }
  }
  if (f <= 0) return far;
  // The measure at which a lump alone would have this much field; 1 on the skin.
  const rho = Math.sqrt(q * (1 - Math.sqrt(Math.min(1, f))));
  const melted = (rho - 1) * (lengths / f);
  return melted < far ? melted : far;
}

function polygonDistance(px: number, py: number, pts: readonly Vec2[], closing: boolean): number {
  // The distance to the outline, signed by the crossing number; a profile that starts and ends on the axis is closed along the axis, which is no surface.
  const n = pts.length;
  let best = Infinity;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Vec2, b = pts[(i + 1) % n] as Vec2;
    if (i < n - 1 || closing) {
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const wx = px - a[0], wy = py - a[1];
      const l2 = ex * ex + ey * ey;
      const t = l2 > 1e-18 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / l2)) : 0;
      const dx = wx - ex * t, dy = wy - ey * t;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    // every edge, the closing one too, counts for the sign
    if ((a[1] > py) !== (b[1] > py) && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

/** The signed distance of a solid at a point of its own space. */
export function primDistance(p: Prim, x: number, y: number, z: number): number {
  switch (p.kind) {
    case 'lumps':
      return p.lumps.length === 1 ? ellipsoid(x, y, z, p.lumps[0]!.c, p.lumps[0]!.r) : lumpsDistance(p.lumps, p.reach, x, y, z);
    case 'tube': {
      let best = Infinity;
      const pts = p.pts, radii = p.radii;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
        const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
        const wx = x - a[0], wy = y - a[1], wz = z - a[2];
        const l2 = ex * ex + ey * ey + ez * ez;
        const t = l2 > 1e-18 ? Math.max(0, Math.min(1, (wx * ex + wy * ey + wz * ez) / l2)) : 0;
        const d = hypot3(wx - ex * t, wy - ey * t, wz - ez * t) - ((radii[i] as number) + ((radii[i + 1] as number) - (radii[i] as number)) * t);
        if (d < best) best = d;
      }
      return best;
    }
    case 'cylinder': {
      const k = p.depth;
      const qx = Math.hypot(x, z / k) - (p.r - p.round), qy = Math.abs(y) - (p.half - p.round);
      const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - p.round;
      return d * Math.min(1, k);
    }
    case 'cone': {
      // A cone standing on y: its base radius r at -half, its point at +half.
      const k = p.depth;
      const q = Math.hypot(x, z / k);
      // distance in the (q, y) half plane to the triangle (0,-half) (r,-half) (0,half), whose third side is the axis
      return polygonDistance(q, y, [[0, -p.half], [p.r, -p.half], [0, p.half]], false) * Math.min(1, k);
    }
    case 'box': {
      const qx = Math.abs(x) - (p.half[0] - p.round), qy = Math.abs(y) - (p.half[1] - p.round), qz = Math.abs(z) - (p.half[2] - p.round);
      return hypot3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - p.round;
    }
    case 'torus': {
      const k = p.depth;
      const q = Math.hypot(x, z / k) - p.big;
      return (Math.hypot(q, y) - p.small) * Math.min(1, k);
    }
    case 'lathe':
      return polygonDistance(Math.hypot(x, z), y, p.profile, p.closing);
  }
}

/** A box round a solid in its own space. */
export function primBounds(p: Prim): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const take = (x: number, y: number, z: number, r: Vec3 | number): void => {
    const rr = typeof r === 'number' ? [r, r, r] : r;
    lo[0] = Math.min(lo[0], x - rr[0]!); lo[1] = Math.min(lo[1], y - rr[1]!); lo[2] = Math.min(lo[2], z - rr[2]!);
    hi[0] = Math.max(hi[0], x + rr[0]!); hi[1] = Math.max(hi[1], y + rr[1]!); hi[2] = Math.max(hi[2], z + rr[2]!);
  };
  switch (p.kind) {
    case 'lumps': {
      const k = lumpSwell(p.reach, p.lumps.length);
      for (const l of p.lumps) take(l.c[0], l.c[1], l.c[2], [l.r[0] * k, l.r[1] * k, l.r[2] * k]);
      break;
    }
    case 'tube': p.pts.forEach((q, i) => take(q[0], q[1], q[2], p.radii[i] as number)); break;
    case 'cylinder': take(0, 0, 0, [p.r, p.half, p.r * p.depth]); break;
    case 'cone': take(0, 0, 0, [p.r, p.half, p.r * p.depth]); break;
    case 'box': take(0, 0, 0, p.half); break;
    case 'torus': take(0, 0, 0, [p.big + p.small, p.small, (p.big + p.small) * p.depth]); break;
    case 'lathe': for (const q of p.profile) take(0, q[1], 0, [Math.abs(q[0]), 0, Math.abs(q[0])]); break;
  }
  return { lo, hi };
}

/** A point inside a solid, in its own space. */
export function primInside(p: Prim): Vec3 {
  switch (p.kind) {
    case 'lumps': return [...(p.lumps[0] as { c: Vec3 }).c];
    case 'tube': {
      const a = p.pts[Math.floor(p.pts.length / 2)] as Vec3;
      return [...a];
    }
    case 'torus': return [p.big, 0, 0];
    case 'lathe': {
      // the middle of the widest stretch of the profile, half way to the axis (or into the ring)
      let best = 0, at: Vec3 = [0, 0, 0];
      for (let i = 0; i < p.profile.length - 1; i++) {
        const a = p.profile[i] as Vec2, b = p.profile[i + 1] as Vec2;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        for (const f of [0.5, 0.8, 0.2, 0.95]) {
          const d = -polygonDistance(mx * f, my, p.profile, p.closing);
          if (d > best) { best = d; at = [mx * f, my, 0]; }
        }
      }
      return at;
    }
    default: return [0, 0, 0];
  }
}

/** The whole field of a body: its parts joined, and what each part is at a point. */
export class BodyField {
  readonly parts: readonly FieldPart[];
  /** Distances of the parts at the last point asked for (Infinity where a part is out of reach). */
  readonly d: Float64Array;
  /** How far a part's reach goes past its box: its fillet. */
  private reach: Float64Array;
  /** An unevenness laid over the whole skin: its height (body units) and how many swells to a unit. Zero is none. */
  relief = 0;
  reliefScale = 1;

  constructor(parts: readonly FieldPart[]) {
    // The largest first: each smaller part then joins what is there with its own, smaller, fillet.
    this.parts = [...parts].sort((a, b) => b.size - a.size);
    this.d = new Float64Array(this.parts.length);
    this.reach = new Float64Array(this.parts.length);
    let widest = 0;
    for (const p of this.parts) widest = Math.max(widest, p.soft);
    this.parts.forEach((p, i) => { this.reach[i] = Math.max(p.soft, widest) + 1e-6; });
  }

  /** The distance of one part at a point of the body's space. */
  partDistance(i: number, x: number, y: number, z: number): number {
    const p = this.parts[i] as FieldPart;
    const m = p.toLocal;
    return primDistance(p.prim, m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, m[4]! * x + m[5]! * y + m[6]! * z + m[7]!, m[8]! * x + m[9]! * y + m[10]! * z + m[11]!) * p.scale;
  }

  /** The joined skin's distance at a point; fills `d` with each part's own. */
  value(x: number, y: number, z: number): number {
    const parts = this.parts, d = this.d;
    let f = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as FieldPart;
      const r = this.reach[i] as number;
      // out of reach of this part's box: it cannot change the skin here; a lower bound of its distance is enough
      const ox = Math.max(p.lo[0] - x, 0, x - p.hi[0]), oy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), oz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
      const out = hypot3(ox, oy, oz);
      if (out > f + r) { d[i] = Infinity; continue; }
      const di = this.partDistance(i, x, y, z);
      d[i] = di;
      f = f === Infinity ? di : smin(f, di, p.soft);
    }
    if (this.relief !== 0) f -= this.relief * swell(x * this.reliefScale, y * this.reliefScale, z * this.reliefScale);
    return f;
  }

  /**
   * The cavity of a hollow body: each hollow part's own inside, a wall's thickness in from its skin. Negative inside the cavity; a number everywhere
   * (outside a part's box, how far the box is, which is no nearer than the part), and Infinity only when no part is hollow.
   */
  cavity(x: number, y: number, z: number): number {
    const parts = this.parts;
    let c = Infinity;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as FieldPart;
      if (p.wall <= 0) continue;
      const ox = Math.max(p.lo[0] - x, 0, x - p.hi[0]), oy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), oz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
      const di = (ox > 0 || oy > 0 || oz > 0 ? hypot3(ox, oy, oz) : this.partDistance(i, x, y, z)) + p.wall;
      if (di < c) c = di;
    }
    return c;
  }

  /** The outward direction of the skin at a point (the field's slope), by differences of `e`. */
  normal(x: number, y: number, z: number, e: number, out: Float64Array | number[]): void {
    const gx = this.value(x + e, y, z) - this.value(x - e, y, z);
    const gy = this.value(x, y + e, z) - this.value(x, y - e, z);
    const gz = this.value(x, y, z + e) - this.value(x, y, z - e);
    const l = hypot3(gx, gy, gz) || 1;
    out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  }
}

function hash3(i: number, j: number, k: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A smooth unevenness between -1 and 1: two scales of value noise. Nothing alive is a perfect ellipsoid. */
export function swell(x: number, y: number, z: number): number {
  const one = (px: number, py: number, pz: number): number => {
    const i = Math.floor(px), j = Math.floor(py), k = Math.floor(pz);
    let fx = px - i, fy = py - j, fz = pz - k;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
    const a = hash3(i, j, k), b = hash3(i + 1, j, k), c = hash3(i, j + 1, k), d = hash3(i + 1, j + 1, k);
    const e = hash3(i, j, k + 1), f = hash3(i + 1, j, k + 1), g = hash3(i, j + 1, k + 1), h = hash3(i + 1, j + 1, k + 1);
    const lo = a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
    const hi = e + (f - e) * fx + (g - e + (e - f - g + h) * fx) * fy;
    return lo + (hi - lo) * fz;
  };
  return (one(x, y, z) * 0.65 + one(x * 2.3 + 11.5, y * 2.3 + 3.1, z * 2.3 + 7.7) * 0.35) * 2 - 1;
}
