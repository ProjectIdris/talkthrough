// Living forms as one field. Every soft solid the scene language can write (a blob's lumps, a ball, a rounded cylinder or box, a cone, a ring, a spun
// profile, a thick tube) is a signed distance here: negative inside, zero on its skin. Parts that touch are joined by a smooth minimum, so a finger grows
// out of a palm and a vessel out of a chamber with a fillet instead of a crease, and the same distances say what lies under the skin: how deep a point is
// (for the layers of a cut face) and where a hollow organ's cavity begins (its wall is a thickness of the same field). No three.js here: numbers only.

import type { Vec2, Vec3 } from '../scene/types.ts';

/** One soft solid in its own space. */
export type Prim =
  | { kind: 'lumps'; lumps: ReadonlyArray<{ c: Vec3; r: Vec3 }>; /** How far a lump's pull reaches, in its own radii squared (`lumpReach`); 1 is a hard union. */ reach: number }
  | {
    kind: 'tube'; pts: readonly Vec3[]; radii: readonly number[];
    /** The creases of its joints (a knuckle's fold): how far along the path each lies, from the first point, and how wide it is. */
    creases?: ReadonlyArray<{ at: number; width: number }>;
    /** For each stretch, its middle and how far from there it reaches (four numbers): a stretch too far off to be the nearest is passed over (`tubeOf`). */
    near?: Float64Array;
  }
  | { kind: 'cylinder'; r: number; half: number; round: number; depth: number }
  | { kind: 'cone'; r: number; half: number; depth: number }
  | { kind: 'box'; half: Vec3; round: number }
  /** A pad: a box of flesh. Its corners are rounded in its own plane (`corner`) and its rim all the way round (`rim`); `thin` is the axis it is thinnest on. */
  | { kind: 'pad'; half: Vec3; thin: 0 | 1 | 2; corner: number; rim: number }
  /** A slab: a flat outline (x and y) with a thickness (`half` each way along z) and a rounded rim; `inside` is a point well inside the outline. */
  | { kind: 'slab'; outline: readonly Vec2[]; half: number; rim: number; inside: Vec2 }
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
  /**
   * A flat part (a pad or a slab) that lies in one plane with others of its body: the plane (an index into the field's planes), where its middle lies along
   * the plane's normal, half its thickness and its rim, in body units, and how wide a join it makes in the plane. Such parts are joined as outlines in
   * their plane, and the thickness runs from one to the next: a palm narrows into a wrist as one flat thing, with no swelling where their faces lie together.
   */
  flat?: { plane: number; mid: number; half: number; rim: number; reach: number };
  /**
   * A limb that grows out of a flat part in the part's own plane, and is thicker than it (a round wrist written under a flat palm): at the flat part's
   * edge it is no thicker than that, within it it lies under its faces, and it comes back to its own roundness with its distance from it. `of` is the
   * flat part, `n` the unit normal of its plane, `mid` where its middle lies along the normal and `half` half its thickness (body units).
   */
  pressed?: { of: FieldPart; n: Vec3; mid: number; half: number };
};

const hypot3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** How fast a pressed limb gets its own thickness back with its distance from the flat part that presses it, and how far under the part's faces it lies within it. */
const PRESS_EASE = 0.5;
const PRESS_SINK = 0.6;

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

/**
 * A stretch of a tube: the two balls at its ends and the cone that touches both (the distance to it is exact outside it). A chain of these has no ridge
 * where the radius changes along the tube, as balls joined by a radius read off the nearest point of the axis have.
 */
function roundCone(x: number, y: number, z: number, a: Vec3, b: Vec3, r1: number, r2: number): number {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const l2 = bx * bx + by * by + bz * bz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  // one ball holds the other: the larger alone
  if (!(a2 > 1e-18)) return r1 >= r2 ? hypot3(px, py, pz) - r1 : hypot3(x - b[0], y - b[1], z - b[2]) - r2;
  const il2 = 1 / l2;
  const along = px * bx + py * by + pz * bz, past = along - l2;
  const cx = px * l2 - bx * along, cy = py * l2 - by * along, cz = pz * l2 - bz * along;
  const x2 = cx * cx + cy * cy + cz * cz;
  const y2 = along * along * l2, z2 = past * past * l2;
  const k = (rr < 0 ? -1 : 1) * rr * rr * x2;
  if ((past < 0 ? -1 : 1) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if ((along < 0 ? -1 : 1) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + along * rr) * il2 - r1;
}

/** A point of a path adds nothing when it lies this near the straight run between its neighbours, in place and in radius, as a share of its radius. */
const TUBE_STRAIGHT = 0.004;

/**
 * A tube for the field from a sampled path: points that add nothing are left out (a straight finger is a few stretches, not one for every sample of
 * its path; the path keeps its length), and each stretch gets its bound.
 */
export function tubeOf(path: readonly Vec3[], widths: readonly number[], creases?: ReadonlyArray<{ at: number; width: number }>): Prim {
  const keep: number[] = [0];
  const n = path.length;
  let a = 0;
  while (a < n - 1) {
    // the furthest point every point up to which lies on the straight run from here to it
    let c = a + 1;
    for (let to = a + 2; to < n; to++) {
      const p = path[a] as Vec3, q = path[to] as Vec3;
      const ex = q[0] - p[0], ey = q[1] - p[1], ez = q[2] - p[2];
      const l2 = ex * ex + ey * ey + ez * ez;
      let straight = l2 > 1e-18;
      for (let i = a + 1; i < to && straight; i++) {
        const m = path[i] as Vec3;
        const t = ((m[0] - p[0]) * ex + (m[1] - p[1]) * ey + (m[2] - p[2]) * ez) / l2;
        const off = hypot3(m[0] - p[0] - ex * t, m[1] - p[1] - ey * t, m[2] - p[2] - ez * t);
        const r = widths[i] as number, between = (widths[a] as number) + ((widths[to] as number) - (widths[a] as number)) * t;
        if (!(t > 0 && t < 1) || off > TUBE_STRAIGHT * r || Math.abs(r - between) > TUBE_STRAIGHT * r) straight = false;
      }
      if (!straight) break;
      c = to;
    }
    keep.push(c);
    a = c;
  }
  const pts = keep.map((i) => path[i] as Vec3), radii = keep.map((i) => widths[i] as number);
  const near = new Float64Array(Math.max(0, pts.length - 1) * 4);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i] as Vec3, q = pts[i + 1] as Vec3;
    near[i * 4] = (p[0] + q[0]) / 2; near[i * 4 + 1] = (p[1] + q[1]) / 2; near[i * 4 + 2] = (p[2] + q[2]) / 2;
    near[i * 4 + 3] = hypot3(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 2 + Math.max(radii[i] as number, radii[i + 1] as number);
  }
  return creases ? { kind: 'tube', pts, radii, creases, near } : { kind: 'tube', pts, radii, near };
}

/** How far along a tube's path (from its first point) the point of the path nearest to a point of its space is. */
function tubeAlong(pts: readonly Vec3[], x: number, y: number, z: number): number {
  let best = Infinity, at = 0, run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as Vec3, b = pts[i + 1] as Vec3;
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
    const wx = x - a[0], wy = y - a[1], wz = z - a[2];
    const l2 = ex * ex + ey * ey + ez * ez;
    const t = l2 > 1e-18 ? Math.max(0, Math.min(1, (wx * ex + wy * ey + wz * ez) / l2)) : 0;
    const dx = wx - ex * t, dy = wy - ey * t, dz = wz - ez * t;
    const d2 = dx * dx + dy * dy + dz * dz;
    const l = Math.sqrt(l2);
    if (d2 < best) { best = d2; at = run + l * t; }
    run += l;
  }
  return at;
}

/** How much light a point of a solid's skin keeps for what the solid is, apart from its shape: 1, and less in the fold of a joint. */
export function primShade(p: Prim, x: number, y: number, z: number): number {
  if (p.kind !== 'tube' || !p.creases || p.creases.length === 0) return 1;
  const s = tubeAlong(p.pts, x, y, z);
  let fold = 0;
  for (const c of p.creases) { const u = (s - c.at) / c.width; if (u > -3 && u < 3) fold = Math.max(fold, Math.exp(-u * u)); }
  return 1 - 0.4 * fold;
}

/** A flat solid's outline: how far a point of its own space is from it in the solid's plane (negative inside), whatever its height above the plane. */
export function primFlat(p: Prim, x: number, y: number, z: number): number {
  if (p.kind === 'pad') {
    const t = p.thin, u = t === 0 ? 1 : 0, v = t === 2 ? 1 : 2;
    const c = [x, y, z];
    const qu = Math.abs(c[u]!) - (p.half[u] - p.corner), qv = Math.abs(c[v]!) - (p.half[v] - p.corner);
    return Math.min(Math.max(qu, qv), 0) + Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) - p.corner;
  }
  if (p.kind === 'slab') return polygonDistance(x, y, p.outline, true);
  return Infinity;
}

/** How far a point of the plane is from a closed outline, negative inside it. */
export function outlineDistance(x: number, y: number, outline: readonly Vec2[]): number {
  return polygonDistance(x, y, outline, true);
}

/** How far (squared) the point asked about is from the middle of each stretch of the tube in hand. */
let apart = new Float64Array(64);

/** The signed distance of a solid at a point of its own space. */
export function primDistance(p: Prim, x: number, y: number, z: number): number {
  switch (p.kind) {
    case 'lumps':
      return p.lumps.length === 1 ? ellipsoid(x, y, z, p.lumps[0]!.c, p.lumps[0]!.r) : lumpsDistance(p.lumps, p.reach, x, y, z);
    case 'tube': {
      let best = Infinity;
      const pts = p.pts, radii = p.radii, near = p.near;
      if (near && pts.length > 4) {
        // The stretch whose middle is nearest first: with its distance known, most of the others are passed over (none is nearer than its bound,
        // the distance to its middle less its reach).
        const count = pts.length - 1;
        if (apart.length < count) apart = new Float64Array(count * 2);
        let first = 0, least = Infinity;
        for (let i = 0; i < count; i++) {
          const dx = x - (near[i * 4] as number), dy = y - (near[i * 4 + 1] as number), dz = z - (near[i * 4 + 2] as number);
          const d2 = dx * dx + dy * dy + dz * dz;
          apart[i] = d2;
          if (d2 < least) { least = d2; first = i; }
        }
        best = roundCone(x, y, z, pts[first] as Vec3, pts[first + 1] as Vec3, radii[first] as number, radii[first + 1] as number);
        for (let i = 0; i < count; i++) {
          if (i === first) continue;
          const reach = best + (near[i * 4 + 3] as number);
          if (reach <= 0 || (apart[i] as number) >= reach * reach) continue;
          const d = roundCone(x, y, z, pts[i] as Vec3, pts[i + 1] as Vec3, radii[i] as number, radii[i + 1] as number);
          if (d < best) best = d;
        }
        return best;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const d = roundCone(x, y, z, pts[i] as Vec3, pts[i + 1] as Vec3, radii[i] as number, radii[i + 1] as number);
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
    case 'pad': {
      const t = p.thin, u = t === 0 ? 1 : 0, v = t === 2 ? 1 : 2;
      const c = [x, y, z];
      // the rounded rectangle in the pad's plane, then its thickness, with the rim rounded over
      const qu = Math.abs(c[u]!) - (p.half[u] - p.corner), qv = Math.abs(c[v]!) - (p.half[v] - p.corner);
      const flat = Math.min(Math.max(qu, qv), 0) + Math.hypot(Math.max(qu, 0), Math.max(qv, 0)) - p.corner;
      const wa = flat + p.rim, wb = Math.abs(c[t]!) - (p.half[t] - p.rim);
      return Math.min(Math.max(wa, wb), 0) + Math.hypot(Math.max(wa, 0), Math.max(wb, 0)) - p.rim;
    }
    case 'slab': {
      const wa = polygonDistance(x, y, p.outline, true) + p.rim, wb = Math.abs(z) - (p.half - p.rim);
      return Math.min(Math.max(wa, wb), 0) + Math.hypot(Math.max(wa, 0), Math.max(wb, 0)) - p.rim;
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
    case 'pad': take(0, 0, 0, p.half); break;
    case 'slab': for (const q of p.outline) take(q[0], q[1], 0, [0, 0, p.half]); break;
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
    case 'slab': return [p.inside[0], p.inside[1], 0];
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

  /** The normals (body space, unit) of the planes flat parts lie in together, and what is gathered for each while a value is worked out. */
  private planes: readonly Vec3[];
  private joined: Array<{ any: boolean; flat: number; mid: number; half: number; rim: number; reach: number; soft: number }>;
  /** The widest join of the body: no part changes the skin further from itself than this. */
  readonly widest: number;
  /** For a pressed limb, which part it is pressed by. */
  private presser: Int32Array;
  /** The parts in the order they are joined: the flat parts that lie in a plane with others first (`flats` of them), then the rest, each the largest first. */
  private order: Int32Array;
  private flats: number;

  constructor(parts: readonly FieldPart[], planes: readonly Vec3[] = []) {
    // The largest first: each smaller part then joins what is there with its own, smaller, fillet.
    this.parts = [...parts].sort((a, b) => b.size - a.size);
    this.planes = planes;
    this.joined = planes.map(() => ({ any: false, flat: 0, mid: 0, half: 0, rim: 0, reach: 0, soft: 0 }));
    this.d = new Float64Array(this.parts.length);
    this.reach = new Float64Array(this.parts.length);
    let widest = 0, softest = 0;
    for (const p of this.parts) { softest = Math.max(softest, p.soft); widest = Math.max(widest, p.soft, p.flat && planes[p.flat.plane] ? p.flat.reach : 0); }
    this.widest = widest;
    // (a flat part reaches as far as its join in the plane; the rest, as far as a fillet)
    const inPlane = (p: FieldPart): boolean => p.flat !== undefined && planes[p.flat.plane] !== undefined;
    this.parts.forEach((p, i) => { this.reach[i] = (inPlane(p) ? Math.max(softest, p.flat!.reach) : softest) + 1e-6; });
    const all = this.parts.map((_, i) => i);
    const first = all.filter((i) => inPlane(this.parts[i] as FieldPart));
    this.flats = first.length;
    this.order = Int32Array.from([...first, ...all.filter((i) => !inPlane(this.parts[i] as FieldPart))]);
    this.presser = Int32Array.from(this.parts, (p) => (p.pressed ? this.parts.indexOf(p.pressed.of) : -1));
  }

  /** The distance of one part at a point of the body's space. */
  partDistance(i: number, x: number, y: number, z: number): number {
    const p = this.parts[i] as FieldPart;
    const m = p.toLocal;
    return primDistance(p.prim, m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, m[4]! * x + m[5]! * y + m[6]! * z + m[7]!, m[8]! * x + m[9]! * y + m[10]! * z + m[11]!) * p.scale;
  }

  /** How much light a point of one part's skin keeps for what the part is (the fold of a knuckle is darker): see `primShade`. */
  shade(i: number, x: number, y: number, z: number): number {
    const p = this.parts[i] as FieldPart;
    if (p.prim.kind !== 'tube' || !p.prim.creases) return 1;
    const m = p.toLocal;
    return primShade(p.prim, m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, m[4]! * x + m[5]! * y + m[6]! * z + m[7]!, m[8]! * x + m[9]! * y + m[10]! * z + m[11]!);
  }

  /** The joined skin's distance at a point; fills `d` with each part's own. */
  value(x: number, y: number, z: number): number {
    const parts = this.parts, d = this.d, joined = this.joined, order = this.order, flats = this.flats;
    let f = Infinity;
    if (flats > 0) {
      // The flat parts that lie in a plane together, first: their outlines are joined in the plane, and the thickness is taken by each one's share.
      // (`near`: the nearest of them so far, for telling which are out of reach)
      let near = Infinity;
      for (const j of joined) j.any = false;
      for (let o = 0; o < flats; o++) {
        const i = order[o] as number;
        const p = parts[i] as FieldPart;
        const ox = Math.max(p.lo[0] - x, 0, x - p.hi[0]), oy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), oz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
        if (hypot3(ox, oy, oz) > near + (this.reach[i] as number)) { d[i] = Infinity; continue; }
        const m = p.toLocal;
        const lx = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, ly = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!, lz = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
        const di = primDistance(p.prim, lx, ly, lz) * p.scale;
        d[i] = di;
        if (di < near) near = di;
        const own = p.flat!, j = joined[own.plane]!;
        const flat = primFlat(p.prim, lx, ly, lz) * p.scale;
        if (!j.any) { j.any = true; j.flat = flat; j.mid = own.mid; j.half = own.half; j.rim = own.rim; j.reach = own.reach; j.soft = p.soft; continue; }
        const k = Math.min(j.reach, own.reach);
        const h = k > 1e-9 ? Math.max(k - Math.abs(j.flat - flat), 0) / k : 0;
        const half = h * h * 0.5; // the share of the further of the two
        const share = flat < j.flat ? 1 - half : half; // of this part
        j.flat = (flat < j.flat ? flat : j.flat) - half * k * 0.5;
        j.mid += (own.mid - j.mid) * share; j.half += (own.half - j.half) * share; j.rim += (own.rim - j.rim) * share;
        if (p.soft < j.soft) j.soft = p.soft;
      }
      for (let g = 0; g < joined.length; g++) {
        const j = joined[g]!;
        if (!j.any) continue;
        const n = this.planes[g] as Vec3;
        const wa = j.flat + j.rim, wb = Math.abs(n[0] * x + n[1] * y + n[2] * z - j.mid) - (j.half - j.rim);
        const dj = Math.min(Math.max(wa, wb), 0) + Math.hypot(Math.max(wa, 0), Math.max(wb, 0)) - j.rim;
        f = f === Infinity ? dj : smin(f, dj, j.soft);
      }
    }
    // The rest grow out of that, and out of one another: each joins what is there with its own fillet.
    for (let o = flats; o < order.length; o++) {
      const i = order[o] as number;
      const p = parts[i] as FieldPart;
      // out of reach of this part's box: it cannot change the skin here; a lower bound of its distance is enough
      const ox = Math.max(p.lo[0] - x, 0, x - p.hi[0]), oy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), oz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
      if (hypot3(ox, oy, oz) > f + (this.reach[i] as number)) { d[i] = Infinity; continue; }
      const m = p.toLocal;
      const lx = m[0]! * x + m[1]! * y + m[2]! * z + m[3]!, ly = m[4]! * x + m[5]! * y + m[6]! * z + m[7]!, lz = m[8]! * x + m[9]! * y + m[10]! * z + m[11]!;
      let di = primDistance(p.prim, lx, ly, lz) * p.scale;
      const by = this.presser[i] as number;
      if (by >= 0 && di < this.reach[i]!) {
        // As thick as the flat part it grows from at the part's edge, half as much thicker again as it is far from it, and under its faces within it
        // (two skins lying together would swell where they are joined). How far in or out of the part is asked in the middle of its thickness.
        const press = p.pressed!;
        const h = press.n[0] * x + press.n[1] * y + press.n[2] * z - press.mid;
        const e = this.partDistance(by, x - h * press.n[0], y - h * press.n[1], z - h * press.n[2]);
        const allowed = e > 0 ? press.half + PRESS_EASE * e : press.half * Math.max(1 - PRESS_SINK, 1 + (PRESS_SINK * e) / press.half);
        di = -smin(-di, -(Math.abs(h) - allowed), 0.5 * press.half);
      }
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
