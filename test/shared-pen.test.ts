import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cropBox, isRealStroke, strokeBounds } from '../src/shared/pen.ts';
import type { Point } from '../src/shared/pen.ts';

const circle = (cx: number, cy: number, r: number): Point[] => Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos((i / 24) * 2 * Math.PI), cy + r * Math.sin((i / 24) * 2 * Math.PI)]);

test('a click or a twitch is not a stroke; a drag across the screen is', () => {
  assert.equal(isRealStroke([]), false);
  assert.equal(isRealStroke([[[500, 500]]]), false);
  assert.equal(isRealStroke([[[500, 500], [505, 503]]]), false);
  assert.equal(isRealStroke([circle(500, 500, 60)]), true);
  assert.equal(isRealStroke([[[100, 100], [300, 102]]]), true); // a line is wide enough
});

test('the crop is the strokes padded, never below the minimum size, and stays on the screen', () => {
  const box = cropBox([circle(500, 500, 100)])!;
  assert.ok(box.x < 400 && box.x + box.w > 600 && box.y < 400 && box.y + box.h > 600, 'padded around the circle');
  const tiny = cropBox([circle(500, 500, 10)])!;
  assert.ok(tiny.w >= 120 && tiny.h >= 120);
  const corner = cropBox([circle(990, 10, 30)])!;
  assert.ok(corner.x >= 0 && corner.y >= 0 && corner.x + corner.w <= 1000 && corner.y + corner.h <= 1000);
  assert.ok(corner.w >= 120 && corner.h >= 120, 'sliding in from the corner keeps the size');
  assert.equal(cropBox([]), null);
  assert.deepEqual(strokeBounds([[[1, 2], [Number.NaN, 5], [4, 8]]]), { x: 1, y: 2, w: 3, h: 6 });
});
