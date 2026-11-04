import assert from 'node:assert/strict';
import test from 'node:test';
import { PEN_FADE_MS, PenLayer, drawPen } from '../src/overlay/pen.ts';

function draw(pen: PenLayer, points: Array<[number, number]>) {
  const [first, ...rest] = points;
  pen.down(...(first as [number, number]));
  for (const p of rest) pen.move(...p);
}

test('a drag is reported in pieces that append to one stroke id, and ends with done', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[100, 100], [120, 110], [140, 130]]);
  const a = pen.take();
  assert.deepEqual(a, [{ id: 1, points: [[100, 100], [120, 110], [140, 130]], done: false }]);
  pen.move(160, 150);
  pen.up();
  assert.deepEqual(pen.take(), [{ id: 1, points: [[160, 150]], done: true }]);
  draw(pen, [[10, 10], [30, 30]]);
  assert.equal(pen.take()[0]?.id, 2, 'the next press is the next id');
});

test('a click or a twitch draws and reports nothing', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[500, 500], [501, 500.5]]);
  pen.up();
  assert.deepEqual(pen.take(), []);
  assert.equal(pen.view(0).strokes.length, 0);
});

test('nothing is drawn while the pen is off, and releasing the keys ends a stroke in progress', () => {
  const pen = new PenLayer();
  draw(pen, [[0, 0], [100, 100]]);
  assert.equal(pen.view(0).strokes.length, 0);
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  const pieces = pen.take();
  assert.equal(pieces.at(-1)?.done, true);
  assert.equal(pen.view(0).strokes.length, 1, 'what was drawn stays');
});

test('the stroke stays until the answer begins, then fades over 0.6 s; a new pen removes it at once', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  assert.equal(pen.view(5000).alpha, 1, 'it waits for the answer');
  assert.equal(pen.animating(5000), false);
  pen.fade(10_000);
  assert.equal(pen.animating(10_000), true);
  const mid = pen.view(10_000 + PEN_FADE_MS / 2).alpha;
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  assert.equal(pen.view(10_000 + PEN_FADE_MS + 1).strokes.length, 0);
  // A second chord removes a stroke that has not yet faded.
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  pen.turnOn();
  assert.equal(pen.view(0).strokes.length, 0);
});

test('the pen is drawn red and round with a faint dark outline, and not at all when faded', () => {
  const calls: string[] = [];
  const target = {} as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(t, key: string) { return key in t ? t[key] : (...a: unknown[]) => calls.push(`${key}(${a.map((x) => Math.round(Number(x))).join(',')})`); },
    set(t, key: string, v) { t[key] = v; if (key === 'strokeStyle' || key === 'lineWidth' || key === 'lineCap') calls.push(`${key}=${String(v)}`); return true; },
  }) as unknown as CanvasRenderingContext2D;
  drawPen(ctx, { strokes: [{ points: [[100, 100], [200, 150], [300, 100]] }], alpha: 1 }, { width: 1000, height: 500 });
  const text = calls.join(' ');
  assert.ok(text.includes('lineCap=round'));
  assert.ok(/strokeStyle=rgba\(0,0,0,/.test(text) && /strokeStyle=rgba\(255,59,48/.test(text));
  assert.ok(text.indexOf('rgba(0,0,0') < text.indexOf('rgba(255,59,48'), 'the outline is under the colour');
  assert.ok(/lineWidth=5\b/.test(text), 'about half a percent of the long side');
  const none: string[] = [];
  const ctx2 = new Proxy({}, { get: () => (...a: unknown[]) => none.push(String(a)) }) as unknown as CanvasRenderingContext2D;
  drawPen(ctx2, { strokes: [{ points: [[0, 0], [10, 10]] }], alpha: 0 }, { width: 1000, height: 500 });
  assert.equal(none.length, 0);
});
