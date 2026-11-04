// What kind of mark the person made with the pen, and roughly what it is on. A circle is not the only thing people draw to say "this": they go round
// a thing twice, leave the circle open, underline a line of text, point at something with an arrow or a tick. The shape says what it is; the
// subject is read from it, not from the stroke's bounds (a C has half a circle's bounds, an underline's bounds are a flat line with the text
// above it, an arrow's bounds are its shaft and the thing it points at is at its tip).
//
// Everything is on the 0..1000 scale of the screenshot; `aspect` (width over height) makes distances and angles true on a screen that is not square.

import type { Box, Point } from './pen.ts';
import { strokeBounds } from './pen.ts';

export type PenKind = 'circle' | 'underline' | 'arrow';

export type PenShape = {
  kind: PenKind;
  /** What the mark is on, roughly (before the page is looked at): the loops' shared box, the strip above an underline, the window at an arrow's tip. */
  subject: Box;
  /** The point an arrow points at. */
  tip?: Point;
  /** How many times a circle went round. */
  loops?: number;
  /** A circle that was not closed. */
  open?: boolean;
};

const TWO_PI = 2 * Math.PI;
/** Turning this much (radians) is a circle, even an unfinished one (a C is about 4 to 5); less is a line or a hook. */
const CIRCLE_TURN = 3.4;
/** An unfinished circle is completed when it went round at least this far. */
const ARC_FROM = 2.1;
/** A stroke this flat (height over width, on the true screen) is an underline. */
const FLAT = 0.2;
/** An underline is at least this wide (0..1000 units across). */
const UNDERLINE_MIN_W = 22;
/** The strip above an underline that its text is in (units of the screen's height), and the window round an arrow's tip (the same, each way). */
const TEXT_STRIP = 42;
const TIP_WINDOW = 36;

type V = { x: number; y: number };

const toTrue = (p: Point, aspect: number): V => ({ x: p[0] * aspect, y: p[1] });
const fromTrue = (v: V, aspect: number): Point => [v.x / aspect, v.y];

/** The points of a stroke at about `step` apart along it (in true units), first and last kept. */
function resample(stroke: ReadonlyArray<Point>, aspect: number, step: number): V[] {
  const pts = stroke.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => toTrue(p, aspect));
  if (pts.length === 0) return [];
  const out: V[] = [pts[0] as V];
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as V, b = pts[i] as V;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    carried += len;
    if (carried >= step) {
      out.push(b);
      carried = 0;
    }
  }
  const last = pts[pts.length - 1] as V;
  if (out.length < 2 || out[out.length - 1] !== last) out.push(last);
  return out;
}

const pathLength = (pts: V[]): number => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - (pts[i - 1] as V).x, p.y - (pts[i - 1] as V).y)), 0);

/** The turning at each interior point of the path, in radians (left positive), measured over chords two steps long so hand jitter does not count. */
function turns(pts: V[]): number[] {
  const out: number[] = [];
  for (let i = 2; i < pts.length - 2; i++) {
    const a = pts[i - 2] as V, b = pts[i] as V, c = pts[i + 2] as V;
    let d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (d > Math.PI) d -= TWO_PI;
    while (d <= -Math.PI) d += TWO_PI;
    out.push(d);
  }
  return out;
}

const boxOf = (pts: V[], aspect: number): Box => strokeBounds([pts.map((p) => fromTrue(p, aspect))]) as Box;
const area = (b: Box): number => b.w * b.h;

function intersection(a: Box, b: Box): Box | null {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The circle that fits the points best (algebraic least squares), in true units; null when they are on a line. */
function fitCircle(pts: V[]): { c: V; r: number } | null {
  const n = pts.length;
  if (n < 5) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return Number.isFinite(r) ? { c: { x: uc + mx, y: vc + my }, r } : null;
}

/**
 * The box a circle drawn once or several times is on. Several loops over one thing: what they share (their boxes' common part, or the smallest
 * loop when they share too little). An unfinished circle: the circle it would have been, fitted to the arc.
 */
function circleSubject(strokes: ReadonlyArray<ReadonlyArray<Point>>, aspect: number): { subject: Box; loops: number; open: boolean } {
  const paths = strokes.map((s) => resample(s, aspect, 6)).filter((p) => p.length >= 2);
  const loops: Box[] = [];
  let turned = 0;
  let open = false;
  for (const pts of paths) {
    const t = turns(pts);
    // One box per full turn of the path.
    let acc = 0, from = 0;
    t.forEach((d, i) => {
      acc += d;
      if (Math.abs(acc) >= TWO_PI * 0.92) {
        loops.push(boxOf(pts.slice(from, i + 3), aspect));
        from = i + 1;
        acc = 0;
      }
    });
    turned += t.reduce((s, d) => s + Math.abs(d), 0);
    const rest = pts.slice(from);
    if (loops.length === 0 || rest.length > 6 && Math.abs(acc) > ARC_FROM) loops.push(boxOf(rest.length >= 2 ? rest : pts, aspect));
    const diag = Math.hypot(boxOf(pts, aspect).w * aspect, boxOf(pts, aspect).h);
    const first = pts[0] as V, last = pts[pts.length - 1] as V;
    if (Math.hypot(last.x - first.x, last.y - first.y) > 0.3 * diag) open = true;
  }
  const all = strokeBounds(strokes as ReadonlyArray<ReadonlyArray<Point>>) as Box;
  let subject: Box;
  if (loops.length >= 2) {
    const smallest = loops.reduce((a, b) => (area(b) < area(a) ? b : a));
    const common = loops.slice(1).reduce<Box | null>((acc, b) => (acc ? intersection(acc, b) : null), loops[0] as Box);
    subject = common && area(common) >= 0.5 * area(smallest) ? common : smallest;
    open = false;
  } else {
    subject = loops[0] ?? all;
    if (open && turned >= ARC_FROM) {
      const arc = paths.flat();
      const fit = fitCircle(arc);
      const extent = Math.max(subject.w * aspect, subject.h);
      if (fit && fit.r >= 0.35 * extent && fit.r <= 0.95 * extent) {
        const circle = strokeBounds([[fromTrue({ x: fit.c.x - fit.r, y: fit.c.y - fit.r }, aspect), fromTrue({ x: fit.c.x + fit.r, y: fit.c.y + fit.r }, aspect)]]) as Box;
        const x0 = Math.min(subject.x, circle.x), y0 = Math.min(subject.y, circle.y);
        subject = { x: x0, y: y0, w: Math.max(subject.x + subject.w, circle.x + circle.w) - x0, h: Math.max(subject.y + subject.h, circle.y + circle.h) - y0 };
      }
    }
  }
  return { subject, loops: Math.max(1, Math.round(turned / TWO_PI)), open };
}

/** Where an arrow points: the end of its shaft that the head is at, or the end of the stroke. */
function arrowTip(strokes: ReadonlyArray<ReadonlyArray<Point>>, aspect: number): Point {
  const lines = strokes.map((s) => ({ s, pts: resample(s, aspect, 6) })).filter((l) => l.pts.length >= 2);
  const shaft = lines.reduce((a, b) => (pathLength(b.pts) > pathLength(a.pts) ? b : a));
  const first = shaft.pts[0] as V, last = shaft.pts[shaft.pts.length - 1] as V;
  const others = lines.filter((l) => l !== shaft).flatMap((l) => l.pts);
  if (others.length > 0) {
    const cx = others.reduce((s, p) => s + p.x, 0) / others.length, cy = others.reduce((s, p) => s + p.y, 0) / others.length;
    return fromTrue(Math.hypot(first.x - cx, first.y - cy) < Math.hypot(last.x - cx, last.y - cy) ? first : last, aspect);
  }
  // One stroke: a head drawn on the end is a sharp turn after a long shaft; a tick is a short stroke then a long one.
  const t = turns(shaft.pts);
  let sharp = -1;
  t.forEach((d, i) => { if (Math.abs(d) > 1.2 && (sharp < 0 || Math.abs(d) > Math.abs(t[sharp] as number))) sharp = i; });
  if (sharp >= 0) {
    const at = shaft.pts[sharp + 2] as V;
    const before = pathLength(shaft.pts.slice(0, sharp + 3)), after = pathLength(shaft.pts.slice(sharp + 2));
    if (before >= 2 * after) return fromTrue(at, aspect);
  }
  return fromTrue(last, aspect);
}

/** A strip of the screen just above a flat stroke (units): where the text it underlines is. */
function stripAbove(stroke: Box, y: number): Box {
  return { x: stroke.x, y: Math.max(0, y - TEXT_STRIP), w: stroke.w, h: Math.min(y, TEXT_STRIP) + 2 };
}

/** A window of the screen round a point (units). */
function windowAt(tip: Point, aspect: number): Box {
  const w = (2 * TIP_WINDOW) / aspect;
  return { x: Math.max(0, tip[0] - w / 2), y: Math.max(0, tip[1] - TIP_WINDOW), w, h: 2 * TIP_WINDOW };
}

/** What kind of mark these strokes (one circle's worth, in the order drawn) are, and what they are on. */
export function readShape(strokes: ReadonlyArray<ReadonlyArray<Point>>, aspect = 16 / 9): PenShape {
  const all = strokeBounds(strokes);
  if (!all) return { kind: 'circle', subject: { x: 0, y: 0, w: 0, h: 0 } };
  const paths = strokes.map((s) => resample(s, aspect, 6)).filter((p) => p.length >= 2);
  const turned = paths.reduce((sum, pts) => sum + turns(pts).reduce((s, d) => s + Math.abs(d), 0), 0);
  const trueW = all.w * aspect, trueH = all.h;
  const meanY = strokes.flat().reduce((s, p) => s + p[1], 0) / Math.max(1, strokes.flat().length);
  if (all.w >= UNDERLINE_MIN_W && trueH <= FLAT * trueW && turned < 2.6) {
    return { kind: 'underline', subject: stripAbove(all, meanY) };
  }
  if (turned >= CIRCLE_TURN) {
    const c = circleSubject(strokes, aspect);
    return { kind: 'circle', subject: c.subject, loops: c.loops, ...(c.open ? { open: true } : {}) };
  }
  if (Math.max(trueW, trueH) >= 30) {
    const tip = arrowTip(strokes, aspect);
    return { kind: 'arrow', subject: windowAt(tip, aspect), tip };
  }
  return { kind: 'circle', subject: all, loops: 1 };
}
