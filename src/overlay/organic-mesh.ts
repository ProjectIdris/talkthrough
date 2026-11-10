// The skin of a field (organic-field.ts) as triangles. The surface is followed, not searched for: starting from a cell on each part's skin, only the cells
// the skin passes through are visited (surface nets: one vertex a cell, a quad across every grid edge the skin crosses), so the cost is the skin's area and
// not the box round it, and a body can afford cells fine enough to keep a finger a finger. Each vertex is then moved onto the true surface along the field's
// slope and takes its normal from the slope, so the mesh shades as the smooth thing it samples, and learns which part it belongs to, how near the next part
// is (colours blend across a join by that) and how shut in it is (a crease is darker than a crown). No three.js here.

import type { BodyField } from './organic-field.ts';

export type Skin = {
  position: Float32Array; normal: Float32Array; index: Uint32Array;
  /** The part each vertex belongs to and the next nearest, as indices into the field's parts, and how much of the second shows (0 to 0.5). */
  owner: Uint16Array; other: Uint16Array; mix: Float32Array;
  /** How open each vertex is to the light: 1 on a crown, less in a crease. */
  open: Float32Array;
  /** The cell size it was cut at. */
  cell: number;
};

export type SkinOptions = {
  /** The cell size asked for; made larger when the grid would not fit. */
  cell: number;
  /** Which surface: the outer skin, or the lining of the cavity. */
  surface?: 'skin' | 'lining';
  /** The most grid points (memory): the cell grows until the box fits. */
  maxNodes?: number;
  /** The most vertices the skin may have: past it the skin is cut again with larger cells. */
  maxVertices?: number;
};

/** No skin has more vertices than this, whatever is asked for (the finest tier's body is about a quarter of it). */
export const SKIN_VERTEX_CEILING = 120_000;
/** No grid has more points than this. */
export const SKIN_NODE_CEILING = 4_000_000;

const EMPTY: Skin = { position: new Float32Array(0), normal: new Float32Array(0), index: new Uint32Array(0), owner: new Uint16Array(0), other: new Uint16Array(0), mix: new Float32Array(0), open: new Float32Array(0), cell: 0 };

/**
 * Cuts the skin (or the cavity lining) of a body out of its field. Bounded whatever it is given: a field with no finite box or cell has no skin, the grid
 * never has more than `SKIN_NODE_CEILING` points, and a skin that would pass `SKIN_VERTEX_CEILING` vertices is cut again coarser.
 */
export function cutSkin(field: BodyField, options: SkinOptions): Skin {
  const steps = cutSkinSteps(field, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** How many cells are followed, and how many vertices are settled, in one step of a cut taken in steps. */
const STEP_CELLS = 500;
const STEP_VERTICES = 120;

/**
 * The same cut a little at a time: each `next()` does a bounded piece of the work (a few hundred cells or vertices) and the last one returns the skin. A
 * caller with a frame to draw spreads a large body's skin over several frames with it.
 */
export function* cutSkinSteps(field: BodyField, options: SkinOptions): Generator<void, Skin, void> {
  if (field.parts.length === 0 || !Number.isFinite(options.cell) || !(options.cell > 0)) return EMPTY;
  for (const p of field.parts) for (let a = 0; a < 3; a++) if (!Number.isFinite(p.lo[a]) || !Number.isFinite(p.hi[a]) || !Number.isFinite(p.inside[a])) return EMPTY;
  const maxVertices = Math.max(64, Math.min(SKIN_VERTEX_CEILING, Math.floor(options.maxVertices ?? SKIN_VERTEX_CEILING)));
  const maxNodes = Math.max(4096, Math.min(SKIN_NODE_CEILING, Math.floor(options.maxNodes ?? SKIN_NODE_CEILING)));
  let cell = Math.max(1e-5, options.cell);
  for (let attempt = 0; attempt < 64; attempt++) {
    const skin = yield* cutAt(field, options.surface === 'lining', cell, maxNodes, maxVertices);
    if (skin) return skin;
    cell *= 1.3;
  }
  return EMPTY;
}

/** One attempt at a cell size; nothing when the skin would have too many vertices. */
function* cutAt(field: BodyField, lining: boolean, cell: number, maxNodes: number, maxVertices: number): Generator<void, Skin | null, void> {
  const parts = field.parts;
  const f = lining ? (x: number, y: number, z: number): number => field.cavity(x, y, z) : (x: number, y: number, z: number): number => field.value(x, y, z);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p.lo[a]!); hi[a] = Math.max(hi[a]!, p.hi[a]!); }
  let h = cell;
  let nx = 0, ny = 0, nz = 0;
  const pad = 3;
  for (let grow = 0; ; grow++) {
    nx = Math.ceil((hi[0]! - lo[0]!) / h) + 2 * pad + 1; ny = Math.ceil((hi[1]! - lo[1]!) / h) + 2 * pad + 1; nz = Math.ceil((hi[2]! - lo[2]!) / h) + 2 * pad + 1;
    if (nx * ny * nz <= maxNodes) break;
    if (grow > 400) return EMPTY;
    h *= 1.12;
  }
  const ox = lo[0]! - pad * h, oy = lo[1]! - pad * h, oz = lo[2]! - pad * h;
  const sx = nx, sxy = nx * ny;
  const nodes = new Float32Array(nx * ny * nz).fill(NaN);
  const node = (i: number, j: number, k: number): number => {
    const key = i + j * sx + k * sxy;
    let v = nodes[key] as number;
    if (v !== v) {
      v = f(ox + i * h, oy + j * h, oz + k * h);
      // a value of exactly zero has no side: nudge it inside
      if (v === 0) v = -1e-12;
      nodes[key] = v;
    }
    return v;
  };
  // The vertex of each cell the skin passes through (index + 1; 0 not seen yet, -1 seen and empty).
  const cells = new Int32Array((nx - 1) * (ny - 1) * (nz - 1));
  const cx = nx - 1, cxy = (nx - 1) * (ny - 1);
  const pos: number[] = [];
  const guess: number[] = []; // the slope from the cell's own corners, for the first move onto the surface
  const where: number[] = []; // the cell of each vertex
  const stack: number[] = [];
  let over = false;
  const corner = new Float64Array(8);
  const visit = (i: number, j: number, k: number): void => {
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return;
    const key = i + j * cx + k * cxy;
    if (cells[key] !== 0) return;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = node(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) { cells[key] = -1; return; }
    // The vertex: the mean of where the skin crosses the cell's twelve edges.
    let px = 0, py = 0, pz = 0, n = 0;
    for (let c = 0; c < 8; c++) {
      for (let a = 0; a < 3; a++) {
        const bit = 1 << a;
        if (c & bit) continue;
        const d = c | bit;
        const va = corner[c] as number, vb = corner[d] as number;
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        px += (c & 1) + (a === 0 ? t : 0); py += ((c >> 1) & 1) + (a === 1 ? t : 0); pz += ((c >> 2) & 1) + (a === 2 ? t : 0);
        n++;
      }
    }
    pos.push(ox + (i + px / n) * h, oy + (j + py / n) * h, oz + (k + pz / n) * h);
    guess.push(
      (corner[1]! + corner[3]! + corner[5]! + corner[7]! - corner[0]! - corner[2]! - corner[4]! - corner[6]!) / (4 * h),
      (corner[2]! + corner[3]! + corner[6]! + corner[7]! - corner[0]! - corner[1]! - corner[4]! - corner[5]!) / (4 * h),
      (corner[4]! + corner[5]! + corner[6]! + corner[7]! - corner[0]! - corner[1]! - corner[2]! - corner[3]!) / (4 * h),
    );
    where.push(i, j, k);
    cells[key] = pos.length / 3;
    if (pos.length / 3 > maxVertices) over = true;
    // On through every face the skin crosses.
    const face = (m: number): boolean => { const s = mask & m; return s !== 0 && s !== m; };
    if (face(0b01010101)) stack.push(i - 1, j, k);
    if (face(0b10101010)) stack.push(i + 1, j, k);
    if (face(0b00110011)) stack.push(i, j - 1, k);
    if (face(0b11001100)) stack.push(i, j + 1, k);
    if (face(0b00001111)) stack.push(i, j, k - 1);
    if (face(0b11110000)) stack.push(i, j, k + 1);
  };
  // A start on each part's skin: from a point inside it, out along x until the field changes sign.
  let followed = 0;
  for (const p of parts) {
    if (lining && p.wall <= 0) continue;
    let i = Math.floor((p.inside[0] - ox) / h);
    const j = Math.floor((p.inside[1] - oy) / h), k = Math.floor((p.inside[2] - oz) / h);
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) continue;
    if (!(node(i, j, k) < 0)) continue;
    while (i < nx - 2 && node(i + 1, j, k) < 0) i++;
    stack.push(i, j, k);
    while (stack.length && !over) {
      const c = stack.pop() as number, b = stack.pop() as number, a = stack.pop() as number;
      visit(a, b, c);
      if (++followed % STEP_CELLS === 0) yield;
    }
    if (over) return null;
  }
  const count = pos.length / 3;
  if (count === 0) return EMPTY;
  yield;
  // A quad across every grid edge the skin crosses, between the four cells that share the edge.
  const idx: number[] = [];
  const at = (i: number, j: number, k: number): number => (cells[i + j * cx + k * cxy] as number) - 1;
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const d1 = (pos[a * 3]! - pos[c * 3]!) ** 2 + (pos[a * 3 + 1]! - pos[c * 3 + 1]!) ** 2 + (pos[a * 3 + 2]! - pos[c * 3 + 2]!) ** 2;
    const d2 = (pos[b * 3]! - pos[d * 3]!) ** 2 + (pos[b * 3 + 1]! - pos[d * 3 + 1]!) ** 2 + (pos[b * 3 + 2]! - pos[d * 3 + 2]!) ** 2;
    if (d1 <= d2) { if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); }
    else if (flip) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
  };
  for (let v = 0; v < count; v++) {
    const i = where[v * 3] as number, j = where[v * 3 + 1] as number, k = where[v * 3 + 2] as number;
    const v0 = node(i, j, k) < 0;
    if (j > 0 && k > 0 && v0 !== node(i + 1, j, k) < 0) quad(v, at(i, j - 1, k), at(i, j - 1, k - 1), at(i, j, k - 1), !v0);
    if (i > 0 && k > 0 && v0 !== node(i, j + 1, k) < 0) quad(v, at(i, j, k - 1), at(i - 1, j, k - 1), at(i - 1, j, k), !v0);
    if (i > 0 && j > 0 && v0 !== node(i, j, k + 1) < 0) quad(v, at(i - 1, j, k), at(i - 1, j - 1, k), at(i, j - 1, k), !v0);
  }
  // Onto the true surface, and the slope there as the normal.
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3);
  const owner = new Uint16Array(count), other = new Uint16Array(count), mix = new Float32Array(count), open = new Float32Array(count);
  const e = h * 0.35;
  const dist = field.d;
  let extent = 0;
  for (let a = 0; a < 3; a++) extent = Math.max(extent, hi[a]! - lo[a]!);
  for (let v = 0; v < count; v++) {
    if (v % STEP_VERTICES === STEP_VERTICES - 1) yield;
    let x = pos[v * 3] as number, y = pos[v * 3 + 1] as number, z = pos[v * 3 + 2] as number;
    let gx = guess[v * 3] as number, gy = guess[v * 3 + 1] as number, gz = guess[v * 3 + 2] as number;
    // Towards the surface by the slope of the cell's own corners; the true slope there (which is the normal); then onto the surface by that. Whose the
    // vertex is is read where the field was last asked for its value, a hair from where the vertex ends.
    let first = 0, second = 0, d1 = Infinity, d2 = Infinity;
    for (let pass = 0; pass < 2; pass++) {
      const value = f(x, y, z);
      if (pass === 1) {
        if (lining) field.value(x, y, z);
        for (let p = 0; p < dist.length; p++) {
          let d = dist[p] as number;
          if (lining) { const wall = parts[p]!.wall; d = wall > 0 ? d + wall : Infinity; }
          if (d < d1) { d2 = d1; second = first; d1 = d; first = p; } else if (d < d2) { d2 = d; second = p; }
        }
      }
      const g2 = gx * gx + gy * gy + gz * gz;
      if (g2 > 1e-12) {
        let step = value / g2;
        const len = Math.abs(step) * Math.sqrt(g2);
        if (len > h * 0.75) step *= (h * 0.75) / len;
        x -= gx * step; y -= gy * step; z -= gz * step;
      }
      if (pass === 0) {
        gx = (f(x + e, y, z) - f(x - e, y, z)) / (2 * e);
        gy = (f(x, y + e, z) - f(x, y - e, z)) / (2 * e);
        gz = (f(x, y, z + e) - f(x, y, z - e)) / (2 * e);
      }
    }
    // A field that gave no number here leaves the vertex where its cell put it, facing the way the cell's corners say.
    if (!Number.isFinite(x + y + z + gx + gy + gz)) {
      x = pos[v * 3] as number; y = pos[v * 3 + 1] as number; z = pos[v * 3 + 2] as number;
      gx = guess[v * 3] as number; gy = guess[v * 3 + 1] as number; gz = guess[v * 3 + 2] as number;
      if (!Number.isFinite(gx + gy + gz)) { gx = 0; gy = 1; gz = 0; }
    }
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const sign = lining ? -1 : 1; // the lining faces into the cavity
    const nx_ = gx / l, ny_ = gy / l, nz_ = gz / l;
    position[v * 3] = x; position[v * 3 + 1] = y; position[v * 3 + 2] = z;
    normal[v * 3] = nx_ * sign; normal[v * 3 + 1] = ny_ * sign; normal[v * 3 + 2] = nz_ * sign;
    // Whose it is: the nearest part (of a lining: the part whose cavity it lines), and how much of the next shows across a join.
    owner[v] = first;
    other[v] = d2 === Infinity ? first : second;
    if (d2 !== Infinity) {
      const band = Math.max(1e-6, Math.max(Math.min(parts[first]!.soft, parts[second]!.soft), h) * 1.2);
      const t = Math.max(0, 1 - (d2 - d1) / band);
      mix[v] = 0.5 * t * t * (3 - 2 * t);
    }
    // How open it is: the field a little way out along the normal is that far away on a crown, nearer in a crease.
    if (!lining) {
      const r1 = extent * 0.035, r2 = extent * 0.11;
      // (measured against the field's own slope here: a squashed solid's field rises more slowly than a true distance)
      const a1 = field.value(x + nx_ * r1, y + ny_ * r1, z + nz_ * r1) / (r1 * l);
      const a2 = field.value(x + nx_ * r2, y + ny_ * r2, z + nz_ * r2) / (r2 * l);
      open[v] = Math.max(0, Math.min(1, 0.5 * Math.min(1, a1) + 0.5 * Math.min(1, a2)));
    } else open[v] = 1;
  }
  // The lining is seen from inside the cavity: its triangles wind the other way.
  const index = new Uint32Array(idx);
  if (lining) for (let t = 0; t < index.length; t += 3) { const s = index[t + 1] as number; index[t + 1] = index[t + 2] as number; index[t + 2] = s; }
  return { position, normal, index, owner, other, mix, open, cell: h };
}

export type Patch = { position: Float32Array; normal: Float32Array; index: Uint32Array; owner: Uint16Array; other: Uint16Array; mix: Float32Array; open: Float32Array };

/** The part of a skin each part of the body owns: a triangle goes to the part most of its corners belong to. Together the patches are the whole skin. */
export function patches(skin: Skin, count: number): Patch[] {
  const lists: number[][] = Array.from({ length: count }, () => []);
  const { index, owner } = skin;
  for (let t = 0; t < index.length; t += 3) {
    const a = owner[index[t] as number] as number, b = owner[index[t + 1] as number] as number, c = owner[index[t + 2] as number] as number;
    (lists[b === c ? b : a] as number[]).push(index[t] as number, index[t + 1] as number, index[t + 2] as number);
  }
  return lists.map((list) => {
    const remap = new Map<number, number>();
    const idx = new Uint32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const v = list[i] as number;
      let n = remap.get(v);
      if (n === undefined) { n = remap.size; remap.set(v, n); }
      idx[i] = n;
    }
    const n = remap.size;
    const out: Patch = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), index: idx, owner: new Uint16Array(n), other: new Uint16Array(n), mix: new Float32Array(n), open: new Float32Array(n) };
    for (const [v, m] of remap) {
      for (let a = 0; a < 3; a++) { out.position[m * 3 + a] = skin.position[v * 3 + a] as number; out.normal[m * 3 + a] = skin.normal[v * 3 + a] as number; }
      out.owner[m] = skin.owner[v] as number; out.other[m] = skin.other[v] as number; out.mix[m] = skin.mix[v] as number; out.open[m] = skin.open[v] as number;
    }
    return out;
  });
}

/** No cut face is sampled at more points than this (its vertices are at most a few times as many). */
export const FACE_NODE_CEILING = 40_000;

export type Face = {
  position: Float32Array; index: Uint32Array;
  owner: Uint16Array; other: Uint16Array; mix: Float32Array;
  /** For each vertex: how deep under the skin it is, and how far from the cavity (a large number when the body is solid). */
  inside: Float32Array;
};

/**
 * The cut face of a body: the part of a plane that lies in its flesh (inside the skin and, for a hollow body, outside the cavity), as triangles with what
 * each point is (whose, how deep, how near the cavity or what else sits in the body) so the face can be drawn in layers. The plane is `origin` and two unit
 * directions across it, in the body's space; the triangles face along `u` x `v`. `only` is a box (the body's space) the face is wanted in: one part's own
 * with room round it. Its samples lie where the whole face's would, so the faces of parts side by side on one plane meet triangle for triangle.
 */
export function cutFace(
  field: BodyField, origin: readonly number[], u: readonly number[], v: readonly number[], cell: number, hollow: boolean,
  holes?: (x: number, y: number, z: number) => number, only?: { lo: readonly number[]; hi: readonly number[] },
): Face {
  const parts = field.parts;
  // The body's box on the plane.
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of parts) {
    for (const x of [p.lo[0], p.hi[0]]) for (const y of [p.lo[1], p.hi[1]]) for (const z of [p.lo[2], p.hi[2]]) {
      const rx = x - origin[0]!, ry = y - origin[1]!, rz = z - origin[2]!;
      const a = rx * u[0]! + ry * u[1]! + rz * u[2]!, b = rx * v[0]! + ry * v[1]! + rz * v[2]!;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
  }
  const none: Face = { position: new Float32Array(0), index: new Uint32Array(0), owner: new Uint16Array(0), other: new Uint16Array(0), mix: new Float32Array(0), inside: new Float32Array(0) };
  if (![a0, a1, b0, b1, cell].every(Number.isFinite) || !(cell > 0)) return none;
  let h = Math.max(1e-5, cell);
  while (((a1 - a0) / h + 3) * ((b1 - b0) / h + 3) > FACE_NODE_CEILING) h *= 1.15;
  if (only) {
    // The box on the plane, if the plane passes through it at all.
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    let c0 = Infinity, c1 = -Infinity, e0 = Infinity, e1 = -Infinity, below = false, above = false;
    for (const x of [only.lo[0]!, only.hi[0]!]) for (const y of [only.lo[1]!, only.hi[1]!]) for (const z of [only.lo[2]!, only.hi[2]!]) {
      const rx = x - origin[0]!, ry = y - origin[1]!, rz = z - origin[2]!;
      const a = rx * u[0]! + ry * u[1]! + rz * u[2]!, b = rx * v[0]! + ry * v[1]! + rz * v[2]!;
      c0 = Math.min(c0, a); c1 = Math.max(c1, a); e0 = Math.min(e0, b); e1 = Math.max(e1, b);
      if (rx * n[0]! + ry * n[1]! + rz * n[2]! < 0) below = true; else above = true;
    }
    a0 = Math.max(a0, c0); a1 = Math.min(a1, c1); b0 = Math.max(b0, e0); b1 = Math.min(b1, e1);
    if (!below || !above || !(a0 <= a1) || !(b0 <= b1)) return none;
  }
  // The samples are whole steps of `h` from the plane's origin, whatever box they are taken in.
  const i0 = Math.floor(a0 / h) - 1, j0 = Math.floor(b0 / h) - 1;
  const nx = Math.ceil(a1 / h) + 2 - i0, ny = Math.ceil(b1 / h) + 2 - j0;
  const oa = i0 * h, ob = j0 * h;
  // Each sample of the plane is asked once, and what it is is kept: the skin's distance, the nearest of the cavity and whatever else sits in the body
  // (`holes`: negative inside those), whose flesh it is. `val` is negative in the flesh: inside the skin, outside the cavity and the other solids.
  const all = nx * ny;
  const val = new Float32Array(all), skin = new Float32Array(all), gap = new Float32Array(all).fill(NaN);
  const own = new Uint16Array(all), next = new Uint16Array(all), share = new Float32Array(all);
  const dist = field.d;
  // A sample clear of every part's box by more than a join can swell the skin is outside the body, and so are the samples next to it: it is not asked.
  let widest = 0;
  for (const p of parts) widest = Math.max(widest, p.soft);
  const clear = (1.5 * h + widest + 2 * Math.abs(field.relief)) ** 2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const key = i + j * nx;
    const a = oa + i * h, b = ob + j * h;
    const x = origin[0]! + u[0]! * a + v[0]! * b, y = origin[1]! + u[1]! * a + v[1]! * b, z = origin[2]! + u[2]! * a + v[2]! * b;
    if (only && (x < only.lo[0]! || x > only.hi[0]! || y < only.lo[1]! || y > only.hi[1]! || z < only.lo[2]! || z > only.hi[2]!)) { val[key] = skin[key] = h; continue; }
    let near = Infinity;
    for (const p of parts) {
      const ox = Math.max(p.lo[0] - x, 0, x - p.hi[0]), oy = Math.max(p.lo[1] - y, 0, y - p.hi[1]), oz = Math.max(p.lo[2] - z, 0, z - p.hi[2]);
      const o2 = ox * ox + oy * oy + oz * oz;
      if (o2 < near) near = o2;
    }
    if (near > clear) { val[key] = skin[key] = Math.sqrt(near); continue; }
    const f0 = field.value(x, y, z);
    skin[key] = f0;
    if (f0 >= 0) { val[key] = f0; continue; }
    let first = 0, second = 0, d1 = Infinity, d2 = Infinity;
    for (let p = 0; p < dist.length; p++) {
      const d = dist[p] as number;
      if (d < d1) { d2 = d1; second = first; d1 = d; first = p; } else if (d < d2) { d2 = d; second = p; }
    }
    own[key] = first;
    next[key] = d2 === Infinity ? first : second;
    if (d2 !== Infinity) {
      const band = Math.max(1e-6, Math.max(Math.min(parts[first]!.soft, parts[second]!.soft), h) * 1.2);
      const t = Math.max(0, 1 - (d2 - d1) / band);
      share[key] = 0.5 * t * t * (3 - 2 * t);
    }
    let c = hollow ? field.cavity(x, y, z) : Infinity;
    if (holes) c = Math.min(c, holes(x, y, z));
    gap[key] = c;
    const f = c !== Infinity && -c > f0 ? -c : f0;
    val[key] = f === 0 ? -1e-9 : f;
  }
  const pos: number[] = [], idx: number[] = [];
  // For each vertex: the sample it takes its owner from, how deep under the skin it is and how far from the cavity or the other solids.
  const from: number[] = [], deep: number[] = [], off: number[] = [];
  const put = (a: number, b: number): void => {
    pos.push(origin[0]! + u[0]! * a + v[0]! * b, origin[1]! + u[1]! * a + v[1]! * b, origin[2]! + u[2]! * a + v[2]! * b);
  };
  const inner = new Int32Array(all).fill(-1), ea = new Int32Array(all).fill(-1), eb = new Int32Array(all).fill(-1);
  const node = (i: number, j: number): number => {
    const key = i + j * nx;
    let n = inner[key] as number;
    if (n < 0) {
      n = pos.length / 3;
      put(oa + i * h, ob + j * h);
      from.push(key); deep.push(Math.max(0, -(skin[key] as number))); off.push(Math.max(0, gap[key] as number));
      inner[key] = n;
    }
    return n;
  };
  const cross = (i: number, j: number, alongA: boolean): number => {
    const key = i + j * nx;
    const store = alongA ? ea : eb;
    let n = store[key] as number;
    if (n < 0) {
      const far = alongA ? key + 1 : key + nx;
      const x = val[key] as number, y = val[far] as number;
      const t = x / (x - y);
      n = pos.length / 3;
      put(oa + (i + (alongA ? t : 0)) * h, ob + (j + (alongA ? 0 : t)) * h);
      // Between a sample in the flesh and one out of it: the flesh one's owner, and the depths run between the two (a sample outside the skin was not
      // asked how far the cavity is: the flesh one's distance stands for both).
      const within = x < 0 ? key : far;
      let g0 = gap[key] as number, g1 = gap[far] as number;
      if (g0 !== g0) g0 = g1;
      if (g1 !== g1) g1 = g0;
      from.push(within);
      deep.push(Math.max(0, -((skin[key] as number) + ((skin[far] as number) - (skin[key] as number)) * t)));
      off.push(g0 === Infinity || g1 === Infinity ? Infinity : Math.max(0, g0 + (g1 - g0) * t));
      store[key] = n;
    }
    return n;
  };
  const poly: number[] = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = i + j * nx;
    const a = (val[k] as number) < 0, b = (val[k + 1] as number) < 0, c = (val[k + 1 + nx] as number) < 0, d = (val[k + nx] as number) < 0;
    if (!a && !b && !c && !d) continue;
    poly.length = 0;
    if (a) poly.push(node(i, j));
    if (a !== b) poly.push(cross(i, j, true));
    if (b) poly.push(node(i + 1, j));
    if (b !== c) poly.push(cross(i + 1, j, false));
    if (c) poly.push(node(i + 1, j + 1));
    if (c !== d) poly.push(cross(i, j + 1, true));
    if (d) poly.push(node(i, j + 1));
    if (d !== a) poly.push(cross(i, j, false));
    for (let t = 1; t < poly.length - 1; t++) idx.push(poly[0]!, poly[t]!, poly[t + 1]!);
  }
  const count = pos.length / 3;
  const owner = new Uint16Array(count), other = new Uint16Array(count), mix = new Float32Array(count), inside = new Float32Array(count * 2);
  for (let n = 0; n < count; n++) {
    const key = from[n] as number;
    owner[n] = own[key] as number;
    other[n] = next[key] as number;
    mix[n] = share[key] as number;
    inside[n * 2] = deep[n] as number;
    const c = off[n] as number;
    inside[n * 2 + 1] = c === Infinity ? 1e6 : c;
  }
  return { position: new Float32Array(pos), index: new Uint32Array(idx), owner, other, mix, inside };
}
