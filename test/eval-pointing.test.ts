import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iou, scoreFirstMark } from '../scripts/pointing-eval.ts';

const target = { x: 100, y: 100, w: 200, h: 100 };
const box = (x: number, y: number, w: number, h: number) => ({ say: 'x', actions: [{ op: 'label', x: 0, y: 0, text: 'a' }, { op: 'box', x, y, w, h }] });

test('iou is 1 for the same box, 0 apart, and between for an overlap', () => {
  assert.equal(iou(target, target), 1);
  assert.equal(iou(target, { x: 500, y: 500, w: 50, h: 50 }), 0);
  const half = iou(target, { x: 200, y: 100, w: 200, h: 100 });
  assert.ok(half > 0.3 && half < 0.4);
});

test('the first pointing mark is scored, labels are skipped, and a far box is a miss', () => {
  assert.equal(scoreFirstMark(target, [box(100, 100, 200, 100)])?.hit, true);
  assert.equal(scoreFirstMark(target, [box(100, 100, 200, 100)])?.iou, 1);
  const miss = scoreFirstMark(target, [box(600, 600, 100, 100)]);
  assert.equal(miss?.hit, false);
  assert.equal(miss?.iou, 0);
});

test('a target taller than the screen is clipped to what can be seen; an arrow counts by its tip', () => {
  const tall = { x: 500, y: 300, w: 200, h: 1400 };
  assert.equal(scoreFirstMark(tall, [box(500, 300, 200, 700)])?.iou, 1);
  const arrow = scoreFirstMark(target, [{ say: 'x', actions: [{ op: 'arrow', x1: 0, y1: 0, x2: 150, y2: 150 }] }]);
  assert.equal(arrow?.hit, true);
  assert.equal(arrow?.iou, null);
  assert.equal(scoreFirstMark(target, [{ say: 'x', actions: [] }]), null);
});
