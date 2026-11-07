import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseFrame } from '../scripts/prototypes/visual-quality-pixels.ts';
const width = 200, height = 150;
function frame() { const b = new Uint8Array(width * height * 4); for (let i = 0; i < b.length; i += 4) b.set([247, 242, 238, 255], i); return b; }
function rectangle(b: Uint8Array, x: number, y: number, w: number, h: number, color = [80, 120, 220, 255]) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) b.set(color, (yy * width + xx) * 4); return b; }
const check = (image: Uint8Array) => analyseFrame(image, frame(), width, height);
test('blank captures fail rather than treating a rendered window as useful 3D', () => { assert.ok(check(frame()).failures.includes('blank')); });
test('centred bright visible geometry passes conservative smoke checks', () => { const r = check(rectangle(frame(), 60, 45, 80, 60)); assert.equal(r.status, 'pass'); assert.equal(r.metrics.changedPixels, 4800); });
test('mostly dark geometry fails with a useful diagnostic', () => { assert.ok(check(rectangle(frame(), 60, 45, 80, 60, [5, 5, 5, 255])).failures.includes('dark')); });
test('tiny geometry fails the minimum visible coverage', () => { assert.ok(check(rectangle(frame(), 99, 74, 2, 2)).failures.includes('too-small')); });
test('geometry clipped at the capture boundary fails framing', () => { assert.ok(check(rectangle(frame(), 0, 40, 80, 60)).failures.includes('edge-clipping')); });
test('off-centre geometry fails framing', () => { assert.ok(check(rectangle(frame(), 170, 60, 20, 30)).failures.includes('off-centre')); });
test('almost full-screen geometry fails excessive coverage', () => { assert.ok(check(rectangle(frame(), 1, 1, 198, 148)).failures.includes('too-large')); });
test('transparent RGB never counts as visible geometry', () => { const a = new Uint8Array(width * height * 4), b = a.slice(); rectangle(a, 60, 45, 80, 60, [255, 0, 255, 0]); assert.ok(analyseFrame(a, b, width, height).failures.includes('blank')); });
test('refuses incomplete or nonsensical bitmap inputs', () => { for (const [w, h] of [[NaN, 150], [200.5, 150], [0, 150], [200, -1]]) assert.throws(() => analyseFrame(frame(), frame(), w!, h!)); assert.throws(() => analyseFrame(new Uint8Array(4), frame(), width, height)); });
test('a large clipped body cannot dilute edge contact by its interior area', () => {
  const w = 800, h = 600, baseline = new Uint8Array(w * h * 4);
  for (let i = 0; i < baseline.length; i += 4) baseline.set([247,242,238,255], i);
  const image = baseline.slice();
  for (let y = 100; y < 500; y++) for (let x = 0; x < 600; x++) image.set([80,120,220,255], (y*w+x)*4);
  assert.ok(analyseFrame(image, baseline, w, h).failures.includes('edge-clipping'));
});
