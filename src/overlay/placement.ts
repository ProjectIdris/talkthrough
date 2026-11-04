// Where the 3D stage and the note cards go on the page. A model writes coordinates blind to what is on the
// screen; this looks at a small grayscale picture of the page and moves a stage or a card off its text (and off
// what the answer points at) into the nearest free place, so a model never covers the article it is explaining.
// Pure (no DOM): the page hands it the grid and asks about each rectangle in scene units (0 to 1000 across each axis).

import type { Action, Mark } from '../scene/types.ts';
import { edgeGrid } from './labels.ts';

export type Box = { x: number; y: number; w: number; h: number };

/** A small picture of the page: gray levels and, from them, where the edges are (text is full of edges). */
export type PageGrid = { cols: number; rows: number; gray: ArrayLike<number>; edge: Float32Array };

export function pageGrid(gray: ArrayLike<number>, cols: number, rows: number): PageGrid {
  return { cols, rows, gray, edge: edgeGrid(gray, cols, rows) };
}

/**
 * Which cells have something on them: an edge, or a gray level that differs from the page's own background (the most
 * common level). Thin text blurs to a faint tone when the page is shrunk to a small grid, so edges alone miss it.
 */
function inkOf(grid: PageGrid): Float32Array {
  const bucket = (g: number): number => Math.min(32, Math.round(g / 8));
  const hist = new Uint32Array(33);
  for (let i = 0; i < grid.gray.length; i++) hist[bucket(grid.gray[i] as number)]!++;
  let mode = 0;
  for (let i = 1; i < hist.length; i++) if ((hist[i] as number) > (hist[mode] as number)) mode = i;
  let sum = 0, n = 0;
  for (let i = 0; i < grid.gray.length; i++) if (bucket(grid.gray[i] as number) === mode) { sum += grid.gray[i] as number; n++; }
  const background = n > 0 ? sum / n : 255;
  const out = new Float32Array(grid.gray.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.abs((grid.gray[i] as number) - background) > 16 || (grid.edge[i] as number) > 0.1 ? 1 : 0;
  return out;
}

/** Summed-area table over a cols x rows field, for the mean of any rectangle at once. */
class Sums {
  private t: Float64Array;
  private cols: number;
  private rows: number;
  constructor(cols: number, rows: number, field: ArrayLike<number>) {
    this.cols = cols;
    this.rows = rows;
    this.t = new Float64Array((cols + 1) * (rows + 1));
    for (let r = 0; r < rows; r++) {
      let run = 0;
      for (let c = 0; c < cols; c++) {
        run += field[r * cols + c] as number;
        this.t[(r + 1) * (cols + 1) + c + 1] = (this.t[r * (cols + 1) + c + 1] as number) + run;
      }
    }
  }
  /** Mean over the cells a rectangle of units covers. */
  mean(b: Box): number {
    const c0 = clamp(Math.floor((b.x / 1000) * this.cols), 0, this.cols - 1), c1 = clamp(Math.ceil(((b.x + b.w) / 1000) * this.cols), c0 + 1, this.cols);
    const r0 = clamp(Math.floor((b.y / 1000) * this.rows), 0, this.rows - 1), r1 = clamp(Math.ceil(((b.y + b.h) / 1000) * this.rows), r0 + 1, this.rows);
    const w = this.cols + 1;
    const sum = (this.t[r1 * w + c1] as number) - (this.t[r0 * w + c1] as number) - (this.t[r1 * w + c0] as number) + (this.t[r0 * w + c0] as number);
    return sum / ((c1 - c0) * (r1 - r0));
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much of the page under a rectangle counts as "in use" at all: below this a place is taken to be blank. */
const BLANK = 0.01;

export type PlacerOptions = { aspect: number; /** Keep this far (units) from the edge of the screen. */ margin?: number };

export class Placer {
  private edge: Sums;
  /** The share of cells with an edge in them: how much of a rectangle has anything on it. */
  private ink: Sums;
  private luma: Sums;
  private reserved: Box[] = [];
  private cards = new Map<string, Box>();
  private stage: Box | undefined;
  private aspect: number;
  private margin: number;

  constructor(grid: PageGrid, options: PlacerOptions) {
    this.edge = new Sums(grid.cols, grid.rows, grid.edge);
    this.ink = new Sums(grid.cols, grid.rows, inkOf(grid));
    this.luma = new Sums(grid.cols, grid.rows, grid.gray);
    this.aspect = options.aspect;
    this.margin = options.margin ?? 12;
  }

  /** A new turn: what the last answer pointed at is no longer being kept clear (the stage stays where it is). */
  reset(): void {
    this.reserved = [];
    this.cards.clear();
  }

  /** The page under a rectangle is being pointed at, or is otherwise to be kept clear. */
  reserve(box: Box): void {
    this.reserved.push(box);
  }

  /** The stage's own rectangle (cards keep out of it). */
  setStage(box: Box | undefined): void {
    this.stage = box;
  }

  /** The mean gray level (0 to 255) under a rectangle: whether a frame behind the stage should be light or dark. */
  brightness(box: Box): number {
    return this.luma.mean(box);
  }

  /** How busy the page is under a rectangle, 0 (blank) to 1. */
  busy(box: Box): number {
    return this.edge.mean(box);
  }

  private cost(box: Box, from: Box, scale: number, keepOut: readonly Box[]): number {
    const area = box.w * box.h;
    const padded = { x: box.x - 6, y: box.y - 10, w: box.w + 12, h: box.h + 20 };
    let c = this.edge.mean(box) * 6 + this.ink.mean(padded) * 30;
    for (const r of keepOut) c += (overlap(box, r) / area) * 5;
    const dx = (box.x + box.w / 2 - (from.x + from.w / 2)) * this.aspect, dy = box.y + box.h / 2 - (from.y + from.h / 2);
    c += (Math.hypot(dx, dy) / 1000) * 1.0;
    c += (1 - scale) * 1.2;
    return c;
  }

  private search(want: Box, scales: readonly number[], keepOut: readonly Box[]): Box {
    const inside = (b: Box): Box => ({
      x: clamp(b.x, this.margin, 1000 - this.margin - b.w), y: clamp(b.y, this.margin, 1000 - this.margin - b.h), w: b.w, h: b.h,
    });
    const home = inside(want);
    const fits = (b: Box): boolean => b.w <= 1000 - 2 * this.margin && b.h <= 1000 - 2 * this.margin;
    if (!fits(want)) return want;
    const homeCost = this.cost(home, want, 1, keepOut);
    // Where it already is fine: blank page, nothing pointed at beneath it.
    if (this.ink.mean({ x: home.x - 6, y: home.y - 10, w: home.w + 12, h: home.h + 20 }) < BLANK && !keepOut.some((r) => overlap(home, r) > 0)) return home;
    let best = home;
    let bestCost = homeCost;
    const step = 20;
    for (const scale of scales) {
      const w = want.w * scale, h = want.h * scale;
      for (let y = this.margin; y + h <= 1000 - this.margin + 0.01; y += step) {
        for (let x = this.margin; x + w <= 1000 - this.margin + 0.01; x += step) {
          const box = { x, y, w, h };
          const c = this.cost(box, want, scale, keepOut);
          if (c < bestCost - 1e-9) {
            best = box;
            bestCost = c;
          }
        }
      }
    }
    // Moving has to be worth it: a small gain stays put, so a model's own choice survives where it was fine.
    // Nowhere is free (the whole page is text): do not shuffle it about, leave it where the model put it.
    if (this.ink.mean(best) > 0.3) return home;
    return homeCost - bestCost < 0.25 ? home : best;
  }

  /** Where the stage goes: the nearest rectangle of its shape (or a little smaller) that is off the page's text and what is pointed at. */
  panel(want: Box): Box {
    const placed = this.search(want, [1, 0.88, 0.76, 0.66], this.reserved);
    this.stage = placed;
    return placed;
  }

  /** Where a card or crop goes: the nearest free place, keeping out of the stage, the other cards and what is pointed at. */
  card(want: Box, id?: string): Box {
    const keepOut = [...this.reserved, ...this.cards.values(), ...(this.stage ? [this.stage] : [])];
    const placed = this.search(want, [1], keepOut);
    this.cards.set(id ?? `#${this.cards.size}`, placed);
    return placed;
  }

  /** Where a flat diagram goes: like a card, but it may also be a little smaller (its drawing scales to its rectangle). */
  diagram(want: Box, id: string): Box {
    const keepOut = [...this.reserved, ...[...this.cards].filter(([k]) => k !== id).map(([, b]) => b), ...(this.stage ? [this.stage] : [])];
    const placed = this.search(want, [1, 0.88, 0.76, 0.66], keepOut);
    this.cards.set(id, placed);
    return placed;
  }

  /** A card or crop went (cleared by id, or all of them): its place is free for the next. */
  release(target: string): void {
    if (target === 'all' || target === 'marks') this.cards.clear();
    else this.cards.delete(target);
  }
}

// ---- Actions -----------------------------------------------------------------------------------

/** How tall a card will be, in units of the screen's height, from its rows and layout (the page measures the real one). */
export function cardHeightUnits(a: Extract<Action, { op: 'card' }>, screenHeight: number): number {
  const px = (a.title ? 54 : 18) + (a.rows ? a.rows.length * 31 : 0) + 22 + (a.layout === 'stat' ? 36 : 0);
  return (px / screenHeight) * 1000;
}

/** The part of the screen a mark points at, to keep clear: boxes, circles and crops whole, an arrow's ends, a line, a label. */
export function markFootprint(m: Mark, aspect: number): Box[] {
  switch (m.op) {
    case 'box': case 'circle': return [{ x: m.x, y: m.y, w: m.w, h: m.h }];
    case 'underline': return [{ x: m.x, y: m.y - 14, w: m.w, h: 28 }];
    case 'arrow': {
      const pad = 14;
      return [{ x: m.x1 - pad / aspect, y: m.y1 - pad, w: (2 * pad) / aspect, h: 2 * pad }, { x: m.x2 - pad / aspect, y: m.y2 - pad, w: (2 * pad) / aspect, h: 2 * pad }];
    }
    case 'label': return [{ x: m.x, y: m.y, w: Math.max(30, m.text.length * 11 / aspect * ((m.size ?? 24) / 24)), h: m.size ?? 24 }];
    case 'image': return [{ x: m.sx, y: m.sy, w: m.sw, h: m.sh }];
    default: return [];
  }
}

/** Notes what a set of actions points at, so cards and the stage keep off it. */
export function reserveMarks(placer: Placer, actions: readonly Action[], aspect: number): void {
  for (const a of actions) {
    if (a.op === 'box' || a.op === 'circle' || a.op === 'underline' || a.op === 'arrow' || a.op === 'label' || a.op === 'image') {
      for (const b of markFootprint(a, aspect)) placer.reserve(b);
    }
  }
}

/** The action with its stage or card moved off the page's text; any other action comes back as it was. */
export function placeAction(placer: Placer, a: Action, screenHeight: number): Action {
  if (a.op === 'panel') {
    const box = placer.panel({ x: a.x, y: a.y, w: a.w, h: a.h });
    return box.x === a.x && box.y === a.y && box.w === a.w && box.h === a.h ? a : { ...a, ...round(box) };
  }
  if (a.op === 'card') {
    const w = a.w ?? 300;
    const box = placer.card({ x: a.x, y: a.y, w, h: cardHeightUnits(a, screenHeight) }, a.id);
    return box.x === a.x && box.y === a.y ? a : { ...a, x: Math.round(box.x), y: Math.round(box.y) };
  }
  if (a.op === 'diagram') {
    // A diagram is kept off the page's text like a card, and out of the stage and the other cards.
    const box = placer.diagram({ x: a.x, y: a.y, w: a.w, h: a.h }, a.id);
    return box.x === a.x && box.y === a.y && box.w === a.w && box.h === a.h ? a : { ...a, ...round(box) };
  }
  if (a.op === 'image') {
    const h = Math.max(40, (a.dw * a.sh) / Math.max(1, a.sw) * 1.6);
    const box = placer.card({ x: a.dx, y: a.dy, w: a.dw, h }, a.id);
    return box.x === a.dx && box.y === a.dy ? a : { ...a, dx: Math.round(box.x), dy: Math.round(box.y) };
  }
  if (a.op === 'clear') placer.release(a.target);
  return a;
}

const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
