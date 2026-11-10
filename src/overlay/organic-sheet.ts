// A flat outline of living material (a leaf, a fin, a petal, a wing's membrane) drawn as the thin grown thing it is, not as a plate cut from sheet metal:
// the outline's corners are eased into a curve (a tip stays a tip), the faces swell from a thin rounded margin to their full thickness, and the sheet is not
// perfectly flat. Same place and size as the extrusion the scene language describes: the outline in x and y, centred on z, `depth` thick at its thickest.

import { BufferAttribute, BufferGeometry } from 'three';
import type { Vec2 } from '../scene/types.ts';
import { swell } from './organic-field.ts';

/** A corner sharper than this (degrees inside the outline) is kept as a point; a blunter one is rounded into the curve. */
const KEEP_CORNER = 82;

/** The outline as a smooth closed curve through its points, `per` samples an edge; sharp corners stay. */
export function easeOutline(outline: readonly Vec2[], per: number): Vec2[] {
  const n = outline.length;
  if (n < 3) return outline.map((p) => [p[0], p[1]]);
  const sharp: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[(i + n - 1) % n] as Vec2, b = outline[i] as Vec2, c = outline[(i + 1) % n] as Vec2;
    const ux = a[0] - b[0], uy = a[1] - b[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    sharp.push(Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI) < KEEP_CORNER);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = outline[(i + n - 1) % n] as Vec2, p1 = outline[i] as Vec2, p2 = outline[(i + 1) % n] as Vec2, p3 = outline[(i + 2) % n] as Vec2;
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    // Tangents of a curve through the points, scaled to this edge; at a kept corner the edge leaves straight.
    const tangent = (a: Vec2, b: Vec2, c: Vec2, corner: boolean, edge: Vec2): Vec2 => {
      if (corner) return edge;
      const dx = c[0] - a[0], dy = c[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      return [(dx / l) * len, (dy / l) * len];
    };
    const edge: Vec2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const m1 = tangent(p0, p1, p2, sharp[i] as boolean, edge), m2 = tangent(p1, p2, p3, sharp[(i + 1) % n] as boolean, edge);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const h1 = 2 * t3 - 3 * t2 + 1, h2 = t3 - 2 * t2 + t, h3 = -2 * t3 + 3 * t2, h4 = t3 - t2;
      out.push([h1 * p1[0] + h2 * m1[0] + h3 * p2[0] + h4 * m2[0], h1 * p1[1] + h2 * m1[1] + h3 * p2[1] + h4 * m2[1]]);
    }
  }
  return out;
}

/** No sheet is cut finer than this many cells across (so none has more than about twice its square in vertices), nor reads more outline points than this. */
export const SHEET_ACROSS_CEILING = 160;
export const SHEET_OUTLINE_CEILING = 256;

/** The distance from a point to a closed outline, negative inside. */
function outlineDistance(x: number, y: number, pts: readonly Vec2[]): number {
  let best = Infinity, inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[j] as Vec2, b = pts[i] as Vec2;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const wx = x - a[0], wy = y - a[1];
    const l2 = ex * ex + ey * ey;
    const t = l2 > 1e-18 ? Math.max(0, Math.min(1, (wx * ex + wy * ey) / l2)) : 0;
    const dx = wx - ex * t, dy = wy - ey * t;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

/**
 * The sheet: both faces and the rounded margin between them as one closed surface. `across` is how many cells the outline's longer side is cut into.
 * `wave` is how far out of flat it may go, as a share of its size (a leaf is never a plane).
 */
export function sheetGeometry(outline: readonly Vec2[], depth: number, across: number, wave = 0.012): BufferGeometry {
  const curve = easeOutline(outline.length > SHEET_OUTLINE_CEILING ? outline.slice(0, SHEET_OUTLINE_CEILING) : outline, 8);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of curve) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  if (![x0, y0, x1, y1, depth].every(Number.isFinite)) return new BufferGeometry();
  const size = Math.max(x1 - x0, y1 - y0, 1e-6);
  const h = size / Math.max(8, Math.min(SHEET_ACROSS_CEILING, Number.isFinite(across) ? across : 8));
  const nx = Math.ceil((x1 - x0) / h) + 3, ny = Math.ceil((y1 - y0) / h) + 3;
  const ox = x0 - h, oy = y0 - h;
  // The outline's distance at the grid's points, and the deepest of them: the margin swells to the full thickness over a share of that.
  const dist = new Float32Array(nx * ny);
  let deepest = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const d = outlineDistance(ox + i * h, oy + j * h, curve);
    dist[i + j * nx] = d === 0 ? -1e-9 : d;
    if (-d > deepest) deepest = -d;
  }
  const rim = Math.max(depth / 2, Math.min(deepest * 0.75, depth * 3));
  const half = depth / 2;
  const height = (d: number): number => {
    const t = Math.max(0, Math.min(1, -d / rim));
    return half * Math.sqrt(1 - (1 - t) * (1 - t));
  };
  const bend = (x: number, y: number): number => size * wave * swell(x / size * 2.2 + 3.7, y / size * 2.2 + 1.3, 0.5);
  const pos: number[] = [];
  const idx: number[] = [];
  // Vertices: a top and a bottom one at each grid point inside, and one on the margin wherever a grid edge crosses the outline (shared by both faces).
  const inner = new Int32Array(nx * ny).fill(-1);
  const edgeX = new Int32Array(nx * ny).fill(-1), edgeY = new Int32Array(nx * ny).fill(-1);
  const top = (i: number, j: number): number => {
    const key = i + j * nx;
    let v = inner[key] as number;
    if (v < 0) {
      const x = ox + i * h, y = oy + j * h, z = height(dist[key] as number), b = bend(x, y);
      v = pos.length / 3;
      pos.push(x, y, z + b, x, y, -z + b);
      inner[key] = v;
    }
    return v;
  };
  const cross = (i: number, j: number, alongX: boolean): number => {
    const key = i + j * nx;
    const store = alongX ? edgeX : edgeY;
    let v = store[key] as number;
    if (v < 0) {
      const a = dist[key] as number, b = dist[alongX ? key + 1 : key + nx] as number;
      const t = a / (a - b);
      const x = ox + (i + (alongX ? t : 0)) * h, y = oy + (j + (alongX ? 0 : t)) * h;
      v = pos.length / 3;
      pos.push(x, y, bend(x, y));
      store[key] = v;
    }
    return v;
  };
  // Each cell: the polygon of its inside corners and margin crossings, as a fan, on the top face and mirrored on the bottom.
  const poly: Array<{ v: number; rim: boolean }> = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = i + j * nx;
    const a = (dist[k] as number) < 0, b = (dist[k + 1] as number) < 0, c = (dist[k + 1 + nx] as number) < 0, d = (dist[k + nx] as number) < 0;
    if (!a && !b && !c && !d) continue;
    poly.length = 0;
    if (a) poly.push({ v: top(i, j), rim: false });
    if (a !== b) poly.push({ v: cross(i, j, true), rim: true });
    if (b) poly.push({ v: top(i + 1, j), rim: false });
    if (b !== c) poly.push({ v: cross(i + 1, j, false), rim: true });
    if (c) poly.push({ v: top(i + 1, j + 1), rim: false });
    if (c !== d) poly.push({ v: cross(i, j + 1, true), rim: true });
    if (d) poly.push({ v: top(i, j + 1), rim: false });
    if (d !== a) poly.push({ v: cross(i, j, false), rim: true });
    for (let t = 1; t < poly.length - 1; t++) {
      const p = poly[0]!, q = poly[t]!, r = poly[t + 1]!;
      idx.push(p.v, q.v, r.v); // counter-clockwise seen from +z
      idx.push(p.rim ? p.v : p.v + 1, r.rim ? r.v : r.v + 1, q.rim ? q.v : q.v + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
