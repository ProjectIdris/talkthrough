// Where the 3D stage and the note cards go on the page. A model writes coordinates blind to what is on the
// screen; this looks at a small grayscale picture of the page and moves a stage or a card off its text (and off
// what the answer points at) into the nearest free place, so a model never covers the article it is explaining.
// Pure (no DOM): the page hands it the grid and asks about each rectangle in scene units (0 to 1000 across each axis).

import type { Action, Mark } from '../scene/types.ts';
import { edgeGrid } from './labels.ts';
import { tiltedCorners } from './shapes.ts';
import type { Pt } from './shapes.ts';

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

/** A line of ink this share of the page wide or less counts wholly as a fixture by width; the share ramps up to PROSE_FULL_WIDTH, from which it counts wholly as prose. */
const PROSE_RAMP_FROM = 0.15;
const PROSE_FULL_WIDTH = 0.3;
/** A run wider than this share of the page is a bar (a toolbar, a header, a rule), not a line of text, unless it is one of a block of regular lines. */
const BAR_WIDTH = 0.85;
/** The shortest run of ink (cells) that can be a line of text, and the tallest a line is (rows): taller is a picture. */
const MIN_RUN = 4;
const MAX_LINE_ROWS = 5;
/** How many lines in a column make it a block of text, and how regular they must be. */
const MIN_BLOCK_LINES = 4;
/**
 * Text has word spacing: along a line the gray level rises and falls again and again (letters, then a gap, then letters). A control is
 * flat, a solid button or an outlined field with the odd label in it. At this grid size the gaps are not empty cells, only lighter ones,
 * so a line is counted by how often its gray profile turns (a turn must be at least GAP_STEP gray levels deep); a column of lines is text
 * only if its middle line turns at least this often per cell. Prose measures 0.2 to 0.5, a flat control 0 to 0.1, a button with a short label in it (a smooth dip) about 0.1.
 */
const TEXT_TURNS = 0.15;
const GAP_STEP = 3;

type TextLine = { r0: number; r1: number; c0: number; c1: number };

/**
 * How much of each cell of ink is plain body text, 0 to 1, as against the page's controls and figures. Two things say so.
 * Lines: a column of text is a stack of lines that start at the same place, repeat at a steady pitch and mostly run nearly as long as
 * the longest, which holds however narrow the column is (a split pane, a chat, an ultrawide screen), while a toolbar is one line, an
 * infobox's picture is a block with no lines in it and a panel of options has lines of all lengths. Width: for the ink that is not in
 * such a stack, a run narrower than 15% of the page is a fixture, one 30% or wider is prose, with a ramp between so a figure does not
 * flip at a cliff, and one wider than 85% is a bar and a fixture again.
 */
export function bodyTextOf(grid: PageGrid, ink: Float32Array = inkOf(grid)): Float32Array {
  const { cols, rows } = grid;
  const weight = new Float32Array(cols * rows);
  // Runs of ink along each row (a gap of one cell is joined), then lines: runs on neighbouring rows that lie over one another.
  const runs: { r: number; c0: number; c1: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    const here: { r: number; c0: number; c1: number }[] = [];
    let start = -1, last = -1;
    const close = (): void => {
      if (start >= 0 && last - start + 1 >= MIN_RUN) here.push({ r, c0: start, c1: last });
      start = -1;
    };
    for (let c = 0; c < cols; c++) {
      if (!(ink[r * cols + c]! > 0)) continue;
      if (start >= 0 && c - last - 1 > 1) close();
      if (start < 0) start = c;
      last = c;
    }
    close();
    runs.push(here);
  }
  const lines: TextLine[] = [];
  let open: TextLine[] = [];
  for (let r = 0; r < rows; r++) {
    const next: TextLine[] = [];
    for (const run of runs[r]!) {
      const into = open.find((l) => Math.min(l.c1, run.c1) - Math.max(l.c0, run.c0) + 1 >= 0.5 * Math.min(l.c1 - l.c0 + 1, run.c1 - run.c0 + 1));
      if (into) {
        into.r1 = r;
        into.c0 = Math.min(into.c0, run.c0);
        into.c1 = Math.max(into.c1, run.c1);
        next.push(into);
      } else {
        const line = { r0: r, r1: r, c0: run.c0, c1: run.c1 };
        lines.push(line);
        next.push(line);
      }
    }
    open = next;
  }
  const text = lines.filter((l) => l.r1 - l.r0 + 1 <= MAX_LINE_ROWS);
  // Stack lines that start at the same place, one under another, into columns.
  const parent = text.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  text.forEach((l, i) => {
    let best = -1;
    text.forEach((p, j) => {
      if (p.r1 >= l.r0 || l.r0 - p.r1 > 6 || Math.abs(p.c0 - l.c0) > 2) return;
      if (Math.min(p.c1, l.c1) - Math.max(p.c0, l.c0) + 1 < 0.6 * Math.min(p.c1 - p.c0 + 1, l.c1 - l.c0 + 1)) return;
      if (best < 0 || p.r1 > text[best]!.r1) best = j;
    });
    if (best >= 0) parent[find(i)] = find(best);
  });
  const columns = new Map<number, TextLine[]>();
  text.forEach((l, i) => columns.set(find(i), [...(columns.get(find(i)) ?? []), l]));
  const regular = new Set<TextLine>();
  for (const column of columns.values()) {
    if (column.length < MIN_BLOCK_LINES) continue;
    column.sort((a, b) => a.r0 - b.r0);
    const gaps = column.slice(1).map((l, i) => (l.r0 + l.r1) / 2 - (column[i]!.r0 + column[i]!.r1) / 2);
    const sorted = [...gaps].sort((a, b) => a - b);
    const pitch = sorted[Math.floor(sorted.length / 2)]!;
    const steady = gaps.filter((g) => Math.abs(g - pitch) <= 1.01).length / gaps.length;
    const longest = Math.max(...column.map((l) => l.c1 - l.c0 + 1));
    const full = column.filter((l) => l.c1 - l.c0 + 1 >= 0.75 * longest).length / column.length;
    // Equal-width controls (a sidebar of buttons, a form of fields) are as regular as text, but have no word spacing.
    const turns = column.map((l) => turnsOf(grid, l)).sort((a, b) => a - b);
    if (steady >= 0.6 && full >= 0.6 && turns[Math.floor(turns.length / 2)]! >= TEXT_TURNS) for (const l of column) regular.add(l);
  }
  // Cells of lines in a regular column are prose; the ink in any other run is weighed by the run's width.
  const ramp = (share: number): number => (share > BAR_WIDTH ? 0 : Math.max(0, Math.min(1, (share - PROSE_RAMP_FROM) / (PROSE_FULL_WIDTH - PROSE_RAMP_FROM))));
  for (const row of runs) {
    for (const run of row) {
      const inColumn = [...regular].some((l) => run.r >= l.r0 && run.r <= l.r1 && run.c0 >= l.c0 && run.c1 <= l.c1);
      const w = inColumn ? 1 : ramp((run.c1 - run.c0 + 1) / cols);
      for (let c = run.c0; c <= run.c1; c++) if (ink[run.r * cols + c]! > 0) weight[run.r * cols + c] = w;
    }
  }
  return weight;
}

/** How often the gray level along a line turns (a gap between words, then the next word), per cell of its width. */
function turnsOf(grid: PageGrid, l: TextLine): number {
  const span = l.c1 - l.c0 + 1;
  if (span < 3) return 0;
  const profile: number[] = [];
  for (let c = l.c0; c <= l.c1; c++) {
    let sum = 0;
    for (let r = l.r0; r <= l.r1; r++) sum += grid.gray[r * grid.cols + c] as number;
    profile.push(sum / (l.r1 - l.r0 + 1));
  }
  let turns = 0;
  for (let i = 1; i < span - 1; i++) {
    const before = profile[i]! - profile[i - 1]!, after = profile[i + 1]! - profile[i]!;
    if (before * after < 0 && Math.abs(before) > GAP_STEP) turns++;
  }
  return turns / span;
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

/**
 * The top fifth of a screen is mostly an app's own bar, tabs, menus and account controls, which are thin and sparse, so
 * the page looks nearly blank there. A card or diagram that was not asked for up there keeps out of it unless the rest of the
 * page is a good deal worse: this much is added to its cost, in proportion to how much of it lies in the band.
 */
/** Covering the page's controls, figures and sidebars costs this many times what covering the same amount of body text does. */
const FIXTURE_COST = 6;
/** How much more a grown diagram may cost the page than the one it grew from before it stays small instead (a few percent of a figure or a fifth of a column of text). */
const GROWTH_COVER_SLACK = 3;

/** What a place that overlaps something the answer points at costs, however little of it. */
const POINTED_HIT = 1.5;

const TOP_BAND = 200;
const TOP_COST = 6;

export type PlacerOptions = { aspect: number; /** Keep this far (units) from the edge of the screen. */ margin?: number };

export class Placer {
  private edge: Sums;
  /** The share of cells with an edge in them: how much of a rectangle has anything on it. */
  private ink: Sums;
  /** The ink that is plain body text, and the rest of it (controls, figures, sidebars): covering the second counts for more. */
  private prose: Sums;
  private fixtures: Sums;
  private luma: Sums;
  private reserved: Box[] = [];
  private cards = new Map<string, Box>();
  /** Each flat diagram's rectangle as asked for and as placed: marks written inside the first go with it to the second. */
  private homes = new Map<string, { from: Box; to: Box }>();
  private stage: Box | undefined;
  private aspect: number;
  private margin: number;

  constructor(grid: PageGrid, options: PlacerOptions) {
    this.edge = new Sums(grid.cols, grid.rows, grid.edge);
    const ink = inkOf(grid);
    const prose = bodyTextOf(grid, ink);
    this.ink = new Sums(grid.cols, grid.rows, ink);
    this.prose = new Sums(grid.cols, grid.rows, prose);
    this.fixtures = new Sums(grid.cols, grid.rows, ink.map((v, i) => (v > 0 ? 1 - prose[i]! : 0)));
    this.luma = new Sums(grid.cols, grid.rows, grid.gray);
    this.aspect = options.aspect;
    this.margin = options.margin ?? 12;
  }

  /** A new turn: what the last answer pointed at is no longer being kept clear (the stage stays where it is). */
  reset(): void {
    this.reserved = [];
    this.cards.clear();
    this.homes.clear();
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

  private cost(box: Box, from: Box, scale: number, keepOut: readonly Box[], extra = 0): number {
    const area = box.w * box.h;
    const padded = { x: box.x - 6, y: box.y - 10, w: box.w + 12, h: box.h + 20 };
    let c = this.edge.mean(box) * 6 + this.prose.mean(padded) * 30 + this.fixtures.mean(padded) * 30 * FIXTURE_COST;
    for (const r of keepOut) c += (overlap(box, r) / area) * 5;
    // Touching what the answer points at, even by a corner, costs a good deal whatever the share: a sliver over the figure it boxed is still covering it.
    for (const r of this.reserved) if (overlap(box, r) > 0) c += POINTED_HIT;
    const dx = (box.x + box.w / 2 - (from.x + from.w / 2)) * this.aspect, dy = box.y + box.h / 2 - (from.y + from.h / 2);
    c += (Math.hypot(dx, dy) / 1000) * 1.0;
    c += (1 - scale) * 1.2 + extra;
    return c;
  }

  private search(want: Box, scales: readonly number[], keepOut: readonly Box[], shapes: readonly number[] = [1], minW = 0, avoidTop = false, minRatio = 0, minSize: { w: number; h: number } = { w: 0, h: 0 }): Box {
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
      // A shape other than the one asked for (narrower and taller, the same area) fits a margin or a gap between columns; it costs a little.
      for (const shape of shapes) {
        const w = want.w * scale * shape, h = want.h * scale / shape;
        // Smaller than it can be read at is not offered (a card asked for small may still go to three quarters of that).
        if (scale !== 1 && (w < Math.min(minSize.w, want.w * 0.76) || h < Math.min(minSize.h, want.h * 0.76))) continue;
        if (shape !== 1 && (w < minW || h > 1000 - 2 * this.margin)) continue;
        // A shape may not be squeezed below the width to height (on the screen's own pixels) the picture needs, unless it was asked for narrower.
        if (shape !== 1 && (w / h) * this.aspect < Math.min(minRatio, (want.w / want.h) * this.aspect) - 1e-9) continue;
        const extra = Math.abs(Math.log(shape)) * 0.5;
        for (let y = this.margin; y + h <= 1000 - this.margin + 0.01; y += step) {
          for (let x = this.margin; x + w <= 1000 - this.margin + 0.01; x += step) {
            const box = { x, y, w, h };
            const top = avoidTop && want.y >= TOP_BAND ? (Math.max(0, Math.min(box.y + box.h, TOP_BAND) - box.y) / box.h) * TOP_COST : 0;
            const c = this.cost(box, want, scale, keepOut, extra + top);
            if (c < bestCost - 1e-9) {
              best = box;
              bestCost = c;
            }
          }
        }
      }
    }
    // Moving has to be worth it: a small gain stays put, so a model's own choice survives where it was fine.
    // Nowhere is free (the whole page is text): do not shuffle it about, leave it where the model put it.
    // (Unless where it was written is on the page's controls or figures and the best place is not: then it moves, onto the prose.)
    if (this.ink.mean(best) > 0.3 && this.fixtures.mean(best) >= this.fixtures.mean(home)) return home;
    return homeCost - bestCost < 0.25 ? home : best;
  }

  /** Where the stage goes: the nearest rectangle of its shape (or a little smaller) that is off the page's text and what is pointed at. */
  panel(want: Box): Box {
    // What the answer points at is what the stage explains or sits beside: covering it counts for three times what covering the page's text does.
    const placed = this.search(want, [1, 0.88, 0.76, 0.64, 0.52], [...this.reserved, ...this.reserved, ...this.reserved]);
    this.stage = placed;
    return placed;
  }

  /** Where a card or crop goes: the nearest free place, keeping out of the stage, the other cards and what is pointed at. */
  card(want: Box, id?: string): Box {
    const keepOut = [...this.reserved, ...this.cards.values(), ...(this.stage ? [this.stage] : [])];
    const placed = this.search(want, [1], keepOut, [1], 0, true);
    this.cards.set(id ?? `#${this.cards.size}`, placed);
    return placed;
  }

  /** Where a flat diagram goes: like a card, but it may also be a little smaller, down to three quarters (its drawing scales to its rectangle, and its small print needs the room). */
  diagram(want: Box, id: string, asked: Box = want, minRatio = 0): Box {
    const keepOut = [...this.reserved, ...[...this.cards].filter(([k]) => k !== id).map(([, b]) => b), ...(this.stage ? [this.stage] : [])];
    // What the answer points at is what the diagram explains: keeping off it counts for three times as much as it does for a card.
    // It may also be taller and narrower (down to 0.6 of the width), to fit a margin or the gap beside a column of text instead of covering the text.
    // A kind that is spoilt by a strip (a chart) has a least width to height; it gives up size before shape, down to 0.64.
    // It goes smaller before it covers the page's controls or figures: down to what it can still be read at (DIAGRAM_MIN_SIZE).
    const placed = this.search(want, [1, 0.88, 0.76, 0.64], [...keepOut, ...this.reserved, ...this.reserved], [1, 0.8, 0.65, 0.55, 0.5], 150, true, minRatio, DIAGRAM_MIN_SIZE);
    this.cards.set(id, placed);
    this.homes.set(id, { from: asked, to: placed });
    return placed;
  }

  /**
   * A flat diagram that has to grow (so its nodes read): the larger rectangle is placed again, in the nearest free place for its new size,
   * keeping off the page's text and figures, what is pointed at, the stage and the other cards. Undefined when the place found is worse for
   * the page than where the diagram was (a little more is allowed): it then stays as it was, small.
   */
  regrow(id: string, grown: Box): Box | undefined {
    const was = this.cards.get(id) ?? this.homes.get(id)?.to ?? grown;
    const keepOut = [...this.reserved, ...[...this.cards].filter(([k]) => k !== id).map(([, b]) => b), ...(this.stage ? [this.stage] : [])];
    const placed = this.search(grown, [1], [...keepOut, ...this.reserved, ...this.reserved], [1], 0, true);
    if (this.coverage(placed, keepOut) > this.coverage(was, keepOut) + GROWTH_COVER_SLACK) return undefined;
    this.cards.set(id, placed);
    const home = this.homes.get(id);
    if (home) this.homes.set(id, { from: home.from, to: placed });
    return placed;
  }

  /** What a rectangle costs the page, apart from where it is: the busy, prose and fixture ink under it, and the pointed-at places and cards it covers. */
  private coverage(box: Box, keepOut: readonly Box[]): number {
    const padded = { x: box.x - 6, y: box.y - 10, w: box.w + 12, h: box.h + 20 };
    let c = this.edge.mean(box) * 6 + this.prose.mean(padded) * 30 + this.fixtures.mean(padded) * 30 * FIXTURE_COST;
    for (const r of keepOut) c += (overlap(box, r) / (box.w * box.h)) * 5;
    for (const r of this.reserved) if (overlap(box, r) > 0) c += POINTED_HIT;
    return c;
  }

  /** The flat diagram a point on the screen belongs to (it is inside the rectangle the diagram was asked for), and where it was placed. */
  homeOf(x: number, y: number): { from: Box; to: Box } | undefined {
    for (const h of this.homes.values()) if (x >= h.from.x && x <= h.from.x + h.from.w && y >= h.from.y && y <= h.from.y + h.from.h) return h;
    return undefined;
  }

  aspectOf(): number {
    return this.aspect;
  }

  /** A card that marks may be written on (an enlarged crop): marks written inside the rectangle it was asked for go with it to where it was placed. */
  home(id: string, from: Box, to: Box): void {
    this.homes.set(id, { from, to });
  }

  /**
   * The smallest rectangle the answer pointed at (a box round a picture) that holds the top-left corner of a label and is clearly larger than it:
   * the label belongs to what that box encloses and is kept inside it, so a name on a picture never hangs over its caption or the page beside it.
   */
  holding(x: number, y: number, w: number, h: number): Box | undefined {
    let best: Box | undefined;
    for (const r of this.reserved) {
      if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h || r.w < 1.15 * w || r.h < 1.15 * h) continue;
      if (!best || r.w * r.h < best.w * best.h) best = r;
    }
    return best;
  }

  /** A card or crop went (cleared by id, or all of them): its place is free for the next. */
  release(target: string): void {
    if (target === 'all' || target === 'marks') {
      this.cards.clear();
      this.homes.clear();
    } else {
      this.cards.delete(target);
      this.homes.delete(target);
    }
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
    case 'box': case 'circle': {
      if (!m.rot) return [{ x: m.x, y: m.y, w: m.w, h: m.h }];
      // Turned on the screen's own pixels: work in units of the screen height, then back.
      return [boundsOf(tiltedCorners((m.x + m.w / 2) * aspect, m.y + m.h / 2, m.w * aspect, m.h, m.rot).map(([x, y]) => [x / aspect, y] as Pt))];
    }
    case 'poly': case 'trace': return [boundsOf(m.pts)];
    case 'point': return [{ x: m.x - 12 / aspect, y: m.y - 12, w: 24 / aspect, h: 24 }];
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

const MARK_OPS: ReadonlySet<string> = new Set(['box', 'circle', 'underline', 'arrow', 'poly', 'point', 'trace', 'label']);

/** The middle of what a mark covers, in units. */
function markCentre(m: Mark, aspect: number): { x: number; y: number } | undefined {
  const foot = markFootprint(m, aspect);
  if (foot.length === 0) return undefined;
  const b = boundsOf(foot.flatMap((f) => [[f.x, f.y], [f.x + f.w, f.y + f.h]] as Pt[]));
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** Whether a mark sits inside one of these rectangles (the places flat diagrams were asked for): it is part of that diagram, not a pointer at the page. */
export function insideAny(a: Action, rects: readonly Box[], aspect: number): boolean {
  if (!MARK_OPS.has(a.op)) return false;
  const c = markCentre(a as Mark, aspect);
  return c !== undefined && rects.some((r) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h);
}

/**
 * The marks of a frame split by ownership: a mark that belongs to a flat diagram (written after it and inside the rectangle it was asked for; `owned` holds
 * their ids) is drawn over the diagram's opaque card, so a ring on a chart's crossing or an arrow at a bar is never hidden by the card it belongs to.
 * Every other mark, even one the card ends up covering, points at the page and stays under the card.
 */
export function splitOwned<T extends { mark: { id?: string } }>(marks: readonly T[], owned: ReadonlySet<string>): { under: T[]; over: T[] } {
  if (owned.size === 0) return { under: [...marks], over: [] };
  const under: T[] = [], over: T[] = [];
  for (const m of marks) (m.mark.id !== undefined && owned.has(m.mark.id) ? over : under).push(m);
  return { under, over };
}

/** The ids of the marks of a whole scene that belong to a flat diagram (see ownedByDiagram). */
export function ownedMarkIds(steps: readonly { actions: readonly Action[] }[], aspect: number): Set<string> {
  const flags = ownedByDiagram(steps, aspect);
  const ids = new Set<string>();
  steps.forEach((step, i) => step.actions.forEach((a, j) => { if (flags[i]![j] && 'id' in a && typeof a.id === 'string') ids.add(a.id); }));
  return ids;
}

/**
 * Which marks of a whole scene belong to a flat diagram, by step and action: those written after the diagram and inside the
 * rectangle it was asked for. A mark written before it (a ring on the page's own graph, then a chart elsewhere) points at the page and stays
 * there, as it does when the answer is drawn as it arrives, where the earlier mark is already on the page when the diagram comes.
 */
export function ownedByDiagram(steps: readonly { actions: readonly Action[] }[], aspect: number): boolean[][] {
  const seen: Box[] = [];
  return steps.map((step) => step.actions.map((a) => {
    if (a.op === 'diagram') {
      seen.push({ x: a.x, y: a.y, w: a.w, h: a.h });
      return false;
    }
    if (a.op === 'image') {
      seen.push({ x: a.dx, y: a.dy, w: a.dw, h: imageCardHeight(a) });
      return false;
    }
    return seen.length > 0 && insideAny(a, seen, aspect);
  }));
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * A mark written inside the rectangle a flat diagram was asked for (a ring on its equilibrium, an arrow at a bar) belongs to the
 * diagram: when the diagram was placed elsewhere or smaller, the mark goes with it, to the same place in the new rectangle.
 * Nothing when the mark is not inside a diagram's rectangle.
 */
export function followDiagram(placer: Placer, a: Action, aspect: number): Action | undefined {
  if (!MARK_OPS.has(a.op)) return undefined;
  const c = markCentre(a as Mark, aspect);
  const home = c ? placer.homeOf(c.x, c.y) : undefined;
  if (!home) return undefined;
  const { from, to } = home;
  const fx = to.w / from.w, fy = to.h / from.h;
  const X = (x: number): number => r1(to.x + (x - from.x) * fx), Y = (y: number): number => r1(to.y + (y - from.y) * fy);
  switch (a.op) {
    case 'box': case 'circle': return { ...a, x: X(a.x), y: Y(a.y), w: r1(a.w * fx), h: r1(a.h * fy) };
    case 'underline': return { ...a, x: X(a.x), y: Y(a.y), w: r1(a.w * fx) };
    case 'arrow': return { ...a, x1: X(a.x1), y1: Y(a.y1), x2: X(a.x2), y2: Y(a.y2) };
    case 'point': return { ...a, x: X(a.x), y: Y(a.y) };
    case 'label': return labelWithin({ ...a, x: X(a.x), y: Y(a.y), ...(a.size !== undefined ? { size: r1(a.size * fy) } : {}) }, to, aspect);
    case 'poly': case 'trace': return { ...a, pts: a.pts.map(([x, y]) => [X(x), Y(y)] as [number, number]) };
    default: return undefined;
  }
}

/** Notes what a set of actions points at, so cards and the stage keep off it. */
export function reserveMarks(placer: Placer, actions: readonly Action[], aspect: number): void {
  for (const a of actions) {
    if (a.op === 'box' || a.op === 'circle' || a.op === 'underline' || a.op === 'arrow' || a.op === 'poly' || a.op === 'point' || a.op === 'trace' || a.op === 'label' || a.op === 'image') {
      for (const b of markFootprint(a, aspect)) placer.reserve(b);
    }
  }
}

/** The most room (units) a kind of flat diagram uses to good effect; asked for more, it is placed at this size. */
const DIAGRAM_MAX: Partial<Record<string, { w: number; h: number }>> = { steps: { w: 440, h: 760 }, chart: { w: 520, h: 520 } };

/** The least width to height (on the screen's pixels) a kind may be squeezed to when it is moved: a chart is read across, a strip of one is not a chart. */
/** The least a flat diagram is made (units): below this its text would be too small to read. */
export const DIAGRAM_MIN_SIZE = { w: 150, h: 150 };

export const DIAGRAM_MIN_RATIO: Partial<Record<string, number>> = { chart: 1.1 };

/** The room a label takes in units: its text at its size and the pill round it (the page draws it as measured, with its colour dot: 2.5 em of padding and dot, 1.85 em tall; this is the same to within a few percent). */
export function labelUnits(a: { text: string; size?: number }, aspect: number): { w: number; h: number } {
  const size = a.size ?? 24;
  return { w: ((a.text.length * 0.56 + 2.5) * size) / aspect, h: size * 1.85 };
}

/** A box of this size put as near as it can to (x, y) while staying inside `inside`; larger than it, it takes the corner. */
function keepInside(x: number, y: number, w: number, h: number, inside: Box): { x: number; y: number } {
  return {
    x: w >= inside.w ? inside.x : Math.min(Math.max(x, inside.x), inside.x + inside.w - w),
    y: h >= inside.h ? inside.y : Math.min(Math.max(y, inside.y), inside.y + inside.h - h),
  };
}

/** A label pulled back inside `inside`, or as it was when it already is. */
function labelWithin(a: Extract<Action, { op: 'label' }>, inside: Box, aspect: number): Action {
  const { w, h } = labelUnits(a, aspect);
  const at = keepInside(a.x, a.y, w, h, inside);
  return at.x === a.x && at.y === a.y ? a : { ...a, x: r1(at.x), y: r1(at.y) };
}

/** How tall an enlarged crop card is, in units: the crop at its true shape, with the card's border and its caption. */
export function imageCardHeight(a: { dw: number; sw: number; sh: number; caption?: string | undefined }): number {
  return (a.dw * a.sh) / Math.max(1, a.sw) + 16 + (a.caption ? 34 : 0);
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
    // A diagram is kept off the page's text like a card, and out of the stage and the other cards. A list of steps or a chart
    // asked for more room than it can use is placed at the size it can (its drawing scales to the rectangle), so it fits a margin.
    const cap = DIAGRAM_MAX[a.kind];
    const want = { x: a.x, y: a.y, w: cap ? Math.min(a.w, cap.w) : a.w, h: cap ? Math.min(a.h, cap.h) : a.h };
    const box = placer.diagram(want, a.id, { x: a.x, y: a.y, w: a.w, h: a.h }, DIAGRAM_MIN_RATIO[a.kind] ?? 0);
    return box.x === a.x && box.y === a.y && box.w === a.w && box.h === a.h ? a : { ...a, ...round(box) };
  }
  if (a.op === 'image') {
    const h = Math.max(40, (a.dw * a.sh) / Math.max(1, a.sw) * 1.6);
    const box = placer.card({ x: a.dx, y: a.dy, w: a.dw, h }, a.id);
    // Marks written on the enlargement (the names of its parts) go with the card to wherever it was put.
    const size = { w: a.dw, h: imageCardHeight(a) };
    placer.home(a.id, { x: a.dx, y: a.dy, ...size }, { x: box.x, y: box.y, ...size });
    return box.x === a.dx && box.y === a.dy ? a : { ...a, dx: Math.round(box.x), dy: Math.round(box.y) };
  }
  if (a.op === 'label') {
    // A name written on a picture the answer boxed stays inside that box: not over its caption, nor out on the page.
    const { w, h } = labelUnits(a, placer.aspectOf());
    const holder = placer.holding(a.x, a.y, w, h);
    return holder ? labelWithin(a, holder, placer.aspectOf()) : a;
  }
  if (a.op === 'clear') placer.release(a.target);
  return a;
}

function boundsOf(pts: readonly Pt[]): Box {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const round = (b: Box): Box => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
