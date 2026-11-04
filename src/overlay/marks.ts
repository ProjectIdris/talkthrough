// Draws the screen marks (box, circle, underline, arrow, label) on a 2D canvas that covers the
// display. Scene coordinates run 0..1000 across each axis of the display; everything is snapped
// to physical pixels so lines stay crisp at any display scaling.

import { drawCard, drawImage, drawPin } from './annotations.ts';
import type { Annotator } from './annotations.ts';
import { pathLength, smoothPath } from './shapes.ts';
import type { Pt } from './shapes.ts';
import { rgbCss } from './timeline.ts';
import type { MarkFrame, Rgb } from './timeline.ts';

/** The drawing surface in CSS pixels and its device pixel ratio. */
export type View = { width: number; height: number; dpr: number };

/** Rounds a CSS-pixel coordinate to the nearest physical pixel. */
export function snap(v: number, dpr: number): number {
  return Math.round(v * dpr) / dpr;
}

export function px(coord: number, extent: number, dpr: number): number {
  return snap((coord / 1000) * extent, dpr);
}

/** Line thickness in CSS pixels: about 0.4% of the display height, at least 3 device-independent pixels. */
export function lineWidth(view: View): number {
  return snap(Math.max(3, view.height * 0.0042), view.dpr);
}

const luminance = (c: Rgb) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

type Ctx = CanvasRenderingContext2D;

function strokeWithHalo(ctx: Ctx, color: Rgb, alpha: number, lw: number, pulse: number, pulseColor: Rgb | undefined, draw: () => void): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${0.35 * alpha})`;
  ctx.lineWidth = lw + 3;
  draw();
  ctx.restore();
  ctx.save();
  if (pulse > 0) {
    ctx.shadowColor = rgbCss(pulseColor ?? color, 0.9 * pulse);
    ctx.shadowBlur = 26 * pulse;
  }
  ctx.strokeStyle = rgbCss(pulse > 0 && pulseColor ? pulseColor : color, alpha);
  ctx.lineWidth = lw * (1 + 0.9 * pulse);
  draw();
  ctx.restore();
}

/** Options the page gives: with reduceMotion the marks appear and go in one step, with no stroke drawn along. */
export type MarkOptions = { reduceMotion?: boolean; /** Draw over what the canvas holds (a second set of marks over the diagrams) instead of clearing it first. */ append?: boolean };

const FEATHER_BANDS = 7;

/**
 * Draws a stroke along a path as a pen would: the part drawn so far (`head` of `total`, in pixels along the
 * path) from `tail` on, with the leading end feathered (it thins and fades over the last stretch) and, when the mark is
 * being cleared, the tail wiped away the same way. `trace` makes the path; the stroke goes along it from its start.
 */
function penStroke(
  ctx: Ctx, m: MarkFrame, alpha: number, lw: number, total: number, head: number, tail: number, trace: () => void,
): void {
  const featherLen = Math.min(Math.max(0, head - tail), Math.max(18, total * 0.1));
  const body = head - featherLen;
  const dashed = (from: number, to: number, a: number): void => {
    if (to - from <= 0.2 || a <= 0.003) return;
    ctx.setLineDash([to - from, total + 200]);
    ctx.lineDashOffset = -from;
    strokeWithHalo(ctx, m.color, alpha * a, lw, m.pulse, m.pulseColor, () => {
      trace();
      ctx.stroke();
    });
  };
  // The tail end is wiped with the same softness as the head is drawn.
  const wipe = tail > 0 ? Math.min(featherLen, Math.max(0, body - tail)) : 0;
  if (tail <= 0 && head >= total - 0.5) {
    dashed(0, total + 2, 1);
    ctx.setLineDash([]);
    return;
  }
  dashed(tail + wipe, body, 1);
  for (let i = 0; i < FEATHER_BANDS; i++) {
    const a = body + (featherLen * i) / FEATHER_BANDS;
    const b = body + (featherLen * (i + 1)) / FEATHER_BANDS;
    dashed(a, b, 1 - (i + 0.5) / FEATHER_BANDS);
  }
  for (let i = 0; i < FEATHER_BANDS && wipe > 0; i++) {
    const a = tail + (wipe * i) / FEATHER_BANDS;
    const b = tail + (wipe * (i + 1)) / FEATHER_BANDS;
    dashed(a, b, (i + 0.5) / FEATHER_BANDS);
  }
  ctx.setLineDash([]);
}

/** How a stroke mark is drawn: its alpha, how far along it is, and where its tail has been wiped to (0 when it is whole). */
function strokeState(m: MarkFrame, total: number, reduce: boolean): { alpha: number; head: number; tail: number } {
  if (reduce) return { alpha: Math.max(0, Math.min(1, m.opacity * m.fade)), head: m.appear > 0 ? total : 0, tail: 0 };
  return { alpha: Math.max(0, Math.min(1, m.opacity)), head: total * m.appear, tail: total * (1 - m.fade) };
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBox(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number, reduce: boolean): void {
  const mk = m.mark;
  if (mk.op !== 'box' && mk.op !== 'circle') return;
  const tilt = mk.rot ?? 0;
  const x = px(mk.x, v.width, v.dpr), y = px(mk.y, v.height, v.dpr);
  const w = Math.max(2, px(mk.w, v.width, v.dpr)), h = Math.max(2, px(mk.h, v.height, v.dpr));
  const p = m.appear;
  // A tilted box or oval turns about its middle, on the screen's own pixels (a tilted square stays square).
  ctx.save();
  if (tilt !== 0) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((tilt * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  if (mk.op === 'box') {
    const rr = Math.max(0, Math.min(8, w / 2, h / 2));
    const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * rr;
    ctx.save();
    ctx.fillStyle = rgbCss(m.color, 0.1 * alpha * p);
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.restore();
    const st = strokeState(m, perimeter, reduce);
    penStroke(ctx, m, st.alpha, lw, perimeter, st.head, st.tail, () => roundRectPath(ctx, x, y, w, h, 8));
    ctx.restore();
    return;
  }
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.fillStyle = rgbCss(m.color, 0.08 * alpha * p);
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const a = w / 2, b = h / 2;
  const girth = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const st = strokeState(m, girth, reduce);
  penStroke(ctx, m, st.alpha, lw, girth, st.head, st.tail, () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, a, b, 0, -Math.PI / 2, (3 * Math.PI) / 2);
  });
  ctx.restore();
}

/** The points of a mark's outline or path in pixels. */
function pixelPoints(pts: readonly [number, number][], v: View): Pt[] {
  return pts.map(([x, y]) => [px(x, v.width, v.dpr), px(y, v.height, v.dpr)] as Pt);
}

function tracePath(ctx: Ctx, pts: readonly Pt[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1])));
  if (closed) ctx.closePath();
}

function drawPoly(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number, reduce: boolean): void {
  const mk = m.mark;
  if (mk.op !== 'poly') return;
  const pts = pixelPoints(mk.pts, v);
  ctx.save();
  ctx.fillStyle = rgbCss(m.color, 0.1 * alpha * m.appear);
  tracePath(ctx, pts, true);
  ctx.fill();
  ctx.restore();
  const total = pathLength(pts, true);
  const st = strokeState(m, total, reduce);
  penStroke(ctx, m, st.alpha, lw, total, st.head, st.tail, () => tracePath(ctx, pts, true));
}

function drawTrace(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number, reduce: boolean): void {
  const mk = m.mark;
  if (mk.op !== 'trace') return;
  const pts = smoothPath(pixelPoints(mk.pts, v));
  const total = pathLength(pts);
  if (total < 1) return;
  // With a head, the line stops short of the tip and the head pops in over the last of the draw (as an arrow does).
  const last = pts[pts.length - 1] as Pt;
  let before = pts[Math.max(0, pts.length - 2)] as Pt;
  for (let i = pts.length - 2; i >= 0; i--) {
    before = pts[i] as Pt;
    if (Math.hypot(last[0] - before[0], last[1] - before[1]) > 3) break;
  }
  const dir = Math.atan2(last[1] - before[1], last[0] - before[0]);
  const headLen = mk.head ? Math.min(total * 0.4, Math.max(16, lw * 5)) : 0;
  const st = strokeState(m, total, reduce);
  penStroke(ctx, m, st.alpha, lw, total, st.head, st.tail, () => tracePath(ctx, pts, false));
  if (mk.head && m.appear > 0.55) {
    const hp = Math.min(1, (m.appear - 0.55) / 0.45);
    const s = headLen * (0.4 + 0.6 * hp);
    const ux = Math.cos(dir), uy = Math.sin(dir);
    const bx = last[0] - ux * s, by = last[1] - uy * s, nx = -uy * s * 0.5, ny = ux * s * 0.5;
    const path = (): void => {
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(bx + nx, by + ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * alpha})`;
    path();
    ctx.stroke();
    ctx.fillStyle = rgbCss(m.color, alpha);
    path();
    ctx.fill();
    ctx.restore();
  }
}

/** A ring with a dot on one point: it settles in from a wider ring so the eye lands on the centre. */
function drawPoint(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number): void {
  const mk = m.mark;
  if (mk.op !== 'point') return;
  const x = px(mk.x, v.width, v.dpr), y = px(mk.y, v.height, v.dpr);
  const r = Math.max(9, lw * 3);
  const ring = r * (1 + 1.2 * (1 - m.appear));
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha * m.appear * 1.4);
  const circle = (radius: number): void => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
  };
  ctx.lineWidth = lw + 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  circle(ring);
  ctx.stroke();
  if (m.pulse > 0) {
    ctx.shadowColor = rgbCss(m.pulseColor ?? m.color, 0.9 * m.pulse);
    ctx.shadowBlur = 26 * m.pulse;
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = rgbCss(m.pulse > 0 && m.pulseColor ? m.pulseColor : m.color, 1);
  circle(ring);
  ctx.stroke();
  ctx.fillStyle = ctx.strokeStyle;
  circle(Math.max(3, lw * 1.1));
  ctx.fill();
  ctx.restore();
}

function drawUnderline(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number, reduce: boolean): void {
  const mk = m.mark;
  if (mk.op !== 'underline') return;
  const x = px(mk.x, v.width, v.dpr), y = px(mk.y, v.height, v.dpr), w = px(mk.w, v.width, v.dpr);
  const st = strokeState(m, w, reduce);
  penStroke(ctx, m, st.alpha, lw * 1.15, w, st.head, st.tail, () => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
  });
}

function drawArrow(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number, reduce: boolean): void {
  const mk = m.mark;
  if (mk.op !== 'arrow') return;
  const x1 = px(mk.x1, v.width, v.dpr), y1 = px(mk.y1, v.height, v.dpr);
  const x2 = px(mk.x2, v.width, v.dpr), y2 = px(mk.y2, v.height, v.dpr);
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len, uy = dy / len;
  const head = Math.min(len * 0.6, Math.max(16, lw * 5));
  const p = m.appear;
  // The shaft grows first; the head pops in over the last part of the draw.
  const reach = len * Math.min(1, p / 0.8);
  const shaftEnd = Math.max(0, Math.min(reach, len - head * 0.7));
  const shaft = Math.max(1, len - head * 0.7);
  const st = reduce ? { alpha, head: m.appear > 0 ? shaft : 0, tail: 0 } : { alpha: Math.max(0, Math.min(1, m.opacity)), head: shaftEnd, tail: shaft * (1 - m.fade) };
  penStroke(ctx, m, st.alpha, lw, shaft, st.head, st.tail, () => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + ux * shaft, y1 + uy * shaft);
  });
  if (p > 0.55) {
    const hp = Math.min(1, (p - 0.55) / 0.45);
    const s = head * (0.4 + 0.6 * hp);
    const tipX = x1 + ux * reach, tipY = y1 + uy * reach;
    const tip = reach >= len - 0.5 ? [x2, y2] : [tipX, tipY];
    const bx = (tip[0] ?? x2) - ux * s, by = (tip[1] ?? y2) - uy * s;
    const nx = -uy * s * 0.5, ny = ux * s * 0.5;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(tip[0] ?? x2, tip[1] ?? y2);
      ctx.lineTo(bx + nx, by + ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0,0,0,${0.35 * alpha})`;
    path();
    ctx.stroke();
    if (m.pulse > 0) {
      ctx.shadowColor = rgbCss(m.pulseColor ?? m.color, 0.9 * m.pulse);
      ctx.shadowBlur = 26 * m.pulse;
    }
    ctx.fillStyle = rgbCss(m.pulse > 0 && m.pulseColor ? m.pulseColor : m.color, alpha);
    path();
    ctx.fill();
    ctx.restore();
  }
}

function drawLabel(ctx: Ctx, m: MarkFrame, v: View, alpha: number): void {
  const mk = m.mark;
  if (mk.op !== 'label') return;
  const textPx = snap(Math.max(11, ((mk.size ?? 24) / 1000) * v.height), v.dpr);
  const padX = textPx * 0.55, padY = textPx * 0.3;
  ctx.save();
  ctx.font = `600 ${textPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(mk.text).width;
  const w = tw + padX * 2, h = textPx + padY * 2;
  let x = px(mk.x, v.width, v.dpr);
  const y = px(mk.y, v.height, v.dpr) + (1 - m.appear) * 8;
  x = Math.max(4, Math.min(x, v.width - w - 4));
  const grow = 1 + 0.12 * m.pulse;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(grow, grow);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.globalAlpha = Math.min(1, alpha * m.appear * 1.4);
  if (m.pulse > 0) {
    ctx.shadowColor = rgbCss(m.pulseColor ?? m.color, 0.9 * m.pulse);
    ctx.shadowBlur = 26 * m.pulse;
  }
  ctx.fillStyle = rgbCss(m.color, 0.94);
  roundRectPath(ctx, x, y, w, h, h * 0.32);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.stroke();
  ctx.fillStyle = luminance(m.color) > 0.62 ? '#10141c' : '#ffffff';
  ctx.fillText(mk.text, x + padX, y + h / 2 + textPx * 0.03);
  ctx.restore();
}

/**
 * Clears the canvas and draws every mark in the frame, oldest first. Pins, cards and image cards need an
 * annotator (the theme, and where 3D parts fall on screen); without one they are left out.
 */
export function drawMarks(ctx: Ctx, marks: readonly MarkFrame[], view: View, annotator?: Annotator, options: MarkOptions = {}): void {
  const reduce = options.reduceMotion === true;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  if (!options.append) ctx.clearRect(0, 0, view.width, view.height);
  const lw = lineWidth(view);
  let order = 0;
  for (const m of marks) {
    const alpha = Math.max(0, Math.min(1, m.opacity * m.fade));
    if (alpha <= 0.002 || m.appear <= 0) continue;
    ctx.save();
    drawBox(ctx, m, view, alpha, lw, reduce);
    drawUnderline(ctx, m, view, alpha, lw, reduce);
    drawArrow(ctx, m, view, alpha, lw, reduce);
    drawPoly(ctx, m, view, alpha, lw, reduce);
    drawTrace(ctx, m, view, alpha, lw, reduce);
    drawPoint(ctx, m, view, alpha, lw);
    drawLabel(ctx, m, view, alpha);
    const op = m.mark.op;
    if (op === 'pin' || op === 'card' || op === 'image') {
      if (annotator) {
        if (op === 'pin') drawPin(ctx, m, annotator, order);
        else if (op === 'card') drawCard(ctx, m, annotator, order);
        else drawImage(ctx, m, annotator, order);
      }
      order++;
    }
    ctx.restore();
  }
}
