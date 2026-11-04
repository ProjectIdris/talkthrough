// Marks that land on the picture. A model points at what is in a screenshot from a downsized view, so a box comes
// out a few pixels loose, an arrow stops short of its curve, a ring sits beside the crossing it means. This looks
// at the page's own pixels (edges, corners, where there is ink) near each mark and moves it onto what it was aimed at:
//   - an arrow's tip goes to the nearest line or curve;
//   - a point, and a small ring, go to the nearest corner or crossing (or onto the nearest line when there is none);
//   - a polygon's corners go to the page's corners; a traced curve is laid onto the curve it follows;
//   - a box is tightened to the figure it surrounds, and grown past an edge that cuts through the figure;
//   - an underline drops to the bottom of the line of text it is under.
// It never moves a mark far (a few percent of the screen), and it leaves a mark alone wherever it cannot tell what
// was meant: a page that is all text, two lines that are equally near, a mark over a blank place.
// Pure (no DOM): the page hands it a gray picture of the screenshot, and asks about marks in scene units (0 to 1000).

import type { Action, Mark, Vec2 } from '../scene/types.ts';

/** How far a mark may move, as a share of the shorter side of the picture: a few percent, never "far". */
import type { BlockGrid } from './snap-blocks.ts';
import { fitParagraph, fitTable, fitUnderline } from './snap-blocks.ts';

export const MAX_MOVE = 0.07;

type Cell = { x: number; y: number };

const EDGE_STEP = 100; // a Sobel step: about 25 gray levels across a sharp edge
const LINE_LENGTH = 0.06; // an edge must run this far (a share of the shorter side) to count as a line: letters are shorter

export type SnapReport = { id: string; op: string; /** The furthest any point of the mark moved, in units of the shorter side (0 to 1000). */ moved: number };

export class Snapper {
  readonly cols: number;
  readonly rows: number;
  /** Cells per unit on each axis: the picture is 1000 units across each way. */
  private kx: number;
  private ky: number;
  private gray: Float32Array;
  private edge: Uint8Array;
  /** The cells of the long edges: what a mark can land on. */
  private strong: Uint8Array;
  private part: Int32Array;
  private near: Float32Array;
  private src: Int32Array;
  private ink: Uint8Array;
  private inkSums: Sums;
  private strongSums: Sums;
  private corners: { x: number; y: number; w: number }[] = [];
  private scale: number;
  private gx: Float32Array;
  private gy: Float32Array;

  constructor(gray: ArrayLike<number>, cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.kx = cols / 1000;
    this.ky = rows / 1000;
    this.scale = Math.min(cols, rows);
    this.gray = Float32Array.from(gray as ArrayLike<number>);
    const { mag, gx, gy } = gradients(this.gray, cols, rows);
    this.gx = gx;
    this.gy = gy;
    this.edge = new Uint8Array(cols * rows);
    for (let i = 0; i < mag.length; i++) this.edge[i] = (mag[i] as number) >= EDGE_STEP ? 1 : 0;
    // Lines the page draws (an axis, a curve, a border) are long and unbroken; letters are short. Only a long edge is something to land on.
    const ridges = thin(mag, gx, gy, cols, rows);
    this.strong = longEdges(ridges, cols, rows, Math.round(LINE_LENGTH * this.scale));
    // The two sides of a thick line are one line.
    this.part = label(dilate(this.strong, cols, rows, 2), cols, rows);
    const t = nearest(this.strong, cols, rows);
    this.near = t.dist;
    this.src = t.src;
    this.ink = inkOf(this.gray, this.edge);
    this.inkSums = new Sums(cols, rows, this.ink);
    this.strongSums = new Sums(cols, rows, this.strong);
    this.corners = cornersOf(gx, gy, cols, rows);
  }

  // ---- Conversions -----------------------------------------------------------------------------

  private toCell(p: Vec2): Cell { return { x: p[0] * this.kx, y: p[1] * this.ky }; }
  private toUnits(c: Cell): Vec2 { return [round1(c.x / this.kx), round1(c.y / this.ky)]; }

  /** Moves are measured as cells (a pixel of the shrunken picture) and limited to a few percent of the picture. */
  private get reach(): number { return MAX_MOVE * this.scale; }

  // ---- What is near a point --------------------------------------------------------------------

  /** The strong edge nearest a point within `r` cells, or nothing when it is further or there are two as near. */
  private line(c: Cell, r: number): { at: Cell; d: number } | undefined {
    const ix = clampInt(Math.round(c.x), 0, this.cols - 1), iy = clampInt(Math.round(c.y), 0, this.rows - 1);
    const i = iy * this.cols + ix;
    const d = this.near[i] as number;
    if (!(d <= r)) return undefined;
    const s = this.src[i] as number;
    const at = { x: s % this.cols, y: Math.floor(s / this.cols) };
    if (this.rival(c, d, this.part[s] as number, r)) return undefined;
    return { at: this.middle(at), d };
  }

  /**
   * A thin line has an edge on each side. From the edge found, look across for the other one (within a few cells) and
   * take the middle, so a mark lands on the line itself and not on its shoulder. A single step (a panel's border) stays.
   */
  private middle(at: Cell): Cell {
    const i = at.y * this.cols + at.x;
    const gx = this.gx[i] as number, gy = this.gy[i] as number;
    const m = Math.hypot(gx, gy);
    if (m === 0) return at;
    const nx = gx / m, ny = gy / m;
    for (let t = 1; t <= 6; t++) {
      for (const sign of [1, -1]) {
        const x = Math.round(at.x + nx * t * sign), y = Math.round(at.y + ny * t * sign);
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const j = y * this.cols + x;
        const across = (this.gx[j] as number) * nx + (this.gy[j] as number) * ny;
        // The gradient turns back (the other side of a line) and is as strong again.
        if (across < -EDGE_STEP * 0.7) return { x: at.x + (nx * t * sign) / 2, y: at.y + (ny * t * sign) / 2 };
      }
    }
    return at;
  }

  /** Another line (not the same one) about as near as the nearest: which was meant cannot be told. */
  private rival(c: Cell, d1: number, part: number, r: number): boolean {
    const rays = 32;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2;
      const ux = Math.cos(a), uy = Math.sin(a);
      for (let s = 1; s <= r * 1.5; s++) {
        const x = Math.round(c.x + ux * s), y = Math.round(c.y + uy * s);
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) break;
        const i = y * this.cols + x;
        if (this.strong[i]) {
          if ((this.part[i] as number) !== part && s <= d1 * 1.6 + 4) return true;
          break;
        }
      }
    }
    return false;
  }

  /** The corner or crossing nearest a point within `r` cells, unless there is another about as near. */
  private corner(c: Cell, r: number): { at: Cell; d: number } | undefined {
    let best: { x: number; y: number } | undefined, bd = Infinity, second = Infinity;
    for (const k of this.corners) {
      // A corner of a letter is not one: the lines of the page cross here (a long edge runs right by).
      if ((this.near[Math.round(k.y) * this.cols + Math.round(k.x)] as number) > 3) continue;
      const d = Math.hypot(k.x - c.x, k.y - c.y);
      if (d > r * 1.6 + 4) continue;
      if (d < bd) { second = bd; bd = d; best = k; } else if (d < second) second = d;
    }
    if (!best || bd > r) return undefined;
    if (second < bd * 1.5 + 3 && Math.hypot(best.x - c.x, best.y - c.y) > 0) {
      // Two corners about as near: a table's grid, a row of letters. Which was meant cannot be told.
      return undefined;
    }
    const at = this.cross(best);
    return { at, d: Math.hypot(at.x - c.x, at.y - c.y) };
  }

  /**
   * Where the two lines through a corner meet. The corner's own peak is blurred by a cell or two; the lines are not:
   * the line cells round it are grouped by which way the picture changes across them (the two lines run at different
   * angles), each group is fitted, and their meeting point is the corner. Where two lines cannot be found, the corner
   * stays as it was.
   */
  private cross(k: Cell): Cell {
    const R = 13;
    const cells: { x: number; y: number; a: number }[] = [];
    for (let y = Math.max(0, Math.round(k.y) - R); y <= Math.min(this.rows - 1, Math.round(k.y) + R); y++) {
      for (let x = Math.max(0, Math.round(k.x) - R); x <= Math.min(this.cols - 1, Math.round(k.x) + R); x++) {
        const i = y * this.cols + x;
        if (this.strong[i] && Math.hypot(x - k.x, y - k.y) <= R) cells.push({ x, y, a: (Math.atan2(this.gy[i] as number, this.gx[i] as number) * 180 / Math.PI + 180) % 180 });
      }
    }
    if (cells.length < 12) return k;
    const first = fitDirection(cells, undefined);
    if (!first) return k;
    const second = fitDirection(cells.filter((c) => !first.used.has(c)), first.angle);
    if (!second) return k;
    const det = first.c * second.s - first.s * second.c;
    if (Math.abs(det) < 0.3) return k;
    const x = (first.rho * second.s - second.rho * first.s) / det, y = (first.c * second.rho - second.c * first.rho) / det;
    return Math.hypot(x - k.x, y - k.y) <= 8 ? { x, y } : k;
  }

  /** How far (in cells) the nearest long edge is from a point in units; infinite when there is none within a good way. */
  lineDistance(x: number, y: number): number {
    const c = this.toCell([x, y]);
    const i = clampInt(Math.round(c.y), 0, this.rows - 1) * this.cols + clampInt(Math.round(c.x), 0, this.cols - 1);
    const d = this.near[i] as number;
    return d <= 0.25 * this.scale ? d : Infinity;
  }

  /** The share of the cells along a box's four sides that have ink on them: how much of its edge cuts through the page's content. */
  edgeCut(x: number, y: number, w: number, h: number): number {
    const x0 = x * this.kx, y0 = y * this.ky, x1 = (x + w) * this.kx, y1 = (y + h) * this.ky;
    const at = (cx: number, cy: number): number => {
      const ix = clampInt(Math.round(cx), 0, this.cols - 1), iy = clampInt(Math.round(cy), 0, this.rows - 1);
      return this.ink[iy * this.cols + ix] as number;
    };
    let n = 0, ink = 0;
    for (let cx = x0; cx <= x1; cx += 1) { ink += at(cx, y0) + at(cx, y1); n += 2; }
    for (let cy = y0; cy <= y1; cy += 1) { ink += at(x0, cy) + at(x1, cy); n += 2; }
    return n > 0 ? ink / n : 0;
  }

  // ---- Marks -----------------------------------------------------------------------------------

  /** The mark moved onto what it points at, or the mark itself when it is where it should be (or cannot be placed). */
  snapMark(m: Mark): Mark {
    // A box that stops short of the paragraph or table it is round is made that block's own size, which may be further than a snap moves.
    if (m.op === 'box') {
      const block = this.fitBlock(m);
      if (block) {
        return block; // the block's own size and air: the usual edge snap would draw it back onto the letters
      }
    }
    // An underline is held to its own line of letters, which may be a long way shorter than the one written; it only ever shortens.
    if (m.op === 'underline') return this.underline(m);
    const next = this.refine(m);
    return next === m || this.within(m, next) ? next : m;
  }

  snapAction(a: Action): Action {
    switch (a.op) {
      case 'box': case 'circle': case 'underline': case 'arrow': case 'point': case 'poly': case 'trace': return this.snapMark(a);
      default: return a;
    }
  }

  private refine(m: Mark): Mark {
    switch (m.op) {
      case 'arrow': return this.arrow(m);
      case 'point': return this.point(m);
      case 'circle': return this.ring(m);
      case 'box': return this.box(m);
      case 'underline': return this.underline(m);
      case 'poly': return this.poly(m);
      case 'trace': return this.trace(m);
      default: return m;
    }
  }

  /** No point of the mark may have moved more than the reach. */
  private within(a: Mark, b: Mark): boolean {
    return this.moved(a, b) <= this.reach * 1.001;
  }

  /** The furthest any key point of a mark moved, in cells. */
  moved(a: Mark, b: Mark): number {
    const pa = keyPoints(a), pb = keyPoints(b);
    if (pa.length !== pb.length) return Infinity;
    let far = 0;
    for (let i = 0; i < pa.length; i++) {
      const u = this.toCell(pa[i] as Vec2), v = this.toCell(pb[i] as Vec2);
      far = Math.max(far, Math.hypot(u.x - v.x, u.y - v.y));
    }
    return far;
  }

  /** The tip of an arrow lands on the nearest line or curve. */
  private arrow(m: Extract<Mark, { op: 'arrow' }>): Mark {
    const tip = this.toCell([m.x2, m.y2]);
    const r = 0.08 * this.scale;
    const hit = this.line(tip, r);
    if (!hit || hit.d < 1.5) return m;
    const to = this.toUnits(hit.at);
    // The arrow keeps its aim and its length (it may not turn round or collapse onto its tail).
    const before = Math.atan2(m.y2 - m.y1, (m.x2 - m.x1) * this.kx / this.ky), after = Math.atan2(to[1] - m.y1, (to[0] - m.x1) * this.kx / this.ky);
    let turn = Math.abs(after - before);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    const len = Math.hypot((to[0] - m.x1) * this.kx, (to[1] - m.y1) * this.ky);
    if (turn > Math.PI / 5 || len < 0.1 * this.scale) return m;
    return { ...m, x2: to[0], y2: to[1] };
  }

  /** A point goes to the corner or crossing it is next to, or onto the line it is next to. */
  private point(m: Extract<Mark, { op: 'point' }>): Mark {
    const at = this.toCell([m.x, m.y]);
    const to = this.crossingOrLine(at);
    if (!to) return m;
    const [x, y] = this.toUnits(to);
    return { ...m, x, y };
  }

  private crossingOrLine(at: Cell): Cell | undefined {
    const c = this.corner(at, 0.06 * this.scale);
    if (c) return c.d < 2 ? undefined : c.at;
    const l = this.line(at, 0.045 * this.scale);
    if (l) return l.d < 1.5 ? undefined : l.at;
    return undefined;
  }

  /** A small ring is on a point (a crossing, a tip): it is centred on it. A large one is round a figure and stays. */
  private ring(m: Extract<Mark, { op: 'circle' }>): Mark {
    if (m.rot) return m;
    const w = m.w * this.kx, h = m.h * this.ky;
    if (Math.max(w, h) > 0.22 * this.scale) return m;
    const centre = this.toCell([m.x + m.w / 2, m.y + m.h / 2]);
    const c = this.corner(centre, 0.04 * this.scale);
    if (!c || c.d < 2.5) return m;
    const [cx, cy] = this.toUnits(c.at);
    return { ...m, x: round1(cx - m.w / 2), y: round1(cy - m.h / 2) };
  }

  /** Each corner of a polygon goes to the page's corner it is next to; the others stay where they are. */
  private poly(m: Extract<Mark, { op: 'poly' }>): Mark {
    let changed = false;
    const pts = m.pts.map((p) => {
      const c = this.corner(this.toCell(p), 0.05 * this.scale);
      if (!c || c.d < 1.5) return p;
      changed = true;
      return this.toUnits(c.at);
    });
    return changed ? { ...m, pts } : m;
  }

  /**
   * A traced curve lies on the page's curve: each point goes to the line it is next to, and a point with no line
   * near takes the move of the points either side of it. Unless most points find a line, the trace stays as written.
   */
  private trace(m: Extract<Mark, { op: 'trace' }>): Mark {
    const r = 0.05 * this.scale;
    const shifts = m.pts.map((p) => {
      const c = this.toCell(p);
      const l = this.line(c, r);
      return l ? { dx: l.at.x - c.x, dy: l.at.y - c.y } : undefined;
    });
    if (shifts.filter(Boolean).length < Math.max(2, Math.ceil(m.pts.length * 0.6))) return m;
    // One move for the whole curve is the rule when the points disagree wildly (a line met by accident).
    const found = shifts.filter(Boolean) as { dx: number; dy: number }[];
    const mx = median(found.map((s) => s.dx)), my = median(found.map((s) => s.dy));
    const pts = m.pts.map((p, i) => {
      let s = shifts[i];
      if (!s) {
        let a: { dx: number; dy: number } | undefined, b: { dx: number; dy: number } | undefined;
        for (let j = i - 1; j >= 0 && !a; j--) a = shifts[j];
        for (let j = i + 1; j < shifts.length && !b; j++) b = shifts[j];
        s = a && b ? { dx: (a.dx + b.dx) / 2, dy: (a.dy + b.dy) / 2 } : a ?? b;
      }
      if (!s || Math.hypot(s.dx - mx, s.dy - my) > 0.05 * this.scale) return p;
      return this.toUnits({ x: p[0] * this.kx + s.dx, y: p[1] * this.ky + s.dy });
    });
    return pts.some((q, i) => q[0] !== (m.pts[i] as Vec2)[0] || q[1] !== (m.pts[i] as Vec2)[1]) ? { ...m, pts } : m;
  }

  /** The page as the block fitters read it. */
  private get blockGrid(): BlockGrid { return { cols: this.cols, rows: this.rows, ink: this.ink, strong: this.strong }; }

  /** A box round part of a table or a paragraph, as the whole block (rows or lines), or nothing when it is not one. */
  private fitBlock(m: Extract<Mark, { op: 'box' }>): Mark | undefined {
    if (m.rot) return undefined;
    const x0 = m.x * this.kx, y0 = m.y * this.ky, x1 = (m.x + m.w) * this.kx, y1 = (m.y + m.h) * this.ky;
    if (x1 - x0 < 24 || y1 - y0 < 8 || this.inkSums.mean(x0, y0, x1 - x0, y1 - y0) < 0.01) return undefined;
    const span = fitTable(this.blockGrid, x0, y0, x1, y1) ?? fitParagraph(this.blockGrid, x0, y0, x1, y1, Math.round(0.05 * this.scale));
    if (!span) return undefined;
    const [nx, ny] = this.toUnits({ x: span.x0 ?? x0, y: span.y0 });
    const [mx, my] = this.toUnits({ x: span.x1 ?? x1, y: span.y1 });
    return { ...m, x: nx, y: ny, w: round1(mx - nx), h: round1(my - ny) };
  }

  /**
   * An underline runs along its own line of letters only (not past the end of the text, not on into a picture beside it, and
   * from the start of a word) and drops to just under the bottom of that line.
   */
  private underline(m: Extract<Mark, { op: 'underline' }>): Mark {
    const thick = Math.round(0.05 * this.scale);
    const y0 = m.y * this.ky;
    const run = fitUnderline(this.blockGrid, m.x * this.kx, (m.x + m.w) * this.kx, Math.round(y0), thick);
    const withRun = (y: number): Mark => {
      const x = run ? round1(run.x0 / this.kx) : m.x, x1 = run ? round1(run.x1 / this.kx) : m.x + m.w;
      return x === m.x && y === m.y && round1(x1 - x) === m.w ? m : { ...m, x, y, w: round1(x1 - x) };
    };
    const c0 = Math.max(0, Math.floor(run ? run.x0 : m.x * this.kx)), c1 = Math.min(this.cols, Math.ceil(run ? run.x1 : (m.x + m.w) * this.kx));
    if (c1 - c0 < 4) return m;
    const r = Math.round(0.03 * this.scale);
    const row = (y: number): number => (y < 0 || y >= this.rows ? 0 : this.inkSums.mean(c0, y, c1 - c0, 1));
    const has = (y: number): boolean => row(y) > 0.04;
    const start = Math.round(y0);
    // Where the underline sits already: on the ground just under a line of ink, nothing to do.
    let bottom: number | undefined;
    for (let d = 0; d <= r && bottom === undefined; d++) {
      for (const y of d === 0 ? [start] : [start - d, start + d]) {
        if (y < 1 || y >= this.rows - 4) continue;
        if (has(y) && !has(y + 1) && !has(y + 2)) { bottom = y; break; }
      }
    }
    if (bottom === undefined) return withRun(m.y);
    const target = bottom + 2;
    return withRun(Math.abs(target - y0) <= 2 ? m.y : round1(target / this.ky));
  }

  /**
   * True when what is inside a box is lines of text and nothing thicker: every run of rows with ink in it is no more than
   * `thick` cells (a line's height), with blank rows between. A picture, a graph or a table is not.
   */
  private onlyLines(x0: number, y0: number, x1: number, y1: number, thick: number): boolean {
    const a = Math.max(0, Math.round(x0)), b = Math.min(this.cols, Math.round(x1));
    if (b <= a) return false;
    const need = Math.max(3, 0.08 * (b - a));
    let run = 0, bands = 0;
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(this.rows, Math.round(y1)); y++) {
      if (this.inkSums.mean(a, y, b - a, 1) * (b - a) >= need) {
        run++;
        if (run > thick) return false;
      } else {
        if (run > 0) bands++;
        run = 0;
      }
    }
    return bands + (run > 0 ? 1 : 0) >= 1;
  }

  /** A box is tightened to the figure it surrounds, and grown past an edge that cuts through it. */
  private box(m: Extract<Mark, { op: 'box' }>): Mark {
    if (m.rot) return m;
    const lim = Math.round(0.05 * this.scale);
    let x0 = m.x * this.kx, y0 = m.y * this.ky, x1 = (m.x + m.w) * this.kx, y1 = (m.y + m.h) * this.ky;
    const w0 = x1 - x0, h0 = y1 - y0;
    if (w0 < 8 || h0 < 8) return m;
    // A box over a blank place points at nothing the page shows: it stays.
    if (this.inkSums.mean(x0, y0, w0, h0) < 0.01) return m;
    const pad = 3;
    const lines = this.onlyLines(x0, y0, x1, y1, Math.round(0.05 * this.scale));
    const side = (which: 'top' | 'bottom' | 'left' | 'right'): number | undefined => this.edgeFor(which, x0, y0, x1, y1, lim, pad, lines);
    const t = side('top'), b = side('bottom'), l = side('left'), r = side('right');
    if (t !== undefined) y0 = t;
    if (b !== undefined) y1 = b;
    if (l !== undefined) x0 = l;
    if (r !== undefined) x1 = r;
    // It still has to be a box round the same thing: not much smaller, not much bigger.
    if (x1 - x0 < w0 * 0.55 || y1 - y0 < h0 * 0.55 || x1 - x0 > w0 * 1.5 + 2 * lim || y1 - y0 > h0 * 1.5 + 2 * lim) return m;
    const [nx, ny] = this.toUnits({ x: Math.max(0, x0), y: Math.max(0, y0) });
    const [mx, my] = this.toUnits({ x: Math.min(this.cols, x1), y: Math.min(this.rows, y1) });
    if (Math.abs(nx - m.x) + Math.abs(ny - m.y) + Math.abs(mx - m.x - m.w) + Math.abs(my - m.y - m.h) < 1) return m;
    return { ...m, x: nx, y: ny, w: round1(mx - nx), h: round1(my - ny) };
  }

  /**
   * Where one side of a box should be: the box's edge when it already hugs the ink, the first ink inside it when there
   * is a blank margin (within `lim` cells), or past the figure when the edge cuts through it. Nothing when unsure.
   */
  private edgeFor(which: 'top' | 'bottom' | 'left' | 'right', x0: number, y0: number, x1: number, y1: number, lim: number, pad: number, lines = true): number | undefined {
    const horizontal = which === 'top' || which === 'bottom';
    const from = horizontal ? x0 : y0, to = horizontal ? x1 : y1;
    const span = Math.max(1, to - from);
    const edge = which === 'top' ? y0 : which === 'bottom' ? y1 : which === 'left' ? x0 : x1;
    const sign = which === 'top' || which === 'left' ? -1 : 1; // outward
    const need = Math.max(3, 0.08 * span);
    const lineInk = (pos: number): number => {
      const p = Math.round(pos);
      const limit = horizontal ? this.rows : this.cols;
      if (p < 0 || p >= limit) return 0;
      const a = Math.max(0, Math.round(from)), b = Math.min(horizontal ? this.cols : this.rows, Math.round(to));
      if (b <= a) return 0;
      return horizontal ? this.inkSums.mean(a, p, b - a, 1) * (b - a) : this.inkSums.mean(p, a, 1, b - a) * (b - a);
    };
    const inside = (k: number): number => lineInk(edge - sign * k - (sign > 0 ? 1 : 0));
    const lineOf = (sums: Sums, k: number): number => {
      const p = Math.round(edge - sign * k - (sign > 0 ? 1 : 0));
      const limit = horizontal ? this.rows : this.cols;
      if (p < 0 || p >= limit) return 0;
      const a = Math.max(0, Math.round(from)), b = Math.min(horizontal ? this.cols : this.rows, Math.round(to));
      if (b <= a) return 0;
      // The border may be a cell off or soft: the best of the cell and the ones either side.
      let best = 0;
      for (const q of [p - 1, p, p + 1]) {
        if (q < 0 || q >= limit) continue;
        best = Math.max(best, horizontal ? sums.mean(a, q, b - a, 1) * (b - a) : sums.mean(q, a, 1, b - a) * (b - a));
      }
      return best;
    };
    const outside = (k: number): number => lineInk(edge + sign * k + (sign > 0 ? 0 : -1));
    // The ink touches the edge from inside: either the figure ends here, or it runs through the edge.
    let touches = false;
    for (let k = 0; k < 2; k++) if (inside(k) >= need) touches = true;
    if (touches) {
      // A ruled line or a solid edge lies along the whole side: the box is on a border, which is where it should be.
      if (Math.max(inside(0), inside(1)) >= 0.85 * span) return undefined;
      // Only a line of text cut through along its top or bottom is completed: the ink that crosses the edge is a thin band
      // (blank rows within a line's height on the inside too). A picture, a graph or a table cut through runs on far
      // inside, and which gap ends it cannot be told.
      if (!horizontal || !lines) return undefined;
      let band = false;
      for (let k = 0; k <= lim + 2 && !band; k++) if (inside(k) < need) band = true;
      if (!band) return undefined;
      let runs = false;
      for (let k = 0; k < 2; k++) if (outside(k) >= need) runs = true;
      if (!runs) return undefined;
      // Cut through: grow to the first clear gap beyond (a few blank cells in a row), within the limit.
      let blank = 0;
      const gap = horizontal ? 3 : 6;
      for (let k = 0; k <= lim + gap; k++) {
        // A sharp dip that picks up again is another object starting (a caption under a picture): the figure ended at the dip.
        if (k >= 1 && outside(k) < 0.5 * outside(k - 1) && Math.max(outside(k + 1), outside(k + 2)) > 1.4 * outside(k) + need) {
          return k > 3 && k <= lim ? edge + sign * (k + pad) : undefined;
        }
        if (outside(k) < need) {
          blank++;
          if (blank >= gap) {
            const grow = k - blank + 1;
            // A halo of a few cells past the edge is the edge's own softness, not a figure running through it.
            return grow > 3 && grow <= lim ? edge + sign * (grow + pad) : undefined;
          }
        } else blank = 0;
      }
      return undefined;
    }
    // A loose margin inside: shrink to a border the page draws there (a long straight edge across the figure's side).
    // Only a drawn border is trusted: the first ink may be a bright part of a picture or a stray word, and a box shrunk
    // onto that would cut into the figure.
    for (let k = 0; k <= lim; k++) {
      // A border right at the edge (within a few cells): the box is on it already, and the next line in is inside the figure.
      if (lineOf(this.strongSums, k) >= 0.5 * span) return k > 3 ? edge - sign * (k - pad) : undefined;
      // Only empty margin is taken in: ink in the way (a line inside the figure, a letter) and the box stays.
      if (inside(k) >= need) return undefined;
    }
    return undefined;
  }
}

/** Marks moved onto the page, with a note of each that moved (for the log of a check). */
export function snapActions(s: Snapper, actions: readonly Action[], onMove?: (r: SnapReport) => void): Action[] {
  return actions.map((a) => {
    const next = s.snapAction(a);
    if (next !== a && onMove && 'id' in a && typeof a.id === 'string') onMove({ id: a.id, op: a.op, moved: round1(s.moved(a as Mark, next as Mark) / s.cols * 1000) });
    return next;
  });
}

// ---- The picture's own features ---------------------------------------------------------------

const round1 = (v: number): number => Math.round(v * 10) / 10;
const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/** The points of a mark that must not move far. */
function keyPoints(m: Mark): Vec2[] {
  switch (m.op) {
    case 'arrow': return [[m.x1, m.y1], [m.x2, m.y2]];
    case 'point': return [[m.x, m.y]];
    case 'box': case 'circle': return [[m.x, m.y], [m.x + m.w, m.y + m.h]];
    case 'underline': return [[m.x, m.y], [m.x + m.w, m.y]];
    case 'poly': case 'trace': return m.pts;
    default: return [];
  }
}

function gradients(gray: Float32Array, cols: number, rows: number): { mag: Float32Array; gx: Float32Array; gy: Float32Array } {
  const n = cols * rows;
  const mag = new Float32Array(n), gxs = new Float32Array(n), gys = new Float32Array(n);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const a = gray[i - cols - 1] as number, b = gray[i - cols] as number, c = gray[i - cols + 1] as number;
      const d = gray[i - 1] as number, f = gray[i + 1] as number;
      const g = gray[i + cols - 1] as number, h = gray[i + cols] as number, k = gray[i + cols + 1] as number;
      const gx = c + 2 * f + k - a - 2 * d - g, gy = g + 2 * h + k - a - 2 * b - c;
      mag[i] = Math.hypot(gx, gy);
      gxs[i] = gx;
      gys[i] = gy;
    }
  }
  return { mag, gx: gxs, gy: gys };
}

/** The angle between two directions that are the same turned half a circle (0 to 90 degrees). */
const turn = (a: number, b: number): number => { const d = Math.abs(a - b) % 180; return d > 90 ? 180 - d : d; };

/**
 * The line most of the cells lie along, found from which way the picture changes across each cell (its gradient
 * direction, mod half a turn): the strongest direction (leaving out those within 25 degrees of `not`), then the cells of
 * that direction that lie on one line (within a few cells of the middle one). It returns the line's normal and offset.
 */
function fitDirection(cells: readonly { x: number; y: number; a: number }[], not: number | undefined): { angle: number; c: number; s: number; rho: number; used: Set<{ x: number; y: number; a: number }> } | undefined {
  const hist = new Array<number>(36).fill(0);
  for (const c of cells) {
    if (not !== undefined && turn(c.a, not) < 25) continue;
    hist[Math.floor(c.a / 5) % 36]!++;
  }
  let top = 0, bestSum = -1;
  for (let i = 0; i < 36; i++) {
    const sum = (hist[(i + 35) % 36] as number) + (hist[i] as number) + (hist[(i + 1) % 36] as number);
    if (sum > bestSum) { bestSum = sum; top = i; }
  }
  if (bestSum < 7) return undefined;
  const centre = top * 5 + 2.5;
  const near = cells.filter((c) => turn(c.a, centre) <= 12 && (not === undefined || turn(c.a, not) >= 25));
  // The mean direction (doubled, so a half turn is one turn).
  let sx = 0, sy = 0;
  for (const c of near) { sx += Math.cos((c.a * 2 * Math.PI) / 180); sy += Math.sin((c.a * 2 * Math.PI) / 180); }
  const angle = ((Math.atan2(sy, sx) * 180) / Math.PI / 2 + 180) % 180;
  const cs = Math.cos((angle * Math.PI) / 180), sn = Math.sin((angle * Math.PI) / 180);
  const rhos = near.map((c) => c.x * cs + c.y * sn).sort((p, q) => p - q);
  const mid = rhos[Math.floor(rhos.length / 2)] as number;
  const onLine = near.filter((c) => Math.abs(c.x * cs + c.y * sn - mid) <= 3.5);
  if (onLine.length < 7) return undefined;
  const rho = onLine.reduce((t, c) => t + c.x * cs + c.y * sn, 0) / onLine.length;
  return { angle, c: cs, s: sn, rho, used: new Set(onLine) };
}

/** The cells of the edges that run at least `min` cells (their bounding box's diagonal), the parts a little broken (a cell apart) joined. */
function longEdges(ridges: Uint8Array, cols: number, rows: number, min: number): Uint8Array {
  const labels = label(dilate(ridges, cols, rows, 1), cols, rows);
  let n = 1;
  for (let i = 0; i < labels.length; i++) if ((labels[i] as number) >= n) n = (labels[i] as number) + 1;
  const x0 = new Int32Array(n).fill(1 << 30), y0 = new Int32Array(n).fill(1 << 30), x1 = new Int32Array(n).fill(-1), y1 = new Int32Array(n).fill(-1);
  for (let i = 0; i < ridges.length; i++) {
    if (!ridges[i]) continue;
    const l = labels[i] as number, x = i % cols, y = (i - x) / cols;
    if (x < (x0[l] as number)) x0[l] = x;
    if (x > (x1[l] as number)) x1[l] = x;
    if (y < (y0[l] as number)) y0[l] = y;
    if (y > (y1[l] as number)) y1[l] = y;
  }
  const out = new Uint8Array(ridges.length);
  for (let i = 0; i < ridges.length; i++) {
    if (!ridges[i]) continue;
    const l = labels[i] as number;
    if (Math.hypot((x1[l] as number) - (x0[l] as number), (y1[l] as number) - (y0[l] as number)) >= min) out[i] = 1;
  }
  return out;
}

/** The ridge of each edge: a cell stays only if it is the strongest across the edge, so a line is a cell or two wide. */
function thin(mag: Float32Array, gx: Float32Array, gy: Float32Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(mag.length);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const m = mag[i] as number;
      if (m < EDGE_STEP) continue;
      const ax = Math.abs(gx[i] as number), ay = Math.abs(gy[i] as number);
      // Compare along the direction of the gradient, quantised to horizontal, vertical or a diagonal.
      let o1: number, o2: number;
      if (ay < ax * 0.4142) { o1 = i - 1; o2 = i + 1; }
      else if (ax < ay * 0.4142) { o1 = i - cols; o2 = i + cols; }
      else if ((gx[i] as number) * (gy[i] as number) > 0) { o1 = i - cols - 1; o2 = i + cols + 1; }
      else { o1 = i - cols + 1; o2 = i + cols - 1; }
      if (m >= (mag[o1] as number) && m > (mag[o2] as number)) out[i] = 1;
    }
  }
  return out;
}

function dilate(mask: Uint8Array, cols: number, rows: number, times: number): Uint8Array {
  let cur = mask;
  for (let t = 0; t < times; t++) {
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rows) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < cols && cur[yy * cols + xx]) { on = 1; break; }
          }
        }
        out[y * cols + x] = on;
      }
    }
    cur = out;
  }
  return cur;
}

/** Connected parts (8-connected) of a mask: a label per cell, 0 where there is none. */
function label(mask: Uint8Array, cols: number, rows: number): Int32Array {
  const out = new Int32Array(mask.length);
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || out[i]) continue;
    next++;
    out[i] = next;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop() as number;
      const x = j % cols, y = (j - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
          const q = yy * cols + xx;
          if (mask[q] && !out[q]) { out[q] = next; stack.push(q); }
        }
      }
    }
  }
  return out;
}

/** For every cell, how far it is from the nearest cell of the mask and which one that is (a two-pass sweep). */
function nearest(mask: Uint8Array, cols: number, rows: number): { dist: Float32Array; src: Int32Array } {
  const n = cols * rows;
  const dist = new Float32Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (mask[i]) { dist[i] = 0; src[i] = i; }
  const relax = (x: number, y: number, qx: number, qy: number): void => {
    if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) return;
    const s = src[qy * cols + qx] as number;
    if (s < 0) return;
    const d = Math.hypot((s % cols) - x, Math.floor(s / cols) - y);
    const i = y * cols + x;
    if (d < (dist[i] as number)) { dist[i] = d; src[i] = s; }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { relax(x, y, x - 1, y); relax(x, y, x - 1, y - 1); relax(x, y, x, y - 1); relax(x, y, x + 1, y - 1); }
    for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) { relax(x, y, x + 1, y); relax(x, y, x + 1, y + 1); relax(x, y, x, y + 1); relax(x, y, x - 1, y + 1); }
  }
  return { dist, src };
}

/** Where there is something on the page: a gray level that is not the page's own background, or an edge. */
function inkOf(gray: Float32Array, edge: Uint8Array): Uint8Array {
  const hist = new Uint32Array(33);
  for (let i = 0; i < gray.length; i++) hist[Math.min(32, Math.round((gray[i] as number) / 8))]!++;
  let mode = 0;
  for (let i = 1; i < hist.length; i++) if ((hist[i] as number) > (hist[mode] as number)) mode = i;
  let sum = 0, n = 0;
  for (let i = 0; i < gray.length; i++) if (Math.min(32, Math.round((gray[i] as number) / 8)) === mode) { sum += gray[i] as number; n++; }
  const background = n > 0 ? sum / n : 255;
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs((gray[i] as number) - background) > 28 || edge[i] ? 1 : 0;
  return out;
}

/** Corners and crossings: where the picture changes in two directions at once (the smaller eigenvalue of the gradient tensor). */
function cornersOf(gx: Float32Array, gy: Float32Array, cols: number, rows: number): { x: number; y: number; w: number }[] {
  const gxx = new Float32Array(gx.length), gyy = new Float32Array(gx.length), gxy = new Float32Array(gx.length);
  for (let i = 0; i < gx.length; i++) { gxx[i] = (gx[i] as number) ** 2; gyy[i] = (gy[i] as number) ** 2; gxy[i] = (gx[i] as number) * (gy[i] as number); }
  const sx = new Sums(cols, rows, gxx), sy = new Sums(cols, rows, gyy), sxy = new Sums(cols, rows, gxy);
  const half = 2;
  const score = new Float32Array(cols * rows);
  for (let y = half; y < rows - half; y++) {
    for (let x = half; x < cols - half; x++) {
      const a = sx.mean(x - half, y - half, 2 * half + 1, 2 * half + 1), c = sy.mean(x - half, y - half, 2 * half + 1, 2 * half + 1), b = sxy.mean(x - half, y - half, 2 * half + 1, 2 * half + 1);
      const tr = a + c, disc = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b));
      const small = tr / 2 - disc, large = tr / 2 + disc;
      // Two directions of change, both strong: a crossing or a corner, not a line.
      if (small > 0.18 * large && small > (EDGE_STEP * 0.55) ** 2) score[y * cols + x] = small;
    }
  }
  const out: { x: number; y: number; w: number }[] = [];
  const nms = 5;
  for (let y = half; y < rows - half; y++) {
    for (let x = half; x < cols - half; x++) {
      const v = score[y * cols + x] as number;
      if (v <= 0) continue;
      let top = true;
      for (let dy = -nms; dy <= nms && top; dy++) for (let dx = -nms; dx <= nms; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        const o = score[yy * cols + xx] as number;
        if (o > v || (o === v && (dy < 0 || (dy === 0 && dx < 0)))) { top = false; break; }
      }
      if (top) out.push({ x, y, w: v });
    }
  }
  // A crossing of two lines has its peak split in two on either side of it: peaks within a few cells are one corner.
  out.sort((a, b) => b.w - a.w);
  const merged: { x: number; y: number; w: number; n: number }[] = [];
  for (const k of out) {
    const near = merged.find((m) => Math.hypot(m.x - k.x, m.y - k.y) <= 12);
    if (near) { near.x = (near.x * near.n + k.x) / (near.n + 1); near.y = (near.y * near.n + k.y) / (near.n + 1); near.n++; }
    else merged.push({ ...k, n: 1 });
  }
  return merged.map(({ x, y, w }) => ({ x, y, w }));
}

/** Summed-area table over a cols x rows field: the mean of any rectangle at once (rectangles are in cells). */
class Sums {
  private t: Float64Array;
  private cols: number;
  private rows: number;
  constructor(cols: number, rows: number, field: ArrayLike<number>) {
    this.cols = cols;
    this.rows = rows;
    this.t = new Float64Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) {
      let run = 0;
      for (let c = 0; c < cols; c++) {
        run += field[r * cols + c] as number;
        this.t[(r + 1) * (cols + 1) + c + 1] = (this.t[r * (cols + 1) + c + 1] as number) + run;
      }
    }
  }
  mean(x: number, y: number, w: number, h: number): number {
    const c0 = clampInt(Math.floor(x), 0, this.cols - 1), c1 = clampInt(Math.ceil(x + w), c0 + 1, this.cols);
    const r0 = clampInt(Math.floor(y), 0, this.rows - 1), r1 = clampInt(Math.ceil(y + h), r0 + 1, this.rows);
    const k = this.cols + 1;
    const sum = (this.t[r1 * k + c1] as number) - (this.t[r0 * k + c1] as number) - (this.t[r1 * k + c0] as number) + (this.t[r0 * k + c0] as number);
    return sum / ((c1 - c0) * (r1 - r0));
  }
}
