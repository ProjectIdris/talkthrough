// Fitting a mark to the block of the page it covers: a paragraph of text, a ruled table, one line of letters. Pure functions
// over the page's ink grid (snap.ts builds the grid and calls these); every number is in cells of that grid.
//
// A box a model draws round a paragraph or a table usually stops short (a line or two, a few rows): its edge runs through
// a line of letters or through a row. The page's own structure says where the block ends: a paragraph is lines of letters
// at a steady pitch with a bigger gap after the last, a table is rows between long ruled lines at a steady pitch.

/** The page as cells: 1 where there is ink, and 1 where a long straight edge runs (a ruled line, the edge of a band of text). */
export type BlockGrid = { cols: number; rows: number; ink: ArrayLike<number>; strong: ArrayLike<number> };

export type Span = { y0: number; y1: number };

const PAD = 3; // cells of air between a fitted edge and the letters or the rule
const MAX_GROWTH = 2.6; // a fitted box is at most this many times the area of the one written
const MIN_SHARE = 0.4; // the box must hold at least this share of the block's lines or rows to be taken for a box round that block
const MIN_LINE = 4; // a line of letters is at least this tall (a rule or a border is thinner)
const MAX_LINES = 16; // a paragraph longer than this is not one block to box

const median = (v: number[]): number => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

function count(a: ArrayLike<number>, cols: number, x0: number, x1: number, y: number): number {
  let n = 0;
  for (let x = x0; x < x1; x++) n += a[y * cols + x] as number;
  return n;
}

type Band = { top: number; bottom: number }; // rows top..bottom-1

/** Runs of rows whose ink across x0..x1 is at least `need`: lines of letters, or something thicker. */
function bandsIn(g: BlockGrid, x0: number, x1: number, from: number, to: number, need: number): Band[] {
  const out: Band[] = [];
  let start = -1;
  for (let y = from; y <= to; y++) {
    const on = y < to && count(g.ink, g.cols, x0, x1, y) >= need;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { out.push({ top: start, bottom: y }); start = -1; }
  }
  return out;
}

/**
 * The paragraph a box is round: when its top or bottom edge runs through a line of letters and it holds a fair share of the
 * paragraph's lines, the whole paragraph; when it holds only a few, each cut line is completed or left out by which side of
 * it the box mostly covers. Nothing when what is inside is not lines of letters (a picture, a table), or the box is clean.
 * `thick` is the tallest a line of letters may be.
 */
export function fitParagraph(g: BlockGrid, x0: number, y0: number, x1: number, y1: number, thick: number): Span | undefined {
  const a = Math.max(0, Math.round(x0)), b = Math.min(g.cols, Math.round(x1));
  if (b - a < 24) return undefined;
  const need = Math.max(3, 0.08 * (b - a));
  const reach = Math.round(thick * 8);
  const from = Math.max(0, Math.floor(y0) - reach), to = Math.min(g.rows, Math.ceil(y1) + reach);
  const bands = bandsIn(g, a, b, from, to, need);
  // A band only a few cells thick is a rule or a border, not a line of letters.
  const inside = bands.filter((r) => r.bottom > y0 && r.top < y1 && r.bottom - r.top >= MIN_LINE);
  if (inside.length === 0 || inside.length > MAX_LINES) return undefined;
  // Only lines of letters inside: a band thicker than a line is a picture, a heading block or a table.
  if (inside.some((r) => r.bottom - r.top > thick)) return undefined;
  const heights = inside.map((r) => r.bottom - r.top);
  const h = median(heights);
  const gaps: number[] = [];
  for (let i = 1; i < inside.length; i++) gaps.push((inside[i] as Band).top - (inside[i - 1] as Band).bottom);
  const gap = gaps.length > 0 ? median(gaps) : Math.max(2, 0.5 * h);
  // Lines of one paragraph are a line's gap apart; a paragraph, a heading or a picture is further.
  const gapMax = Math.max(gap * 1.8, gap + 3);
  const like = (r: Band): boolean => r.bottom - r.top >= MIN_LINE && r.bottom - r.top <= thick && Math.abs(r.bottom - r.top - h) <= Math.max(3, 0.5 * h);
  const first = bands.indexOf(inside[0] as Band), last = bands.indexOf(inside[inside.length - 1] as Band);
  let lo = first, hi = last;
  while (lo > 0 && like(bands[lo - 1] as Band) && (bands[lo] as Band).top - (bands[lo - 1] as Band).bottom <= gapMax) lo--;
  while (hi < bands.length - 1 && like(bands[hi + 1] as Band) && (bands[hi + 1] as Band).top - (bands[hi] as Band).bottom <= gapMax) hi++;
  const para = bands.slice(lo, hi + 1);
  if (para.length > MAX_LINES) return undefined;
  const topLine = inside[0] as Band, botLine = inside[inside.length - 1] as Band;
  // An edge cuts a line when it runs through the body of it; one on the fringe of the letters (their feet, the blur) is a clean edge.
  const room = (r: Band): number => Math.max(2, 0.25 * (r.bottom - r.top));
  const cutTop = y0 > topLine.top + room(topLine) && y0 < topLine.bottom - room(topLine);
  const cutBottom = y1 < botLine.bottom - room(botLine) && y1 > botLine.top + room(botLine);
  if (!cutTop && !cutBottom) return undefined;
  const covers = inside.filter((r) => (Math.min(r.bottom, y1) - Math.max(r.top, y0)) >= 0.5 * (r.bottom - r.top)).length;
  const whole = covers / para.length >= MIN_SHARE;
  let top = y0, bottom = y1;
  if (cutTop) top = whole ? (para[0] as Band).top - PAD : (topLine.bottom - y0 >= 0.5 * (topLine.bottom - topLine.top) ? topLine.top - PAD : topLine.bottom + PAD);
  if (cutBottom) bottom = whole ? (para[para.length - 1] as Band).bottom + PAD : (y1 - botLine.top >= 0.5 * (botLine.bottom - botLine.top) ? botLine.bottom + PAD : botLine.top - PAD);
  if (bottom - top < h || (bottom - top) * (b - a) > (y1 - y0) * (b - a) * MAX_GROWTH) return undefined;
  return { y0: Math.max(0, top), y1: Math.min(g.rows, bottom) };
}

/** Rows of cells that are one long ruled line across x0..x1: its middle row, for each rule. */
function rulesIn(g: BlockGrid, x0: number, x1: number, from: number, to: number): number[] {
  const span = x1 - x0;
  const out: number[] = [];
  let start = -1, strong = 0;
  for (let y = from; y <= to; y++) {
    const on = y < to && count(g.ink, g.cols, x0, x1, y) >= 0.9 * span;
    if (on && start < 0) { start = y; strong = 0; }
    if (on) strong = Math.max(strong, count(g.strong, g.cols, x0, x1, y));
    if (!on && start >= 0) {
      // A rule is thin and drawn; a solid band of colour or a line of letters packed together is neither.
      if (y - start <= 6 && strong >= 0.6 * span) out.push((start + y - 1) / 2);
      start = -1;
    }
  }
  return out;
}

/**
 * The table a box is round: rows between long ruled lines at a steady pitch. When the box holds at least a share of the
 * table's rows, it becomes the table, as far as the screen shows it (a table that runs off the bottom ends at the last rule
 * there). Nothing when there are too few rules, the box is already the table, or the table is much bigger than the box.
 */
export function fitTable(g: BlockGrid, x0: number, y0: number, x1: number, y1: number): Span | undefined {
  const a = Math.max(0, Math.round(x0)), b = Math.min(g.cols, Math.round(x1));
  if (b - a < 40) return undefined;
  const rules = rulesIn(g, a, b, 0, g.rows);
  const inBox = rules.filter((r) => r >= y0 - PAD - 1 && r <= y1 + PAD + 1);
  // Three rows at least (four rules): a picture in a frame with its caption has two or three rules and is not a table.
  if (inBox.length < 4) return undefined;
  const steps: number[] = [];
  for (let i = 1; i < inBox.length; i++) steps.push((inBox[i] as number) - (inBox[i - 1] as number));
  const pitch = median(steps);
  if (pitch < 6) return undefined;
  // The rows of the box are at one pitch (a header may be taller): most steps agree closely.
  if (steps.filter((s) => s <= pitch * 1.35 && s >= pitch * 0.74).length < Math.max(2, steps.length * 0.6)) return undefined;
  let i0 = rules.indexOf(inBox[0] as number), i1 = rules.indexOf(inBox[inBox.length - 1] as number);
  while (i0 > 0 && (rules[i0] as number) - (rules[i0 - 1] as number) <= pitch * 1.5 && (rules[i0] as number) - (rules[i0 - 1] as number) >= pitch * 0.65) i0--;
  while (i1 < rules.length - 1 && (rules[i1 + 1] as number) - (rules[i1] as number) <= pitch * 1.5 && (rules[i1 + 1] as number) - (rules[i1] as number) >= pitch * 0.65) i1++;
  let top = rules[i0] as number, bottom = rules[i1] as number;
  // A table that runs off the screen: the rows go on to its edge.
  if (g.rows - bottom <= pitch * 1.2 && g.rows - bottom > 1 && count(g.ink, g.cols, a, b, g.rows - 1) > 0) bottom = g.rows - 1;
  const total = i1 - i0 + 1;
  if (inBox.length / total < MIN_SHARE) return undefined;
  const nt = top - PAD, nb = bottom + PAD;
  if (Math.abs(nt - y0) + Math.abs(nb - y1) < 4) return undefined;
  if ((nb - nt) > (y1 - y0) * MAX_GROWTH) return undefined;
  return { y0: Math.max(0, nt), y1: Math.min(g.rows, nb) };
}

/**
 * Where an underline should start and end along its line of letters: not past the end of the text (a gutter, a picture, the
 * page's edge) and starting at a word and not in the space before it. `y` is the row just under the letters. Returns the
 * columns, or nothing when the row above is not a line of letters.
 */
export function fitUnderline(g: BlockGrid, x0: number, x1: number, y: number, thick: number): { x0: number; x1: number } | undefined {
  const top = Math.max(0, y - Math.max(4, Math.round(thick * 0.45))), bot = Math.min(g.rows - 1, y - 1);
  if (bot - top < 2) return undefined;
  const occupied = (x: number): boolean => {
    for (let r = top; r <= bot; r++) if (g.ink[r * g.cols + x]) return true;
    return false;
  };
  const gutter = Math.max(7, Math.round(g.cols * 0.009)); // blank this wide is the space between columns, not between words
  const word = 2; // blank this wide is the space between two words
  let a = Math.max(0, Math.round(x0));
  const b = Math.min(g.cols, Math.round(x1));
  if (b - a < 6) return undefined;
  let any = false;
  for (let x = a; x < b; x++) if (occupied(x)) { any = true; break; }
  if (!any) return undefined;
  // The end: the first gutter after the start stops the line.
  let blank = 0, end = a;
  for (let x = a; x < b; x++) {
    if (occupied(x)) { end = x + 1; blank = 0; } else if (++blank >= gutter && end > a) break;
  }
  // A start in the blank before the first word moves onto it; one in the middle of a word moves back to its first letter.
  while (a < end && !occupied(a)) a++;
  {
    let blank = 0, start = a, found = false;
    for (let x = a - 1; x >= 0 && a - x <= 10; x--) {
      if (occupied(x)) { blank = 0; start = x; } else if (++blank >= word) { found = true; break; }
    }
    if (found) a = start;
  }
  if (end - a < 6) return undefined;
  return { x0: a, x1: end };
}
