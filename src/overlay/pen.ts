// The pen: what the user draws with the mouse while the chord is held (circle something to point at it).
// A stroke is pure overlay: it is drawn on the marks canvas and reported to the main process, but it is
// never part of a scene. It stays after the keys are let go until the answer starts, then fades.
// The state here has no DOM, so it is tested without a window; coordinates run 0..1000 across the window.

import type { Stroke } from '../shared/ipc.ts';

/** How far (in 0..1000 units) the pointer must move after pressing before it counts as drawing: a click draws nothing. */
export const START_DISTANCE = 3;
/** The stroke fades out over this long once the answer begins. */
export const PEN_FADE_MS = 600;
/** The stroke is this share of the window's longer side wide. */
export const PEN_WIDTH_SHARE = 0.005;

type Pt = [number, number];
type Live = { id: number; start: Pt; started: boolean; sent: number; done: boolean };

export class PenLayer {
  private strokes: Array<{ id: number; points: Pt[] }> = [];
  private live: Live | undefined;
  private nextId = 1;
  private fadeAt: number | undefined;
  private on = false;
  private outbox: Stroke[] = [];

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

  down(x: number, y: number): void {
    if (!this.on) return;
    this.up();
    this.live = { id: this.nextId++, start: [round(x), round(y)], started: false, sent: 0, done: false };
  }

  move(x: number, y: number): void {
    const live = this.live;
    if (!this.on || !live) return;
    const p: Pt = [round(x), round(y)];
    if (!live.started) {
      if (Math.hypot(p[0] - live.start[0], p[1] - live.start[1]) < START_DISTANCE) return;
      live.started = true;
      this.strokes.push({ id: live.id, points: [live.start] });
    }
    const s = this.strokes[this.strokes.length - 1];
    if (s && s.id === live.id) s.points.push(p);
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

  /** What has been drawn since the last call, as the pieces to report (points are appended per stroke id). */
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

  /** The answer has begun (or the question ended): the stroke starts to fade. */
  fade(now: number): void {
    if (this.strokes.length > 0 && this.fadeAt === undefined && !this.on) this.fadeAt = now;
  }

  /** Strokes to draw now, with how opaque they are; none once faded. */
  view(now: number): { strokes: ReadonlyArray<{ id: number; points: ReadonlyArray<Pt> }>; alpha: number } {
    if (this.fadeAt !== undefined) {
      const k = (now - this.fadeAt) / PEN_FADE_MS;
      if (k >= 1) {
        this.strokes = [];
        this.fadeAt = undefined;
      } else return { strokes: this.strokes, alpha: 1 - k };
    }
    return { strokes: this.strokes, alpha: 1 };
  }

  /** True while the picture changes by itself (the stroke is fading). */
  animating(now: number): boolean {
    return this.fadeAt !== undefined && now - this.fadeAt < PEN_FADE_MS;
  }
}

const round = (v: number): number => Math.round(v * 10) / 10;

type Ctx = CanvasRenderingContext2D;

/** Draws the strokes: red, round, with a faint dark outline so they read on light and dark pages. */
export function drawPen(ctx: Ctx, view: { strokes: ReadonlyArray<{ points: ReadonlyArray<Pt> }>; alpha: number }, size: { width: number; height: number }): void {
  if (view.alpha <= 0.002) return;
  const width = Math.max(3, Math.max(size.width, size.height) * PEN_WIDTH_SHARE);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass === 0 ? `rgba(0,0,0,${0.32 * view.alpha})` : `rgba(255,59,48,${0.95 * view.alpha})`;
    ctx.lineWidth = pass === 0 ? width + 3 : width;
    for (const s of view.strokes) {
      const pts = s.points.map((p) => ({ x: (p[0] / 1000) * size.width, y: (p[1] / 1000) * size.height }));
      const first = pts[0];
      if (!first || pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      // Smooth through the midpoints so a hand-drawn loop is not a polygon.
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i] as { x: number; y: number }, b = pts[i + 1] as { x: number; y: number };
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = pts[pts.length - 1] as { x: number; y: number };
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
