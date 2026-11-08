import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

// The reading half of scripts/capture-check.cjs (the half that needs a screen is run by hand).
const { share, toPicture, leastSafeWait } = createRequire(import.meta.url)('../scripts/capture-check-pixels.cjs') as {
  share(b: { data: Uint8Array; width: number; height: number }, r: { x: number; y: number; w: number; h: number }, rgb: number[], tol?: number): number;
  toPicture(r: { x: number; y: number; w: number; h: number }, d: { bounds: { x: number; y: number; width: number; height: number } }, p: { width: number; height: number }): { x: number; y: number; w: number; h: number };
  leastSafeWait(f: Record<number, number>): number | null;
};

/** A BGRA picture of `width`x`height` grey with a patch of `rgb` at `rect`. */
function picture(width: number, height: number, rect: { x: number; y: number; w: number; h: number }, rgb: number[]) {
  const data = new Uint8Array(width * height * 4).fill(60);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) { const i = (y * width + x) * 4; data[i] = rgb[2]!; data[i + 1] = rgb[1]!; data[i + 2] = rgb[0]!; data[i + 3] = 255; }
  return { data, width, height };
}

test('the share of a patch is read from the middle of its rectangle, in the picture\'s own channel order', () => {
  const rect = { x: 20, y: 10, w: 50, h: 40 };
  const pic = picture(100, 80, rect, [255, 0, 255]);
  assert.equal(share(pic, rect, [255, 0, 255]), 1, 'all of it');
  assert.equal(share(pic, rect, [0, 0, 255]), 0, 'red and blue are not swapped');
  assert.equal(share(pic, { x: 60, y: 50, w: 30, h: 20 }, [255, 0, 255]), 0, 'none of a place without it');
  const gone = picture(100, 80, { x: 0, y: 0, w: 1, h: 1 }, [255, 0, 255]);
  assert.equal(share(gone, rect, [255, 0, 255]), 0, 'the patch absent');
  const half = picture(100, 80, { x: 20, y: 10, w: 25, h: 40 }, [255, 0, 255]);
  assert.ok(Math.abs(share(half, rect, [255, 0, 255]) - 0.5) < 0.1, 'half of it');
});

test('a rectangle on a display is mapped into a picture of any size', () => {
  const display = { bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(toPicture({ x: 2040, y: 120, w: 300, h: 300 }, display, { width: 3840, height: 2160 }), { x: 240, y: 240, w: 600, h: 600 });
  assert.deepEqual(toPicture({ x: 2040, y: 120, w: 300, h: 300 }, display, { width: 1920, height: 1080 }), { x: 120, y: 120, w: 300, h: 300 });
});

test('the least safe wait is the shortest one after which no wait lost a capture', () => {
  assert.equal(leastSafeWait({ 0: 5, 8: 2, 16: 0, 33: 0, 50: 0 }), 16);
  assert.equal(leastSafeWait({ 0: 0, 8: 0, 16: 0 }), 0);
  assert.equal(leastSafeWait({ 0: 0, 8: 3, 16: 0, 33: 0 }), 16, 'a failure at a shorter wait than a pass does not count as safe');
  assert.equal(leastSafeWait({ 0: 4, 8: 2, 16: 1 }), null);
});
