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
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: a.t + (b.t - a.t) * f });
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

/** How many steps of opacity a stroke is drawn in: a run of the ribbon at one step is one filled shape, so no seam shows inside it. */
const LEVELS = 14;

/**
 * Draws the strokes as a soft marker: a translucent ribbon in the style's red, thickest at the pen and tapering at its very start and tip,
 * with a faint wider halo; no dark outline. With a decay, a point's opacity and thickness settle over `decayMs` to a muted trace
 * (`PEN_REST` of the opacity) that stays; without one the whole stroke is drawn at full strength. The ribbon is filled as a few single
 * polygons, one for each run of one opacity, so overlapping pieces never show as beads or seams.
 */
export function drawPen(ctx: Ctx, view: PenView, size: { width: number; height: number }): void {
  if (view.alpha <= 0.002) return;
  const width = Math.max(6, Math.max(size.width, size.height) * PEN_WIDTH_SHARE);
  const decay = view.decayMs;
  const now = view.now ?? 0;
  ctx.save();
  for (const s of view.strokes) {
    const raw: Pix[] = s.points.map((p, i) => ({ x: (p[0] / 1000) * size.width, y: (p[1] / 1000) * size.height, t: s.times?.[i] ?? NO_TIME }));
    if (raw.length < 2) continue;
    const keep = calmLine(raw, Math.max(4, width * 0.55));
    const n = keep.length;
    if (n < 2) continue;
    // How fresh each point is: 1 at the pen, 0 once it has settled.
    const fresh = (p: Pix): number => (decay === undefined || p.t === NO_TIME ? 1 : Math.max(0, Math.min(1, 1 - (now - p.t) / decay)));
    const body = keep.map((p) => (decay === undefined ? 1 : PEN_REST + (1 - PEN_REST) * Math.pow(fresh(p), 0.9)));
    const slim = keep.map((p) => (decay === undefined ? 1 : 0.6 + 0.4 * Math.pow(fresh(p), 0.8)));
    // Distance along the line from each end, for the taper of the very start and tip.
    const along: number[] = [0];
    for (let i = 1; i < n; i++) along.push((along[i - 1] as number) + Math.hypot((keep[i] as Pix).x - (keep[i - 1] as Pix).x, (keep[i] as Pix).y - (keep[i - 1] as Pix).y));
    const total = along[n - 1] as number;
    const tip = width * 2.2;
    const ease = (u: number): number => 0.3 + 0.7 * Math.sqrt(Math.max(0, Math.min(1, u)));
    const half = (i: number, spread: number): number => (width * spread * Math.min(ease((total - (along[i] as number)) / tip), ease((along[i] as number) / tip)) * (slim[i] as number)) / 2;
    // The unit direction and the normal at each point (from the points either side of it).
    const dir: Array<[number, number]> = keep.map((_, i) => {
      const p = keep[Math.max(0, i - 1)] as Pix, q = keep[Math.min(n - 1, i + 1)] as Pix;
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return [(q.x - p.x) / l, (q.y - p.y) / l];
    });
    const level = (i: number): number => Math.round((body[i] as number) * LEVELS);
    // The halo is a wider, fainter ribbon under the body.
    for (const [spread, strength] of [[1.9, 0.16], [1, 0.6]] as const) {
      let from = 0;
      while (from < n - 1) {
        let to = from + 1;
        while (to < n - 1 && level(to) === level(from)) to++;
        let mean = 0;
        for (let i = from; i <= to; i++) mean += body[i] as number;
        const alpha = strength * view.alpha * (mean / (to - from + 1));
        if (alpha > 0.003) {
          const last = to === n - 1;
          // A hair of overlap into the next run, so the shared edge shows no seam.
          const push = last ? 0 : 0.25;
          const left: Array<[number, number]> = [], right: Array<[number, number]> = [];
          for (let i = from; i <= to; i++) {
            const p = keep[i] as Pix, [dx, dy] = dir[i] as [number, number], h = half(i, spread);
            const o = i === to ? push : 0;
            left.push([p.x - dy * h + dx * o, p.y + dx * h + dy * o]);
            right.push([p.x + dy * h + dx * o, p.y - dx * h + dy * o]);
          }
          ctx.fillStyle = `rgba(${INK[0]},${INK[1]},${INK[2]},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(...(left[0] as [number, number]));
          for (const q of left) ctx.lineTo(...q);
          if (last) {
            // The tip is round: half a circle from the left side round to the right.
            const p = keep[to] as Pix, [dx, dy] = dir[to] as [number, number], h = half(to, spread);
            for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; ctx.lineTo(p.x + h * (-dy * Math.cos(a) + dx * Math.sin(a)), p.y + h * (dx * Math.cos(a) + dy * Math.sin(a))); }
          }
          for (let k = right.length - 1; k >= 0; k--) ctx.lineTo(...(right[k] as [number, number]));
          if (from === 0) {
            const p = keep[0] as Pix, [dx, dy] = dir[0] as [number, number], h = half(0, spread);
            for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; ctx.lineTo(p.x + h * (dy * Math.cos(a) - dx * Math.sin(a)), p.y + h * (-dx * Math.cos(a) - dy * Math.sin(a))); }
          }
          ctx.closePath();
          ctx.fill();
        }
        from = to;
      }
    }
  }
  ctx.restore();
}
