import test from 'node:test';
import assert from 'node:assert/strict';
import { Placer, followDiagram, bodyTextOf, cardHeightUnits, markFootprint, pageGrid, placeAction, reserveMarks } from '../src/overlay/placement.ts';
import type { Box } from '../src/overlay/placement.ts';
import type { Action } from '../src/scene/index.ts';

const COLS = 192, ROWS = 108;
/** A page: text lines (dark on white) across the left 55% of the screen, nothing on the right. */
function textPage(textEnd = 0.55) {
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const text = c > 4 && c < COLS * textEnd && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0;
      gray[r * COLS + c] = text ? 40 : 238;
    }
  }
  return pageGrid(gray, COLS, ROWS);
}
const placer = (grid = textPage()) => new Placer(grid, { aspect: 16 / 9 });
const overlaps = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
const inside = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1000 && b.y + b.h <= 1000;

test('a stage written over the text moves to the blank part of the page, and one already on blank page stays', () => {
  const p = placer();
  assert.ok(p.busy({ x: 100, y: 200, w: 300, h: 400 }) > 0.1, 'the test page is busy where the stage was written');
  const moved = p.panel({ x: 100, y: 200, w: 300, h: 400 });
  assert.ok(p.busy(moved) < 0.02, `moved to blank page: ${JSON.stringify(moved)}`);
  assert.ok(moved.w >= 300 * 0.66 && inside(moved));
  assert.ok(moved.x >= 480, 'it went across to the empty side');
  const stays = placer().panel({ x: 640, y: 150, w: 300, h: 600 });
  assert.deepEqual(stays, { x: 640, y: 150, w: 300, h: 600 });
});

test('a stage keeps off what the answer points at', () => {
  const p = placer();
  const pointed: Box = { x: 650, y: 250, w: 200, h: 120 };
  p.reserve(pointed);
  const placed = p.panel({ x: 600, y: 200, w: 300, h: 400 });
  assert.ok(!overlaps(placed, pointed), JSON.stringify(placed));
  assert.ok(inside(placed));
});

test('a card goes off the text, off the stage and off the cards before it, and as near as it can to where it was written', () => {
  const p = placer();
  const stage = p.panel({ x: 600, y: 200, w: 350, h: 500 });
  const first = p.card({ x: 620, y: 220, w: 280, h: 120 });
  assert.ok(!overlaps(first, stage), 'not on the stage');
  const second = p.card({ x: first.x, y: first.y, w: 280, h: 120 });
  assert.ok(!overlaps(second, first) && !overlaps(second, stage), 'not on the first card either');
  const onText = placer().card({ x: 100, y: 300, w: 300, h: 120 });
  assert.ok(placer().busy(onText) < 0.02 && inside(onText));
  const near = placer().card({ x: 700, y: 100, w: 250, h: 100 });
  assert.deepEqual(near, { x: 700, y: 100, w: 250, h: 100 }, 'a card on blank page where it wanted to be stays');
});

test('whatever is asked, the result is on the screen, and a page with nowhere free leaves a stage near where it was written', () => {
  const p = placer();
  for (const want of [{ x: -50, y: -50, w: 300, h: 300 }, { x: 900, y: 900, w: 300, h: 300 }, { x: 0, y: 0, w: 1000, h: 400 }]) {
    const got = p.panel(want);
    assert.ok(inside(got) || got.w > 976, JSON.stringify(got));
  }
  const full = new Placer(textPage(1), { aspect: 16 / 9 });
  const got = full.panel({ x: 300, y: 300, w: 300, h: 300 });
  assert.ok(Math.abs(got.x - 300) < 120 && Math.abs(got.y - 300) < 120, JSON.stringify(got));
});

test('the actions: a stage or card is moved, marks are only noted, and anything else comes back as it was', () => {
  const p = placer();
  const actions: Action[] = [
    { op: 'box', id: 'b', x: 700, y: 300, w: 100, h: 100, color: 'red' },
    { op: 'panel', x: 100, y: 200, w: 300, h: 400 },
    { op: 'card', id: 'c', x: 120, y: 220, w: 200, title: 'Note', rows: ['one', 'two'], color: 'blue' },
    { op: 'orbit', az: 10, el: 5 },
  ];
  reserveMarks(p, actions, 16 / 9);
  const placed = actions.map((a) => placeAction(p, a, 1080));
  const panel = placed[1] as Extract<Action, { op: 'panel' }>;
  const card = placed[2] as Extract<Action, { op: 'card' }>;
  assert.ok(panel.x > 400 && !overlaps(panel, { x: 700, y: 300, w: 100, h: 100 }));
  assert.ok(card.x !== 120 || card.y !== 220);
  assert.ok(!overlaps({ x: card.x, y: card.y, w: 200, h: cardHeightUnits(card, 1080) }, panel));
  assert.equal(placed[0], actions[0]);
  assert.equal(placed[3], actions[3]);
  assert.equal(markFootprint(actions[3] as never, 1.78).length, 0);
});

test('a bright page under a stage reads as bright and a dark one as dark', () => {
  const light = placer();
  assert.ok(light.brightness({ x: 700, y: 100, w: 200, h: 200 }) > 200);
  const dark = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(30), COLS, ROWS), { aspect: 16 / 9 });
  assert.ok(dark.brightness({ x: 0, y: 0, w: 1000, h: 1000 }) < 60);
});

/** A page of dense text with two equally sparse places: a menu row in the top fifth, and a footer in the bottom right. */
function menuPage() {
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const body = r > 24 && r < 70 && c > 4 && c < COLS - 4 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0;
      const sparse = ((r >= 3 && r <= 5) || (r >= 80 && r <= 82)) && c % 3 === 0 && (r < 60 || c > 100) && c > 60;
      gray[r * COLS + c] = body || sparse ? 40 : 238;
    }
  }
  return pageGrid(gray, COLS, ROWS);
}

test('a card or diagram that was not asked for in the top fifth keeps out of it (an app\'s bar and menus look nearly blank), unless asked to be there', () => {
  const want = { x: 120, y: 330, w: 420, h: 150 };
  const away = placer(menuPage()).diagram(want, 'd');
  assert.ok(away.y >= 200, `placed at ${JSON.stringify(away)}`);
  assert.ok(placer(menuPage()).card({ ...want, w: 300 }, 'c').y >= 200, 'a card too');
  // Asked for up there, it stays: the model chose that place.
  const asked = placer(menuPage()).diagram({ x: 400, y: 30, w: 420, h: 150 }, 'e');
  assert.ok(asked.y < 200, `asked place kept: ${JSON.stringify(asked)}`);
});

test('a stage keeps off the figure the answer boxed even when it was written overlapping its edge, and goes smaller before it covers it', () => {
  const p = placer();
  // The blank right 45% of the page; the boxed figure stands in it, and the stage was asked to overlap its right edge by 20 units.
  const figure: Box = { x: 600, y: 150, w: 160, h: 350 };
  p.reserve(figure);
  const placed = p.panel({ x: 740, y: 100, w: 256, h: 350 });
  assert.ok(!overlaps(placed, figure), `clear of the figure: ${JSON.stringify(placed)}`);
  assert.ok(inside(placed) && placed.w >= 256 * 0.76 - 1);
});

test('a stage that was written to overlap only a corner of the figure the answer boxed still moves clear of it (a sliver is still covering it)', () => {
  const p = placer();
  const figure: Box = { x: 600, y: 150, w: 160, h: 350 };
  p.reserve(figure);
  const want: Box = { x: 730, y: 480, w: 230, h: 300 }; // overlaps the figure's bottom right corner by 30 x 20 units
  assert.ok(overlaps(want, figure), 'the test starts with a corner overlap');
  const placed = p.panel(want);
  assert.ok(!overlaps(placed, figure), `clear of the figure: ${JSON.stringify(placed)}`);
});

test('a stage keeps full size when a clear place exists over prose', () => {
  const p = placer();
  const figure: Box = { x: 600, y: 150, w: 160, h: 500 };
  p.reserve(figure);
  const placed = p.panel({ x: 420, y: 200, w: 340, h: 480 });
  assert.ok(!overlaps(placed, figure), `clear of the figure: ${JSON.stringify(placed)}`);
  assert.ok(placed.w >= 340 && inside(placed), `a full size fits over prose: ${JSON.stringify(placed)}`);
});

/**
 * A dense page like an encyclopedia article: a column of prose (left 55%), a figure beside it (an infobox: a dense block 17% wide), a panel
 * of options (sparse, 12% wide) above the free space in the right margin, and a sidebar down the left edge.
 */
function articlePage(freeRight = true) {
  const gray = new Uint8Array(COLS * ROWS);
  gray.fill(238);
  const put = (c0: number, c1: number, r0: number, r1: number, ink: (c: number, r: number) => boolean) => {
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (ink(c, r)) gray[r * COLS + c] = 40;
  };
  put(26, 132, 10, 104, (c, r) => r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0); // prose
  put(138, 170, 28, 50, () => true); // the figure
  put(138, 170, 50, 62, (c, r) => r % 4 < 2 && c % 2 === 0); // its table
  // The panel of options and the sidebar are lists: lines of all lengths, as labels are.
  const list = (c0: number, r0: number, n: number, pitch: number, lengths: number[]) => { for (let k = 0; k < n; k++) put(c0, c0 + lengths[k % lengths.length]!, r0 + k * pitch, r0 + k * pitch + 2, (c) => c % 4 !== 0); };
  list(174, 12, 5, 8, [6, 12, 9, 14, 7]); // the panel of options
  list(4, 14, 17, 5, [8, 14, 18, 10, 16, 6, 12, 17, 9, 15]); // the sidebar
  if (!freeRight) put(138, 190, 64, 104, (c, r) => r % 3 < 2); // the margin is full too
  return pageGrid(gray, COLS, ROWS);
}
const AC = (c: number) => (c / COLS) * 1000; // a grid column in units

test('prose is told from controls and figures: a column of text is body, a sidebar, an infobox and a panel of options are not', () => {
  const grid = articlePage();
  const body = bodyTextOf(grid);
  const at = (c: number, r: number) => body[r * COLS + c]!;
  let prose = 0, fixtures = 0, proseInk = 0, fixtureInk = 0;
  for (let r = 10; r < 104; r++) for (let c = 26; c < 132; c++) if (grid.gray[r * COLS + c]! < 100) { proseInk++; prose += at(c, r); }
  for (const [c0, c1, r0, r1] of [[138, 170, 28, 62], [174, 190, 12, 52], [4, 22, 14, 100]] as const) for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (grid.gray[r * COLS + c]! < 100) { fixtureInk++; fixtures += at(c, r); }
  assert.ok(prose / proseInk > 0.9, `the prose is body: ${(prose / proseInk).toFixed(2)}`);
  assert.ok(fixtures / fixtureInk < 0.15, `the infobox, the options panel and the sidebar are not: ${(fixtures / fixtureInk).toFixed(2)}`);
});

/** A page of one kind of ink: a function says which cells are ink. */
function inkPage(ink: (c: number, r: number) => boolean) {
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = ink(c, r) ? 40 : 238;
  return pageGrid(gray, COLS, ROWS);
}
/** The mean prose weight over the ink in a block of the page. */
function weightOf(grid: ReturnType<typeof pageGrid>, c0: number, c1: number, r0: number, r1: number): number {
  const w = bodyTextOf(grid);
  let sum = 0, n = 0;
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (grid.gray[r * COLS + c]! < 100) { sum += w[r * COLS + c]!; n++; }
  assert.ok(n > 0, 'the block has ink');
  return sum / n;
}

test('the share of a figure that counts as prose ramps with its width, from 15% to 30% of the page, and does not flip at a cliff', () => {
  // A dense block (no lines in it) of each width; 192 columns across.
  const widths = [20, 29, 36, 44, 52, 62];
  const weights = widths.map((w) => weightOf(inkPage((c, r) => c >= 10 && c < 10 + w && r >= 20 && r < 60), 10, 10 + w, 20, 60));
  assert.ok(weights[0]! < 0.1, `10% wide is a fixture: ${weights[0]}`);
  assert.ok(weights[5]! > 0.95, `32% wide is prose: ${weights[5]}`);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i]! >= weights[i - 1]! - 1e-9, `rises with width: ${weights.join(' ')}`);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i]! - weights[i - 1]! < 0.45, `no cliff between neighbours: ${weights.join(' ')}`);
  assert.ok(weights[2]! > 0.1 && weights[2]! < 0.9, `a figure 19% wide is part way: ${weights[2]}`);
});

test('a run wider than 85% of the page is a bar (a toolbar), not prose; a block of regular lines that wide is still prose', () => {
  const bar = inkPage((c, r) => r >= 10 && r < 12 && c >= 6 && c < COLS - 6 && c % 5 !== 0);
  assert.ok(weightOf(bar, 6, COLS - 6, 10, 12) < 0.05, 'one line across the whole page is a toolbar');
  const paragraph = inkPage((c, r) => r >= 10 && r < 90 && r % 4 < 2 && c >= 6 && c < COLS - 6 && (c * 7 + r * 13) % 11 !== 0);
  assert.ok(weightOf(paragraph, 6, COLS - 6, 10, 90) > 0.95, 'a paragraph on a narrow screen is prose whatever its width');
});

test('body text in a narrow column still reads as prose (an ultrawide screen, a split pane, a chat), by the regularity of its lines; a list of labels of the same width does not', () => {
  const narrow = 16; // 8% of the page
  const column = inkPage((c, r) => c >= 90 && c < 90 + narrow && r >= 10 && r < 90 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0);
  assert.ok(weightOf(column, 90, 90 + narrow, 10, 90) > 0.95, 'twenty lines of one width and pitch are text');
  // A chat: lines start together, repeat at a pitch, and run to different lengths, but most of them nearly full.
  const lengths = [16, 15, 16, 9, 16, 14, 16, 16, 10, 15, 16, 12];
  const chat = inkPage((c, r) => { const k = Math.floor((r - 10) / 5); return r >= 10 && r < 70 && (r - 10) % 5 < 2 && c >= 90 && c < 90 + lengths[k]! && c % 4 !== 0; });
  assert.ok(weightOf(chat, 90, 106, 10, 70) > 0.9, `a chat of ragged lines is text: ${weightOf(chat, 90, 106, 10, 70)}`);
  // The same width as a list of labels: lengths all over the place, and uneven spacing.
  const labels = [5, 14, 7, 16, 4, 12, 9, 6];
  const at = [10, 18, 24, 36, 42, 54, 60, 74];
  const list = inkPage((c, r) => { const k = at.findIndex((a) => r >= a && r < a + 2); return k >= 0 && c >= 90 && c < 90 + labels[k]! && c % 4 !== 0; });
  assert.ok(weightOf(list, 90, 106, 10, 80) < 0.2, `a list of labels is not text: ${weightOf(list, 90, 106, 10, 80)}`);
  // Evenly spaced, as a menu is, but with labels of all lengths.
  const menu = inkPage((c, r) => { const k = Math.floor((r - 10) / 6); return r >= 10 && r < 70 && (r - 10) % 6 < 2 && c >= 90 && c < 90 + [5, 14, 7, 16, 4, 12, 9, 6, 15, 8][k]! && c % 4 !== 0; });
  assert.ok(weightOf(menu, 90, 106, 10, 70) < 0.2, `an evenly spaced menu of labels of all lengths is not text: ${weightOf(menu, 90, 106, 10, 70)}`);
});

test('a stack of equal-width controls is not prose: it is as regular as text but has no word spacing (sidebar buttons, a form of fields)', () => {
  // Eight solid buttons of one width at a steady pitch, with a short label inside each (lighter cells in the middle).
  const buttons = inkPage((c, r) => { const k = Math.floor((r - 10) / 8); return r >= 10 && r < 74 && (r - 10) % 8 < 3 && c >= 12 && c < 36 && !(c >= 22 && c < 27 && (r - 10) % 8 === 1); });
  assert.ok(weightOf(buttons, 12, 36, 10, 74) < 0.2, `a sidebar of equal buttons is not text: ${weightOf(buttons, 12, 36, 10, 74)}`);
  // A form of six outlined fields of one width, a pitch of 12: the interior is the page's own colour.
  const fields = inkPage((c, r) => { const k = Math.floor((r - 8) / 12); const at = (r - 8) % 12; return r >= 8 && r < 80 && c >= 90 && c < 118 && (at === 0 || at === 3 || ((at === 1 || at === 2) && (c === 90 || c === 117))); });
  assert.ok(weightOf(fields, 90, 118, 8, 80) < 0.2, `a form of equal fields is not text: ${weightOf(fields, 90, 118, 8, 80)}`);
  // The same stack with word spacing in each line is text again.
  const lines = inkPage((c, r) => r >= 10 && r < 74 && (r - 10) % 8 < 3 && c >= 12 && c < 36 && c % 5 !== 0);
  assert.ok(weightOf(lines, 12, 36, 10, 74) > 0.9, `eight lines of equal length with gaps are text: ${weightOf(lines, 12, 36, 10, 74)}`);
});

test('explanation first: a diagram keeps the size it asked for, over the prose if need be, and still keeps off the page\'s figure and controls where a place of that size is clear of them', () => {
  const p = new Placer(articlePage(), { aspect: 16 / 9 });
  // Asked wide over the prose (150..950): it is not shrunk or narrowed to dodge the text.
  const placed = placeAction(p, { op: 'diagram', id: 't', kind: 'timeline', x: 150, y: 690, w: 800, h: 260 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const figure = { x: AC(138), y: (28 / ROWS) * 1000, w: AC(32), h: (34 / ROWS) * 1000 };
  const options = { x: AC(174), y: (12 / ROWS) * 1000, w: AC(16), h: (40 / ROWS) * 1000 };
  assert.ok(!overlaps(placed, figure), `off the figure: ${JSON.stringify(placed)}`);
  assert.ok(!overlaps(placed, options), 'off the options');
  assert.ok(placed.w === 800 && placed.h === 260, `the size asked for: ${JSON.stringify(placed)}`);
});

test('when nothing is free even at the least size, a diagram covers body text before it covers a figure or controls', () => {
  const p = new Placer(articlePage(false), { aspect: 16 / 9 });
  const placed = placeAction(p, { op: 'diagram', id: 't', kind: 'steps', x: 740, y: 300, w: 220, h: 400 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const fixtures: Box[] = [{ x: AC(138), y: (28 / ROWS) * 1000, w: AC(32), h: (34 / ROWS) * 1000 }, { x: AC(174), y: (12 / ROWS) * 1000, w: AC(16), h: (40 / ROWS) * 1000 }, { x: AC(138), y: (64 / ROWS) * 1000, w: AC(52), h: (40 / ROWS) * 1000 }];
  for (const f of fixtures) assert.ok(!overlaps(placed, f), `off ${JSON.stringify(f)}: ${JSON.stringify(placed)}`);
});

test('a diagram that has to grow is placed again for its new size, at that size, where it costs the page least; or it stays as it was', () => {
  const p = new Placer(articlePage(), { aspect: 16 / 9 });
  const placed = placeAction(p, { op: 'diagram', id: 't', kind: 'flow', x: 740, y: 600, w: 230, h: 260 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const figure = { x: AC(138), y: (28 / ROWS) * 1000, w: AC(32), h: (34 / ROWS) * 1000 };
  const options = { x: AC(174), y: (12 / ROWS) * 1000, w: AC(16), h: (40 / ROWS) * 1000 };
  // Grown about its centre by 1.3, as the drawing would (kept on the page): it now reaches the infobox's table.
  const cx = placed.x + placed.w / 2, cy = placed.y + placed.h / 2;
  const grown = { x: Math.min(1000 - placed.w * 1.3 - 12, cx - placed.w * 0.65), y: cy - placed.h * 0.65, w: placed.w * 1.3, h: placed.h * 1.3 };
  const table = { x: AC(138), y: (50 / ROWS) * 1000, w: AC(32), h: (12 / ROWS) * 1000 };
  assert.ok(overlaps(grown, table) || overlaps(grown, figure) || overlaps(grown, options), `the test starts with the grown card over a figure: ${JSON.stringify(grown)}`);
  const again = p.regrow('t', grown);
  // Either it moves to a place that costs the page less, at the size it asked for, or it stays as it was (undefined); it is never made smaller.
  if (again) assert.ok(Math.abs(again.w - grown.w) < 1e-6 && Math.abs(again.h - grown.h) < 1e-6, 'the size it asked for');
  // Where the page has no free place for the bigger card at all, it stays as it was (undefined), or goes at its size.
  const full = new Placer(articlePage(false), { aspect: 16 / 9 });
  const start = placeAction(full, { op: 'diagram', id: 't', kind: 'flow', x: 740, y: 600, w: 230, h: 260 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const big = { x: start.x - 200, y: start.y - 200, w: start.w + 400, h: start.h + 400 };
  const verdict = full.regrow('t', big);
  assert.ok(verdict === undefined || (Math.abs(verdict.w - big.w) < 1e-6 && Math.abs(verdict.h - big.h) < 1e-6), `at its size or not at all: ${JSON.stringify(verdict)}`);
});

test('a stage the model asked for small is given more room (blank page first, then page text if that is all there is), never over what is pointed at, and not past a comfortable size', () => {
  const small = { x: 700, y: 200, w: 130, h: 200 };
  const grown = placer().panel(small);
  assert.ok(grown.w >= 130 * 1.5 && grown.w <= 320 && grown.h <= 560 && inside(grown), `grown on blank page: ${JSON.stringify(grown)}`);
  assert.ok(placer().busy({ x: grown.x - 6, y: grown.y - 10, w: grown.w + 12, h: grown.h + 20 }) < 0.02, 'and still on blank page');
  // Narrow blank room: an explanation is the priority, so it grows onto the text beside the strip rather than stay a sliver.
  const tight = new Placer(textPage(0.85), { aspect: 16 / 9 }).panel({ x: 880, y: 200, w: 100, h: 200 });
  assert.ok(tight.w >= 100 * 1.5 && inside(tight), `grown past the blank strip: ${JSON.stringify(tight)}`);
  // What the answer points at is not covered by the growth.
  const p = placer();
  const pointed: Box = { x: 700, y: 440, w: 200, h: 60 };
  p.reserve(pointed);
  const beside = p.panel(small);
  assert.ok(!overlaps(beside, pointed), JSON.stringify(beside));
  // A stage already of a comfortable size is left alone.
  assert.deepEqual(placer().panel({ x: 600, y: 150, w: 320, h: 560 }), { x: 600, y: 150, w: 320, h: 560 });
  // A page that is all text: the stage still gets its room; it does not stay small to spare the text.
  const crowded = new Placer(textPage(1), { aspect: 16 / 9 }).panel(small);
  assert.ok(crowded.w >= small.w * 1.5, JSON.stringify(crowded));
});

// Rendered extent, not the placement estimate, is the property under test.
test('wrapped card drawn at a feasible bottom-edge position stays on screen', async () => {
  const { drawCard } = await import('../src/overlay/annotations.ts');
  const view = {width: 1200, height: 800, dpr: 1};
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(255), COLS, ROWS), {aspect: 1.5, height: 800});
  const card = placeAction(p, {op:'card',id:'long',x:20,y:900,w:250,title:'A long title that wraps around',rows:['A long row that wraps across two lines','A second long row that wraps across two lines','A third long row that wraps across two lines']}, 800) as Extract<Action,{op:'card'}>;
  const corners: number[][] = [];
  const ctx = new Proxy({measureText:(s:string)=>({width:s.length*12})} as Record<string, unknown>, {get(t,k:string){return k in t ? t[k] : (...a:number[])=>{if(k==='arcTo' && corners.length<4) corners.push(a);};},set(t,k:string,v){t[k]=v;return true;}}) as unknown as CanvasRenderingContext2D;
  drawCard(ctx, {mark:card,key:1,id:'long',color:[1,1,1],opacity:1,appear:1,fade:1,pulse:0,pulseColor:undefined,tinted:false}, {view,project:()=>undefined}, 0);
  assert.ok(corners[1]![1]! <= view.height, `drawn bottom ${corners[1]![1]} exceeds ${view.height}`);
});

test('captioned image actual footprint fits when a feasible location exists', async () => {
  const { drawImage } = await import('../src/overlay/annotations.ts');
  const view = {width:1920,height:804,dpr:1};
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(255), COLS, ROWS), {aspect:view.width/view.height,height:view.height,sourceAspect:1920/1080} as never);
  const img = placeAction(p, {op:'image',id:'image',sx:100,sy:100,sw:160,sh:184,dx:10,dy:700,dw:250,caption:'Zoom'},view.height) as Extract<Action,{op:'image'}>;
  const corners: number[][] = [];
  const ctx = new Proxy({measureText:(s:string)=>({width:s.length*8})} as Record<string, unknown>, {get(t,k:string){return k in t ? t[k] : (...a:number[])=>{if(k==='arcTo' && corners.length<4) corners.push(a);};},set(t,k:string,v){t[k]=v;return true;}}) as unknown as CanvasRenderingContext2D;
  drawImage(ctx,{mark:img,key:1,id:'image',color:[1,1,1],opacity:1,appear:1,fade:1,pulse:0,pulseColor:undefined,tinted:false},{view,project:()=>undefined,source:{image:{} as CanvasImageSource,width:1920,height:1080}},0);
  assert.ok(corners[1]![1]! <= view.height, `drawn bottom ${corners[1]![1]} exceeds ${view.height}`);
  const { cardFootprint } = await import('../src/overlay/placement.ts');
  const footprint = cardFootprint(img,view.height,view.width/view.height,1920/1080)[0]!;
  assert.ok(footprint.h * view.height / 1000 >= corners[1]![1]! - Math.round(img.dy * view.height / 1000), 'reserved crop height must enclose drawn caption and image');
});

test('a later stage avoids an already placed card when space exists', () => {
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(255),COLS,ROWS),{aspect:16/9});
  const card = p.card({x:300,y:250,w:300,h:400},'one');
  const stage = p.panel({x:300,y:250,w:300,h:400});
  assert.ok(!overlaps(card,stage), `card ${JSON.stringify(card)} stage ${JSON.stringify(stage)}`);
});

test('a narrow feasible gap is considered at obstacle boundaries', () => {
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(255),COLS,ROWS),{aspect:1});
  p.reserve({x:12,y:12,w:389,h:976});
  p.reserve({x:503,y:12,w:485,h:976});
  const card = p.card({x:80,y:200,w:102,h:200},'c');
  assert.ok(card.x >= 401 && card.x + card.w <= 503, JSON.stringify(card));
});

test('an impossible layout keeps the content and emits a bounded diagnostic', () => {
  let count=0;
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(255),COLS,ROWS),{aspect:1,onImpossible:()=>count++});
  p.reserve({x:12,y:12,w:976,h:976});
  const a=p.card({x:100,y:100,w:200,h:200},'a');
  const b=p.card({x:200,y:200,w:200,h:200},'b');
  assert.equal(a.w,200); assert.equal(b.w,200); assert.equal(count,1);
});

test('known controls stay clear of a card and later stage if room exists', () => {
  const p = new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const control={x:600,y:200,w:200,h:300};
  (p as unknown as {setControls?:(v:Box[])=>void}).setControls?.([control]);
  const card=p.card({x:610,y:210,w:150,h:100},'c');
  const stage=p.panel({x:610,y:220,w:150,h:180});
  assert.ok(!overlaps(card,control));assert.ok(!overlaps(stage,control));
});


test('clearing a stage frees its occupied space for a following card', () => {
  const p = new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const old=p.panel({x:200,y:200,w:300,h:300});
  placeAction(p,{op:'clear',target:'panel'},800);
  const next=p.card(old,'next');
  assert.deepEqual(next,old);
});

test('replacing a card does not block itself and clear frees the region', () => {
  const p = new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const a=p.card({x:200,y:200,w:200,h:150},'a');
  assert.deepEqual(p.card(a,'a'),a);
  placeAction(p,{op:'clear',target:'a'},800);
  assert.deepEqual(p.card(a,'b'),a);
});

test('moving a crop keeps source coordinates and translates owned marks with it', async () => {
  const {followDiagram} = await import('../src/overlay/placement.ts');
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1.5,height:800,sourceAspect:1.5});
  p.setControls([{x:600,y:600,w:300,h:300}]);
  const crop={op:'image',id:'img',sx:110,sy:130,sw:200,sh:150,dx:600,dy:600,dw:220,caption:'View'} as const;
  const moved=placeAction(p,crop,800) as typeof crop;
  const point={op:'point',id:'p',x:650,y:640,color:'red'} as const;
  const next=followDiagram(p,point,1.5) as typeof point;
  assert.deepEqual([moved.sx,moved.sy,moved.sw,moved.sh],[crop.sx,crop.sy,crop.sw,crop.sh]);
  assert.ok(next); assert.ok(Math.abs((next.x-point.x)-(moved.dx-crop.dx))<1);
  assert.ok(Math.abs((next.y-point.y)-(moved.dy-crop.dy))<1);
});

test('a viewport-sized stage is kept on screen without shrinking', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const stage=p.panel({x:900,y:100,w:1000,h:300});
  assert.ok(inside(stage), JSON.stringify(stage));
});

test('near viewport sized stage avoids a control when a clear position exists', () => {
  let warnings=0;
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1,onImpossible:()=>warnings++});
  const control={x:100,y:50,w:100,h:100};p.setControls([control]);
  const stage=placeAction(p,{op:'panel',x:0,y:30,w:990,h:100},800) as Extract<Action,{op:'panel'}>;
  assert.ok(inside(stage) && !overlaps(stage,control),JSON.stringify(stage));
  assert.equal(warnings,0);
});

test('image caption is complete and within a feasible viewport', async () => {
  const {drawImage}=await import('../src/overlay/annotations.ts');const view={width:1000,height:1000,dpr:1};
  const cap='A long detailed caption describing the contents of this image';
  const mark={op:'image',id:'i',sx:0,sy:0,sw:200,sh:100,dx:100,dy:100,dw:80,caption:cap} as const;
  const output: Array<{text:string;x:number}>=[];
  const ctx=new Proxy({measureText:(s:string)=>({width:s.length*8}),fillText:(text:string,x:number)=>output.push({text,x})} as Record<string,unknown>,{get(t,k:string){return k in t?t[k]:(..._a:unknown[])=>{};},set(t,k:string,v){t[k]=v;return true;}}) as unknown as CanvasRenderingContext2D;
  drawImage(ctx,{mark,key:1,id:'i',color:[1,1,1],opacity:1,appear:1,fade:1,pulse:0,pulseColor:undefined,tinted:false},{view,project:()=>undefined,source:{image:{} as CanvasImageSource,width:1000,height:1000}},0);
  assert.equal(output.map(x=>x.text).join('').replace(/\s/g,''),cap.replace(/\s/g,''));
  assert.ok(output.every(x=>x.x+x.text.length*8 <= (mark.dx+mark.dw)/1000*view.width+16),'caption stays inside image card background');
});

test('visible card survives continuing turn and an occupancy reconstruction', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const old=p.card({x:250,y:250,w:300,h:300},'old');
  (p as unknown as {syncVisible?:(surfaces:Array<{id:string;box:Box}>)=>void}).syncVisible?.([{id:'old',box:old}]);
  p.reset();
  const stage=p.panel(old);
  assert.ok(!overlaps(stage,old),'still-visible card remains occupied');
});

test('actual expanded stage causes a colliding visible card to reflow', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const card=p.card({x:500,y:250,w:220,h:100},'note');
  const grown={x:60,y:220,w:900,h:400};
  const moved=(p as unknown as {syncRenderedStage?:(v:Box)=>Map<string,Box>}).syncRenderedStage?.(grown)?.get('note') ?? card;
  assert.ok(!overlaps(moved,grown),JSON.stringify(moved));
});

test('visible occupancy survives placement cache renewal and is pruned after clear', () => {
  const grid=pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS);
  const old=new Placer(grid,{aspect:1});const box=old.card({x:250,y:250,w:300,h:300},'old');old.syncVisible([{id:'old',key:1,box}]);
  const next=new Placer(grid,{aspect:1});next.restore(old.snapshot());next.reset();
  assert.ok(!overlaps(next.panel(box),box),'continuing scene retains visible occupancy');
  next.syncVisible([]);next.setStage(undefined);
  assert.deepEqual(next.card(box,'new'),box,'removed surface is no longer reserved');
});

test('a replacement identity updates occupied geometry instead of keeping old bounds', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  p.syncVisible([{id:'c',key:1,box:{x:100,y:100,w:100,h:100}}]);
  const replacement={x:700,y:700,w:100,h:100};p.syncVisible([{id:'c',key:2,box:replacement}]);
  assert.deepEqual(p.surface('c'),replacement);
});

test('published grown diagram bounds move its origin clear of the actual stage', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const original=p.card({x:500,y:300,w:150,h:100},'d');
  const drawn={x:500,y:300,w:350,h:250};p.publishSurface('d',drawn);
  const stage={x:700,y:150,w:250,h:450};
  p.syncRenderedStage(stage);
  const relocated=p.surface('d')!;
  const actual={...drawn,x:drawn.x+relocated.x-original.x,y:drawn.y+relocated.y-original.y};
  assert.ok(!overlaps(stage,actual));
});

test('a growing stage does not repeatedly move a diagram while it is still easing', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  p.card({x:500,y:300,w:150,h:100},'d');
  const drawn={x:500,y:300,w:350,h:250},stage={x:700,y:150,w:250,h:450};
  p.publishSurface('d',drawn);p.syncRenderedStage(stage);const first=p.surface('d');
  p.publishSurface('d',drawn);p.syncRenderedStage(stage);assert.deepEqual(p.surface('d'),first);
});

test('visible moving card follows its live frame until it needs collision reflow', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  p.syncVisible([{id:'a',key:1,box:{x:100,y:100,w:100,h:100}}]);
  p.syncVisible([{id:'a',key:1,box:{x:150,y:100,w:100,h:100}}]);
  assert.equal(p.surface('a')?.x,150);
});

test('crop ownership mapping survives renewal and is removed on clear', async () => {
  const {followDiagram}=await import('../src/overlay/placement.ts');
  const grid=pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS);
  const p=new Placer(grid,{aspect:1});p.home('image',{x:100,y:100,w:200,h:150},{x:400,y:400,w:200,h:150});
  const next=new Placer(grid,{aspect:1});next.restore(p.snapshot());next.reset();
  const point={op:'point',id:'p',x:150,y:130,color:'red'} as Action;
  const moved=followDiagram(next,point,1) as Extract<Action,{op:'point'}>;
  assert.deepEqual([moved.x,moved.y],[450,430]);
  next.release('image');assert.equal(followDiagram(next,point,1),undefined);
});

test('replaying an existing card clears old reflow targets before stage growth', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const original={x:500,y:250,w:220,h:100},stage={x:60,y:220,w:900,h:400};
  p.card(original,'note');p.syncVisible([{id:'note',key:1,box:original}]);p.syncRenderedStage(stage);
  p.reset();p.setStage(undefined);p.card(original,'note');p.syncVisible([{id:'note',key:1,box:original}]);p.syncRenderedStage(stage);
  assert.ok(!overlaps(p.surface('note')!,stage));
});

test('visible stage controls are separate obstacles, leaving open space between them', () => {
  const p=new Placer(pageGrid(new Uint8Array(COLS*ROWS).fill(255),COLS,ROWS),{aspect:1});
  const stage={x:20,y:250,w:250,h:300},button={x:700,y:250,w:250,h:100};
  p.card({x:730,y:260,w:150,h:70},'button-overlap');
  (p.syncRenderedStage as unknown as (stage:Box,buttons:Box[])=>Map<string,Box>)(stage,[button]);
  const moved=p.surface('button-overlap')!;assert.ok(!overlaps(moved,button));
  p.release('button-overlap');
  const middle=p.card({x:400,y:260,w:200,h:70},'middle');
  assert.deepEqual(middle,{x:400,y:260,w:200,h:70});
});

test('render synchronization preserves authored crop and diagram ownership for later streamed marks', () => {
  const grid = pageGrid(new Uint8Array(192 * 108).fill(255), 192, 108);
  for (const id of ['crop', 'diagram']) {
    const p = new Placer(grid, { aspect: 1 });
    const authored = {x:100,y:100,w:200,h:200}, displayed = {x:92,y:330,w:200,h:200};
    p.home(id, authored, displayed);
    p.syncVisible([{id,key:1,box:displayed}]);
    p.syncHomeDisplay(id, displayed, displayed);
    assert.deepEqual(p.homeOf(150,150), {from:authored,to:displayed});
    assert.deepEqual(followDiagram(p, {op:"point",id:"dot",x:150,y:150,color:"red"}, 1), {op:"point",id:"dot",x:142,y:380,color:"red"});
    assert.deepEqual(followDiagram(p, {op:"point",id:"dot",x:142,y:380,color:"red"}, 1, true), {op:"point",id:"dot",x:142,y:380,color:"red"});
    const renewed = new Placer(grid,{aspect:1}); renewed.restore(p.snapshot());
    renewed.syncHomeDisplay(id, displayed, { ...displayed, x: 200 });
    assert.deepEqual(renewed.homeOf(150,150), {from:authored,to:{...displayed,x:200}});
  }
});
