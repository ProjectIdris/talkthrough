import test from 'node:test';
import assert from 'node:assert/strict';
import { Placer, bodyTextOf, cardHeightUnits, markFootprint, pageGrid, placeAction, reserveMarks } from '../src/overlay/placement.ts';
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

test('when no full-size place is clear of the figure the answer boxed, the stage goes smaller (down to about half) rather than cover it', () => {
  const p = placer();
  const figure: Box = { x: 600, y: 150, w: 160, h: 500 };
  p.reserve(figure);
  const placed = p.panel({ x: 420, y: 200, w: 340, h: 480 });
  assert.ok(!overlaps(placed, figure), `clear of the figure: ${JSON.stringify(placed)}`);
  assert.ok(placed.w < 340 * 0.76 && inside(placed), `it had to be smaller than three quarters: ${JSON.stringify(placed)}`);
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

test('a diagram goes smaller, to what it can be read at, before it covers a page\'s figure or controls, and keeps readable bounds', () => {
  const p = new Placer(articlePage(), { aspect: 16 / 9 });
  // Asked wide over the prose (150..950); the only free place is the right margin under the figure, narrower than the least the old shapes allowed (a third of the asked width).
  const placed = placeAction(p, { op: 'diagram', id: 't', kind: 'timeline', x: 150, y: 690, w: 800, h: 260 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const figure = { x: AC(138), y: (28 / ROWS) * 1000, w: AC(32), h: (34 / ROWS) * 1000 };
  const options = { x: AC(174), y: (12 / ROWS) * 1000, w: AC(16), h: (40 / ROWS) * 1000 };
  assert.ok(!overlaps(placed, figure), `off the figure: ${JSON.stringify(placed)}`);
  assert.ok(!overlaps(placed, options), 'off the options');
  assert.ok(placed.w >= 150 && placed.h >= 150, 'not smaller than it can be read');
  assert.ok(placed.w * placed.h >= 800 * 260 * 0.35 && placed.w * placed.h < 800 * 260, `smaller than asked, but not by much: ${placed.w * placed.h}`);
  assert.ok(placed.x >= AC(132), 'in the margin, not on the prose');
});

test('when nothing is free even at the least size, a diagram covers body text before it covers a figure or controls', () => {
  const p = new Placer(articlePage(false), { aspect: 16 / 9 });
  const placed = placeAction(p, { op: 'diagram', id: 't', kind: 'steps', x: 740, y: 300, w: 220, h: 400 } as Action, 1080) as Action & { x: number; y: number; w: number; h: number };
  const fixtures: Box[] = [{ x: AC(138), y: (28 / ROWS) * 1000, w: AC(32), h: (34 / ROWS) * 1000 }, { x: AC(174), y: (12 / ROWS) * 1000, w: AC(16), h: (40 / ROWS) * 1000 }, { x: AC(138), y: (64 / ROWS) * 1000, w: AC(52), h: (40 / ROWS) * 1000 }];
  for (const f of fixtures) assert.ok(!overlaps(placed, f), `off ${JSON.stringify(f)}: ${JSON.stringify(placed)}`);
});
