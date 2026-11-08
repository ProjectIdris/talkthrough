import { imageCaptionLines } from './image-caption.ts';
// Where the 3D stage and the note cards go on the page. A model writes coordinates blind to what is on the
// screen; this looks at a small grayscale picture of the page and moves a stage or a card off its text (and off
// what the answer points at) into the nearest free place, so a model never covers the article it is explaining.
// Pure (no DOM): the page hands it the grid and asks about each rectangle in scene units (0 to 1000 across each axis).

import type { Action, Mark } from '../scene/types.ts';
import { edgeGrid } from './labels.ts';
import { tiltedCorners } from './shapes.ts';
import type { Pt } from './shapes.ts';

export type Box = { x: number; y: number; w: number; h: number };

/** Visible overlay rectangles in CSS pixels, expressed in the scene's 0..1000 display units. */
export function displayBoxesFromPixels(rects: readonly Box[], width: number, height: number): Box[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];
  const out: Box[] = [];
  for (const r of rects) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.w <= 0 || r.h <= 0) continue;
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    const x1 = Math.min(width, r.x + r.w), y1 = Math.min(height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: x0 * 1000 / width, y: y0 * 1000 / height, w: (x1 - x0) * 1000 / width, h: (y1 - y0) * 1000 / height });
  }
  return out;
}

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

/**
 * A 3D stage the model asked for small is given more room where the page is blank beside it: grown up to this many times its size, but not past
 * a width and a height (units; about a quarter of the screen across) that leave the cards after it their room. A model drawn into a few hundred pixels of a large screen is hard to read and to turn.
 */
const STAGE_GROW = 2;
const STAGE_BIGGEST = { w: 320, h: 560 };
/** Growth under this factor is not worth moving the stage for. */
const STAGE_GROW_LEAST = 1.12;

/** A place has to be this much cheaper (a few percent of the page's text under it) before a card, diagram or stage leaves where it was asked for: text may be covered when that reads better. */
const MOVE_WORTH = 8;
const TOP_BAND = 200;
const TOP_COST = 6;

export type PlacerOptions = { aspect: number; /** Keep this far (units) from the edge of the screen. */ margin?: number; /** The screen's height in pixels: the page draws no text smaller than 11 px, which a label's room allows for. */ height?: number; sourceAspect?: number; measureCaption?: (text: string) => number; onImpossible?: () => void };

export class Placer {
  private edge: Sums;
  /** The share of cells with an edge in them: how much of a rectangle has anything on it. */
  private ink: Sums;
  /** The ink that is plain body text, and the rest of it (controls, figures, sidebars): covering the second counts for more. */
  private prose: Sums;
  private fixtures: Sums;
  private luma: Sums;
  private reserved: Box[] = [];
  private controls: readonly Box[] = [];
  private heightPx: number | undefined;
  private sourceAspect: number;
  private measureCaption?: (text: string) => number;
  private onImpossible?: () => void;
  private reportedImpossible = false;
  /** The points marked so far, as they are finally placed, and whether a label has been put beside each. */
  private points: Array<{ id: string; x: number; y: number; color: string; taken: boolean; ahead?: true }> = [];
  /** Where the labels went (their final rectangles), so the next does not land on them. */
  private labelled: Array<Box & { id: string }> = [];
  private cards = new Map<string, Box>();
  private visible = new Map<string, Box>();
  private visibleKeys = new Map<string, number>();
  private actual = new Map<string, Box>();
  private desired = new Map<string, Box>();
  private sourceBoxes = new Map<string, Box>();
  /** Each flat diagram's rectangle as asked for and as placed: marks written inside the first go with it to the second. */
  private homes = new Map<string, { from: Box; to: Box }>();
  private stage: Box | undefined;
  private stageControls: readonly Box[] = [];
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
    this.heightPx = options.height;
    this.sourceAspect = options.sourceAspect ?? options.aspect;
    this.measureCaption = options.measureCaption;
    this.onImpossible = options.onImpossible;
  }

  sourceRatio(): number { return this.sourceAspect; }
  captionMeasure(): ((text: string) => number) | undefined { return this.measureCaption; }

  /** A new turn: what the last answer pointed at is no longer being kept clear (the stage stays where it is). */
  reset(): void {
    this.reserved = [];
    this.reportedImpossible = false;
    this.cards = new Map(this.visible);
    this.points = [];
    this.labelled = [];
  }

  /** Carry live placement identity across screenshot and viewport cache renewal. */
  snapshot(): { cards: Map<string, Box>; visible: Map<string, Box>; keys: Map<string, number>; actual: Map<string, Box>; desired: Map<string, Box>; sourceBoxes: Map<string, Box>; homes: Map<string, { from: Box; to: Box }>; stageControls: readonly Box[]; stage?: Box } {
    return { cards: new Map(this.cards), visible: new Map(this.visible), keys: new Map(this.visibleKeys), actual: new Map(this.actual), desired: new Map(this.desired), sourceBoxes: new Map(this.sourceBoxes), homes: new Map(this.homes), stageControls: this.stageControls.map((b) => ({ ...b })), ...(this.stage ? { stage: { ...this.stage } } : {}) };
  }

  restore(saved: ReturnType<Placer['snapshot']>): void {
    this.cards = new Map(saved.cards); this.visible = new Map(saved.visible); this.visibleKeys = new Map(saved.keys); this.actual = new Map(saved.actual); this.desired = new Map(saved.desired); this.sourceBoxes = new Map(saved.sourceBoxes);
    this.homes = new Map(saved.homes); this.stageControls = saved.stageControls.map((b) => ({ ...b })); this.stage = saved.stage ? { ...saved.stage } : undefined;
  }

  /** Rehydrate and prune from identities that are still drawn. */
  syncVisible(surfaces: readonly { id: string; box: Box; key?: number }[]): void {
    const ids = new Set(surfaces.map((s) => s.id));
    for (const id of this.visible.keys()) if (!ids.has(id)) { this.cards.delete(id); this.actual.delete(id); this.desired.delete(id); this.sourceBoxes.delete(id); this.homes.delete(id); this.visibleKeys.delete(id); }
    for (const surface of surfaces) {
      const previous = this.visibleKeys.get(surface.id);
      const replaced = surface.key !== undefined && previous !== undefined && previous !== surface.key;
      const prior = this.sourceBoxes.get(surface.id);
      if (!this.cards.has(surface.id) || replaced) {
        this.cards.set(surface.id, surface.box); this.actual.delete(surface.id); this.desired.delete(surface.id);
      } else if (prior) {
        const dx = surface.box.x - prior.x, dy = surface.box.y - prior.y;
        for (const map of [this.cards, this.actual, this.desired]) {
          const b = map.get(surface.id);
          if (b) map.set(surface.id, { ...b, x: b.x + dx, y: b.y + dy, ...(map === this.cards ? { w: surface.box.w, h: surface.box.h } : {}) });
        }
      }
      this.sourceBoxes.set(surface.id, surface.box);
      if (surface.key !== undefined) this.visibleKeys.set(surface.id, surface.key);
    }
    this.visible = new Map(surfaces.map((s) => [s.id, this.cards.get(s.id) ?? s.box]));
  }

  surface(id: string): Box | undefined { return this.cards.get(id); }
  publishSurface(id: string, box: Box): void { this.actual.set(id, box); }

  /** Reflow rendered surfaces that collide with the current stage, stage buttons, or visible controls. */
  syncRenderedStage(stage: Box | undefined, controls: readonly Box[] = []): Map<string, Box> {
    this.stage = stage;
    this.stageControls = controls;
    const obstacles = [...(stage ? [stage] : []), ...controls, ...this.controls];
    const moved = new Map<string, Box>();
    for (const [id, box] of this.cards) {
      const shown = this.actual.get(id) ?? box;
      if (!obstacles.some((r) => overlap(shown, r) > 0)) continue;
      const target = this.desired.get(id);
      if (target && !obstacles.some((r) => overlap({ ...target, w: shown.w, h: shown.h }, r) > 0)) continue;
      const keep = [...this.reserved, ...[...this.cards].filter(([key]) => key !== id).map(([key, b]) => this.actual.get(key) ?? b), ...obstacles];
      const next = this.search(shown, [1], keep, [1], 0, true);
      const shifted = { ...box, x: box.x + next.x - shown.x, y: box.y + next.y - shown.y };
      this.cards.set(id, shifted);
      if (next.x !== shown.x || next.y !== shown.y) { moved.set(id, shifted); this.desired.set(id, next); }
      if (this.visible.has(id)) this.visible.set(id, shifted);
    }

    return moved;
  }

  /** The page under a rectangle is being pointed at, or is otherwise to be kept clear. */
  reserve(box: Box): void {
    this.reserved.push(box);
  }

  /** Control bounds already supplied for this capture; no new accessibility reads. */
  setControls(boxes: readonly Box[]): void { this.controls = boxes; }

  /** The stage's own rectangle (cards keep out of it). */
  setStage(box: Box | undefined): void {
    this.stage = box;
    if (!box) this.stageControls = [];
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

  private search(want: Box, scales: readonly number[], keepOut: readonly Box[], shapes: readonly number[] = [1], minW = 0, avoidTop = false, minRatio = 0, minSize: { w: number; h: number } = { w: 0, h: 0 }, diagnose = true): Box {
    const marginFor = (length: number): number => length <= 1000 - 2 * this.margin ? this.margin : 0;
    const inside = (b: Box): Box => {
      const mx = marginFor(b.w), my = marginFor(b.h);
      return { x: clamp(b.x, mx, 1000 - mx - b.w), y: clamp(b.y, my, 1000 - my - b.h), w: b.w, h: b.h };
    };
    if (want.w > 1000 || want.h > 1000) { if (diagnose) this.impossible(); return want; }
    const home = inside(want);
    const homeCost = this.cost(home, want, 1, keepOut);
    // Where it already is fine: blank page, nothing pointed at beneath it.
    if (this.ink.mean({ x: home.x - 6, y: home.y - 10, w: home.w + 12, h: home.h + 20 }) < BLANK && !keepOut.some((r) => overlap(home, r) > 0)) return home;
    let best = home;
    let bestCost = homeCost;
    let bestClear: {box: Box; cost: number} | undefined = !keepOut.some((r) => overlap(home, r) > 0) ? { box: home, cost: homeCost } : undefined;
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
        const mx = marginFor(w), my = marginFor(h);
        const xs = new Set<number>([mx, 1000 - mx - w, ...keepOut.flatMap((r) => [Math.floor(r.x - w), Math.ceil(r.x + r.w)])]);
        const ys = new Set<number>([my, 1000 - my - h, ...keepOut.flatMap((r) => [Math.floor(r.y - h), Math.ceil(r.y + r.h)])]);
        for (let x = mx; x + w <= 1000 - mx + 0.01; x += step) xs.add(x);
        for (let y = my; y + h <= 1000 - my + 0.01; y += step) ys.add(y);
        for (const y of ys) {
          for (const x of xs) {
            if (x < mx || y < my || x + w > 1000 - mx + 0.01 || y + h > 1000 - my + 0.01) continue;
            const box = { x, y, w, h };
            const top = avoidTop && want.y >= TOP_BAND ? (Math.max(0, Math.min(box.y + box.h, TOP_BAND) - box.y) / box.h) * TOP_COST : 0;
            const c = this.cost(box, want, scale, keepOut, extra + top);
            if (!keepOut.some((r) => overlap(box, r) > 0) && (!bestClear || c < bestClear.cost - 1e-9)) bestClear = { box, cost: c };
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
    if (keepOut.some((r) => overlap(home, r) > 0)) {
      if (bestClear) return bestClear.box;
      if (diagnose) this.impossible();
    }
    if (bestClear && keepOut.some((r) => overlap(best, r) > 0)) { best = bestClear.box; bestCost = bestClear.cost; }
    if (this.ink.mean(best) > 0.3 && this.fixtures.mean(best) >= this.fixtures.mean(home)) return home;
    return homeCost - bestCost < (keepOut.some((r) => overlap(home, r) > 0) ? 0.25 : MOVE_WORTH) ? home : best;
  }

  private impossible(): void { if (!this.reportedImpossible) { this.reportedImpossible = true; this.onImpossible?.(); } }

  /** Where the stage goes: the nearest rectangle of its shape (or a little smaller) that is off the page's text and what is pointed at. */
  panel(want: Box): Box {
    // What the answer points at is what the stage explains or sits beside: covering it counts for three times what covering the page's text does.
    // Explanation first: the stage keeps the size it was asked for (it moves to the quietest place of that size, and may sit over page text if that
    // is where it reads best); it is made smaller only when no place of its size is clear of what the answer points at.
    const keep = [...this.reserved, ...this.reserved, ...this.reserved, ...this.controls, ...this.cards.values()];
    const full = this.search(want, [1], keep, [1], 0, false, 0, { w: 0, h: 0 }, false);
    const placed = this.enlarge(keep.some((r) => overlap(full, r) > 0) ? this.search(want, [1, 0.88, 0.76, 0.64, 0.52], keep) : full);
    this.stage = placed;
    this.stageControls = [];
    return placed;
  }

  /**
   * A small stage made larger when the blank page beside it has room: the biggest growth (about its own centre, or from one of its corners,
   * so it can spread toward the free side) that is still blank, clear of what the answer points at and of the cards, and inside the screen.
   * A stage that sits on text, or is already large, is left as it is.
   */
  private enlarge(box: Box): Box {
    const most = Math.min(STAGE_GROW, STAGE_BIGGEST.w / box.w, STAGE_BIGGEST.h / box.h);
    if (!(most >= STAGE_GROW_LEAST)) return box;
    const avoid = [...this.reserved, ...this.controls, ...this.cards.values()];
    const lo = this.margin;
    const grow = (blankOnly: boolean): { box: Box; f: number } | undefined => {
      for (let f = most; f >= STAGE_GROW_LEAST - 1e-9; f -= 0.1) {
        const w = box.w * f, h = box.h * f;
        const anchors: Array<[number, number]> = [
          [box.x + (box.w - w) / 2, box.y + (box.h - h) / 2], // about the centre
          [box.x, box.y], [box.x + box.w - w, box.y], [box.x, box.y + box.h - h], [box.x + box.w - w, box.y + box.h - h], // from each corner
        ];
        let best: { box: Box; cost: number } | undefined;
        for (const [ax, ay] of anchors) {
          const x = clamp(ax, lo, 1000 - lo - w), y = clamp(ay, lo, 1000 - lo - h);
          const grown = { x, y, w, h };
          const padded = { x: x - 6, y: y - 10, w: w + 12, h: h + 20 };
          if (avoid.some((r) => overlap(grown, r) > 0)) continue;
          if (blankOnly && this.ink.mean(padded) >= BLANK) continue;
          const cost = blankOnly ? 0 : this.edge.mean(grown) * 6 + this.prose.mean(padded) * 30 + this.fixtures.mean(padded) * 30 * FIXTURE_COST;
          if (!best || cost < best.cost) best = { box: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }, cost };
          if (blankOnly) break;
        }
        if (best) return { box: best.box, f };
      }
      return undefined;
    };
    // Into blank page first; when that gives only a little of what the stage could have, into page text too (an explanation is the priority, and
    // text under a stage is the lesser loss), still never over what the answer points at or over the cards.
    const blank = grow(true);
    if (blank && blank.f >= most - 0.15) return blank.box;
    const over = grow(false);
    if (over && over.f > (blank?.f ?? 1) + 0.2) return over.box;
    return blank?.box ?? box;
  }

  /** The stage as something to keep a card or diagram off: it counts several times over, because the model in it is what is being explained. */
  private stageKeepOut(): Box[] {
    return this.stage ? [...Array.from({ length: 8 }, () => this.stage as Box), ...this.stageControls] : [];
  }

  /** Where a card or crop goes: the nearest free place, keeping out of the stage, the other cards and what is pointed at. */
  card(want: Box, id?: string): Box {
    const keepOut = [...this.reserved, ...this.controls, ...[...this.cards].filter(([key]) => key !== id).map(([, box]) => box), ...this.stageKeepOut()];
    const placed = this.search(want, [1], keepOut, [1], 0, true);
    const key = id ?? `#${this.cards.size}`;
    this.cards.set(key, placed);
    this.desired.delete(key);
    this.actual.delete(key);
    this.sourceBoxes.delete(key);
    return placed;
  }

  /** Where a flat diagram goes: like a card, but it may also be a little smaller, down to three quarters (its drawing scales to its rectangle, and its small print needs the room). */
  diagram(want: Box, id: string, asked: Box = want, minRatio = 0): Box {
    const keepOut = [...this.reserved, ...this.controls, ...[...this.cards].filter(([k]) => k !== id).map(([, b]) => b), ...this.stageKeepOut()];
    // What the answer points at is what the diagram explains: keeping off it counts for three times as much as it does for a card.
    // It may also be taller and narrower (down to 0.6 of the width), to fit a margin or the gap beside a column of text instead of covering the text.
    // A kind that is spoilt by a strip (a chart) has a least width to height; it gives up size before shape, down to 0.64.
    // It goes smaller before it covers the page's controls or figures: down to what it can still be read at (DIAGRAM_MIN_SIZE).
    // Explanation first: it keeps the size and the shape it was asked for, and goes to the quietest place of that size, over page text if that reads best.
    // Only when no such place is clear of what the answer points at, the cards and the stage does it go smaller or narrower, as before.
    const keep = [...keepOut, ...this.reserved, ...this.reserved];
    const full = this.search(want, [1], keep, [1], 0, true, minRatio, DIAGRAM_MIN_SIZE, false);
    const placed = keepOut.some((r) => overlap(full, r) > 0)
      ? this.search(want, [1, 0.88, 0.76, 0.64], keep, [1, 0.8, 0.65, 0.55, 0.5], 150, true, minRatio, DIAGRAM_MIN_SIZE)
      : full;
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
    const keepOut = [...this.reserved, ...this.controls, ...[...this.cards].filter(([k]) => k !== id).map(([, b]) => b), ...this.stageKeepOut()];
    const placed = this.search(grown, [1], [...keepOut, ...this.reserved, ...this.reserved], [1], 0, true);
    // A small coverage cost can still mean a whole line of another panel is hidden.
    if (keepOut.some((r) => overlap(placed, r) > 0)) return undefined;
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

  /** Exact surface identity for a newly streamed mark, before placement changes its coordinates. */
  ownerOf(a: Action): string | undefined {
    const c = MARK_OPS.has(a.op) ? markCentre(a as Mark, this.aspect) : undefined;
    if (c) for (const [id, home] of this.homes) {
      const r = home.from;
      if (c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h) return id;
    }
    return undefined;
  }

  aspectOf(): number {
    return this.aspect;
  }

  /** The room a label takes here, in units (see labelUnits). */
  labelRoom(a: { text: string; size?: number }): { w: number; h: number } {
    return labelUnits(a, this.aspect, this.heightPx);
  }

  /** A card that marks may be written on (an enlarged crop): marks written inside the rectangle it was asked for go with it to where it was placed. */
  home(id: string, from: Box, to: Box): void {
    this.homes.set(id, { from, to });
  }

  /** Update the displayed destination without replacing its authored source. */
  syncHomeDisplay(id: string, displayed: Box, current: Box): void {
    const home = this.homes.get(id);
    if (home) this.homes.set(id, { from: home.from, to: { ...home.to, x: current.x, y: current.y } });
    else this.homes.set(id, { from: displayed, to: current });
  }

  /** Mapping for marks already placed in the player, not newly streamed marks. */
  displayedHomeOf(x: number, y: number): { from: Box; to: Box } | undefined {
    for (const [id] of this.homes) {
      const from = this.sourceBoxes.get(id);
      const to = this.cards.get(id);
      if (from && to && x >= from.x && x <= from.x + from.w && y >= from.y && y <= from.y + from.h)
        return { from, to };
    }
    return undefined;
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

  /** A point was marked, at the place it finally took. */
  notePoint(id: string, x: number, y: number, color: string): void {
    const taken = this.points.some((q) => q.id === id && q.taken); // a name written before the point already has it
    this.points = this.points.filter((q) => q.id !== id);
    this.points.push({ id, x, y, color, taken });
  }

  /**
   * A point that comes later in the step, at about where it will be: the names written before it keep off its ring, and a name written before it
   * may take it when no point of its colour was marked before (a name that comes first). It is no name's of another colour until it is marked itself (notePoint).
   */
  foresee(id: string, x: number, y: number, color: string): void {
    if (!this.points.some((q) => q.id === id)) this.points.push({ id, x, y, color, taken: false, ahead: true });
  }

  /**
   * The point a label names, then taken: the nearest one that has no label yet, of the label's own colour within LABEL_REACH (in units of the
   * screen's height), a point already marked before one still to come in the step; failing that, a point of any colour within the much shorter
   * LABEL_REACH_ANY (a title written near an unrelated point is not that point's name). Undefined when there is none: the label stands as it is.
   */
  takePoint(label: { x: number; y: number; color: string }, w: number, h: number): { id: string; x: number; y: number } | undefined {
    const cx = label.x + w / 2, cy = label.y + h / 2;
    const far = (q: { x: number; y: number }): number => Math.hypot((q.x - cx) * this.aspect, q.y - cy);
    // Where the answer wrote the name's corner, to the point, in plain units: how close it was written to the point it means.
    const written = (q: { x: number; y: number }): number => Math.hypot(q.x - label.x, q.y - label.y);
    const nearest = (ok: (q: (typeof this.points)[number]) => boolean, dist: (q: { x: number; y: number }) => number, reach: number): (typeof this.points)[number] | undefined => {
      let best: (typeof this.points)[number] | undefined;
      for (const q of this.points) if (!q.taken && ok(q) && dist(q) <= reach && (!best || dist(q) < dist(best))) best = q;
      return best;
    };
    const best = nearest((q) => !q.ahead && q.color === label.color, far, LABEL_REACH)
      ?? nearest((q) => !!q.ahead && q.color === label.color, far, LABEL_REACH)
      ?? nearest((q) => !q.ahead, written, LABEL_REACH_ANY);
    if (best) best.taken = true;
    return best;
  }
  /** The rectangle a mark placed at (x, y) is kept inside: the card or diagram it sits on, else the picture the answer boxed, else the screen. */
  roomAt(x: number, y: number, w: number, h: number): Box {
    let card: Box | undefined;
    for (const home of this.homes.values()) {
      const t = home.to;
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h && (!card || t.w * t.h < card.w * card.h)) card = t;
    }
    return card ?? this.holding(x, y, w, h) ?? { x: 0, y: 0, w: 1000, h: 1000 };
  }

  /** A label's final rectangle: the next ones keep off it. */
  noteLabel(id: string, box: Box): void {
    this.labelled = this.labelled.filter((q) => q.id !== id);
    this.labelled.push({ id, ...box });
  }

  /** Whether a rectangle lands on a label already placed, or on a point other than the one the label names (the ring drawn on it). */
  onLabel(box: Box, except: string, ownPoint: string): boolean {
    const ring = POINT_RING;
    return this.labelled.some((q) => q.id !== except && overlap(box, q) > 1)
      || this.points.some((q) => q.id !== ownPoint && overlap(box, { x: q.x - ring / this.aspect, y: q.y - ring, w: (2 * ring) / this.aspect, h: 2 * ring }) > 1);
  }

  /** A card or crop went (cleared by id, or all of them): its place is free for the next. */
  release(target: string): void {
    if (target === 'all' || target === 'panel') { this.stage = undefined; this.stageControls = []; }
    if (target === 'all' || target === 'marks') {
      this.cards.clear();
      this.visible.clear();
      this.visibleKeys.clear();
      this.actual.clear();
      this.desired.clear();
      this.sourceBoxes.clear();
      this.homes.clear();
      this.points = [];
      this.labelled = [];
    } else {
      this.cards.delete(target);
      this.visible.delete(target);
      this.visibleKeys.delete(target);
      this.actual.delete(target);
      this.desired.delete(target);
      this.sourceBoxes.delete(target);
      this.homes.delete(target);
      this.points = this.points.filter((q) => q.id !== target);
      this.labelled = this.labelled.filter((q) => q.id !== target);
    }
  }
}

// ---- Actions -----------------------------------------------------------------------------------

/** How tall a card will be, in units of the screen's height, from its rows and layout (the page measures the real one). */
export function cardHeightUnits(a: Extract<Action, { op: 'card' }>, screenHeight: number): number {
  // Renderer limits title/row wrapping to two lines, timeline descriptions to three.
  // Reserving those maxima bounds the drawn height independently of font metrics.
  const pad = Math.max(12, screenHeight * 0.017);
  const title = Math.max(15, screenHeight * 0.0245);
  const row = Math.max(13, screenHeight * 0.0185);
  let h = pad + (a.title ? 2 * title * 1.33 + row * 0.35 : 0);
  const n = a.rows?.length ?? 0;
  if (a.layout === 'stat' && n > 0) h += Math.max(30, screenHeight * 0.062) * 1.14 + (n - 1) * 2 * row * 1.35;
  else if (a.layout === 'timeline' && n > 0) h += row * (1.9 + 1.7 + 2 * 1.2 + 0.5);
  else h += n * row * (2 * 1.4 + 0.18);
  return ((h + pad * 0.9 + 10) / screenHeight) * 1000;
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

/**
 * Where the cards a mark is drawn on are, in units: a note card (its own rectangle) and the enlarged picture an image mark is drawn on (not the part of
 * the page it was cut from, which markFootprint gives). Something that is shown on the page, and must not be covered by a caption; not a place the answer points at.
 */
export function cardFootprint(m: Mark, screenHeight: number, aspect = 1, sourceAspect = aspect, measureCaption?: (text: string) => number): Box[] {
  if (m.op === 'card') return [{ x: m.x, y: m.y, w: m.w ?? 300, h: cardHeightUnits(m, screenHeight) }];
  if (m.op === 'image') return [{ x: m.dx, y: m.dy, w: Math.min(800, m.dw) + (Math.max(6, screenHeight * 0.008) * 2 / screenHeight / aspect) * 1000, h: imageCardHeight(m, screenHeight, aspect, sourceAspect, measureCaption) }];
  return [];
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
export function ownedMarkIds(steps: readonly { actions: readonly Action[] }[], aspect: number, screenHeight = 1000, sourceAspect = aspect, measureCaption?: (text: string) => number): Set<string> {
  const flags = ownedByDiagram(steps, aspect, screenHeight, sourceAspect, measureCaption);
  const ids = new Set<string>();
  steps.forEach((step, i) => step.actions.forEach((a, j) => { if (flags[i]![j] && 'id' in a && typeof a.id === 'string') ids.add(a.id); }));
  return ids;
}

/**
 * Which marks of a whole scene belong to a flat diagram, by step and action: those written after the diagram and inside the
 * rectangle it was asked for. A mark written before it (a ring on the page's own graph, then a chart elsewhere) points at the page and stays
 * there, as it does when the answer is drawn as it arrives, where the earlier mark is already on the page when the diagram comes.
 */
export function ownedByDiagram(steps: readonly { actions: readonly Action[] }[], aspect: number, screenHeight = 1000, sourceAspect = aspect, measureCaption?: (text: string) => number, owners?: Map<string, string>): boolean[][] {
  const seen: Array<Box & { id: string }> = [];
  return steps.map((step) => step.actions.map((a) => {
    if (a.op === 'diagram') {
      seen.push({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h });
      return false;
    }
    if (a.op === 'image') {
      seen.push({ id: a.id, x: a.dx, y: a.dy, w: a.dw, h: imageCardHeight(a, screenHeight, aspect, sourceAspect, measureCaption) });
      return false;
    }
    const owner = seen.find(r => insideAny(a, [r], aspect));
    if (owners && 'id' in a && typeof a.id === 'string') {
      if (owner) owners.set(a.id, owner.id); else owners.delete(a.id);
    }
    return owner !== undefined;
  }));
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * A mark written inside the rectangle a flat diagram was asked for (a ring on its equilibrium, an arrow at a bar) belongs to the
 * diagram: when the diagram was placed elsewhere or smaller, the mark goes with it, to the same place in the new rectangle.
 * Nothing when the mark is not inside a diagram's rectangle.
 */
export function followDiagram(placer: Placer, a: Action, aspect: number, displayed = false): Action | undefined {
  if (!MARK_OPS.has(a.op)) return undefined;
  const c = markCentre(a as Mark, aspect);
  const home = c ? (displayed ? placer.displayedHomeOf(c.x, c.y) : placer.homeOf(c.x, c.y)) : undefined;
  if (!home) return undefined;
  const { from, to } = home;
  const fx = to.w / from.w, fy = to.h / from.h;
  const X = (x: number): number => r1(to.x + (x - from.x) * fx), Y = (y: number): number => r1(to.y + (y - from.y) * fy);
  switch (a.op) {
    case 'box': case 'circle': return { ...a, x: X(a.x), y: Y(a.y), w: r1(a.w * fx), h: r1(a.h * fy) };
    case 'underline': return { ...a, x: X(a.x), y: Y(a.y), w: r1(a.w * fx) };
    case 'arrow': return { ...a, x1: X(a.x1), y1: Y(a.y1), x2: X(a.x2), y2: Y(a.y2) };
    case 'point': return { ...a, x: X(a.x), y: Y(a.y) };
    case 'label': {
      const moved = { ...a, x: X(a.x), y: Y(a.y), ...(a.size !== undefined ? { size: r1(a.size * fy) } : {}) };
      return labelWithin(moved, to, placer.labelRoom(moved));
    }
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
export function labelUnits(a: { text: string; size?: number }, aspect: number, height?: number): { w: number; h: number } {
  // The page draws no text under 11 px, however small the label asks to be (a name on a shrunken card).
  const size = Math.max(a.size ?? 24, height ? 11000 / height : 0);
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
function labelWithin(a: Extract<Action, { op: 'label' }>, inside: Box, room: { w: number; h: number }): Action {
  const { w, h } = room;
  const at = keepInside(a.x, a.y, w, h, inside);
  return at.x === a.x && at.y === a.y ? a : { ...a, x: r1(at.x), y: r1(at.y) };
}

/** The farthest (in units of the screen's height) a label may be from the point of its own colour that it names. */
export const LABEL_REACH = 180;

/** The same for a point of another colour, from where the name was written to the point in plain units: short, so a title near an unrelated point stays where it was written. */
export const LABEL_REACH_ANY = 70;

/** How far a point's ring reaches from its centre, in units of the screen's height: a name keeps off the rings of the other points. */
const POINT_RING = 14;

/** The space between a point and the label beside it, in units of the screen's height. */
const LABEL_GAP = 18;

/**
 * The name of a point goes just to its right, at the point's height; to its left when there is no room on the right (the edge of the card or
 * picture it is on, or of the screen); and a little up or down when a label, or the ring of another point, is already there. The label is paired with the nearest point of its
 * own colour that has none (else the nearest of any colour) within LABEL_REACH; a label with no point near it stays where the answer put it.
 * The model's own offset is not trusted: one put a name 62 units to the left of its point and 25 below it.
 */
function besidePoint(placer: Placer, a: Extract<Action, { op: 'label' }>): Action {
  const aspect = placer.aspectOf();
  const { w, h } = placer.labelRoom(a);
  const point = placer.takePoint(a, w, h);
  if (!point) {
    placer.noteLabel(a.id, { x: a.x, y: a.y, w, h });
    return a;
  }
  const room = placer.roomAt(point.x, point.y, w, h);
  const gap = LABEL_GAP / aspect;
  const right = point.x + gap, left = point.x - gap - w;
  const fitsRight = right + w <= room.x + room.w, fitsLeft = left >= room.x;
  const xs = fitsRight || !fitsLeft ? [right, left] : [left, right];
  let chosen: { x: number; y: number } | undefined;
  let first: { x: number; y: number } | undefined;
  for (const x of xs) {
    for (const dy of [0, -0.85 * h, 0.85 * h, -1.7 * h, 1.7 * h]) {
      const at = keepInside(x, point.y - h / 2 + dy, w, h, room);
      first ??= at;
      if (!placer.onLabel({ ...at, w, h }, a.id, point.id)) {
        chosen = at;
        break;
      }
    }
    if (chosen) break;
  }
  const at = chosen ?? first!;
  placer.noteLabel(a.id, { ...at, w, h });
  return at.x === a.x && at.y === a.y ? a : { ...a, x: r1(at.x), y: r1(at.y) };
}

/** The points among these marks are made known ahead of their turn, so the names written before them keep off their rings (see Placer.foresee). */
export function foreseePoints(placer: Placer, actions: readonly Action[], aspect: number): void {
  for (const a of actions) {
    if (a.op !== 'point') continue;
    const at = (followDiagram(placer, a, aspect) ?? a) as { x: number; y: number };
    placer.foresee(a.id, at.x, at.y, a.color);
  }
}

/**
 * The last thing done to a mark once it is where it goes: a point is noted, and a label is put beside the point it names (see besidePoint).
 * Marks come in the order the answer wrote them, a point before its name.
 */
export function settleMark(placer: Placer, a: Action): Action {
  if (a.op === 'point') {
    placer.notePoint(a.id, a.x, a.y, a.color);
    return a;
  }
  return a.op === 'label' ? besidePoint(placer, a) : a;
}

/** How tall an enlarged crop card is, in units: the crop at its true shape, with the card's border and its caption. */
export function imageCardHeight(a: { dw: number; sw: number; sh: number; caption?: string | undefined }, screenHeight = 1000, aspect = 1, sourceAspect = aspect, measureCaption?: (text: string) => number): number {
  const w = Math.min(800, a.dw);
  const image = w * aspect / sourceAspect * a.sh / Math.max(1, a.sw);
  const pad = Math.max(6, screenHeight * 0.008);
  const capPx = Math.max(13, screenHeight * 0.018);
  const widthPx = w * aspect * screenHeight / 1000;
  const lines = a.caption ? imageCaptionLines(a.caption, Math.max(1, widthPx - 4), measureCaption ?? ((text) => text.length * capPx)) : [];
  const cap = lines.length ? capPx * (0.9 + lines.length) : 0;
  return image + (pad * 2 + cap + 10) / screenHeight * 1000;
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
    const h = imageCardHeight(a, screenHeight, placer.aspectOf(), placer.sourceRatio(), placer.captionMeasure());
    const pad = Math.max(6, screenHeight * 0.008);
    const width = Math.min(800, a.dw) + (pad * 2 / screenHeight / placer.aspectOf()) * 1000;
    const box = placer.card({ x: a.dx, y: a.dy, w: width, h }, a.id);
    // Marks written on the enlargement (the names of its parts) go with the card to wherever it was put.
    const size = { w: a.dw, h };
    placer.home(a.id, { x: a.dx, y: a.dy, ...size }, { x: box.x, y: box.y, ...size });
    return box.x === a.dx && box.y === a.dy ? a : { ...a, dx: Math.round(box.x), dy: Math.round(box.y) };
  }
  if (a.op === 'label') {
    // A name written on a picture the answer boxed stays inside that box: not over its caption, nor out on the page.
    const { w, h } = placer.labelRoom(a);
    const holder = placer.holding(a.x, a.y, w, h);
    return holder ? labelWithin(a, holder, { w, h }) : a;
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
