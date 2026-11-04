import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action } from '../src/scene/index.ts';
import { LABEL_REACH, Placer, foreseePoints, labelUnits, pageGrid, placeAction, reserveMarks, settleMark } from '../src/overlay/placement.ts';

const COLS = 192, ROWS = 108, ASPECT = 16 / 9;
const blank = () => new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(238), COLS, ROWS), { aspect: ASPECT });
const point = (id: string, x: number, y: number, color = 'red') => ({ op: 'point', id, x, y, color }) as Action;
const label = (id: string, x: number, y: number, text: string, color = 'red') => ({ op: 'label', id, x, y, text, color }) as Action;
const at = (a: Action) => a as { x: number; y: number };
const box = (a: Action) => {
  const { w, h } = labelUnits(a as { text: string }, ASPECT);
  return { x: at(a).x, y: at(a).y, w, h };
};
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;

test('a name starts just to the right of its point, at the point\'s height, wherever the model put it', () => {
  const p = blank();
  settleMark(p, point('lv', 800, 700, 'orange'));
  // The model's own offset in the heart run: 62 to the left and 25 below.
  const out = settleMark(p, label('lvl', 738, 725, 'Left ventricle', 'orange'));
  const { h } = labelUnits({ text: 'Left ventricle' }, ASPECT);
  assert.ok(at(out).x > 800 && at(out).x < 800 + 20, `starts just right of the point: ${at(out).x}`);
  assert.ok(Math.abs(at(out).y + h / 2 - 700) < 1, `centred on the point's height: ${at(out).y}`);
});

test('each label goes to the nearest point of its own colour, each point having one name', () => {
  const p = blank();
  settleMark(p, point('a', 400, 300, 'red'));
  settleMark(p, point('b', 400, 380, 'blue'));
  // The blue label is written nearer the red point, and is still the blue point's.
  const blue = settleMark(p, label('bl', 420, 300, 'Left atrium', 'blue'));
  const red = settleMark(p, label('rl', 420, 400, 'Aorta', 'red'));
  const { h } = labelUnits({ text: 'x' }, ASPECT);
  assert.ok(Math.abs(at(blue).y + h / 2 - 380) < 1, `blue label is on the blue point's height: ${at(blue).y}`);
  assert.ok(Math.abs(at(red).y + h / 2 - 300) < 1, `red label is on the red point's height: ${at(red).y}`);
});

test('with no point of its colour the nearest point of any colour is used; one more than a point has, or one too far, stays as written', () => {
  const p = blank();
  settleMark(p, point('a', 400, 300, 'red'));
  const any = settleMark(p, label('l1', 430, 330, 'One', 'green'));
  assert.ok(at(any).x > 400 && at(any).x < 420, 'a green name takes the red point');
  const second = label('l2', 430, 340, 'Two', 'green');
  assert.equal(settleMark(p, second), second, 'the point already has a name: the second stays');
  settleMark(p, point('far', 100, 100, 'green'));
  const distant = label('l3', 100 + (LABEL_REACH * 1.2) / ASPECT + 200, 100, 'Three', 'green');
  assert.equal(settleMark(p, distant), distant, 'farther than the reach: stays');
});

test('no room on the right: the name goes to the left of its point', () => {
  const p = blank();
  settleMark(p, point('a', 950, 500, 'red'));
  const out = settleMark(p, label('l', 960, 500, 'Right ventricle', 'red'));
  const b = box(out);
  assert.ok(b.x + b.w <= 950, `ends left of the point: ${b.x + b.w}`);
  assert.ok(b.x >= 0);
});

test('a name stays inside the picture the answer boxed, going to the left of its point at that picture\'s edge', () => {
  const p = blank();
  reserveMarks(p, [{ op: 'box', id: 'pic', x: 600, y: 300, w: 200, h: 400, color: 'red' } as Action], ASPECT);
  settleMark(p, point('a', 780, 500, 'red'));
  const out = settleMark(p, label('l', 790, 500, 'Pulmonary trunk', 'red'));
  const b = box(out);
  assert.ok(b.x >= 600 && b.x + b.w <= 800, `inside the box: ${JSON.stringify(b)}`);
  assert.ok(b.x + b.w <= 780, 'to the left of its point');
});

test('a name inside an enlargement card stays inside the card', () => {
  const p = blank();
  const image = { op: 'image', id: 'zoom', sx: 600, sy: 400, sw: 90, sh: 280, dx: 800, dy: 100, dw: 140, color: 'red' } as Action;
  placeAction(p, image, 1080);
  settleMark(p, point('a', 930, 400, 'teal'));
  const out = settleMark(p, label('l', 940, 395, 'Right ventricle', 'teal'));
  const b = box(out);
  assert.ok(b.x >= 800 - 1 && b.x + b.w <= 940 + 1, `inside the card's width: ${JSON.stringify(b)}`);
});

test('two names that would land on each other are moved apart', () => {
  const p = blank();
  settleMark(p, point('a', 500, 300, 'red'));
  settleMark(p, point('b', 500, 312, 'blue'));
  const one = settleMark(p, label('l1', 510, 300, 'Aorta', 'red'));
  const two = settleMark(p, label('l2', 510, 312, 'Left atrium', 'blue'));
  assert.ok(!overlap(box(one), box(two)), `${JSON.stringify(box(one))} ${JSON.stringify(box(two))}`);
});

test('a name with no point near it, and any other mark, is left as it was; clearing forgets the points', () => {
  const p = blank();
  const lone = label('l', 500, 500, 'Title');
  assert.equal(settleMark(p, lone), lone);
  const circle = { op: 'circle', id: 'c', x: 1, y: 2, w: 3, h: 4, color: 'red' } as Action;
  assert.equal(settleMark(p, circle), circle);
  settleMark(p, point('a', 400, 300));
  placeAction(p, { op: 'clear', target: 'all' } as Action, 1080);
  const after = label('l2', 420, 300, 'Gone');
  assert.equal(settleMark(p, after), after, 'the point was cleared: nothing to name');
});

test('a name keeps off the ring of another point', () => {
  const p = blank();
  settleMark(p, point('a', 500, 300, 'blue'));
  settleMark(p, point('b', 540, 308, 'green')); // just where a's name would go
  const out = settleMark(p, label('l', 510, 300, 'Right ventricle', 'blue'));
  const { w, h } = labelUnits({ text: 'Right ventricle' }, ASPECT);
  const ring = { x: 540 - 14 / ASPECT, y: 308 - 14, w: 28 / ASPECT, h: 28 };
  assert.ok(!overlap({ x: at(out).x, y: at(out).y, w, h }, ring), JSON.stringify(out));
  assert.ok(at(out).x > 500 && at(out).x < 500 + 20, 'still just right of its own point');
});

test('a label asked to be smaller than the page draws text (11 px) is given the room of 11 px text, so what is put beside it is not under it', () => {
  const small = labelUnits({ text: 'Left ventricle', size: 6 }, ASPECT, 804);
  const floor = labelUnits({ text: 'Left ventricle', size: 11000 / 804 }, ASPECT);
  assert.deepEqual(small, floor);
  assert.ok(small.w > labelUnits({ text: 'Left ventricle', size: 6 }, ASPECT).w, 'wider than the size it asked for');
  assert.deepEqual(labelUnits({ text: 'Left ventricle', size: 30 }, ASPECT, 804), labelUnits({ text: 'Left ventricle', size: 30 }, ASPECT), 'a larger size is as it asked');
  // In a placer that knows the screen height the same is true of where a name goes.
  const p = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(238), COLS, ROWS), { aspect: ASPECT, height: 804 });
  settleMark(p, point('a', 500, 300, 'blue'));
  settleMark(p, point('b', 500 + small.w + 14 / ASPECT, 300, 'green')); // beyond the label as 6 units, inside it as 11 px
  const out = settleMark(p, { op: 'label', id: 'l', x: 510, y: 300, text: 'Left ventricle', color: 'blue', size: 6 } as Action);
  assert.ok(!overlap({ x: at(out).x, y: at(out).y, ...small }, { x: 500 + small.w, y: 300 - 14, w: 28 / ASPECT, h: 28 }), JSON.stringify(out));
});

test('a point that comes later in the answer is known ahead: the names before it keep off its ring, and it is no name\'s until it is marked', () => {
  const p = blank();
  const { w } = labelUnits({ text: 'Right ventricle' }, ASPECT);
  const later = point('b', 500 + w * 0.7, 300, 'green');
  foreseePoints(p, [later], ASPECT);
  settleMark(p, point('a', 500, 300, 'blue'));
  const out = settleMark(p, label('l', 510, 300, 'Right ventricle', 'blue'));
  const ring = { x: at(later).x - 14 / ASPECT, y: 300 - 14, w: 28 / ASPECT, h: 28 };
  const room = labelUnits({ text: 'Right ventricle' }, ASPECT);
  assert.ok(!overlap({ x: at(out).x, y: at(out).y, ...room }, ring), JSON.stringify(out));
  const stray = label('l2', at(later).x + 5, 300, 'Mine?', 'green');
  assert.equal(settleMark(p, stray), stray, 'a foreseen point is not a name\'s yet');
});
