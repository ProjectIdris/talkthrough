import test from 'node:test';
import assert from 'node:assert/strict';
import { snapToControl } from '../src/shared/controls.ts';
import type { ControlBox } from '../src/shared/controls.ts';
import type { Action } from '../src/scene/index.ts';

const ASPECT = 16 / 9;
// A toolbar of three buttons, a tab strip, and a form field, on the 0..1000 scale.
const controls: ControlBox[] = [
  { x: 100, y: 100, w: 60, h: 40, kind: 'button' },
  { x: 170, y: 100, w: 60, h: 40, kind: 'button' },
  { x: 240, y: 100, w: 60, h: 40, kind: 'button' },
  { x: 100, y: 200, w: 80, h: 36, kind: 'tab' },
  { x: 190, y: 200, w: 80, h: 36, kind: 'tab' },
  { x: 100, y: 400, w: 400, h: 44, kind: 'edit' },
];
const box = (x: number, y: number, w: number, h: number): Action => ({ op: 'box', id: 'b', x, y, w, h, color: 'red' });

test('a box drawn a little off a button takes the button\'s bounds, a little outside them', () => {
  const s = snapToControl(box(108, 104, 58, 44), controls, ASPECT);
  assert.ok(s, 'snapped');
  assert.equal(s.kind, 'button');
  const a = s.action as { x: number; y: number; w: number; h: number };
  assert.ok(a.x < 100 && a.x > 96 && a.x + a.w > 160 && a.x + a.w < 164, JSON.stringify(a));
  assert.ok(a.y < 100 && a.y + a.h > 140);
  assert.ok(s.moved < 15, 'moved a few units');
});

test('a circle round a tab, a point inside a tab and an arrow that stops short of a button are put on them', () => {
  const ring = snapToControl({ op: 'circle', id: 'c', x: 110, y: 195, w: 70, h: 44, color: 'red' }, controls, ASPECT)!;
  assert.equal(ring.kind, 'tab');
  const r = ring.action as { x: number; y: number; w: number; h: number };
  assert.ok(Math.abs(r.x + r.w / 2 - 140) < 1 && Math.abs(r.y + r.h / 2 - 218) < 1, 'centred on the tab');
  const dot = snapToControl({ op: 'point', id: 'p', x: 120, y: 210, color: 'red' }, controls, ASPECT)!;
  assert.deepEqual([(dot.action as { x: number }).x, (dot.action as { y: number }).y], [140, 218]);
  const arrow = snapToControl({ op: 'arrow', id: 'a', x1: 400, y1: 300, x2: 245, y2: 150, color: 'red' }, controls, ASPECT)!;
  const tip = arrow.action as { x2: number; y2: number };
  assert.ok(tip.x2 >= 240 && tip.x2 <= 300 && tip.y2 >= 100 && tip.y2 <= 140, `the tip is on the third button: ${tip.x2},${tip.y2}`);
});

test('what points at no control is left alone: a box round a whole form, over blank page, between two buttons, a huge box', () => {
  assert.equal(snapToControl(box(80, 80, 400, 200), controls, ASPECT), undefined, 'a box round many controls');
  assert.equal(snapToControl(box(600, 600, 50, 40), controls, ASPECT), undefined, 'over blank page');
  assert.equal(snapToControl(box(150, 100, 30, 40), controls, ASPECT), undefined, 'half on each of two buttons: not clear which');
  assert.equal(snapToControl(box(100, 100, 600, 500), controls, ASPECT), undefined, 'far larger than any control');
  assert.equal(snapToControl(box(300, 105, 18, 12), controls, ASPECT), undefined, 'a small box at the edge of a button and mostly outside it');
  assert.equal(snapToControl({ op: 'point', id: 'p', x: 700, y: 700, color: 'red' }, controls, ASPECT), undefined, 'a point in no control');
  assert.equal(snapToControl({ op: 'point', id: 'p', x: 150, y: 420, color: 'red' }, controls, ASPECT), undefined, 'a point in a wide field stays where it is');
  assert.equal(snapToControl({ op: 'arrow', id: 'a', x1: 800, y1: 800, x2: 700, y2: 700, color: 'red' }, controls, ASPECT), undefined, 'an arrow far from any control');
  assert.equal(snapToControl({ op: 'arrow', id: 'a', x1: 400, y1: 300, x2: 165, y2: 150, color: 'red' }, controls, ASPECT), undefined, 'a tip about as near two buttons as it is far from either');
  assert.equal(snapToControl({ op: 'label', id: 'l', x: 120, y: 110, text: 'x', color: 'red' } as Action, controls, ASPECT), undefined, 'text is never moved');
  assert.equal(snapToControl(box(100, 100, 60, 40), [], ASPECT), undefined, 'with no controls (another system, a picture) nothing happens');
});

test('a mark already on its control stays put, and a nested control is the one the point lands on', () => {
  const near = snapToControl(box(98, 98, 64, 44), controls, ASPECT, 2);
  assert.ok(!near || near.moved < 6, 'a box already about on its button hardly moves');
  const row = [{ x: 100, y: 500, w: 400, h: 60, kind: 'listitem' }, { x: 420, y: 510, w: 60, h: 40, kind: 'button' }];
  const dot = snapToControl({ op: 'point', id: 'p', x: 430, y: 520, color: 'red' }, row, ASPECT)!;
  assert.equal(dot.kind, 'button', 'the smaller, inner control');
});
