// Where the tags of pinned labels go. Pure geometry, no DOM and no three.js: the page gives it where
// the model falls on screen (convex outlines of its parts), how busy the page under it is, and the
// anchors of the pins, and it answers with a place for each tag.
//
// Rules, in order of weight: a tag never overlaps another tag, and its leader never crosses another
// leader or tag; a tag stays off the model and off the page's own text where it can; leaders are short
// and leave the model quickly. A tag that has been placed stays where it is while the model turns:
// only the leader follows its part. When the model moves a long way (zoom, a new stage) the tags are
// laid out again and glide to their new places.

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Convex hull of points (Andrew's monotone chain), counter-clockwise on screen axes. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as Pt, lower[lower.length - 1] as Pt, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i] as Pt;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as Pt, upper[upper.length - 1] as Pt, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** A coarse grid over the window that remembers which cells the model covers. */
export class Occupancy {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private cells: Uint8Array;

  constructor(width: number, height: number, cell = 10) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.cells = new Uint8Array(this.cols * this.rows);
  }

  /** Marks the cells whose centres fall inside a convex polygon. */
  fillConvex(poly: readonly Pt[]): void {
    if (poly.length < 3) {
      for (const p of poly) this.mark(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
      return;
    }
    let y0 = Infinity, y1 = -Infinity;
    for (const p of poly) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const r0 = Math.max(0, Math.floor(y0 / this.cell)), r1 = Math.min(this.rows - 1, Math.floor(y1 / this.cell));
    for (let r = r0; r <= r1; r++) {
      const y = (r + 0.5) * this.cell;
      let xa = Infinity, xb = -Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i] as Pt, b = poly[(i + 1) % poly.length] as Pt;
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
          xa = Math.min(xa, x); xb = Math.max(xb, x);
        }
      }
      if (xa > xb) continue;
      const c0 = Math.max(0, Math.ceil(xa / this.cell - 0.5)), c1 = Math.min(this.cols - 1, Math.floor(xb / this.cell - 0.5));
      for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c] = 1;
    }
  }

  private mark(c: number, r: number): void {
    if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) this.cells[r * this.cols + c] = 1;
  }

  at(x: number, y: number): boolean {
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows && this.cells[r * this.cols + c] === 1;
  }

  /** The share of a rectangle's cells that are covered (0 to 1). */
  fraction(rect: Rect): number {
    const c0 = Math.max(0, Math.floor(rect.x / this.cell)), c1 = Math.min(this.cols - 1, Math.floor((rect.x + rect.w) / this.cell));
    const r0 = Math.max(0, Math.floor(rect.y / this.cell)), r1 = Math.min(this.rows - 1, Math.floor((rect.y + rect.h) / this.cell));
    let hit = 0, all = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { all++; hit += this.cells[r * this.cols + c] as number; }
    return all === 0 ? 0 : hit / all;
  }

  /** How many cells along a line (from `skip` pixels in) are covered. */
  along(a: Pt, b: Pt, skip: number): number {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(len / (this.cell / 2));
    let count = 0, last = -1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t * len < skip) continue;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const key = Math.floor(y / this.cell) * 100000 + Math.floor(x / this.cell);
      if (key === last) continue;
      last = key;
      if (this.at(x, y)) count++;
    }
    return count;
  }
}

/** How much is going on in the page under a rectangle, 0 (blank) to 1 (text-dense). */
export type Busy = { mean(rect: Rect): number };

/** Where the edges are in a small grayscale picture (a text line is full of them), 0 to 1 a cell. */
export function edgeGrid(gray: ArrayLike<number>, cols: number, rows: number): Float32Array {
  const edge = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = gray[r * cols + c] as number;
      const dx = c + 1 < cols ? Math.abs((gray[r * cols + c + 1] as number) - v) : 0;
      const dy = r + 1 < rows ? Math.abs((gray[(r + 1) * cols + c] as number) - v) : 0;
      edge[r * cols + c] = Math.min(1, (dx + dy) / 80);
    }
  }
  return edge;
}

/** Busy-ness from a small grayscale picture of the page: edges (a text line is full of them) count. */
export function busyFromGray(gray: ArrayLike<number>, cols: number, rows: number, width: number, height: number): Busy {
  const edge = edgeGrid(gray, cols, rows);
  const sx = cols / width, sy = rows / height;
  return {
    mean(rect: Rect): number {
      const c0 = Math.max(0, Math.floor(rect.x * sx)), c1 = Math.min(cols - 1, Math.floor((rect.x + rect.w) * sx));
      const r0 = Math.max(0, Math.floor(rect.y * sy)), r1 = Math.min(rows - 1, Math.floor((rect.y + rect.h) * sy));
      let sum = 0, n = 0;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { sum += edge[r * cols + c] as number; n++; }
      return n === 0 ? 0 : sum / n;
    },
  };
}

export type Env = { occ: Occupancy; busy?: Busy; /** Rectangles no tag may sit on (the app's own buttons), whether or not they are showing yet. */ keepOut?: readonly Rect[] };
export type PinRequest = { anchor: Pt; w: number; h: number; /** The author's wish for where the tag goes from the anchor, in pixels; a hint only. */ hint?: Pt };
/** `alpha` is below 1 while a tag that would have to cross another fades out and in at its new place. */
export type Placement = { rect: Rect; attach: Pt; alpha: number };

type Entry = { target: Rect; shown: Rect; request: PinRequest; seen: number; tangled?: number; /** Frames to wait before looking again for a place inside the card, after none was found. */ fitWait?: number; fade?: { phase: 'out' | 'in'; alpha: number } };

const FADE_OUT_SECONDS = 0.12;
const FADE_IN_SECONDS = 0.2;

/** What a tag over page text costs, in the pixels of distance from its point it would go to keep off it: text may be covered when that keeps the tag near its part and readable. */
const BUSY_COST = 300;
const MARGIN = 8;
const GAP = 8;
/** Frames a tag may sit with a leader across another leader or tag before it is placed again. */
const TANGLE_FRAMES = 8;
/** How far a tag keeps from a keep-out rectangle (pixels). */
const KEEP_OUT_PAD = 4;
/** Frames to wait before looking again when no place cleared the tangle. */
const TANGLE_RETRY_FRAMES = 60;

/** The point of a rectangle's outline a leader from `from` should end on. */
export function attachPoint(rect: Rect, from: Pt): Pt {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const dx = from.x - cx, dy = from.y - cy;
  // Leave from the side the anchor is most beyond, keeping off the corners.
  if (Math.abs(dx) / (rect.w / 2) > Math.abs(dy) / (rect.h / 2)) {
    const y = Math.max(rect.y + Math.min(10, rect.h / 2), Math.min(rect.y + rect.h - Math.min(10, rect.h / 2), from.y));
    return { x: dx < 0 ? rect.x : rect.x + rect.w, y };
  }
  const x = Math.max(rect.x + Math.min(12, rect.w / 2), Math.min(rect.x + rect.w - Math.min(12, rect.w / 2), from.x));
  return { x, y: dy < 0 ? rect.y : rect.y + rect.h };
}

function ccw(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True when the segments properly cross (touching at an end does not count). */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const inside = (p: Pt) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  if (inside(a) || inside(b)) return true;
  const tl = { x: r.x, y: r.y }, tr = { x: r.x + r.w, y: r.y }, bl = { x: r.x, y: r.y + r.h }, br = { x: r.x + r.w, y: r.y + r.h };
  return segmentsCross(a, b, tl, tr) || segmentsCross(a, b, tr, br) || segmentsCross(a, b, br, bl) || segmentsCross(a, b, bl, tl);
}

const sameSpot = (a: Rect, b: Rect) => a === b || (a.x === b.x && a.y === b.y);

const overlaps = (a: Rect, b: Rect, pad: number) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Places tags one at a time, and remembers them. */
export class LabelBoard {
  private entries = new Map<number, Entry>();
  private width = 0;
  private height = 0;
  private now: number | undefined;
  private lastNow = 0;
  /** Set when a long move of the model has made the placed tags stale. */
  private stale = false;
  private modelAt: Rect | undefined;
  private tick = 0;
  private dragging = false;
  /** The frame of the model's card, when it has one: a tag stays wholly inside it (it never straddles the card's edge or sits beside it). */
  private within: Rect | undefined;

  /**
   * Called once per frame before the tags are placed. `model` is the rectangle the model fills; a long
   * move of it (or a window of another size) lays every tag out again, unless the user is dragging it
   * round, when tags stay put however far the model turns.
   */
  beginFrame(info: { width: number; height: number; model: Rect | undefined; dragging: boolean; now: number; within?: Rect }): void {
    this.tick++;
    this.within = info.within;
    this.lastNow = this.now ?? info.now;
    this.now = info.now;
    if (info.width !== this.width || info.height !== this.height) {
      this.width = info.width;
      this.height = info.height;
      this.entries.clear();
      this.modelAt = undefined;
    }
    this.dragging = info.dragging;
    if (info.dragging) return;
    const m = info.model;
    if (!m) return;
    // With no tags placed there is nothing to keep steady: follow the model (it grows as it is built).
    if (!this.modelAt || this.entries.size === 0) {
      this.modelAt = m;
      return;
    }
    const was = this.modelAt;
    const size = Math.max(was.w, was.h, 1);
    const moved = Math.hypot(m.x + m.w / 2 - (was.x + was.w / 2), m.y + m.h / 2 - (was.y + was.h / 2)) / size;
    const grown = Math.abs(Math.max(m.w, m.h) - Math.max(was.w, was.h)) / size;
    if (moved > 0.4 || grown > 0.4) {
      this.stale = true;
      this.modelAt = m;
    }
  }

  /** Forgets the tags of pins that are gone, so their room can be used again. */
  keep(alive: ReadonlySet<number>): void {
    for (const key of [...this.entries.keys()]) if (!alive.has(key)) this.entries.delete(key);
  }

  /** Where the tag of a pin goes. Stable between frames; the leader is drawn from the anchor to `attach`. */
  place(key: number, request: PinRequest, env: () => Env): Placement {
    let entry = this.entries.get(key);
    if (this.stale) {
      // Lay out again, from the first pin: every tag keeps where it is shown now and glides to its new place.
      for (const e of this.entries.values()) e.target = { x: NaN, y: NaN, w: e.target.w, h: e.target.h };
      this.stale = false;
    }
    if (!entry || Number.isNaN(entry.target.x)) {
      const placed: Rect[] = [];
      const leaders: Array<[Pt, Pt]> = [];
      for (const [k, e] of this.entries) {
        if (k === key || Number.isNaN(e.target.x)) continue;
        placed.push(e.target);
        leaders.push([e.request.anchor, attachPoint(e.target, e.request.anchor)]);
      }
      const rect = this.search(request, env(), placed, leaders);
      if (entry) {
        entry.target = rect;
        entry.request = request;
      } else {
        entry = { target: rect, shown: rect, request, seen: this.tick };
        this.entries.set(key, entry);
      }
    }
    entry.request = request;
    entry.seen = this.tick;
    if (!this.dragging) this.untangle(entry);
    if (!this.dragging) this.mend(entry, env);
    // Glide towards the target (a fresh placement starts there). A tag whose way would take it through
    // another tag fades out where it is and in at its place instead.
    const dt = Math.max(0, Math.min(0.25, ((this.now ?? 0) - this.lastNow) / 1000));
    const k = 1 - Math.exp(-dt * 9);
    const t = entry.target;
    if (entry.fade?.phase === 'in' && !sameSpot(entry.shown, t)) entry.fade = undefined;
    if (!entry.fade && !sameSpot(entry.shown, t) && this.wayIsBlocked(entry)) entry.fade = { phase: 'out', alpha: 1 };
    if (entry.fade?.phase === 'out') {
      entry.fade.alpha -= dt / FADE_OUT_SECONDS;
      if (entry.fade.alpha <= 0) {
        entry.shown = t;
        entry.fade = { phase: 'in', alpha: 0 };
      }
    } else if (entry.fade?.phase === 'in') {
      entry.fade.alpha += dt / FADE_IN_SECONDS;
      if (entry.fade.alpha >= 1) entry.fade = undefined;
    } else {
      const s = entry.shown;
      entry.shown = { x: s.x + (t.x - s.x) * k, y: s.y + (t.y - s.y) * k, w: t.w, h: t.h };
      if (Math.abs(entry.shown.x - t.x) < 0.3 && Math.abs(entry.shown.y - t.y) < 0.3) entry.shown = t;
    }
    const alpha = entry.fade ? Math.max(0, Math.min(1, entry.fade.alpha)) : 1;
    return { rect: entry.shown, attach: attachPoint(entry.shown, request.anchor), alpha };
  }

  /** Whether a tag gliding to its target would touch another tag on the way (both moving at the same pace). */
  private wayIsBlocked(entry: Entry): boolean {
    const way = (e: Entry): [Rect, Rect] => (e.fade?.phase === 'out' || Number.isNaN(e.target.x) ? [e.shown, e.shown] : [e.shown, e.target]);
    const at = (w: [Rect, Rect], f: number): Rect => ({ x: w[0].x + (w[1].x - w[0].x) * f, y: w[0].y + (w[1].y - w[0].y) * f, w: w[1].w, h: w[1].h });
    const mine = way(entry);
    for (const other of this.entries.values()) {
      if (other === entry || (other.fade?.phase === 'out' && other.fade.alpha < 0.05)) continue;
      const theirs = way(other);
      for (let f = 0.05; f <= 1.001; f += 0.05) {
        if (overlaps(at(mine, f), at(theirs, f), 4)) return true;
      }
    }
    return false;
  }

  /**
   * The model has turned since the tags were placed, so two leaders may now cross. When they do and
   * the two tags can swap places so that neither crosses, they swap (and glide); otherwise they stay.
   */
  private untangle(entry: Entry): void {
    for (const other of this.entries.values()) {
      if (other === entry || other.seen !== this.tick || Number.isNaN(other.target.x) || Number.isNaN(entry.target.x)) continue;
      const a1 = entry.request.anchor, a2 = other.request.anchor;
      const t1 = attachPoint(entry.target, a1), t2 = attachPoint(other.target, a2);
      if (!segmentsCross(a1, t1, a2, t2)) continue;
      // Swap the centres, each tag keeping its own size.
      const at = (r: Rect, c: Rect): Rect => ({ x: Math.round(c.x + c.w / 2 - r.w / 2), y: Math.round(c.y + c.h / 2 - r.h / 2), w: r.w, h: r.h });
      const n1 = at(entry.target, other.target), n2 = at(other.target, entry.target);
      const inside = (r: Rect) => r.x >= MARGIN && r.y >= MARGIN && r.x + r.w <= this.width - MARGIN && r.y + r.h <= this.height - MARGIN && this.fits(r);
      if (!inside(n1) || !inside(n2) || overlaps(n1, n2, GAP)) continue;
      if (segmentsCross(a1, attachPoint(n1, a1), a2, attachPoint(n2, a2))) continue;
      if (segmentHitsRect(a1, attachPoint(n1, a1), n2) || segmentHitsRect(a2, attachPoint(n2, a2), n1)) continue;
      const clash = [...this.entries.values()].some((e) => e !== entry && e !== other && !Number.isNaN(e.target.x) && (overlaps(n1, e.target, GAP) || overlaps(n2, e.target, GAP)));
      if (clash) continue;
      entry.target = n1;
      other.target = n2;
    }
  }

  /**
   * The parts move (a key slides in, a plug turns) and a leader that was clear can end up across another
   * leader or through another tag. When that lasts a few frames the tag is placed again, with the other
   * tags where they are, and glides (or fades) to its new place.
   */
  private mend(entry: Entry, env: () => Env): void {
    if (Number.isNaN(entry.target.x)) return;
    const others: Entry[] = [];
    for (const other of this.entries.values()) if (other !== entry && !Number.isNaN(other.target.x)) others.push(other);
    // A tag that is not wholly inside the card (the card came later, or moved) is placed again, to a place inside it if there is one.
    if (entry.fitWait) entry.fitWait--;
    if (this.within && !this.fits(entry.target) && !entry.fitWait) {
      const rect = this.scan(entry.request, env(), others.map((o) => o.target), others.map((o): [Pt, Pt] => [o.request.anchor, attachPoint(o.target, o.request.anchor)]), env().keepOut ?? [], true);
      if (rect) {
        entry.target = rect;
        entry.tangled = 0;
        return;
      }
      entry.fitWait = TANGLE_RETRY_FRAMES;
    }
    // A tag on one of the app's buttons (they came after it was placed) moves at once, to a place off them if there is one.
    const keepOut = env().keepOut ?? [];
    if (keepOut.some((k) => overlaps(entry.target, k, KEEP_OUT_PAD))) {
      const rect = this.search(entry.request, env(), others.map((o) => o.target), others.map((o): [Pt, Pt] => [o.request.anchor, attachPoint(o.target, o.request.anchor)]));
      if (!keepOut.some((k) => overlaps(rect, k, KEEP_OUT_PAD))) {
        entry.target = rect;
        entry.tangled = 0;
        return;
      }
    }
    const tangledAt = (rect: Rect): boolean => {
      const mine: [Pt, Pt] = [entry.request.anchor, attachPoint(rect, entry.request.anchor)];
      return others.some((other) => {
        const theirs: [Pt, Pt] = [other.request.anchor, attachPoint(other.target, other.request.anchor)];
        return segmentsCross(mine[0], mine[1], theirs[0], theirs[1]) || segmentHitsRect(mine[0], mine[1], other.target) || segmentHitsRect(theirs[0], theirs[1], rect);
      });
    };
    if (!tangledAt(entry.target)) {
      entry.tangled = 0;
      return;
    }
    entry.tangled = (entry.tangled ?? 0) + 1;
    if (entry.tangled < TANGLE_FRAMES) return;
    const rect = this.search(entry.request, env(), others.map((o) => o.target), others.map((o): [Pt, Pt] => [o.request.anchor, attachPoint(o.target, o.request.anchor)]));
    // Move only to a place that really clears it; with none, stay and look again in a while.
    if (tangledAt(rect)) {
      entry.tangled = -TANGLE_RETRY_FRAMES;
      return;
    }
    entry.tangled = 0;
    entry.target = rect;
  }

  /** Where the tags are shown now (screen pixels): what else drawn on the page, such as a caption, keeps clear of. */
  shownRects(): Rect[] {
    const out: Rect[] = [];
    for (const e of this.entries.values()) if (!Number.isNaN(e.shown.x) && e.shown.w > 0) out.push(e.shown);
    return out;
  }

  /** Whether any tag is still gliding (the page should keep drawing). */
  get moving(): boolean {
    for (const e of this.entries.values()) if (e.fade || !sameSpot(e.shown, e.target)) return true;
    return false;
  }

  private search(req: PinRequest, env: Env, placed: Rect[], leaders: Array<[Pt, Pt]>): Rect {
    // Prefer a place inside the card and clear of controls, then any clear viewport place, before accepting a place that overlaps a control.
    return (this.within ? this.scan(req, env, placed, leaders, env.keepOut ?? [], true) : undefined) ?? this.scan(req, env, placed, leaders, env.keepOut ?? []) ?? (this.within ? this.scan(req, env, placed, leaders, [], true) : undefined) ?? this.scan(req, env, placed, leaders, []) ?? { x: Math.max(MARGIN, Math.min(this.width - req.w - MARGIN, req.anchor.x - req.w / 2)), y: Math.max(MARGIN, req.anchor.y - req.h - 30), w: req.w, h: req.h };
  }

  /** Whether a tag lies wholly inside the card (always, when there is no card). */
  private fits(r: Rect): boolean {
    const c = this.within;
    return !c || (r.x >= c.x && r.y >= c.y && r.x + r.w <= c.x + c.w && r.y + r.h <= c.y + c.h);
  }

  private scan(req: PinRequest, env: Env, placed: Rect[], leaders: Array<[Pt, Pt]>, avoid: readonly Rect[], inCard = false): Rect | undefined {
    const s = this.height / 1080;
    const { anchor: a, w, h } = req;
    const hintAngle = req.hint && (req.hint.x !== 0 || req.hint.y !== 0) ? Math.atan2(req.hint.y, req.hint.x) : undefined;
    let best: { rect: Rect; cost: number } | undefined;
    let fallback: { rect: Rect; cost: number } | undefined;
    for (const dist of [26, 52, 84, 124, 172, 230, 300, 380, 460]) {
      for (let step = 0; step < 24; step++) {
        const ang = (step / 24) * Math.PI * 2;
        const cx = a.x + Math.cos(ang) * (dist * s + w / 2);
        const cy = a.y + Math.sin(ang) * (dist * s + h / 2);
        const rect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
        if (rect.x < MARGIN || rect.y < MARGIN || rect.x + w > this.width - MARGIN || rect.y + h > this.height - MARGIN) continue;
        if (inCard && !this.fits(rect)) continue;
        if (placed.some((p) => overlaps(rect, p, GAP))) continue;
        if (avoid.some((k) => overlaps(rect, k, KEEP_OUT_PAD))) continue;
        const attach = attachPoint(rect, a);
        let cost = dist * 0.9 + env.occ.fraction({ x: rect.x - 6, y: rect.y - 6, w: w + 12, h: h + 12 }) * 6000;
        if (env.busy) cost += Math.min(1, env.busy.mean(rect) * 2.5) * BUSY_COST;
        cost += env.occ.along(a, attach, 26 * s) * 24;
        if (hintAngle !== undefined) {
          let d = Math.abs(ang - hintAngle) % (Math.PI * 2);
          if (d > Math.PI) d = Math.PI * 2 - d;
          cost += (d / Math.PI) * 50;
        }
        if (!fallback || cost < fallback.cost) fallback = { rect, cost };
        // Preferred: no crossing of another leader or tag. Failing that, the cheapest place there is.
        if (leaders.some(([la, lb]) => segmentsCross(a, attach, la, lb))) continue;
        if (placed.some((p) => segmentHitsRect(a, attach, p))) continue;
        if (leaders.some(([la, lb]) => segmentHitsRect(la, lb, rect))) continue;
        if (!best || cost < best.cost) best = { rect, cost };
      }
    }
    return best?.rect ?? fallback?.rect;
  }
}
