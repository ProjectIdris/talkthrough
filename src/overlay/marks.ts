// Draws the screen marks (box, circle, underline, arrow, label) on a 2D canvas that covers the
// display. Scene coordinates run 0..1000 across each axis of the display; everything is snapped
// to physical pixels so lines stay crisp at any display scaling.

import { drawCard, drawImage, drawPin } from './annotations.ts';
import type { Annotator } from './annotations.ts';
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

function drawBox(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number): void {
  const mk = m.mark;
  if (mk.op !== 'box' && mk.op !== 'circle') return;
  const x = px(mk.x, v.width, v.dpr), y = px(mk.y, v.height, v.dpr);
  const w = Math.max(2, px(mk.w, v.width, v.dpr)), h = Math.max(2, px(mk.h, v.height, v.dpr));
  const p = m.appear;
  if (mk.op === 'box') {
    const perimeter = 2 * (w + h);
    ctx.save();
    ctx.fillStyle = rgbCss(m.color, 0.1 * alpha * p);
    roundRectPath(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.restore();
    strokeWithHalo(ctx, m.color, alpha, lw, m.pulse, m.pulseColor, () => {
      ctx.setLineDash([perimeter * p, perimeter + 10]);
      roundRectPath(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    return;
  }
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.fillStyle = rgbCss(m.color, 0.08 * alpha * p);
  ctx.beginPath();
  ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  strokeWithHalo(ctx, m.color, alpha, lw, m.pulse, m.pulseColor, () => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, p));
    ctx.stroke();
  });
}

function drawUnderline(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number): void {
  const mk = m.mark;
  if (mk.op !== 'underline') return;
  const x = px(mk.x, v.width, v.dpr), y = px(mk.y, v.height, v.dpr), w = px(mk.w, v.width, v.dpr);
  strokeWithHalo(ctx, m.color, alpha, lw * 1.15, m.pulse, m.pulseColor, () => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * m.appear, y);
    ctx.stroke();
  });
}

function drawArrow(ctx: Ctx, m: MarkFrame, v: View, alpha: number, lw: number): void {
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
  strokeWithHalo(ctx, m.color, alpha, lw, m.pulse, m.pulseColor, () => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + ux * shaftEnd, y1 + uy * shaftEnd);
    ctx.stroke();
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
export function drawMarks(ctx: Ctx, marks: readonly MarkFrame[], view: View, annotator?: Annotator): void {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  const lw = lineWidth(view);
  let order = 0;
  for (const m of marks) {
    const alpha = Math.max(0, Math.min(1, m.opacity * m.fade));
    if (alpha <= 0.002 || m.appear <= 0) continue;
    ctx.save();
    drawBox(ctx, m, view, alpha, lw);
    drawUnderline(ctx, m, view, alpha, lw);
    drawArrow(ctx, m, view, alpha, lw);
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
