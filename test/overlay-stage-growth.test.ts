import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAGE_ROOM, StageGrowth } from '../src/overlay/layout.ts';

const view = { width: 1920, height: 1080 };
const panel = { x: 1240, y: 140, w: 580, h: 700 };

test('a model inside its card leaves the card as the panel placed it', () => {
  const g = new StageGrowth();
  assert.deepEqual(g.card(panel, { x: 1300, y: 200, w: 400, h: 500 }, view), panel);
  assert.deepEqual(g.card(panel, undefined, view), panel);
});

test('a model that reaches past the card (pulled apart, turned, a part swung out) is held whole by the card, with room', () => {
  const g = new StageGrowth();
  const model = { x: 1180, y: 20, w: 700, h: 900 }; // past the left, the top and the right edge, and the bottom
  const card = g.card(panel, model, view)!;
  assert.ok(card.x <= model.x - STAGE_ROOM + 0.001 && card.y <= model.y - STAGE_ROOM + 0.001, 'room on the left and top');
  assert.ok(card.x + card.w >= model.x + model.w + STAGE_ROOM - 0.001 && card.y + card.h >= model.y + model.h + STAGE_ROOM - 0.001, 'room on the right and bottom');
});

test('the card only grows while the same panel is up, so a swinging part does not make it breathe', () => {
  const g = new StageGrowth();
  const wide = g.card(panel, { x: 1100, y: 300, w: 700, h: 300 }, view)!;
  const back = g.card(panel, { x: 1300, y: 300, w: 300, h: 300 }, view)!;
  assert.deepEqual(back, wide);
});

test('a new panel, or none, starts the card again', () => {
  const g = new StageGrowth();
  g.card(panel, { x: 1000, y: 100, w: 800, h: 800 }, view);
  assert.deepEqual(g.card({ ...panel, x: 100 }, { x: 150, y: 200, w: 300, h: 300 }, view), { ...panel, x: 100 });
  g.card(panel, { x: 1000, y: 100, w: 800, h: 800 }, view);
  assert.equal(g.card(undefined, undefined, view), undefined);
  assert.deepEqual(g.card(panel, { x: 1300, y: 200, w: 300, h: 300 }, view), panel);
});

test('the card never grows off the display and never shrinks into the panel', () => {
  const g = new StageGrowth();
  const card = g.card(panel, { x: -300, y: -200, w: 3000, h: 2000 }, view)!;
  assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.w <= view.width && card.y + card.h <= view.height);
  const near = new StageGrowth().card(panel, { x: 1700, y: 900, w: 300, h: 300 }, view)!;
  assert.ok(near.x <= panel.x && near.y <= panel.y && near.x + near.w >= panel.x + panel.w && near.y + near.h >= panel.y + panel.h);
});
