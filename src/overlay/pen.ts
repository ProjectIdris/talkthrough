// The pen: what the user draws with the mouse while the chord is held (circle something to point at it).
// A stroke is pure overlay: it is drawn on the marks canvas and reported to the main process, but it is
// never part of a scene. It is drawn like a soft marker: translucent, tapered, smoothed so a shaky hand reads as a calm loop,
// and what is drawn settles about a second behind the pen, as a laser pointer's tail does, to a very muted trace, so a messy loop does
// not shout from the screen; the whole drawing stays that muted until the answer starts and then fades out. The decay is only how it
// looks: the points are all kept, and the main process gets the whole stroke. The last circle can be taken back (undo) and the
// whole question cancelled; both are told to the main process. The state here has no DOM, so it is tested without a window; coordinates
// run 0..1000 across the window.

import type { Stroke } from '../shared/ipc.ts';
import { REFINED } from './style.ts';

/** How far (in 0..1000 units) the pointer must move after pressing before it counts as drawing: a click draws nothing. */
export const START_DISTANCE = 3;
/** The stroke fades out over this long once the answer begins. */
export const PEN_FADE_MS = 600;
/** A drawn point has settled to its muted trace this long after it was drawn (the stroke decays behind the pen). */
export const PEN_DECAY_MS = 1000;
/** What is left of a point's opacity once it has settled: the drawing stays at this until the answer starts. */
export const PEN_REST = 0.22;
/** The stroke is this share of the window's longer side wide. */
export const PEN_WIDTH_SHARE = 0.0068;

type Pt = [number, number];
type Live = { id: number; start: Pt; started: boolean; sent: number; done: boolean };
type Stroked = { id: number; points: Pt[]; times: number[] };

export class PenLayer {
  private strokes: Stroked[] = [];
  private live: Live | undefined;
  private nextId = 1;
  private fadeAt: number | undefined;
  private on = false;
  private outbox: Stroke[] = [];
  /** The clock of the press that began the stroke in progress (its first point has no move of its own). */
  private startedAt: number | undefined;

  /** The pen is on while the chord is held. */
  get active(): boolean {
    return this.on;
  }

  /** The chord was pressed: the old stroke goes at once and the pen takes the mouse. */
  turnOn(): void {
    this.strokes = [];
    this.live = undefined;
    this.outbox = [];
    this.fadeAt = undefined;
    this.on = true;
  }

  /** The chord was released: a stroke still in progress ends here; what is drawn stays on screen. */
  turnOff(): void {
    this.up();
    this.on = false;
  }

  /** `now` is the clock (ms) the stroke's decay is measured on; without one a point is never old (no decay). */
  down(x: number, y: number, now?: number): void {
    if (!this.on) return;
    this.up();
    this.live = { id: this.nextId++, start: [round(x), round(y)], started: false, sent: 0, done: false };
    this.startedAt = now;
  }

  move(x: number, y: number, now?: number): void {
    const live = this.live;
    if (!this.on || !live) return;
    const p: Pt = [round(x), round(y)];
    if (!live.started) {
      if (Math.hypot(p[0] - live.start[0], p[1] - live.start[1]) < START_DISTANCE) return;
      live.started = true;
      this.strokes.push({ id: live.id, points: [live.start], times: [this.startedAt ?? now ?? NO_TIME] });
    }
    const s = this.strokes[this.strokes.length - 1];
    if (s && s.id === live.id) {
      s.points.push(p);
      s.times.push(now ?? NO_TIME);
    }
  }

  /** The button came up (or the pen went off): the stroke in progress is finished. */
  up(): void {
    const live = this.live;
    if (!live) return;
    this.live = undefined;
    if (!live.started) return; // a click: nothing was drawn, nothing is reported
    live.done = true;
    const s = this.strokes.find((t) => t.id === live.id);
    const fresh = s ? s.points.slice(live.sent) : [];
    this.outbox.push({ id: live.id, points: fresh, done: true });
    live.sent += fresh.length;
  }

  /** What has been drawn since the last call, as the pieces to report (points are appended per stroke id). Always every point, whatever has decayed. */
  take(): Stroke[] {
    const out = this.outbox;
    this.outbox = [];
    const live = this.live;
    if (live && live.started) {
      const s = this.strokes.find((t) => t.id === live.id);
      if (s && s.points.length > live.sent) {
        out.push({ id: live.id, points: s.points.slice(live.sent), done: false });
        live.sent = s.points.length;
      }
    }
    return out;
  }

  /** True while a stroke is being drawn (the button is down and the pointer has moved). */
  get drawing(): boolean {
    return this.live?.started === true;
  }

  /** True while there is a circle to take back: the pen is on and something is drawn. */
  get canUndo(): boolean {
    return this.on && this.fadeAt === undefined && this.strokes.length > 0;
  }

  /**
   * Takes back the last stroke (one in progress is ended and taken back too). The main process is told to drop it: the piece
   * reported is `{ id, points: [], done: true, removed: true }`, and any of its points not yet reported are not reported at all.
   */
  undo(): boolean {
    if (!this.canUndo) return false;
    this.up();
    const s = this.strokes.pop();
    if (!s) return false;
    this.outbox = this.outbox.filter((p) => p.id !== s.id);
    this.outbox.push({ id: s.id, points: [], done: true, removed: true });
    return true;
  }

  /** The question is cancelled (right click): everything drawn goes at once, nothing is reported any more, and the pen is off. */
  cancel(): void {
    this.strokes = [];
    this.live = undefined;
    this.outbox = [];
    this.fadeAt = undefined;
    this.on = false;
  }

  /** The box round the last stroke (0..1000), where the undo button goes next to; nothing when none is drawn. */
  lastBox(): { x0: number; y0: number; x1: number; y1: number } | undefined {
    const s = this.strokes[this.strokes.length - 1];
    if (!s || s.points.length === 0) return undefined;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of s.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  }

  /** The answer has begun (or the question ended): the stroke starts to fade. */
  fade(now: number): void {
    if (this.strokes.length > 0 && this.fadeAt === undefined && !this.on) this.fadeAt = now;
  }

  /**
   * Strokes to draw now, with how opaque they are; none once faded. `decayMs` is how long a point lasts (undefined: it does not decay, as with
   * reduced motion, or for a stroke that was drawn without a clock); `now` is the clock the points' times were taken on.
   */
  view(now: number, options: { reduceMotion?: boolean } = {}): PenView {
    const decayMs = options.reduceMotion === true ? undefined : PEN_DECAY_MS;
    let alpha = 1;
    if (this.fadeAt !== undefined) {
      const k = (now - this.fadeAt) / PEN_FADE_MS;
      if (k >= 1) {
        this.strokes = [];
        this.fadeAt = undefined;
      } else alpha = 1 - k;
    }
    return { strokes: this.strokes, alpha, now, ...(decayMs !== undefined ? { decayMs } : {}) };
  }

  /** True while the picture changes by itself (the stroke is fading, or its tail is decaying). */
  animating(now: number, options: { reduceMotion?: boolean } = {}): boolean {
    if (this.fadeAt !== undefined && now - this.fadeAt < PEN_FADE_MS) return true;
    if (options.reduceMotion === true) return false;
    return this.strokes.some((s) => {
      const last = s.times[s.times.length - 1];
      return last !== undefined && last !== NO_TIME && now - last < PEN_DECAY_MS;
    });
  }
}

/** What a press of a mouse button does while the pen is on. */
export type PenRoute = { act: 'draw' | 'cancel' | 'none'; /** True when the press must be taken whole: it never reaches the page's own handlers, the model or the app underneath. */ consume: boolean };

/**
 * Where a press goes while the chord is held: the left button draws; the right button cancels the whole question; a press on the Undo
 * button is the button's own (it does not start a stroke); any other button does nothing. Every press but the plain left one is
 * consumed, so none reaches anything under the pen.
 */
export function routePenPointer(press: { button: number; onUndo: boolean }): PenRoute {
  if (press.onUndo) return { act: 'none', consume: true };
  if (press.button === 0) return { act: 'draw', consume: false };
  if (press.button === 2) return { act: 'cancel', consume: true };
  return { act: 'none', consume: true };
}

/** Where the Undo button goes (its top-left, in pixels): just to the right of the last circle, or to its left when there is no room, kept on screen. */
export function undoPlace(box: { x0: number; y0: number; x1: number; y1: number }, size: { width: number; height: number }, button: { w: number; h: number }): { x: number; y: number } {
  const gap = 14, edge = 8;
  const right = (box.x1 / 1000) * size.width + gap;
  const x = right + button.w + edge <= size.width ? right : (box.x0 / 1000) * size.width - gap - button.w;
  const y = (box.y0 / 1000) * size.height - button.h * 0.5;
  return { x: Math.max(edge, Math.min(size.width - button.w - edge, x)), y: Math.max(edge, Math.min(size.height - button.h - edge, y)) };
}

/** A point drawn without a clock: it never decays. */
const NO_TIME = -Infinity;
const round = (v: number): number => Math.round(v * 10) / 10;

export type PenView = {
  strokes: ReadonlyArray<{ points: ReadonlyArray<Pt>; times?: ReadonlyArray<number> }>;
  alpha: number;
  now?: number;
  decayMs?: number;
};

type Ctx = CanvasRenderingContext2D;
type Pix = { x: number; y: number; t: number };

/** The marker's colour: the new style's red. */
const INK = REFINED.red as readonly [number, number, number];

/**
 * The points of a stroke as a calm line: set at an even spacing (a shake of the hand between two points is lost), then smoothed a few
 * times, the ends held. The time of each new point is carried along so the decay still knows how old it is.
 */
export function calmLine(raw: ReadonlyArray<Pix>, spacing: number): Pix[] {
  if (raw.length < 2) return [...raw];
  const out: Pix[] = [raw[0] as Pix];
  let carry = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1] as Pix, b = raw[i] as Pix;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let at = spacing - carry;
    while (at <= len) {
      const f = at / len;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: a.t === NO_TIME || b.t === NO_TIME ? NO_TIME : a.t + (b.t - a.t) * f });
      at += spacing;
    }
    carry = len - (at - spacing);
  }
  const last = raw[raw.length - 1] as Pix;
  const end = out[out.length - 1] as Pix;
  if (Math.hypot(last.x - end.x, last.y - end.y) > spacing * 0.25) out.push({ ...last });
  else out[out.length - 1] = { ...last };
  let line = out;
  for (let pass = 0; pass < 3; pass++) {
    line = line.map((p, i) => {
      if (i === 0 || i === line.length - 1) return p;
      const a = line[i - 1] as Pix, b = line[i + 1] as Pix;
      return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4, t: p.t };
    });
  }
  return line;
}

/** The strength of the body of the ribbon and of its wider halo (the share of full opacity at the pen). */
const BODY_STRENGTH = 0.6;
const HALO_STRENGTH = 0.16;
/** The halo is this many times as wide as the body. */
const HALO_SPREAD = 1.9;

/** A stroke as a ribbon: points along a calm line, with the half-width of its body and how much of its opacity is left at each. */
export type Ribbon = { pts: Pix[]; half: number[]; level: number[] };

/**
 * The ribbon of a stroke at `now`: the calm line, thickest at the pen and tapering at its start and tip, and, with a decay, each point
 * settling over `decayMs` to `PEN_REST` of its opacity and 60 per cent of its thickness (they stay so). Nothing for a stroke too short to draw.
 */
export function penRibbon(s: { points: ReadonlyArray<Pt>; times?: ReadonlyArray<number> }, size: { width: number; height: number }, now: number, decayMs: number | undefined): Ribbon | undefined {
  const width = Math.max(6, Math.max(size.width, size.height) * PEN_WIDTH_SHARE);
  const raw: Pix[] = s.points.map((p, i) => ({ x: (p[0] / 1000) * size.width, y: (p[1] / 1000) * size.height, t: s.times?.[i] ?? NO_TIME }));
  if (raw.length < 2) return undefined;
  const pts = calmLine(raw, Math.max(4, width * 0.55));
  const n = pts.length;
  if (n < 2) return undefined;
  // How fresh each point is: 1 at the pen, 0 once it has settled.
  const fresh = (p: Pix): number => (decayMs === undefined || p.t === NO_TIME ? 1 : Math.max(0, Math.min(1, 1 - (now - p.t) / decayMs)));
  const level = pts.map((p) => (decayMs === undefined ? 1 : PEN_REST + (1 - PEN_REST) * Math.pow(fresh(p), 0.9)));
  const slim = pts.map((p) => (decayMs === undefined ? 1 : 0.6 + 0.4 * Math.pow(fresh(p), 0.8)));
  // Distance along the line from each end, for the taper of the very start and tip.
  const along: number[] = [0];
  for (let i = 1; i < n; i++) along.push((along[i - 1] as number) + Math.hypot((pts[i] as Pix).x - (pts[i - 1] as Pix).x, (pts[i] as Pix).y - (pts[i - 1] as Pix).y));
  const total = along[n - 1] as number;
  const tip = width * 2.2;
  const ease = (u: number): number => 0.3 + 0.7 * Math.sqrt(Math.max(0, Math.min(1, u)));
  const half = pts.map((_, i) => (width * Math.min(ease((total - (along[i] as number)) / tip), ease((along[i] as number) / tip)) * (slim[i] as number)) / 2);
  return { pts, half, level };
}

/** An image of a stroke: RGBA bytes for the rectangle `w` by `h` at (`x`, `y`). */
export type PenRaster = { x: number; y: number; w: number; h: number; data: Uint8ClampedArray<ArrayBuffer>; /** The picture is this share of full size (a big stroke is worked out smaller and drawn scaled up; its edge is soft anyway). */ scale: number };

/**
 * The ribbon as pixels, worked out for each pixel from its nearest point on the line: the distance gives the edge (a pixel wide), the
 * place along the line gives the opacity, which runs smoothly from point to point. There are no pieces joined end to end, so there is no
 * seam or banding in it however the opacity changes, and where the stroke crosses itself the pixel keeps the stronger of the two (the
 * ink does not pile up into a dark bead). `bounds` is the area the picture may cover (the window). Nothing when the ribbon is off it.
 */
export function rasterRibbon(r: Ribbon, bounds: { width: number; height: number }, scale = 1): PenRaster | undefined {
  if (scale === 1) {
    // A stroke whose picture would be over about a million and a half pixels is worked out at half size: the cost goes with the area.
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const p of r.pts) { lo = [Math.min(lo[0] as number, p.x), Math.min(lo[1] as number, p.y)]; hi = [Math.max(hi[0] as number, p.x), Math.max(hi[1] as number, p.y)]; }
    if (((hi[0] as number) - (lo[0] as number)) * ((hi[1] as number) - (lo[1] as number)) > 1_500_000) {
      const k = 0.5;
      const small: Ribbon = { pts: r.pts.map((p) => ({ x: p.x * k, y: p.y * k, t: p.t })), half: r.half.map((h) => h * k), level: r.level };
      return rasterRibbon(small, { width: bounds.width * k, height: bounds.height * k }, k);
    }
  }
  const { pts, half, level } = r;
  const n = pts.length;
  let reach = 0;
  for (const h of half) reach = Math.max(reach, h * HALO_SPREAD);
  reach += 1.5;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const x0 = Math.max(0, Math.floor(minX - reach)), y0 = Math.max(0, Math.floor(minY - reach));
  const x1 = Math.min(Math.ceil(bounds.width), Math.ceil(maxX + reach)), y1 = Math.min(Math.ceil(bounds.height), Math.ceil(maxY + reach));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0 || w * h > 6_000_000) return undefined;
  const body = new Float32Array(w * h), halo = new Float32Array(w * h);
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i] as Pix, q = pts[i + 1] as Pix;
    const dx = q.x - p.x, dy = q.y - p.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const hp = half[i] as number, hq = half[i + 1] as number, lp = level[i] as number, lq = level[i + 1] as number;
    const rr = Math.max(hp, hq) * HALO_SPREAD + 1;
    const ya = Math.max(y0, Math.floor(Math.min(p.y, q.y) - rr)), yb = Math.min(y1, Math.ceil(Math.max(p.y, q.y) + rr));
    const xa = Math.max(x0, Math.floor(Math.min(p.x, q.x) - rr)), xb = Math.min(x1, Math.ceil(Math.max(p.x, q.x) + rr));
    for (let y = ya; y < yb; y++) {
      const py = y + 0.5;
      for (let x = xa; x < xb; x++) {
        const px = x + 0.5;
        const u = Math.max(0, Math.min(1, ((px - p.x) * dx + (py - p.y) * dy) / len2));
        const ex = px - (p.x + dx * u), ey = py - (p.y + dy * u);
        const hw = hp + (hq - hp) * u;
        const reachHere = hw * HALO_SPREAD + 0.5;
        const d2 = ex * ex + ey * ey;
        if (d2 >= reachHere * reachHere) continue;
        const d = Math.sqrt(d2);
        const lv = lp + (lq - lp) * u;
        const cb = Math.max(0, Math.min(1, hw - d + 0.5));
        const ch = Math.max(0, Math.min(1, hw * HALO_SPREAD - d + 0.5));
        if (ch <= 0) continue;
        const k = (y - y0) * w + (x - x0);
        if (cb * lv > (body[k] as number)) body[k] = cb * lv;
        if (ch * lv > (halo[k] as number)) halo[k] = ch * lv;
      }
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const a = 1 - (1 - HALO_STRENGTH * (halo[k] as number)) * (1 - BODY_STRENGTH * (body[k] as number));
    if (a <= 0) continue;
    data[k * 4] = INK[0];
    data[k * 4 + 1] = INK[1];
    data[k * 4 + 2] = INK[2];
    data[k * 4 + 3] = Math.round(a * 255);
  }
  return { x: x0, y: y0, w, h, data, scale };
}

/** What a stroke was last drawn as, so a stroke that has settled (or stands still) is not worked out again for every frame the page draws. */
const drawn = new WeakMap<object, { key: string; layer: HTMLCanvasElement | undefined; x: number; y: number; scale: number }>();

/**
 * Draws the strokes as a soft marker: a translucent ribbon in the style's red, thickest at the pen and tapering at its start and tip, with a
 * faint wider halo; no dark outline. With a decay, a point's opacity and thickness settle over `decayMs` to a muted trace (`PEN_REST` of the
 * opacity) that stays; without one the whole stroke is drawn at full strength. Each stroke is one picture (see `rasterRibbon`) put on the
 * canvas once, so it reads as one continuous marker. Needs a page (it makes small canvases); where there is none it draws nothing.
 */
export function drawPen(ctx: Ctx, view: PenView, size: { width: number; height: number }): void {
  if (view.alpha <= 0.002 || typeof document === 'undefined') return;
  const decay = view.decayMs;
  const now = view.now ?? 0;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, view.alpha));
  for (const s of view.strokes) {
    const last = s.times?.[s.times.length - 1];
    // A stroke whose points have all settled (or that has no decay) looks the same for every frame until it grows.
    const still = decay === undefined || last === undefined || last === NO_TIME || now - last >= decay;
    const key = `${s.points.length}|${size.width}x${size.height}|${decay === undefined ? 'n' : still ? 's' : now}`;
    let entry = drawn.get(s);
    if (!entry || entry.key !== key) {
      const ribbon = penRibbon(s, size, now, decay);
      const image = ribbon ? rasterRibbon(ribbon, size) : undefined;
      let layer: HTMLCanvasElement | undefined;
      if (image) {
        layer = entry?.layer ?? document.createElement('canvas');
        layer.width = image.w;
        layer.height = image.h;
        layer.getContext('2d')?.putImageData(new ImageData(image.data, image.w, image.h), 0, 0);
      }
      entry = { key, layer, x: image?.x ?? 0, y: image?.y ?? 0, scale: image?.scale ?? 1 };
      drawn.set(s, entry);
    }
    if (entry.layer) ctx.drawImage(entry.layer, entry.x / entry.scale, entry.y / entry.scale, entry.layer.width / entry.scale, entry.layer.height / entry.scale);
  }
  ctx.restore();
}
