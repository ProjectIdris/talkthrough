// Draws the screen-space annotations that are more than a line: tags pinned to 3D parts, note cards
// and image cards. The look comes from the theme; everything is drawn on the marks canvas, in
// CSS pixels, so it lines up with the 3D layer.

import type { Vec3 } from '../scene/types.ts';
import type { View } from './marks.ts';
import { THEME, fontAt } from './theme.ts';
import type { Theme } from './theme.ts';
import { attachPoint } from './labels.ts';
import type { PinRequest, Placement } from './labels.ts';
import type { MarkFrame, Rgb } from './timeline.ts';
import { softShadow } from './style.ts';
import { rgbCss } from './timeline.ts';


export type Annotator = {
  view: View;
  /** The 3D stage in pixels, when there is one: tags are drawn smaller beside a small stage so they do not outweigh the model. */
  stage?: { w: number; h: number };
  /** Where a point of a 3D object is in the window. */
  project: (key: number, point: Vec3 | undefined, anchor?: string) => { x: number; y: number; visible: boolean } | undefined;
  /** The screenshot (or backdrop) image crops are taken from. */
  source?: { image: CanvasImageSource; width: number; height: number };
  /** Where the tag of a pin goes (stable between frames). Without it a tag sits where the author's offset says. */
  place?: (key: number, request: PinRequest) => Placement;
};

type Ctx = CanvasRenderingContext2D;
type Pt = { x: number; y: number };

const snapPx = (v: number, dpr: number) => Math.round(v * dpr) / dpr;

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function accentFor(m: MarkFrame, theme: Theme, order: number): Rgb {
  if (m.tinted) return m.color;
  return theme.accents[order % theme.accents.length] as Rgb;
}


function words(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''}...`;
    return kept;
  }
  return out;
}

// ---- Leaders ----------------------------------------------------------------------------------

/** A gentle curve from `a` to `b` (card leaders), as a polyline. */
function curvePath(a: Pt, b: Pt, vertical: boolean): Pt[] {
  const pts: Pt[] = [];
  const nx = -(b.y - a.y), ny = b.x - a.x;
  const len = Math.hypot(nx, ny) || 1;
  const bow = Math.min(60, len * 0.22) * (vertical ? 1 : -1);
  const c = { x: (a.x + b.x) / 2 + (nx / len) * bow, y: (a.y + b.y) / 2 + (ny / len) * bow };
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  }
  return pts;
}

function strokePartial(ctx: Ctx, pts: Pt[], fraction: number): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot((pts[i] as Pt).x - (pts[i - 1] as Pt).x, (pts[i] as Pt).y - (pts[i - 1] as Pt).y);
  let left = total * Math.max(0, Math.min(1, fraction));
  ctx.beginPath();
  ctx.moveTo((pts[0] as Pt).x, (pts[0] as Pt).y);
  let tip = pts[0] as Pt;
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i - 1] as Pt, b = pts[i] as Pt;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg <= left) {
      ctx.lineTo(b.x, b.y);
      tip = b;
      left -= seg;
    } else {
      const t = left / seg;
      tip = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      ctx.lineTo(tip.x, tip.y);
      left = 0;
    }
  }
  ctx.stroke();
  return tip;
}

function drawLeader(ctx: Ctx, pts: Pt[], color: Rgb, alpha: number, fraction: number): void {
  const theme = THEME;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  softShadow(ctx);
  ctx.strokeStyle = rgbCss(color, 1);
  ctx.lineWidth = theme.leaderWidth;
  ctx.globalAlpha = alpha;
  strokePartial(ctx, pts, fraction);
  ctx.restore();
}

function drawAnchor(ctx: Ctx, p: Pt, color: Rgb, alpha: number, scale: number): void {
  const r = 5.5 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = rgbCss(color, 1);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- Pins -------------------------------------------------------------------------------------

const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

export function drawPin(ctx: Ctx, m: MarkFrame, a: Annotator, order: number): void {
  const mk = m.mark;
  if (mk.op !== 'pin' || m.onKey === undefined) return;
  const where = a.project(m.onKey, mk.point, mk.anchor);
  if (!where || !where.visible) return;
  const theme = THEME;
  const { view } = a;
  const alpha = Math.max(0, Math.min(1, m.opacity * m.fade));
  const p = m.appear;
  const color = accentFor(m, theme, order);
  // A tag is sized by the screen; beside a stage much smaller than a usual one (half the screen's height) it comes down, to 70% at most.
  const beside = a.stage ? Math.max(0.7, Math.min(1, Math.min(a.stage.w, a.stage.h) / (view.height * 0.5))) : 1;
  const textPx = Math.max(11, Math.max(13, view.height * 0.0195) * beside);
  const anchor = { x: snapPx(where.x, view.dpr), y: snapPx(where.y, view.dpr) };

  ctx.save();
  ctx.font = fontAt(theme.font, textPx);
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(mk.text).width;
  const padX = textPx * 0.8, padY = textPx * 0.55;
  const markW = textPx * 0.9;
  const w = Math.ceil(textW + padX * 2 + markW);
  const h = Math.ceil(textPx + padY * 2);
  const hint = mk.off ? { x: (mk.off[0] / 1000) * view.width, y: (mk.off[1] / 1000) * view.height } : undefined;
  let spot: Placement;
  if (a.place) spot = a.place(m.key, { anchor, w, h, ...(hint ? { hint } : {}) });
  else {
    const off = hint ?? { x: 0, y: -90 / 1000 * view.height };
    const cx = Math.max(w / 2 + 6, Math.min(view.width - w / 2 - 6, anchor.x + off.x));
    const cy = Math.max(h / 2 + 6, Math.min(view.height - h / 2 - 6, anchor.y + off.y));
    const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    spot = { rect, attach: attachPoint(rect, anchor), alpha: 1 };
  }
  const tag = { x: snapPx(spot.rect.x, view.dpr), y: snapPx(spot.rect.y, view.dpr), w, h };

  // The reveal, in order: the dot pops, the leader draws on from the dot, then the tag settles in.
  const dot = easeOut(p / 0.25);
  const lead = easeOut((p - 0.12) / 0.5);
  const show = easeOut((p - 0.45) / 0.55);
  drawLeader(ctx, [anchor, spot.attach], color, alpha * spot.alpha, lead);
  drawAnchor(ctx, anchor, color, alpha * Math.min(1, p / 0.2), (0.5 + 0.5 * dot) * (1 + 0.5 * m.pulse) * beside);

  ctx.globalAlpha = alpha * show * spot.alpha;
  const grow = 0.94 + 0.06 * show;
  const mx = tag.x + tag.w / 2, my = tag.y + tag.h / 2;
  ctx.translate(mx, my);
  ctx.scale(grow, grow);
  ctx.translate(-mx, -my);
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 5;
  if (m.pulse > 0) {
    ctx.shadowColor = rgbCss(m.pulseColor ?? color, 0.9 * m.pulse);
    ctx.shadowBlur = 26 * m.pulse;
    ctx.shadowOffsetY = 0;
  }
  ctx.fillStyle = theme.surface;
  roundRectPath(ctx, tag.x, tag.y, tag.w, tag.h, theme.radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.line;
  ctx.stroke();
  const mid = tag.y + tag.h / 2;
  ctx.fillStyle = rgbCss(color, 1);
  ctx.beginPath();
  ctx.arc(tag.x + padX * 0.9, mid, textPx * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.ink;
  ctx.fillText(mk.text, tag.x + padX + markW * 0.75, mid + textPx * 0.03);
  ctx.restore();
}

// ---- Cards ------------------------------------------------------------------------------------

type CardLine = { text: string; font: string; color: string; x: number; y: number };

export function drawCard(ctx: Ctx, m: MarkFrame, a: Annotator, order: number): void {
  const mk = m.mark;
  if (mk.op !== 'card') return;
  const theme = THEME;
  const { view } = a;
  const alpha = Math.max(0, Math.min(1, m.opacity * m.fade));
  const p = m.appear;
  const color = accentFor(m, theme, order);
  const W = Math.min(view.width - 16, ((mk.w ?? 300) / 1000) * view.width);
  const pad = Math.max(12, view.height * 0.017);
  const titlePx = Math.max(15, view.height * 0.0245);
  const rowPx = Math.max(13, view.height * 0.0185);
  const layout = mk.layout ?? 'list';
  const rows = mk.rows ?? [];
  const x = snapPx((mk.x / 1000) * view.width, view.dpr);
  const y0 = snapPx((mk.y / 1000) * view.height, view.dpr);

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const lines: CardLine[] = [];
  const shapes: Array<() => void> = [];
  let y = pad;
  const inner = W - pad * 2;
  const addText = (text: string, font: string, colorCss: string, lx: number, ly: number) => lines.push({ text, font, color: colorCss, x: lx, y: ly });

  if (mk.title) {
    ctx.font = fontAt(theme.titleFont, titlePx);
    const t = mk.title;
    for (const l of words(ctx, t, inner, 2)) {
      y += titlePx * 1.05;
      addText(l, fontAt(theme.titleFont, titlePx), theme.ink, pad, y);
      y += titlePx * 0.28;
    }
    y += rowPx * 0.35;
  }
  if (layout === 'stat' && rows.length > 0) {
    const bigPx = Math.max(30, view.height * 0.062);
    ctx.font = fontAt(theme.titleFont, bigPx);
    const big = rows[0] as string;
    y += bigPx * 0.92;
    addText(big, fontAt(theme.titleFont, bigPx), rgbCss(color, 1), pad, y);
    y += bigPx * 0.22;
    ctx.font = fontAt(theme.font, rowPx);
    for (const r of rows.slice(1)) {
      for (const l of words(ctx, r, inner, 2)) {
        y += rowPx * 1.35;
        addText(l, fontAt(theme.font, rowPx), theme.muted, pad, y);
      }
    }
  } else if (layout === 'timeline' && rows.length > 0) {
    const n = rows.length;
    const slot = inner / n;
    ctx.font = fontAt(theme.font, rowPx);
    const lineY = y + rowPx * 1.9;
    let tall = 0;
    rows.forEach((r, i) => {
      const [when, what] = r.includes('|') ? r.split('|').map((s) => s.trim()) : ['', r];
      const cx = pad + slot * (i + 0.5);
      ctx.font = fontAt(theme.titleFont, rowPx * 1.05);
      if (when) addText(when, fontAt(theme.titleFont, rowPx * 1.05), theme.ink, Math.max(pad, cx - ctx.measureText(when).width / 2), lineY - rowPx * 0.95);
      ctx.font = fontAt(theme.font, rowPx * 0.92);
      const wrapped = words(ctx, what ?? '', slot - 6, 3);
      wrapped.forEach((l, k) => {
        const ly = lineY + rowPx * 1.7 + k * rowPx * 1.2;
        addText(l, fontAt(theme.font, rowPx * 0.92), theme.muted, cx - ctx.measureText(l).width / 2, ly);
        tall = Math.max(tall, ly - lineY);
      });
      shapes.push(() => {
        ctx.fillStyle = rgbCss(color, 1);
        ctx.beginPath();
        ctx.arc(x + cx, y0 + lineY, rowPx * 0.3, 0, Math.PI * 2);
        ctx.fill();
      });
    });
    shapes.unshift(() => {
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + pad + slot * 0.5, y0 + lineY);
      ctx.lineTo(x + pad + slot * (n - 0.5), y0 + lineY);
      ctx.stroke();
    });
    y = lineY + Math.max(tall, rowPx * 1.7) + rowPx * 0.5;
  } else {
    ctx.font = fontAt(theme.font, rowPx);
    for (const r of rows) {
      const wrapped = words(ctx, r, inner - rowPx * 1.1, 2);
      wrapped.forEach((l, k) => {
        y += rowPx * 1.4;
        if (k === 0) {
          const by = y - rowPx * 0.32;
          shapes.push(() => {
            ctx.fillStyle = rgbCss(color, 1);
            ctx.beginPath();
            ctx.arc(x + pad + rowPx * 0.2, y0 + by, rowPx * 0.17, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        addText(l, fontAt(theme.font, rowPx), theme.ink, pad + rowPx * 1.1, y);
      });
      y += rowPx * 0.18;
    }
  }
  const H = y + pad * 0.9;
  const slide = (1 - p) * 10;
  const top = y0 + slide;

  ctx.globalAlpha = alpha * Math.min(1, p * 1.5);
  ctx.translate(0, slide);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  if (m.pulse > 0) {
    ctx.shadowColor = rgbCss(m.pulseColor ?? color, 0.9 * m.pulse);
    ctx.shadowBlur = 30 * m.pulse;
    ctx.shadowOffsetY = 0;
  }
  ctx.fillStyle = theme.surface;
  roundRectPath(ctx, x, y0, W, H, theme.radius + 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.line;
  ctx.stroke();
  ctx.fillStyle = rgbCss(color, 1);
  roundRectPath(ctx, x, y0 + 10, 4, Math.min(H - 20, titlePx * 1.6), 2);
  ctx.fill();
  for (const s of shapes) s();
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x + l.x, y0 + l.y);
  }
  ctx.restore();

  if (mk.to) {
    const target = { x: (mk.to[0] / 1000) * view.width, y: (mk.to[1] / 1000) * view.height };
    const vertical = Math.abs(target.y - (top + H / 2)) > Math.abs(target.x - (x + W / 2));
    const from = vertical
      ? { x: Math.max(x + 16, Math.min(x + W - 16, target.x)), y: target.y < top ? top : top + H }
      : { x: target.x < x ? x : x + W, y: Math.max(top + 12, Math.min(top + H - 12, target.y)) };
    const path = curvePath(from, target, vertical);
    ctx.save();
    drawLeader(ctx, path, color, alpha, easeOut((p - 0.3) / 0.7));
    if (p > 0.95) drawAnchor(ctx, target, color, alpha, 1);
    ctx.restore();
  }
}

// ---- Image cards ------------------------------------------------------------------------------

export function drawImage(ctx: Ctx, m: MarkFrame, a: Annotator, order: number): void {
  const mk = m.mark;
  if (mk.op !== 'image' || !a.source) return;
  const theme = THEME;
  const { view, source } = a;
  const alpha = Math.max(0, Math.min(1, m.opacity * m.fade));
  const p = m.appear;
  const color = accentFor(m, theme, order);
  const srcW = (mk.sw / 1000) * source.width, srcH = (mk.sh / 1000) * source.height;
  const w = Math.min(view.width * 0.8, (mk.dw / 1000) * view.width);
  const h = (w * srcH) / Math.max(1, srcW);
  const pad = Math.max(6, view.height * 0.008);
  const capPx = Math.max(13, view.height * 0.018);
  const cap = mk.caption ? capPx * 1.9 : 0;
  const x = snapPx((mk.dx / 1000) * view.width, view.dpr), y = snapPx((mk.dy / 1000) * view.height, view.dpr);
  ctx.save();
  ctx.globalAlpha = alpha * Math.min(1, p * 1.5);
  ctx.translate(0, (1 - p) * 10);
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = theme.surface;
  roundRectPath(ctx, x, y, w + pad * 2, h + pad * 2 + cap, theme.radius + 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.save();
  roundRectPath(ctx, x + pad, y + pad, w, h, Math.max(0, theme.radius - 2));
  ctx.clip();
  ctx.drawImage(source.image, (mk.sx / 1000) * source.width, (mk.sy / 1000) * source.height, srcW, srcH, x + pad, y + pad, w, h);
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rgbCss(color, 1);
  roundRectPath(ctx, x + pad, y + pad, w, h, Math.max(0, theme.radius - 2));
  ctx.stroke();
  if (mk.caption) {
    ctx.font = fontAt(theme.font, capPx);
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(mk.caption, x + pad + 2, y + pad + h + cap * 0.55);
  }
  ctx.restore();
}
