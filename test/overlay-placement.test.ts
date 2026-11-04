import test from 'node:test';
import assert from 'node:assert/strict';
import { Placer, cardHeightUnits, markFootprint, pageGrid, placeAction, reserveMarks } from '../src/overlay/placement.ts';
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
