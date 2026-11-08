// Draws the flat diagrams (flow, timeline, steps, chart) on the marks canvas in the look of the cards and tags: dark glass,
// a coloured accent, thin light lines. Everything is in CSS pixels inside the diagram's own rectangle. Where pieces
// go comes from diagram-layout.ts; a piece that is moved by a later arrival eases to its new place instead of jumping.

import type { DiagramFrame, DiagramItemFrame } from './diagram-plan.ts';
import { bezierPoints, chartDotLabelPlacements, chartLayout, flowGrowth, flowLayout, flowReadable, formatTick, smoothPoints, stepsLayout, timelineLayout, routeEdge } from './diagram-layout.ts';
import type { ChartDotLabel, FlowBox, FlowLayout, Pt, Px } from './diagram-layout.ts';
import type { View } from './marks.ts';
import { FROST, THEME, discWithNumber, fontAt, frostAccent, onAccent } from './theme.ts';
import type { Face, FrostFace } from './theme.ts';
import { parseColor, rgbCss } from './timeline.ts';
import { refine } from './style.ts';
import type { Rgb } from './timeline.ts';
import { markerPlaces, markerSize, polylinePoint, streamColour } from './stream.ts';
import type { EdgeAction, NodeAction, SeriesAction, DotAction, StreamPiece } from '../scene/types.ts';

type Ctx = CanvasRenderingContext2D;


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
/** An item's accent: the colour the scene named, else the next of Frost's accents in turn (blue, teal, violet, amber, rose). */
const accentOf = (color: string | undefined, index: number): Rgb => (color !== undefined ? refine(parseColor(color)) : frostAccent(index));

type Env = { ctx: Ctx; view: View; alpha: number; accent: Rgb; px: number; painter: DiagramPainter; dt: number; face: Face; tone: FrostFace };

/** The radius of a panel's corners: round, in proportion to the panel (a small card is not a pill). */
const panelRadius = (r: Px): number => Math.max(14, Math.min(28, Math.min(r.w, r.h) * 0.075));

export type DiagramPainterOptions = {
  regrow?: (id: string, want: Px) => Px | undefined;
  onBounds?: (id: string, bounds: Px) => void;
  /** The face a panel wears (light or dark), from the page under it; without it every panel is dark. `key` names the panel, so it keeps its face. */
  faceOf?: (key: string, rect: Px) => Face;
};

/** Draws diagrams, remembering where each piece was last put so a re-layout glides. One per canvas. */
export class DiagramPainter {
  private cur = new Map<string, Px>();
  /** The card a flow was grown to, for the layout it was worked out for (what it holds, its place and the screen): worked out once, not every frame. */
  private grown = new Map<string, { layout: string; card: Px }>();
  private grownLive = new Set<string>();
  private flowRouting = new Map<number, { topology: string; slots: Map<string, string>; revision: number }>();
  private flowLive = new Set<number>();
  /** Which size and wrapping a timeline's labels were fitted at, for the labels and room they were worked out for; and the timelines drawn this frame. */
  readonly timelineChoices = new Map<number, { signature: string; index: number }>();
  readonly timelineLive = new Set<number>();
  /** Where a flow card that has to grow goes: the page finds a free place for its new size (pixels in, pixels out; undefined: stay as it was). */
  private readonly options: DiagramPainterOptions;
  constructor(options: DiagramPainterOptions = {}) {
    this.options = options;
  }
  private last: number | undefined;
  moving = false;

  /** Reset node easing when an edge change actually moves an existing node to a different graph slot. */
  flowRevision(key: number, edges: readonly { from: string; to: string }[], layout: FlowLayout, area: Px): number {
    this.flowLive.add(key);
    const topology = JSON.stringify(edges.map((e) => JSON.stringify([e.from, e.to])).sort());
    const ranks = new Map<string, number>(), slots = new Map<string, string>();
    for (const [id, box] of layout.nodes) {
      const group = `${box.layer}:${box.row ?? ''}:${box.rev ? 1 : 0}`;
      const rank = ranks.get(group) ?? 0;
      ranks.set(group, rank + 1);
      // Normalized geometry catches a topology-driven change in spacing even
      // when each node remains in the same layer; ordinary resize still eases
      // because a revision also requires a change in edge topology.
      const norm = [box.x - area.x, box.y - area.y, box.w, box.h].map((n, i) => Math.round(10000 * n / Math.max(1, i % 2 ? area.h : area.w)));
      slots.set(id, `${group}:${rank}:${norm.join(':')}`);
    }
    const before = this.flowRouting.get(key);
    const changedSlot = before && [...slots].some(([id, slot]) => before.slots.has(id) && before.slots.get(id) !== slot);
    const revision = (before?.revision ?? 0) + (before && before.topology !== topology && changedSlot ? 1 : 0);
    this.flowRouting.set(key, { topology, slots, revision });
    return revision;
  }

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
    this.flowLive.clear();
    this.timelineLive.clear();
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
    for (const key of [...this.flowRouting.keys()]) if (!this.flowLive.has(key)) this.flowRouting.delete(key);
    for (const key of [...this.timelineChoices.keys()]) if (!this.timelineLive.has(key)) this.timelineChoices.delete(key);
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
    const face = this.options.faceOf?.(`d${d.key}`, r) ?? 'dark';
    const tone = FROST[face];
    const accent = accentOf(d.color, 0);
    const { base, pad } = textSizes(r, view);
    const slide = (1 - d.appear) * 10;
    ctx.globalAlpha = alpha * Math.min(1, d.appear * 1.5);
    ctx.translate(0, slide);
    // Frost: a rounded pane of frosted glass in the face of the page under it, a wide soft shadow under it and a tight one at its foot.
    const glass = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    glass.addColorStop(0, tone.panelTop);
    glass.addColorStop(1, tone.panelFoot);
    const radius = panelRadius(r);
    ctx.shadowColor = d.pulse > 0 ? rgbCss(d.pulseColor !== undefined ? parseColor(d.pulseColor) : accent, 0.9 * d.pulse) : tone.shadow;
    ctx.shadowBlur = d.pulse > 0 ? 30 * d.pulse : 44;
    ctx.shadowOffsetY = d.pulse > 0 ? 0 : 18;
    ctx.fillStyle = glass;
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.fill();
    if (d.pulse <= 0) {
      ctx.shadowColor = tone.ring;
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, r.x, r.y, r.w, r.h, radius);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = tone.ring;
    roundRect(ctx, r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1, radius + 0.5);
    ctx.stroke();
    ctx.strokeStyle = tone.border;
    roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, radius - 0.5);
    ctx.stroke();
    const { lines: titleLines, area } = titleAndArea(ctx, d, r, base, pad);
    ctx.font = fontAt(theme.titleFont, base * 1.2);
    ctx.fillStyle = tone.ink;
    ctx.textBaseline = 'alphabetic';
    titleLines.forEach((l, i) => ctx.fillText(l, r.x + pad + 4, r.y + pad + base * 1.2 * (1 + i * 1.05)));
    const env: Env = { ctx, view, alpha: 1, accent, px: base, painter: this, dt, face, tone };
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
  // Routing changes sides when the flow turns or wraps. Do not interpolate boxes from the old
  // arrangement under those new arrows: their labels would run through the moving nodes.
  // A new routing key places the nodes together; ordinary movement in one arrangement still eases.
  const revision = painter.flowRevision(d.key, inputs.edges, lay, area);
  const routing = `${lay.dir}:${lay.rows}:${lay.rows > 1 ? Math.ceil(lay.layers / lay.rows) : 0}:${revision}`;
  const boxes = new Map<string, FlowBox>();
  for (const n of nodes) {
    const t = lay.nodes.get(n.id);
    if (t) boxes.set(n.id, { ...painter.ease(`${d.key}:${n.key}:${routing}`, t, env.dt, seen), layer: t.layer, ...(t.row !== undefined ? { row: t.row, ...(t.rev ? { rev: true } : {}) } : {}) });
  }
  const { tone } = env;
  const colorOf = new Map<string, Rgb>(nodes.map((n, i) => [n.id, accentOf(n.color, i)]));
  const lineW = Math.max(2.6, env.px * 0.27);
  const dotR = Math.max(4.2, env.px * 0.42);
  // Edges first, so a node sits over the end of its own arrows.
  const runs = new Map<string, Run>();
  edges.forEach((e, k) => {
    const s = boxes.get(e.def.from), t = boxes.get(e.def.to);
    if (!s || !t || e.appear <= 0) return;
    const route = routeEdge(lay.dir, s, t);
    const from = e.color !== undefined ? accentOf(e.color, 0) : (colorOf.get(e.def.from) ?? accentOf(undefined, k));
    const to = e.color !== undefined ? from : (colorOf.get(e.def.to) ?? from);
    const a = pieceAlpha(e) * d.appear;
    const pts = bezierPoints(route.a, route.b, route.c, route.d);
    runs.set(e.id, { pts, appear: easeOut(e.appear) });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    // A thick rounded connector that runs from the colour of the node it leaves to the colour of the node it reaches, and ends in a dot.
    if (Math.hypot(route.d.x - route.a.x, route.d.y - route.a.y) > 1) {
      const grad = ctx.createLinearGradient(route.a.x, route.a.y, route.d.x, route.d.y);
      grad.addColorStop(0, rgbCss(from, 0.8));
      grad.addColorStop(1, rgbCss(to, 0.8));
      ctx.strokeStyle = grad;
    } else ctx.strokeStyle = rgbCss(to, 0.8);
    ctx.lineWidth = lineW;
    glow(ctx, e, to);
    const { tip, angle } = strokePartial(ctx, pts, easeOut(e.appear));
    ctx.shadowBlur = 0;
    if (e.appear > 0.55) {
      // The dot sits a little back from the tip, on the line, so it is not hidden by the node the line runs under. An arrow still being drawn has none yet.
      ctx.fillStyle = rgbCss(to, 1);
      ctx.beginPath();
      ctx.arc(tip.x - Math.cos(angle) * dotR * 1.1, tip.y - Math.sin(angle) * dotR * 1.1, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
    if (e.def.text && e.appear > 0.7) {
      const px = env.px * 0.78;
      ctx.font = fontAt(theme.font, px);
      const tw = ctx.measureText(e.def.text).width;
      const own = runs.get(e.id);
      if (own) own.label = { x0: route.mid.x - tw / 2 - 8, y0: route.mid.y - px * 0.8, x1: route.mid.x + tw / 2 + 8, y1: route.mid.y + px * 0.8 };
      ctx.globalAlpha = a * Math.min(1, (e.appear - 0.7) / 0.3);
      ctx.fillStyle = tone.chip;
      roundRect(ctx, route.mid.x - tw / 2 - 8, route.mid.y - px * 0.8, tw + 16, px * 1.6, px * 0.8);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = tone.chipLine;
      ctx.stroke();
      ctx.fillStyle = tone.muted;
      ctx.textBaseline = 'middle';
      ctx.fillText(e.def.text, route.mid.x - tw / 2, route.mid.y + px * 0.04);
    }
    ctx.restore();
  });
  for (const s of d.items) if (s.def.op === 'stream') drawStream(env, s as DiagramItemFrame & { def: StreamPiece }, d.appear, runs);
  nodes.forEach((n, i) => {
    const b = boxes.get(n.id);
    if (!b || n.appear <= 0) return;
    const color = colorOf.get(n.id) as Rgb;
    const a = pieceAlpha(n) * d.appear;
    const grow = 0.9 + 0.1 * easeOut(n.appear);
    ctx.save();
    ctx.globalAlpha = a * Math.min(1, n.appear * 1.6);
    const mx = b.x + b.w / 2, my = b.y + b.h / 2;
    ctx.translate(mx, my);
    ctx.scale(grow, grow);
    ctx.translate(-mx, -my);
    // A node is a tinted capsule of its own colour with a fine line of that colour round it, and its number in a disc of the colour.
    const nodeRadius = Math.min(26, b.h * 0.32);
    if (n.pulse > 0) glow(ctx, n, color);
    ctx.fillStyle = rgbCss(color, tone.tint);
    roundRect(ctx, b.x, b.y, b.w, b.h, nodeRadius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgbCss(color, tone.tintLine);
    ctx.stroke();
    const lp = Math.max(8, b.h * 0.19), br = Math.max(7, Math.min(14, b.h * 0.19));
    // A capsule too narrow for a disc and its words keeps the words (centred) and drops the disc.
    if (b.w >= (lp + br) * 2 + env.px * 4.2) {
      const cx = b.x + lp + br, cy = b.y + b.h / 2;
      discWithNumber(ctx, cx, cy, br, color, String(i + 1));
      const x0 = cx + br + lp * 0.7;
      textInBox(ctx, n.def.text, n.def.note, { x: x0, y: b.y, w: b.x + b.w - x0 - lp * 0.6, h: b.h }, env.px, tone.ink, tone.muted, 'left');
    } else textInBox(ctx, n.def.text, n.def.note, b, env.px, tone.ink, tone.muted);
    ctx.restore();
  });
}

/**
 * Centred text (and an optional smaller note under it) fitted inside a box: the size comes down until both fit. The note is never left
 * out for want of room (it is the point of some boxes): in a short box the text and the note both go small, down to 9 px, and last
 * of all the text is cut to one line, and the note still stands in full (a hair over the box before a word of it is lost).
 */
function textInBox(ctx: Ctx, text: string, note: string | undefined, b: Px, basePx: number, ink: string, muted: string, align: 'center' | 'left' = 'center'): void {
  const innerW = b.w - (align === 'left' ? 4 : 14);
  const startX = (w: number): number => (align === 'left' ? b.x : b.x + b.w / 2 - w / 2);
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
    ctx.fillText(l, startX(ctx.measureText(l).width), y);
    y += px * 1.2;
  }
  ctx.font = fontAt(THEME.font, notePx);
  ctx.fillStyle = muted;
  for (const l of noteLines) {
    ctx.fillText(l, startX(ctx.measureText(l).width), y);
    y += notePx * 1.2;
  }
}

// ---- Timeline --------------------------------------------------------------------------------------

function drawTimeline(env: Env, d: DiagramFrame, area: Px, pad: number, seen: Set<string>): void {
  const { ctx, tone } = env;
  const theme = THEME;
  const events = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  if (events.length === 0) return;
  const measureAt = (font: string) => (t: string): number => { ctx.font = font; return ctx.measureText(t).width; };
  type Label = { when: string[]; text: string[]; note: string[]; w: number; h: number; pillW: number; inline: boolean };
  // In a short panel the date sits in its pill beside the event (when the event is one short line), instead of in a row of its own.
  const build = (px: number, compact: boolean, wrap: number): { labels: Map<string, Label>; lay: ReturnType<typeof timelineLayout> } => {
  const whenPx = px * 0.92, textPx = px, notePx = px * 0.84;
  // A label is a tinted chip: a pill with the date, then the event and its note, with room round them.
  const padX = Math.max(10, px * 0.95), padY = Math.max(compact ? 6 : 8, px * (compact ? 0.5 : 0.7)), pillH = whenPx * 1.75, pillGap = px * 0.4;
  // Each label: its lines and size, wrapped to a width that leaves room for the others.
  // Along a tall area the labels stand to the right of the axis and may use most of the width; along a wide one they share it.
  const tall = area.w - 2 * pad < (area.h - 2 * pad) * 0.9;
  const maxW = tall ? Math.max(70, (area.w - 2 * pad) * 0.7 - 20 - 2 * padX) : Math.max(70, Math.min(area.w * 0.3, px * 15) * wrap - 2 * padX);
  const labels = new Map<string, Label>();
  for (const e of events) {
    const when = e.def.when ? wrapLines(measureAt(fontAt(theme.titleFont, whenPx)), e.def.when, maxW, 1) : [];
    const text = wrapLines(measureAt(fontAt(theme.font, textPx)), e.def.text, maxW, tall ? 5 : 3);
    // A narrower wrap makes more lines, so the note may have a third: it is cut only when nothing is left of its room.
    const note = e.def.note ? wrapLines(measureAt(fontAt(theme.font, notePx)), e.def.note, maxW, wrap < 1 ? 3 : 2) : [];
    let w = 0, pillW = 0;
    for (const l of when) { pillW = measureAt(fontAt(theme.titleFont, whenPx))(l) + whenPx * 1.4; w = Math.max(w, pillW); }
    for (const l of text) w = Math.max(w, measureAt(fontAt(theme.font, textPx))(l));
    for (const l of note) w = Math.max(w, measureAt(fontAt(theme.font, notePx))(l));
    const textW = Math.max(0, ...text.map(measureAt(fontAt(theme.font, textPx))));
    const inline = compact && when.length > 0 && text.length === 1 && pillW + pillGap + textW <= maxW;
    if (inline) w = Math.max(pillW + pillGap + textW, ...note.map(measureAt(fontAt(theme.font, notePx))));
    labels.set(e.id, { when, text, note, pillW, inline, w: w + 4 + 2 * padX, h: 2 * padY + (inline ? Math.max(pillH, textPx * 1.22) : (when.length > 0 ? pillH + pillGap : 0) + text.length * textPx * 1.22) + note.length * notePx * 1.2 + 2 });
  }
  const lay = timelineLayout(events.map((e) => ({ id: e.id, ...(e.def.pos !== undefined ? { pos: e.def.pos } : {}) })), area, pad, (id) => labels.get(id) ?? { w: 40, h: 20 });
  return { labels, lay };
  };
  // If the labels do not fit the room, the text comes down a size at a time (to a floor) until they do.
  // Roomy first (a row for the date); a little smaller is better than cramped, then the date goes beside the event, then the words wrap narrower
  // (a panel with height to spare and little width), and last the words go smaller still, down to a floor.
  const tries: Array<[boolean, number, number]> = [];
  for (const [compact, wrap, sizes] of [[false, 1, [1.02, 0.94, 0.865]], [true, 1, [1.02, 0.94, 0.865, 0.8]], [true, 0.7, [1.02, 0.94, 0.865, 0.8, 0.73, 0.67, 0.62]]] as Array<[boolean, number, number[]]>) for (const f of sizes) tries.push([compact, wrap, f]);
  // Which attempt fits is worked out once for the labels, the room and the text size, not on every frame (each attempt measures every label).
  const signature = JSON.stringify([Math.round(area.w), Math.round(area.h), Math.round(pad), Math.round(env.px * 10), events.map((e) => [e.def.text, e.def.when, e.def.note, e.def.pos])]);
  const remembered = env.painter.timelineChoices.get(d.key);
  env.painter.timelineLive.add(d.key);
  let index = remembered && remembered.signature === signature ? remembered.index : -1;
  if (index < 0) {
    index = tries.length - 1;
    for (let k = 0; k < tries.length; k++) if (!build(env.px * tries[k]![2], tries[k]![0], tries[k]![1]).lay.overflow) { index = k; break; }
    env.painter.timelineChoices.set(d.key, { signature, index });
  }
  const chosen = tries[index]!;
  const made = build(env.px * chosen[2], chosen[0], chosen[1]);
  const compact = chosen[0];
  const px = env.px * chosen[2];
  const { labels, lay } = made;
  const whenPx = px * 0.92, textPx = px, notePx = px * 0.84;
  const padX = Math.max(10, px * 0.95), padY = Math.max(compact ? 6 : 8, px * (compact ? 0.5 : 0.7)), pillH = whenPx * 1.75, pillGap = px * 0.4;
  const colors = new Map<string, Rgb>(events.map((e, i) => [e.id, accentOf(e.color, i)]));
  // The track is graded from event to event: each event's colour at its own place along the axis. It draws on along with the diagram.
  const ax = lay.axis.b.x - lay.axis.a.x, ay = lay.axis.b.y - lay.axis.a.y, along2 = Math.max(1, ax * ax + ay * ay);
  const stops = events.flatMap((e) => {
    const slot = lay.events.get(e.id);
    return slot ? [{ t: Math.max(0, Math.min(1, ((slot.dot.x - lay.axis.a.x) * ax + (slot.dot.y - lay.axis.a.y) * ay) / along2)), color: colors.get(e.id) as Rgb }] : [];
  }).sort((p, q) => p.t - q.t);
  const trackW = Math.max(5, px * 0.55);
  ctx.save();
  ctx.globalAlpha = d.appear * 0.85;
  const track = ctx.createLinearGradient(lay.axis.a.x, lay.axis.a.y, lay.axis.b.x, lay.axis.b.y);
  if (stops.length === 0) track.addColorStop(0, tone.faint);
  for (const s of stops) track.addColorStop(s.t, rgbCss(s.color, 1));
  ctx.strokeStyle = track;
  ctx.lineWidth = trackW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(lay.axis.a.x, lay.axis.a.y);
  ctx.lineTo(lay.axis.b.x, lay.axis.b.y);
  ctx.stroke();
  ctx.restore();
  // The markers and stems are drawn first and the chips after them, so a stem that runs past another event's chip goes behind it.
  const later: Array<() => void> = [];
  events.forEach((e, i) => {
    const slot = lay.events.get(e.id);
    const label = labels.get(e.id);
    if (!slot || !label || e.appear <= 0) return;
    const dotBox = env.painter.ease(`${d.key}:${e.key}`, { x: slot.dot.x, y: slot.dot.y, w: 0, h: 0 }, env.dt, seen);
    const dot = { x: dotBox.x, y: dotBox.y };
    const rect = env.painter.ease(`${d.key}:${e.key}:label`, slot.rect, env.dt, seen);
    const color = colors.get(e.id) ?? accentOf(e.color, i);
    const a = pieceAlpha(e) * d.appear;
    ctx.save();
    glow(ctx, e, color);
    const pop = easeOut(e.appear / 0.5);
    ctx.globalAlpha = a;
    // The event's marker on the track: a ring of its colour round a hollow in the face of the panel.
    const ringR = Math.max(6, px * 0.64);
    ctx.fillStyle = tone.core;
    ctx.strokeStyle = rgbCss(color, 1);
    ctx.lineWidth = Math.max(2.6, px * 0.3);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, ringR * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    const show = easeOut((e.appear - 0.35) / 0.65);
    if (show > 0) {
      ctx.globalAlpha = a * show;
      // The stem from the marker to the chip.
      ctx.strokeStyle = rgbCss(color, 0.5);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (lay.horizontal) {
        ctx.moveTo(dot.x, dot.y + slot.side * (ringR + 2));
        ctx.lineTo(dot.x, slot.side === -1 ? rect.y + rect.h : rect.y);
      } else {
        ctx.moveTo(dot.x + ringR + 2, dot.y);
        ctx.lineTo(rect.x, Math.max(rect.y + 6, Math.min(rect.y + rect.h - 6, dot.y)));
      }
      ctx.stroke();
      later.push(() => {
      ctx.save();
      ctx.globalAlpha = a * show;
      // The chip: tinted, with a fine line of the event's colour.
      ctx.fillStyle = rgbCss(color, tone.tint);
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(22, rect.h * 0.3));
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgbCss(color, tone.tintLine);
      ctx.stroke();
      ctx.textBaseline = 'alphabetic';
      let y = rect.y + padY;
      const x = rect.x + padX;
      if (label.when.length > 0) {
        // The date in a pill of the colour.
        ctx.fillStyle = rgbCss(color, 1);
        roundRect(ctx, x, y, label.pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.font = fontAt(theme.titleFont, whenPx);
        ctx.fillStyle = onAccent(color);
        ctx.fillText(label.when[0] as string, x + whenPx * 0.7, y + pillH / 2 + whenPx * 0.36);
        if (label.inline) {
          // The event itself on the pill's line.
          ctx.font = fontAt(theme.titleFont, textPx);
          ctx.fillStyle = tone.ink;
          ctx.fillText(label.text[0] as string, x + label.pillW + pillGap, y + pillH / 2 + textPx * 0.36);
          y += Math.max(pillH, textPx * 1.22);
        } else y += pillH + pillGap;
      }
      const put = (l: string, font: string, ink: string, size: number, lead: number): void => {
        ctx.font = font;
        ctx.fillStyle = ink;
        y += size * lead * 0.82;
        ctx.fillText(l, x, y);
        y += size * lead * 0.18;
      };
      if (!label.inline) for (const l of label.text) put(l, fontAt(theme.titleFont, textPx), tone.ink, textPx, 1.22);
      for (const l of label.note) put(l, fontAt(theme.font, notePx), tone.muted, notePx, 1.2);
      ctx.restore();
      });
    }
    ctx.restore();
  });
  for (const draw of later) draw();
}

// ---- Steps -----------------------------------------------------------------------------------------

function drawSteps(env: Env, d: DiagramFrame, area: Px, pad: number, seen: Set<string>): void {
  const { ctx, tone } = env;
  const theme = THEME;
  const steps = d.items.filter((i): i is DiagramItemFrame & { def: NodeAction } => i.def.op === 'node');
  if (steps.length === 0) return;
  const lay = stepsLayout(steps.length, area, pad, env.px * 4.4);
  // The step in hand is the first one not done yet; it is the one lit.
  const current = steps.findIndex((s) => s.done <= 0.5);
  const teal = frostAccent(1), blue = frostAccent(0);
  steps.forEach((s, i) => {
    const target = lay.rows[i];
    if (!target || s.appear <= 0) return;
    const row = env.painter.ease(`${d.key}:${s.key}`, target, env.dt, seen);
    const color = s.color !== undefined ? accentOf(s.color, i) : blue;
    const a = pieceAlpha(s) * d.appear;
    const done = s.done;
    const lit = i === current;
    ctx.save();
    ctx.globalAlpha = a * Math.min(1, s.appear * 1.6);
    ctx.translate((1 - easeOut(s.appear)) * -8, 0);
    glow(ctx, s, color);
    // A row is a soft rounded tile: the step in hand tinted with its colour and outlined, the others a neutral tone.
    const rowR = Math.min(22, row.h * 0.34);
    const gap = Math.min(5, row.h * 0.06);
    ctx.fillStyle = lit ? rgbCss(color, tone.tint + 0.03) : tone.row;
    roundRect(ctx, row.x, row.y + gap, row.w, row.h - gap * 2, rowR);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = lit ? rgbCss(color, 0.62) : tone.chipLine;
    ctx.stroke();
    const r = Math.max(9, Math.min(row.h * 0.3, env.px * 0.95));
    const cx = row.x + r + Math.max(8, row.h * 0.2), cy = row.y + row.h / 2;
    ctx.textBaseline = 'middle';
    if (done > 0.5) {
      // Done: a teal disc with a white tick.
      ctx.fillStyle = rgbCss(teal, 1);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2.2, r * 0.2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.34);
      ctx.lineTo(cx + r * 0.44, cy - r * 0.32);
      ctx.stroke();
    } else if (lit) discWithNumber(ctx, cx, cy, r, color, String(i + 1));
    else {
      // Still to do: a ring and its number, quiet.
      ctx.strokeStyle = tone.muted;
      ctx.globalAlpha *= 0.7;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = fontAt(theme.titleFont, r * 0.95);
      ctx.fillStyle = tone.muted;
      const n = String(i + 1);
      ctx.fillText(n, cx - ctx.measureText(n).width / 2, cy + r * 0.05);
      ctx.globalAlpha /= 0.7;
    }
    const x = cx + r + env.px * 0.75;
    const innerW = row.x + row.w - x - Math.max(8, row.h * 0.2);
    const px = Math.min(env.px * 1.02, row.h * 0.4);
    const notePx = px * 0.82;
    const measure = (font: string) => (t: string): number => { ctx.font = font; return ctx.measureText(t).width; };
    const text = wrapLines(measure(fontAt(theme.font, px)), s.def.text, innerW, row.h > px * 3.2 ? 2 : 1);
    const note = s.def.note && row.h > px * (text.length * 1.25 + 1.9) ? wrapLines(measure(fontAt(theme.font, notePx)), s.def.note, innerW, 1) : [];
    const total = text.length * px * 1.22 + note.length * notePx * 1.2;
    let y = cy - total / 2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = done > 0.5 ? tone.muted : tone.ink;
    ctx.font = fontAt(lit ? theme.titleFont : theme.font, px);
    for (const l of text) {
      y += px * 1.0;
      ctx.fillText(l, x, y);
      y += px * 0.22;
    }
    ctx.font = fontAt(theme.font, notePx);
    ctx.fillStyle = tone.muted;
    for (const l of note) {
      y += notePx * 1.0;
      ctx.fillText(l, x, y);
      y += notePx * 0.2;
    }
    ctx.restore();
  });
}
// ---- Chart -----------------------------------------------------------------------------------------

/** Wraps a chart label without dropping words, splitting long unbroken values only when needed. */
function chartLabelLines(text: string, measure: (s: string) => number, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  const addWord = (word: string): void => {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxW || !line) {
      if (measure(next) <= maxW) { line = next; return; }
    } else {
      lines.push(line);
      line = '';
    }
    for (const char of [...word]) {
      if (line && measure(line + char) > maxW) { lines.push(line); line = ''; }
      line += char;
    }
  };
  for (const word of text.split(/\s+/).filter(Boolean)) addWord(word);
  if (line) lines.push(line);
  return lines;
}

function drawChart(env: Env, d: DiagramFrame, area: Px, pad: number): void {
  const { ctx, tone } = env;
  const theme = THEME;
  const series = d.items.filter((i): i is DiagramItemFrame & { def: SeriesAction } => i.def.op === 'series');
  const dots = d.items.filter((i): i is DiagramItemFrame & { def: DotAction } => i.def.op === 'dot');
  const tickPx = env.px * 0.78;
  ctx.font = fontAt(theme.font, tickPx);
  const data = { series: series.map((s) => ({ pts: s.def.pts as Array<[number, number]> })), dots: dots.map((p) => ({ x: p.def.x, y: p.def.y })), ...(d.def.xrange ? { xrange: d.def.xrange } : {}), ...(d.def.yrange ? { yrange: d.def.yrange } : {}) };
  const probe = chartLayout(data, area, { left: 40, bottom: 30, top: 8, right: 20 });
  const yLabelW = Math.max(0, ...probe.yTicks.map((t) => ctx.measureText(formatTick(t.v, probe.yStep)).width));
  const labelRoom = Math.max(0, ...series.map((s) => (s.def.label ? Math.min(area.w * 0.28, ctx.measureText(s.def.label).width + 10) : 0)));
  const baseRoom = {
    left: pad * 0.6 + yLabelW + (d.def.ylabel ? tickPx * 1.5 : 0) + 8,
    bottom: tickPx * 2 + (d.def.xlabel ? tickPx * 1.6 : 0) + 6,
    top: 10,
    right: Math.max(18, labelRoom),
  };
  let room = { ...baseRoom };
  let xWant = Math.max(2, Math.round(Math.max(10, area.w - room.left - room.right) / 90));
  let lay = chartLayout(data, area, room, { x: xWant });
  for (let attempt = 0; attempt < 12; attempt++) {
    const yLabelWidth = Math.max(0, ...lay.yTicks.map((t) => ctx.measureText(formatTick(t.v, lay.yStep)).width));
    const xLabels = lay.xTicks.map((t) => ({ px: t.px, width: ctx.measureText(formatTick(t.v, lay.xStep)).width })).sort((a, b) => a.px - b.px);
    const edgeRoom = Math.max(0, ...xLabels.map(({ width }) => width / 2 + 6));
    const nextRoom = {
      ...room,
      left: Math.max(baseRoom.left, pad * 0.6 + yLabelWidth + (d.def.ylabel ? tickPx * 1.5 : 0) + 8, edgeRoom),
      right: Math.max(baseRoom.right, edgeRoom),
    };
    const overlaps = xLabels.some((label, i) => i > 0 && label.px - xLabels[i - 1]!.px < (label.width + xLabels[i - 1]!.width) / 2 + 4);
    const desiredWant = Math.max(1, Math.round(Math.max(10, area.w - nextRoom.left - nextRoom.right) / 90));
    const nextWant = overlaps ? Math.max(1, Math.min(xWant, desiredWant, xWant - 1)) : Math.min(xWant, desiredWant);
    const changed = nextWant !== xWant || nextRoom.left > room.left + 0.01 || nextRoom.right > room.right + 0.01;
    if (!changed) break;
    room = nextRoom;
    xWant = nextWant;
    lay = chartLayout(data, area, room, { x: xWant });
  }
  const { plot } = lay;
  const chartLabelObstacles: Px[] = [];
  ctx.save();
  ctx.globalAlpha = d.appear;
  // Frost: no frame and no boxed grid, only faint rules across the plot (and a short tick under each x label) and a firmer line at the foot.
  ctx.lineWidth = 1;
  ctx.strokeStyle = tone.faint;
  ctx.beginPath();
  for (const t of lay.yTicks) { ctx.moveTo(plot.x, t.px); ctx.lineTo(plot.x + plot.w, t.px); }
  for (const t of lay.xTicks) { ctx.moveTo(t.px, plot.y + plot.h); ctx.lineTo(t.px, plot.y + plot.h + 4); }
  ctx.stroke();
  ctx.strokeStyle = tone.chipLine;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y + plot.h);
  ctx.lineTo(plot.x + plot.w, plot.y + plot.h);
  ctx.stroke();
  ctx.fillStyle = tone.muted;
  ctx.font = fontAt(theme.font, tickPx);
  ctx.textBaseline = 'middle';
  for (const t of lay.yTicks) {
    const s = formatTick(t.v, lay.yStep);
    const w = ctx.measureText(s).width, x = plot.x - 6 - w;
    ctx.fillText(s, x, t.px);
    chartLabelObstacles.push({ x, y: t.px - tickPx * 0.6, w, h: tickPx * 1.2 });
  }
  ctx.textBaseline = 'alphabetic';
  for (const t of lay.xTicks) {
    const s = formatTick(t.v, lay.xStep);
    const w = ctx.measureText(s).width, x = t.px - w / 2, y = plot.y + plot.h + tickPx * 1.45;
    ctx.fillText(s, x, y);
    chartLabelObstacles.push({ x, y: y - tickPx, w, h: tickPx * 1.2 });
  }
  ctx.font = fontAt(theme.font, tickPx * 1.05);
  ctx.fillStyle = tone.muted;
  if (d.def.xlabel) {
    const w = ctx.measureText(d.def.xlabel).width, x = plot.x + plot.w / 2 - w / 2, y = plot.y + plot.h + tickPx * 3.2;
    ctx.fillText(d.def.xlabel, x, y);
    chartLabelObstacles.push({ x, y: y - tickPx * 1.05, w, h: tickPx * 1.25 });
  }
  if (d.def.ylabel) {
    const w = ctx.measureText(d.def.ylabel).width;
    const cx = area.x + pad * 0.6 + tickPx * 0.5, cy = plot.y + plot.h / 2 + w / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(d.def.ylabel, 0, 0);
    ctx.restore();
    chartLabelObstacles.push({ x: cx - tickPx * 0.6, y: cy - w / 2, w: tickPx * 1.2, h: w });
  }
  ctx.restore();
  // Lines and curves, drawn along from their first point; they stay inside the plot. A curve that runs left to right is tinted under, a little less
  // the more there are; with many series the lines alone carry it.
  const tintUnder = series.length <= 3 ? [0.3, 0.26, 0.2][series.length - 1] ?? 0 : 0;
  const pathOf = (s: (typeof series)[number]): Pt[] => {
    const px = s.def.pts.map(([x, y]) => lay.toPx(x, y));
    return s.def.curve ? smoothPoints(px) : px;
  };
  // The names of the series stand at the ends of their lines; where two ends are close the names are pushed apart, top to bottom, so none is written over another.
  const spots = new Map<string, { x: number; y: number }>();
  {
    ctx.font = fontAt(theme.titleFont, tickPx * 1.1);
    const lo = plot.y + 6, hi = plot.y + plot.h - 6, gapY = tickPx * 1.3;
    for (const s of series) {
      const path = s.def.label ? pathOf(s) : [];
      const end = path[path.length - 1];
      if (!s.def.label || !end) continue;
      const w = ctx.measureText(s.def.label).width;
      const x = end.x + 8 + w <= area.x + area.w - 4 ? end.x + 8 : end.x - 8 - w;
      spots.set(s.id, { x, y: Math.max(lo, Math.min(hi, end.y - (x < end.x ? 12 : 0))) });
    }
    const order = [...spots.values()].sort((p, q) => p.y - q.y);
    for (let k = 1; k < order.length; k++) if (order[k]!.y < order[k - 1]!.y + gapY) order[k]!.y = order[k - 1]!.y + gapY;
    if (order.length > 0 && order[order.length - 1]!.y > hi) {
      order[order.length - 1]!.y = hi;
      for (let k = order.length - 2; k >= 0; k--) if (order[k]!.y > order[k + 1]!.y - gapY) order[k]!.y = Math.max(lo, order[k + 1]!.y - gapY);
    }
  }
  series.forEach((s, i) => {
    if (s.appear <= 0) return;
    const color = accentOf(s.color, i);
    const pts = pathOf(s);
    const a = pieceAlpha(s) * d.appear;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x - 2, plot.y - 4, plot.w + 4, plot.h + 8);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = a;
    const foot = plot.y + plot.h;
    if (tintUnder > 0 && pts.length > 1 && pts.every((p, k) => k === 0 || p.x >= pts[k - 1]!.x - 0.5)) {
      const top = Math.min(...pts.map((p) => p.y));
      const fill = ctx.createLinearGradient(0, top, 0, foot);
      fill.addColorStop(0, rgbCss(color, tintUnder));
      fill.addColorStop(1, rgbCss(color, 0));
      ctx.globalAlpha = a * easeOut(s.appear);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, foot);
      for (const p of pts) ctx.lineTo(p.x, Math.min(foot, p.y));
      ctx.lineTo(pts[pts.length - 1]!.x, foot);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = a;
    }
    ctx.strokeStyle = rgbCss(color, 1);
    ctx.lineWidth = Math.max(2.6, env.px * 0.27);
    glow(ctx, s, color);
    const { tip } = strokePartial(ctx, pts, easeOut(s.appear));
    ctx.restore();
    const spot = spots.get(s.id);
    if (s.def.label && s.appear > 0.8 && spot) {
      ctx.save();
      ctx.globalAlpha = a * Math.min(1, (s.appear - 0.8) / 0.2);
      ctx.font = fontAt(theme.titleFont, tickPx * 1.1);
      ctx.fillStyle = rgbCss(color, 1);
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(s.def.label).width;
      const { x, y } = spot;
      ctx.fillText(s.def.label, x, y);
      chartLabelObstacles.push({ x: x - 3, y: y - tickPx * 0.75, w: w + 6, h: tickPx * 1.5 });
      ctx.restore();
    }
    void tip;
  });
  const markerDots = dots.filter((p) => p.appear > 0).map((p) => ({ item: p, at: lay.toPx(p.def.x, p.def.y) }))
    .filter(({ at }) => at.x >= plot.x && at.x <= plot.x + plot.w && at.y >= plot.y && at.y <= plot.y + plot.h);
  const labelRequests: ChartDotLabel[] = [];
  const labelLines = new Map<string, { lines: string[]; px: number; color: Rgb }>();
  for (const { item: p, at } of markerDots) {
    if (!p.def.text || p.appear <= 0.5) continue;
    const color = accentOf(p.color, series.length + dots.indexOf(p));
    const px = tickPx * 1.05;
    ctx.font = fontAt(theme.font, px);
    const measure = (s: string): number => ctx.measureText(s).width;
    const lines = chartLabelLines(p.def.text, measure, Math.max(1, area.w - 24));
    const textW = Math.max(0, ...lines.map(measure));
    const lineH = px * 1.2;
    const labelH = Math.max(px * 1.5, lines.length * lineH);
    const boxW = textW + 12;
    const right = at.x + 12 + boxW <= area.x + area.w - 4;
    const x = right ? at.x + 12 : at.x - 12 - boxW;
    const above = at.y - px * 1.6 > area.y;
    const y = above ? at.y - px * 1.4 : at.y + px * 0.2;
    labelRequests.push({ id: p.id, at, w: boxW, h: labelH, preferred: { x, y, w: boxW, h: labelH } });
    labelLines.set(p.id, { lines, px, color });
  }
  const labelPlacements = new Map(chartDotLabelPlacements(labelRequests, area, chartLabelObstacles, markerDots.map(({ at }) => at)).map((placement) => [placement.id, placement.rect]));
  dots.forEach((p, i) => {
    if (p.appear <= 0) return;
    const color = accentOf(p.color, series.length + i);
    const c = lay.toPx(p.def.x, p.def.y);
    if (c.x < plot.x || c.x > plot.x + plot.w || c.y < plot.y || c.y > plot.y + plot.h) return;
    const a = pieceAlpha(p) * d.appear;
    const pop = easeOut(p.appear / 0.5);
    ctx.save();
    ctx.globalAlpha = a;
    glow(ctx, p, color);
    // A point on the chart: a soft halo of its colour, and a white ring of it.
    const ringR = Math.max(6, env.px * 0.55);
    ctx.fillStyle = rgbCss(color, 0.22);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ringR * 2 * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = rgbCss(color, 1);
    ctx.lineWidth = Math.max(2.4, env.px * 0.24);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ringR * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const textLayout = labelLines.get(p.id);
    if (p.def.text && p.appear > 0.5 && textLayout) {
      ctx.globalAlpha = a * Math.min(1, (p.appear - 0.5) / 0.5);
      const { lines, px, color: labelColor } = textLayout;
      const textW = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
      const labelH = Math.max(px * 1.5, lines.length * px * 1.2);
      const w = textW + 12;
      const fallback = labelRequests.find((request) => request.id === p.id)?.preferred;
      const rect = labelPlacements.get(p.id) ?? (fallback ? {
        ...fallback,
        x: Math.max(area.x + 4, Math.min(area.x + area.w - fallback.w - 4, fallback.x)),
        y: Math.max(area.y + 4, Math.min(area.y + area.h - fallback.h - 4, fallback.y)),
      } : { x: c.x + 12, y: c.y - labelH / 2, w, h: labelH });
      const end = { x: Math.max(rect.x, Math.min(rect.x + rect.w, c.x)), y: Math.max(rect.y, Math.min(rect.y + rect.h, c.y)) };
      const distance = Math.hypot(end.x - c.x, end.y - c.y);
      if (distance > 0.5) {
        ctx.strokeStyle = rgbCss(labelColor, 0.58);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c.x + (end.x - c.x) * Math.min(1, 8 / distance), c.y + (end.y - c.y) * Math.min(1, 8 / distance));
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.fillStyle = tone.chip;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(rect.h / 2, px * 0.9));
      ctx.fill();
      ctx.strokeStyle = rgbCss(labelColor, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = tone.ink;
      ctx.textBaseline = 'middle';
      ctx.font = fontAt(theme.font, px);
      lines.forEach((line, lineIndex) => ctx.fillText(line, rect.x + 6, rect.y + rect.h / 2 + px * 0.03 + (lineIndex - (lines.length - 1) / 2) * px * 1.2));
    }
    ctx.restore();
  });
}
