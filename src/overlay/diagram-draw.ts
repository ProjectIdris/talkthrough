// Draws the flat diagrams (flow, timeline, steps, chart) on the marks canvas in the look of the cards and tags: dark glass,
// a coloured accent, thin light lines. Everything is in CSS pixels inside the diagram's own rectangle. Where pieces
// go comes from diagram-layout.ts; a piece that is moved by a later arrival eases to its new place instead of jumping.

import type { DiagramFrame, DiagramItemFrame } from './diagram-plan.ts';
import { bezierPoints, chartLayout, flowGrowth, flowLayout, flowReadable, formatTick, smoothPoints, stepsLayout, timelineLayout, routeEdge } from './diagram-layout.ts';
import type { FlowBox, Pt, Px } from './diagram-layout.ts';
import type { View } from './marks.ts';
import { softShadow } from './style.ts';
import { THEME, fontAt } from './theme.ts';
import { parseColor, rgbCss } from './timeline.ts';
import { refine } from './style.ts';
import type { Rgb } from './timeline.ts';
import { markerPlaces, markerSize, polylinePoint, streamColour } from './stream.ts';
import type { EdgeAction, NodeAction, SeriesAction, DotAction, StreamPiece } from '../scene/types.ts';

type Ctx = CanvasRenderingContext2D;

const GREEN: Rgb = [92, 224, 168];

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** The text cut into lines no wider than `maxW`, at most `maxLines` of them (the last one ends in "..." when cut). */
export function wrapLines(measure: (s: string) => number, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxW) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > maxLines) {
    const kept = out.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''}...`;
    return kept;
  }
  return out;
}

/** A polyline stroked from its start for `fraction` of its length; returns where the stroke ended and the way it was heading there. */
function strokePartial(ctx: Ctx, pts: readonly Pt[], fraction: number): { tip: Pt; angle: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let left = total * Math.max(0, Math.min(1, fraction));
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  let tip = pts[0]!;
  let angle = 0;
  for (let i = 1; i < pts.length && left > 0; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    angle = Math.atan2(b.y - a.y, b.x - a.x);
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
  return { tip, angle };
}

const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
const accentOf = (color: string | undefined, index: number): Rgb => (color !== undefined ? refine(parseColor(color)) : (THEME.accents[index % THEME.accents.length] as Rgb));

type Env = { ctx: Ctx; view: View; alpha: number; accent: Rgb; px: number; painter: DiagramPainter; dt: number };

/** Draws diagrams, remembering where each piece was last put so a re-layout glides. One per canvas. */
export class DiagramPainter {
  private cur = new Map<string, Px>();
  /** The card a flow was grown to, for the layout it was worked out for (what it holds, its place and the screen): worked out once, not every frame. */
  private grown = new Map<string, { layout: string; card: Px }>();
  private grownLive = new Set<string>();
  /** Where a flow card that has to grow goes: the page finds a free place for its new size (pixels in, pixels out; undefined: stay as it was). */
  private readonly options: { regrow?: (id: string, want: Px) => Px | undefined; onBounds?: (id: string, bounds: Px) => void };
  constructor(options: { regrow?: (id: string, want: Px) => Px | undefined; onBounds?: (id: string, bounds: Px) => void } = {}) {
    this.options = options;
  }
  private last: number | undefined;
  moving = false;

  /** A rectangle that eases toward `target` (the first time it is just there). `key` names it; it is forgotten when not asked for. */
  ease(key: string, target: Px, dt: number, seen: Set<string>): Px {
    seen.add(key);
    const was = this.cur.get(key);
    if (!was) {
      this.cur.set(key, { ...target });
      return target;
    }
    const k = 1 - Math.exp(-Math.max(0, dt) * 10);
    const next = { x: was.x + (target.x - was.x) * k, y: was.y + (target.y - was.y) * k, w: was.w + (target.w - was.w) * k, h: was.h + (target.h - was.h) * k };
    const far = Math.max(Math.abs(target.x - next.x), Math.abs(target.y - next.y), Math.abs(target.w - next.w), Math.abs(target.h - next.h));
    if (far < 0.4) {
      this.cur.set(key, { ...target });
      return target;
    }
    this.moving = true;
    this.cur.set(key, next);
    return next;
  }

  /** Draws every diagram of the frame; `now` is a clock in milliseconds. Returns true while something is still gliding into place. */
  draw(ctx: Ctx, diagrams: readonly DiagramFrame[], view: View, now: number): boolean {
    const dt = this.last === undefined ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.moving = false;
    this.grownLive.clear();
    const seen = new Set<string>();
    for (const d of diagrams) {
      const alpha = Math.max(0, Math.min(1, d.opacity * d.fade));
      if (alpha <= 0.002 || d.appear <= 0) continue;
      ctx.save();
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      try {
        this.one(ctx, d, view, alpha, dt, seen);
      } finally {
        ctx.restore();
      }
    }
    for (const key of [...this.cur.keys()]) if (!seen.has(key)) this.cur.delete(key);
    for (const key of [...this.grown.keys()]) if (!this.grownLive.has(key)) this.grown.delete(key);
    return this.moving;
  }

  /** The card a flow is drawn on, worked out again only when what it holds, its place or the screen changes (growFlow searches sizes and places). */
  private grownFlow(ctx: Ctx, d: DiagramFrame, r0: Px, view: View): Px {
    const key = String(d.key);
    this.grownLive.add(key);
    const layout = JSON.stringify([d.def.title, d.items.map((i) => (i.def.op === 'node' ? [i.id, i.def.text, i.def.note] : i.def.op === 'edge' ? [i.id, i.def.from, i.def.to, i.def.text] : i.id)), [r0.x, r0.y, r0.w, r0.h].map(Math.round), view.width, view.height]);
    const memo = this.grown.get(key);
    if (memo && memo.layout === layout) return memo.card;
    const card = this.growFlow(ctx, d, r0, view);
    this.grown.set(key, { layout, card });
    return card;
  }

  /** The rectangle a flow was placed at, made larger (to the screen's limits) until every node is at least the least readable size. */
  private growFlow(ctx: Ctx, d: DiagramFrame, r0: Px, view: View): Px {
    if (!d.items.some((i) => i.def.op === 'node')) return r0;
    const limit = Math.min(FLOW_GROWTH_MAX, (FLOW_GROWTH_SHARE * view.width) / r0.w, (view.height - 8) / r0.h);
    if (!(limit > 1)) return r0;
    const at = (f: number): Px => {
      const w = Math.min(view.width - 8, r0.w * f), h = Math.min(view.height - 8, r0.h * f);
      const cx = r0.x + r0.w / 2, cy = r0.y + r0.h / 2;
      return { x: Math.max(4, Math.min(view.width - w - 4, cx - w / 2)), y: Math.max(4, Math.min(view.height - h - 4, cy - h / 2)), w, h };
    };
    const readable = (f: number): boolean => {
      const r = at(f);
      const { base, pad } = textSizes(r, view);
      const { area } = titleAndArea(ctx, d, r, base, pad);
      const inputs = flowInputs(ctx, d, base);
      return flowReadable(flowLayout(inputs.ids, inputs.edges, area, { ...inputs.options, pad }), { w: base * FLOW_NODE_LEAST.w, h: base * FLOW_NODE_LEAST.h });
    };
    const f = flowGrowth(readable, limit);
    if (f === undefined) return r0;
    const want = at(f);
    const regrow = this.options.regrow;
    if (!regrow || f === 1) return want;
    // The grown card goes where the page has room for it, not just around where it was.
    return regrow(d.def.id, want) ?? r0;
  }

  private one(ctx: Ctx, d: DiagramFrame, view: View, alpha: number, dt: number, seen: Set<string>): void {
    const theme = THEME;
    const asked = rectOf(d, view);
    // A flow does not go below a readable node size: its card grows (eased, so a late node does not make it jump) until the nodes read.
    const r = d.def.kind === 'flow' ? this.ease(`${d.key}:card`, this.grownFlow(ctx, d, asked, view), dt, seen) : asked;
    this.options.onBounds?.(d.id, r);
    const accent = accentOf(d.color, 0);
    const { base, pad } = textSizes(r, view);
    const slide = (1 - d.appear) * 10;
    ctx.globalAlpha = alpha * Math.min(1, d.appear * 1.5);
    ctx.translate(0, slide);
    // Depth: a wide soft shadow under the card and a tight one at its foot, on a surface a little lighter at the top.
    const glass = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    glass.addColorStop(0, 'rgba(31,39,59,0.96)');
    glass.addColorStop(1, 'rgba(14,19,31,0.96)');
    const radius = theme.radius + 4;
    ctx.shadowColor = d.pulse > 0 ? rgbCss(d.pulseColor !== undefined ? parseColor(d.pulseColor) : accent, 0.9 * d.pulse) : 'rgba(4,8,18,0.46)';
    ctx.shadowBlur = d.pulse > 0 ? 30 * d.pulse : 40;
    ctx.shadowOffsetY = d.pulse > 0 ? 0 : 16;
    ctx.fillStyle = glass;
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.fill();
    if (d.pulse <= 0) {
      ctx.shadowColor = 'rgba(4,8,18,0.34)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, radius);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.stroke();
    // A fine light line along the top edge, as a lit pane has.
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(r.x + radius, r.y + 0.5, Math.max(0, r.w - radius * 2), 1);
    ctx.fillStyle = rgbCss(accent, 1);
    roundRect(ctx, r.x + 1, r.y + pad * 0.95, 3.5, base * 1.5, 1.75);
    ctx.fill();
    const { lines: titleLines, area } = titleAndArea(ctx, d, r, base, pad);
    ctx.font = fontAt(theme.titleFont, base * 1.2);
    ctx.fillStyle = theme.ink;
    ctx.textBaseline = 'alphabetic';
    titleLines.forEach((l, i) => ctx.fillText(l, r.x + pad + 2, r.y + pad + base * 1.2 * (1 + i * 1.05)));
    if (titleLines.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(r.x + pad, area.y - base * 0.32, r.w - pad * 2, 1);
    }
    const env: Env = { ctx, view, alpha: 1, accent, px: base, painter: this, dt };
    ctx.save();
    roundRect(ctx, r.x + 1, r.y + 1, r.w - 2, r.h - 2, theme.radius + 2);
    ctx.clip();
    switch (d.def.kind) {
      case 'flow': drawFlow(env, d, area, pad, seen); break;
      case 'timeline': drawTimeline(env, d, area, pad, seen); break;
      case 'steps': drawSteps(env, d, area, pad, seen); break;
      case 'chart': drawChart(env, d, area, pad); break;
    }
    ctx.restore();
  }
}

/** A diagram's rectangle in pixels, as it was placed and kept on the screen. */
function rectOf(d: DiagramFrame, view: View): Px {
  const r: Px = { x: (d.def.x / 1000) * view.width, y: (d.def.y / 1000) * view.height, w: Math.min((d.def.w / 1000) * view.width, view.width - 8), h: Math.min((d.def.h / 1000) * view.height, view.height - 8) };
  r.x = Math.max(4, Math.min(view.width - r.w - 4, r.x));
  r.y = Math.max(4, Math.min(view.height - r.h - 4, r.y));
  return r;
}

/** One size for the text of the whole diagram, from how much room it has. */
function textSizes(r: Px, view: View): { base: number; pad: number } {
  const scale = Math.max(0.72, Math.min(1.25, Math.min(r.w / 440, r.h / 300)));
  const base = Math.max(12, Math.min(view.height * 0.0215, view.height * 0.0185 * scale));
  return { base, pad: Math.max(10, base * 0.9) };
}

/** The title's lines, and the area under them where the pieces go. */
function titleAndArea(ctx: Ctx, d: DiagramFrame, r: Px, base: number, pad: number): { lines: string[]; area: Px } {
  let top = r.y;
  let lines: string[] = [];
  if (d.def.title) {
    ctx.font = fontAt(THEME.titleFont, base * 1.2);
    lines = wrapLines((s) => ctx.measureText(s).width, d.def.title, r.w - pad * 2 - 2, 2);
    top = r.y + pad + base * 1.2 * (1.05 * lines.length) + base * 0.62;
  }
  return { lines, area: { x: r.x, y: top, w: r.w, h: Math.max(20, r.y + r.h - top) } };
}

/** The least a flow's node may be (times the text size) before its card grows, and how far a card may grow (times its size, and as a share of the screen's width). */
const FLOW_NODE_LEAST = { w: 7, h: 3.2 };
const FLOW_GROWTH_MAX = 2.2;
const FLOW_GROWTH_SHARE = 0.5;

/** What flowLayout is given for a diagram's nodes and edges at a text size. */
function flowInputs(ctx: Ctx, d: DiagramFrame, base: number): { ids: string[]; edges: Array<{ id: string; from: string; to: string; labelW?: number }>; options: { maxBox: { w: number; h: number }; pad: number; labelW: number; labelH: number; notes: boolean } } {
  const nodes = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  const edges = d.items.filter((i): i is DiagramItemFrame & { def: EdgeAction } => i.def.op === 'edge');
  const notes = nodes.some((n) => n.def.note);
  const maxBox = { w: Math.max(80, base * 11), h: Math.max(36, base * (notes ? 4.6 : 3.4)) };
  ctx.font = fontAt(THEME.font, base * 0.78);
  const labelW = Math.max(0, ...edges.map((e) => (e.def.text ? ctx.measureText(e.def.text).width + 12 : 0)));
  return {
    ids: nodes.map((n) => n.id),
    edges: edges.map((e) => ({ id: e.id, from: e.def.from, to: e.def.to, ...(e.def.text ? { labelW: ctx.measureText(e.def.text).width + 12 } : {}) })),
    options: { maxBox, pad: Math.max(10, base * 0.9), labelW, labelH: labelW > 0 ? base * 1.55 : 0, notes },
  };
}

/** The alpha of one piece: it comes in with its own `appear`, and goes with its fade and opacity. */
const pieceAlpha = (it: DiagramItemFrame): number => Math.max(0, Math.min(1, it.opacity * it.fade));

function glow(ctx: Ctx, it: DiagramItemFrame, accent: Rgb): void {
  if (it.pulse > 0) {
    ctx.shadowColor = rgbCss(it.pulseColor !== undefined ? parseColor(it.pulseColor) : accent, 0.95 * it.pulse);
    ctx.shadowBlur = 22 * it.pulse;
  }
}

/** The markers of a stream along the arrow it runs on (the arrow as far as it has been drawn), by the lap count it has run. */
/** An arrow as drawn: its points, how much of it is there, and where its label sits (markers keep off the label). */
type Run = { pts: Pt[]; appear: number; label?: { x0: number; y0: number; x1: number; y1: number } };
function drawStream(env: Env, s: DiagramItemFrame & { def: StreamPiece }, diagramAppear: number, runs: ReadonlyMap<string, Run>): void {
  const run = runs.get(s.def.along);
  const alpha = pieceAlpha(s) * diagramAppear * Math.min(1, s.appear * 1.6);
  if (!run || run.appear <= 0.02 || alpha <= 0.01) return;
  const { ctx } = env;
  const from: Rgb = s.color !== undefined ? refine(parseColor(s.color)) : [240, 244, 250];
  const to = s.def.toColor !== undefined ? refine(parseColor(s.def.toColor)) : undefined;
  const size = Math.max(3, env.px * 0.3);
  const kind = s.def.mark ?? 'dot';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const u of markerPlaces(s.phase ?? 0, s.def.count ?? 5)) {
    const k = markerSize(u);
    if (k <= 0.05) continue;
    const at = polylinePoint(run.pts, u * run.appear);
    const l = run.label;
    if (l && at.x >= l.x0 - size && at.x <= l.x1 + size && at.y >= l.y0 - size && at.y <= l.y1 + size) continue;
    const color = streamColour(from, to, u, s.def.shiftAt ?? 0.5);
    ctx.globalAlpha = alpha * Math.min(1, k * 1.5);
    ctx.fillStyle = rgbCss(color, 1);
    ctx.strokeStyle = 'rgba(10,14,24,0.55)';
    ctx.lineWidth = 1;
    const r = size * k;
    if (kind === 'dot') {
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (kind === 'dash') {
      const dx = Math.cos(at.angle) * r * 1.9, dy = Math.sin(at.angle) * r * 1.9;
      ctx.strokeStyle = rgbCss(color, 1);
      ctx.lineWidth = r * 1.3;
      ctx.beginPath();
      ctx.moveTo(at.x - dx, at.y - dy);
      ctx.lineTo(at.x + dx, at.y + dy);
      ctx.stroke();
    } else {
      const ca = Math.cos(at.angle), sa = Math.sin(at.angle);
      const h = r * 2.2;
      ctx.beginPath();
      ctx.moveTo(at.x + ca * h * 0.6, at.y + sa * h * 0.6);
      ctx.lineTo(at.x - ca * h * 0.4 - sa * h * 0.5, at.y - sa * h * 0.4 + ca * h * 0.5);
      ctx.lineTo(at.x - ca * h * 0.2, at.y - sa * h * 0.2);
      ctx.lineTo(at.x - ca * h * 0.4 + sa * h * 0.5, at.y - sa * h * 0.4 - ca * h * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- Flow ------------------------------------------------------------------------------------------

function drawFlow(env: Env, d: DiagramFrame, area: Px, pad: number, seen: Set<string>): void {
  const { ctx, painter } = env;
  const theme = THEME;
  const nodes = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  const edges = d.items.filter((i): i is DiagramItemFrame & { def: EdgeAction } => i.def.op === 'edge');
  const inputs = flowInputs(ctx, d, env.px);
  const lay = flowLayout(inputs.ids, inputs.edges, area, { ...inputs.options, pad });
  const boxes = new Map<string, FlowBox>();
  for (const n of nodes) {
    const t = lay.nodes.get(n.id);
    if (t) boxes.set(n.id, { ...painter.ease(`${d.key}:${n.key}`, t, env.dt, seen), layer: t.layer, ...(t.row !== undefined ? { row: t.row, ...(t.rev ? { rev: true } : {}) } : {}) });
  }
  // Edges first, so a node sits over the end of its own arrows.
  const runs = new Map<string, Run>();
  edges.forEach((e, k) => {
    const s = boxes.get(e.def.from), t = boxes.get(e.def.to);
    if (!s || !t || e.appear <= 0) return;
    const route = routeEdge(lay.dir, s, t);
    const color = accentOf(e.color, 0);
    const a = pieceAlpha(e) * d.appear;
    const pts = bezierPoints(route.a, route.b, route.c, route.d);
    runs.set(e.id, { pts, appear: easeOut(e.appear) });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    softShadow(ctx);
    ctx.strokeStyle = rgbCss(color, 1);
    ctx.lineWidth = 2.3;
    glow(ctx, e, color);
    const { tip, angle } = strokePartial(ctx, pts, easeOut(e.appear));
    ctx.shadowBlur = 0;
    if (e.appear > 0.55) {
      // A kite-shaped head with rounded corners: a notch at the back so it reads as an arrow, not a wedge.
      const h = Math.max(11, env.px * 0.86);
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const wing = 0.46, notch = 0.62;
      ctx.fillStyle = rgbCss(color, 1);
      ctx.strokeStyle = rgbCss(color, 1);
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - h * Math.cos(angle - wing), tip.y - h * Math.sin(angle - wing));
      ctx.lineTo(tip.x - h * notch * ca, tip.y - h * notch * sa);
      ctx.lineTo(tip.x - h * Math.cos(angle + wing), tip.y - h * Math.sin(angle + wing));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (e.def.text && e.appear > 0.7) {
      const px = env.px * 0.78;
      ctx.font = fontAt(theme.font, px);
      const tw = ctx.measureText(e.def.text).width;
      const own = runs.get(e.id);
      if (own) own.label = { x0: route.mid.x - tw / 2 - 8, y0: route.mid.y - px * 0.8, x1: route.mid.x + tw / 2 + 8, y1: route.mid.y + px * 0.8 };
      ctx.globalAlpha = a * Math.min(1, (e.appear - 0.7) / 0.3);
      ctx.fillStyle = 'rgba(19,25,39,0.97)';
      roundRect(ctx, route.mid.x - tw / 2 - 8, route.mid.y - px * 0.8, tw + 16, px * 1.6, px * 0.8);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgbCss(color, 0.42);
      ctx.stroke();
      ctx.fillStyle = 'rgba(232,238,248,0.96)';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.def.text, route.mid.x - tw / 2, route.mid.y + px * 0.04);
    }
    ctx.restore();
    void k;
  });
  for (const s of d.items) if (s.def.op === 'stream') drawStream(env, s as DiagramItemFrame & { def: StreamPiece }, d.appear, runs);
  nodes.forEach((n, i) => {
    const b = boxes.get(n.id);
    if (!b || n.appear <= 0) return;
    const color = accentOf(n.color, n.color === undefined ? 0 : i);
    const a = pieceAlpha(n) * d.appear;
    const grow = 0.9 + 0.1 * easeOut(n.appear);
    ctx.save();
    ctx.globalAlpha = a * Math.min(1, n.appear * 1.6);
    const mx = b.x + b.w / 2, my = b.y + b.h / 2;
    ctx.translate(mx, my);
    ctx.scale(grow, grow);
    ctx.translate(-mx, -my);
    const nodeRadius = Math.min(13, b.h * 0.34);
    if (n.pulse > 0) glow(ctx, n, color);
    else {
      ctx.shadowColor = 'rgba(4,8,18,0.42)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
    }
    // A node is a small lit pane of its own colour: tinted at the top, deeper at the foot, with a fine light line along its top edge.
    const pane = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    pane.addColorStop(0, rgbCss(color, 0.30));
    pane.addColorStop(1, rgbCss(color, 0.11));
    ctx.fillStyle = 'rgba(14,19,31,0.9)';
    roundRect(ctx, b.x, b.y, b.w, b.h, nodeRadius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = pane;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = rgbCss(color, 0.9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(b.x + nodeRadius, b.y + 1.2, Math.max(0, b.w - nodeRadius * 2), 1);
    textInBox(ctx, n.def.text, n.def.note, b, env.px, theme.ink, theme.muted);
    ctx.restore();
  });
}

/**
 * Centred text (and an optional smaller note under it) fitted inside a box: the size comes down until both fit. The note is never left
 * out for want of room (it is the point of some boxes): in a short box the text and the note both go small, down to 9 px, and last
 * of all the text is cut to one line, and the note still stands in full (a hair over the box before a word of it is lost).
 */
function textInBox(ctx: Ctx, text: string, note: string | undefined, b: Px, basePx: number, ink: string, muted: string): void {
  const innerW = b.w - 14;
  const wrapAt = (font: string, s: string, max: number): string[] => wrapLines((t) => { ctx.font = font; return ctx.measureText(t).width; }, s, innerW, max);
  const fitAt = (px: number, noteMax: number, textMax = 3): { lines: string[]; noteLines: string[]; notePx: number; ok: boolean } => {
    const notePx = Math.max(9, px * 0.82);
    const lines = wrapAt(fontAt(THEME.font, px), text, textMax);
    const noteLines = note ? wrapAt(fontAt(THEME.font, notePx), note, noteMax) : [];
    ctx.font = fontAt(THEME.font, px);
    const wide = lines.every((l) => ctx.measureText(l).width <= innerW);
    return { lines, noteLines, notePx, ok: wide && lines.length * px * 1.2 + noteLines.length * notePx * 1.2 <= b.h - 6 };
  };
  let px = Math.max(9, Math.min(basePx * 1.08, b.h * 0.37));
  let fit = fitAt(px, 2);
  for (; !fit.ok && px > 9; ) {
    px = Math.max(9, px - 1);
    fit = fitAt(px, 2);
  }
  if (!fit.ok && note) fit = fitAt(9, 2, 1);
  const { lines, noteLines, notePx } = fit;
  const total = lines.length * px * 1.2 + noteLines.length * notePx * 1.2;
  let y = b.y + (b.h - total) / 2 + px * 0.95;
  ctx.textBaseline = 'alphabetic';
  ctx.font = fontAt(THEME.font, px);
  ctx.fillStyle = ink;
  for (const l of lines) {
    ctx.fillText(l, b.x + b.w / 2 - ctx.measureText(l).width / 2, y);
    y += px * 1.2;
  }
  ctx.font = fontAt(THEME.font, notePx);
  ctx.fillStyle = muted;
  for (const l of noteLines) {
    ctx.fillText(l, b.x + b.w / 2 - ctx.measureText(l).width / 2, y);
    y += notePx * 1.2;
  }
}

// ---- Timeline --------------------------------------------------------------------------------------

function drawTimeline(env: Env, d: DiagramFrame, area: Px, pad: number, seen: Set<string>): void {
  const { ctx } = env;
  const theme = THEME;
  const events = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  if (events.length === 0) return;
  const measureAt = (font: string) => (t: string): number => { ctx.font = font; return ctx.measureText(t).width; };
  type Label = { when: string[]; text: string[]; note: string[]; w: number; h: number };
  const build = (px: number): { labels: Map<string, Label>; lay: ReturnType<typeof timelineLayout> } => {
  const whenPx = px * 1.08, textPx = px, notePx = px * 0.84;
  // Each label: its lines and size, wrapped to a width that leaves room for the others.
  // Along a tall area the labels stand to the right of the axis and may use most of the width; along a wide one they share it.
  const tall = area.w - 2 * pad < (area.h - 2 * pad) * 0.9;
  const maxW = tall ? Math.max(70, (area.w - 2 * pad) * 0.7 - 20) : Math.max(70, Math.min(area.w * 0.3, px * 15));
  const labels = new Map<string, Label>();
  for (const e of events) {
    const when = e.def.when ? wrapLines(measureAt(fontAt(theme.titleFont, whenPx)), e.def.when, maxW, 1) : [];
    const text = wrapLines(measureAt(fontAt(theme.font, textPx)), e.def.text, maxW, tall ? 5 : 3);
    const note = e.def.note ? wrapLines(measureAt(fontAt(theme.font, notePx)), e.def.note, maxW, 2) : [];
    let w = 0;
    for (const l of when) w = Math.max(w, measureAt(fontAt(theme.titleFont, whenPx))(l));
    for (const l of text) w = Math.max(w, measureAt(fontAt(theme.font, textPx))(l));
    for (const l of note) w = Math.max(w, measureAt(fontAt(theme.font, notePx))(l));
    labels.set(e.id, { when, text, note, w: w + 4, h: when.length * whenPx * 1.25 + text.length * textPx * 1.22 + note.length * notePx * 1.2 + 2 });
  }
  const lay = timelineLayout(events.map((e) => ({ id: e.id, ...(e.def.pos !== undefined ? { pos: e.def.pos } : {}) })), area, pad, (id) => labels.get(id) ?? { w: 40, h: 20 });
  return { labels, lay };
  };
  // If the labels do not fit the room, the text comes down a size at a time (to a floor) until they do.
  let px = env.px * 1.02;
  let made = build(px);
  for (let tries = 0; made.lay.overflow && px > env.px * 0.62 && tries < 6; tries++) {
    px *= 0.92;
    made = build(px);
  }
  const { labels, lay } = made;
  const whenPx = px * 1.08, textPx = px, notePx = px * 0.84;
  // The axis draws on along with the diagram.
  ctx.save();
  ctx.globalAlpha = d.appear * 0.9;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lay.axis.a.x, lay.axis.a.y);
  ctx.lineTo(lay.axis.b.x, lay.axis.b.y);
  ctx.stroke();
  ctx.restore();
  events.forEach((e, i) => {
    const slot = lay.events.get(e.id);
    const label = labels.get(e.id);
    if (!slot || !label || e.appear <= 0) return;
    const dotBox = env.painter.ease(`${d.key}:${e.key}`, { x: slot.dot.x, y: slot.dot.y, w: 0, h: 0 }, env.dt, seen);
    const dot = { x: dotBox.x, y: dotBox.y };
    const rect = env.painter.ease(`${d.key}:${e.key}:label`, slot.rect, env.dt, seen);
    const color = accentOf(e.color, e.color === undefined ? 0 : i);
    const a = pieceAlpha(e) * d.appear;
    ctx.save();
    glow(ctx, e, color);
    const pop = easeOut(e.appear / 0.5);
    ctx.globalAlpha = a;
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 8 * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgbCss(color, 1);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, 5.2 * pop, 0, Math.PI * 2);
    ctx.fill();
    const show = easeOut((e.appear - 0.35) / 0.65);
    if (show > 0) {
      ctx.globalAlpha = a * show;
      // The stem from the dot to the label.
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (lay.horizontal) {
        ctx.moveTo(dot.x, dot.y + slot.side * 8);
        ctx.lineTo(dot.x, slot.side === -1 ? rect.y + rect.h + 2 : rect.y - 2);
      } else {
        ctx.moveTo(dot.x + 8, dot.y);
        ctx.lineTo(rect.x - 3, Math.max(rect.y + 6, Math.min(rect.y + rect.h - 6, dot.y)));
      }
      ctx.stroke();
      ctx.textBaseline = 'alphabetic';
      let y = rect.y;
      const center = lay.horizontal;
      const put = (l: string, font: string, ink: string, size: number, lead: number): void => {
        ctx.font = font;
        ctx.fillStyle = ink;
        y += size * lead * 0.82;
        const w = ctx.measureText(l).width;
        ctx.fillText(l, center ? rect.x + (rect.w - w) / 2 : rect.x, y);
        y += size * lead * 0.18;
      };
      for (const l of label.when) put(l, fontAt(theme.titleFont, whenPx), rgbCss(color, 1), whenPx, 1.25);
      for (const l of label.text) put(l, fontAt(theme.font, textPx), theme.ink, textPx, 1.22);
      for (const l of label.note) put(l, fontAt(theme.font, notePx), theme.muted, notePx, 1.2);
    }
    ctx.restore();
  });
}

// ---- Steps -----------------------------------------------------------------------------------------

function drawSteps(env: Env, d: DiagramFrame, area: Px, pad: number, seen: Set<string>): void {
  const { ctx } = env;
  const theme = THEME;
  const steps = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  if (steps.length === 0) return;
  const lay = stepsLayout(steps.length, area, pad, env.px * 4.4);
  steps.forEach((s, i) => {
    const target = lay.rows[i];
    if (!target || s.appear <= 0) return;
    const row = env.painter.ease(`${d.key}:${s.key}`, target, env.dt, seen);
    const color = accentOf(s.color, i);
    const a = pieceAlpha(s) * d.appear;
    const done = s.done;
    ctx.save();
    ctx.globalAlpha = a * Math.min(1, s.appear * 1.6);
    ctx.translate((1 - easeOut(s.appear)) * -8, 0);
    glow(ctx, s, color);
    const r = Math.max(9, Math.min(row.h * 0.32, env.px * 0.95));
    const cx = row.x + r + 2, cy = row.y + row.h / 2;
    ctx.fillStyle = done > 0 ? rgbCss(GREEN, done) : 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = done > 0.5 ? rgbCss(GREEN, 1) : rgbCss(color, 1);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textBaseline = 'middle';
    if (done > 0.5) {
      ctx.strokeStyle = '#10141c';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
      ctx.lineTo(cx + r * 0.44, cy - r * 0.32);
      ctx.stroke();
    } else {
      ctx.font = fontAt(theme.titleFont, r * 1.1);
      ctx.fillStyle = theme.ink;
      const n = String(i + 1);
      ctx.fillText(n, cx - ctx.measureText(n).width / 2, cy + r * 0.05);
    }
    const x = cx + r + env.px * 0.7;
    const innerW = row.x + row.w - x - 4;
    const px = Math.min(env.px * 1.02, row.h * 0.4);
    const notePx = px * 0.82;
    const measure = (font: string) => (t: string): number => { ctx.font = font; return ctx.measureText(t).width; };
    const text = wrapLines(measure(fontAt(theme.font, px)), s.def.text, innerW, row.h > px * 3.2 ? 2 : 1);
    const note = s.def.note && row.h > px * (text.length * 1.25 + 1.9) ? wrapLines(measure(fontAt(theme.font, notePx)), s.def.note, innerW, 1) : [];
    const total = text.length * px * 1.22 + note.length * notePx * 1.2;
    let y = cy - total / 2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = done > 0.5 ? theme.muted : theme.ink;
    ctx.font = fontAt(theme.font, px);
    for (const l of text) {
      y += px * 1.0;
      ctx.fillText(l, x, y);
      y += px * 0.22;
    }
    ctx.font = fontAt(theme.font, notePx);
    ctx.fillStyle = theme.muted;
    for (const l of note) {
      y += notePx * 1.0;
      ctx.fillText(l, x, y);
      y += notePx * 0.2;
    }
    ctx.restore();
  });
}

// ---- Chart -----------------------------------------------------------------------------------------

function drawChart(env: Env, d: DiagramFrame, area: Px, pad: number): void {
  const { ctx } = env;
  const theme = THEME;
  const series = d.items.filter((i): i is DiagramItemFrame & { def: SeriesAction } => i.def.op === 'series');
  const dots = d.items.filter((i): i is DiagramItemFrame & { def: DotAction } => i.def.op === 'dot');
  const tickPx = env.px * 0.78;
  ctx.font = fontAt(theme.font, tickPx);
  const probe = chartLayout(
    { series: series.map((s) => ({ pts: s.def.pts as Array<[number, number]> })), dots: dots.map((p) => ({ x: p.def.x, y: p.def.y })), ...(d.def.xrange ? { xrange: d.def.xrange } : {}), ...(d.def.yrange ? { yrange: d.def.yrange } : {}) },
    area, { left: 40, bottom: 30, top: 8, right: 20 },
  );
  const yLabelW = Math.max(0, ...probe.yTicks.map((t) => ctx.measureText(formatTick(t.v)).width));
  const labelRoom = Math.max(0, ...series.map((s) => (s.def.label ? Math.min(area.w * 0.28, ctx.measureText(s.def.label).width + 10) : 0)));
  const room = {
    left: pad * 0.6 + yLabelW + (d.def.ylabel ? tickPx * 1.5 : 0) + 8,
    bottom: tickPx * 2 + (d.def.xlabel ? tickPx * 1.6 : 0) + 6,
    top: 10,
    right: Math.max(18, labelRoom),
  };
  const lay = chartLayout(
    { series: series.map((s) => ({ pts: s.def.pts as Array<[number, number]> })), dots: dots.map((p) => ({ x: p.def.x, y: p.def.y })), ...(d.def.xrange ? { xrange: d.def.xrange } : {}), ...(d.def.yrange ? { yrange: d.def.yrange } : {}) },
    area, room,
  );
  const { plot } = lay;
  ctx.save();
  ctx.globalAlpha = d.appear;
  // Grid and axes.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  for (const t of lay.yTicks) { ctx.moveTo(plot.x, t.px); ctx.lineTo(plot.x + plot.w, t.px); }
  for (const t of lay.xTicks) { ctx.moveTo(t.px, plot.y); ctx.lineTo(t.px, plot.y + plot.h); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();
  ctx.fillStyle = theme.muted;
  ctx.font = fontAt(theme.font, tickPx);
  ctx.textBaseline = 'middle';
  for (const t of lay.yTicks) {
    const s = formatTick(t.v);
    ctx.fillText(s, plot.x - 6 - ctx.measureText(s).width, t.px);
  }
  ctx.textBaseline = 'alphabetic';
  for (const t of lay.xTicks) {
    const s = formatTick(t.v);
    ctx.fillText(s, t.px - ctx.measureText(s).width / 2, plot.y + plot.h + tickPx * 1.45);
  }
  ctx.font = fontAt(theme.font, tickPx * 1.05);
  ctx.fillStyle = theme.ink;
  if (d.def.xlabel) ctx.fillText(d.def.xlabel, plot.x + plot.w / 2 - ctx.measureText(d.def.xlabel).width / 2, plot.y + plot.h + tickPx * 3.2);
  if (d.def.ylabel) {
    ctx.save();
    ctx.translate(area.x + pad * 0.6 + tickPx * 0.5, plot.y + plot.h / 2 + ctx.measureText(d.def.ylabel).width / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(d.def.ylabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  // Lines and curves, drawn along from their first point; they stay inside the plot.
  series.forEach((s, i) => {
    if (s.appear <= 0) return;
    const color = accentOf(s.color, i);
    const px = s.def.pts.map(([x, y]) => lay.toPx(x, y));
    const pts = s.def.curve ? smoothPoints(px) : px;
    const a = pieceAlpha(s) * d.appear;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x - 2, plot.y - 4, plot.w + 4, plot.h + 8);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    softShadow(ctx);
    ctx.strokeStyle = rgbCss(color, 1);
    ctx.lineWidth = 2.2;
    glow(ctx, s, color);
    const { tip } = strokePartial(ctx, pts, easeOut(s.appear));
    ctx.restore();
    if (s.def.label && s.appear > 0.8) {
      ctx.save();
      ctx.globalAlpha = a * Math.min(1, (s.appear - 0.8) / 0.2);
      ctx.font = fontAt(theme.titleFont, tickPx * 1.1);
      ctx.fillStyle = rgbCss(color, 1);
      ctx.textBaseline = 'middle';
      const end = pts[pts.length - 1]!;
      const w = ctx.measureText(s.def.label).width;
      const x = end.x + 8 + w <= area.x + area.w - 4 ? end.x + 8 : end.x - 8 - w;
      ctx.fillText(s.def.label, x, Math.max(plot.y + 6, Math.min(plot.y + plot.h - 6, end.y - (x < end.x ? 12 : 0))));
      ctx.restore();
    }
    void tip;
  });
  dots.forEach((p, i) => {
    if (p.appear <= 0) return;
    const color = accentOf(p.color, series.length + i);
    const c = lay.toPx(p.def.x, p.def.y);
    const a = pieceAlpha(p) * d.appear;
    const pop = easeOut(p.appear / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    glow(ctx, p, color);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6.5 * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = rgbCss(color, 1);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3.6 * pop, 0, Math.PI * 2);
    ctx.fill();
    if (p.def.text && p.appear > 0.5) {
      ctx.globalAlpha = a * Math.min(1, (p.appear - 0.5) / 0.5);
      const px = tickPx * 1.05;
      ctx.font = fontAt(theme.font, px);
      const w = ctx.measureText(p.def.text).width;
      // Beside the dot, on the side with room, kept inside the diagram.
      const right = c.x + 12 + w + 12 <= area.x + area.w - 4;
      const lx = right ? c.x + 12 : c.x - 12 - w - 12;
      const above = c.y - px * 1.6 > area.y;
      const ly = above ? c.y - px * 1.4 : c.y + px * 0.2;
      ctx.fillStyle = theme.surface;
      roundRect(ctx, lx, ly, w + 12, px * 1.5, px * 0.7);
      ctx.fill();
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = theme.ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(p.def.text, lx + 6, ly + px * 0.78);
    }
    ctx.restore();
  });
}
