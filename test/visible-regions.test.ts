import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  clearVisibleRegions,
  containsVisiblePoint,
  publishVisibleRegions,
  readVisibleRegions,
  regionsForMark,
  type VisibleRegion,
} from '../src/overlay/visible-regions.ts';

afterEach(() => clearVisibleRegions());

test('published visible regions are immutable viewport CSS-pixel snapshots with increasing revisions', () => {
  const first = publishVisibleRegions({ width: 1200, height: 800, regions: [
    { id: 'ask-more', kind: 'capture-control', alpha: 1, shape: { type: 'rect', x: 40, y: 60, w: 100, h: 32 } },
  ] });
  assert.equal(first.units, 'css-px');
  assert.equal(first.revision, 1);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.regions), true);
  assert.equal(Object.isFrozen(first.regions[0]?.shape), true);
  assert.throws(() => { (first.regions as VisibleRegion[]).push(first.regions[0]!); }, TypeError);

  const second = publishVisibleRegions({ width: 1200, height: 800, regions: [] });
  assert.equal(second.revision, first.revision + 1);
  assert.deepEqual(readVisibleRegions(), second);
});

test('sparse mark hit shapes exclude the whitespace between line and polygon marks', () => {
  const snapshot = publishVisibleRegions({ width: 1000, height: 700, regions: [
    { id: 'underline', kind: 'content', alpha: 1, shape: { type: 'line', x1: 100, y1: 100, x2: 220, y2: 100, width: 12 } },
    { id: 'trace', kind: 'content', alpha: 1, shape: { type: 'polygon', points: [{ x: 400, y: 100 }, { x: 420, y: 120 }, { x: 400, y: 140 }] } },
  ] });
  assert.equal(containsVisiblePoint(snapshot, 160, 102), true);
  assert.equal(containsVisiblePoint(snapshot, 160, 130), false, 'line footprint must not become its large bounding box');
  assert.equal(containsVisiblePoint(snapshot, 405, 120), true);
  assert.equal(containsVisiblePoint(snapshot, 430, 120), false, 'polygon footprint must not become its large bounding box');
});

test('mark producer emits strokes for borders and traces instead of a broad rectangle', () => {
  const regions = regionsForMark({ op: 'underline', id: 'u', x: 100, y: 100, w: 400, color: 'red' }, 1000, 700, 1);
  const snapshot = publishVisibleRegions({ width: 1000, height: 700, regions });
  assert.equal(regions.length, 1);
  assert.equal(containsVisiblePoint(snapshot, 250, 70), true);
  assert.equal(containsVisiblePoint(snapshot, 250, 120), false);

  const box = publishVisibleRegions({ width: 1000, height: 700, regions: regionsForMark({ op: 'box', id: 'b', x: 100, y: 100, w: 400, h: 300, color: 'blue' }, 1000, 700, 1) });
  assert.equal(containsVisiblePoint(box, 100, 140), true);
  assert.equal(containsVisiblePoint(box, 300, 200), false, 'outline does not turn the box interior into a hit region');

  const circle = regionsForMark({ op: 'circle', id: 'c', x: 100, y: 100, w: 200, h: 200, color: 'blue' }, 1000, 700, 1);
  assert.equal(circle.length, 1, 'one compact outline shape stays within the bounded snapshot');
  const ring = publishVisibleRegions({ width: 1000, height: 700, regions: circle });
  assert.equal(containsVisiblePoint(ring, 200, 70), true);
  assert.equal(containsVisiblePoint(ring, 200, 140), false, 'circle interior is not part of its outline hit region');
});

test('rotated mark outlines use scene degrees at the drawn location', () => {
  const regions = regionsForMark({ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, rot: 90, color: 'blue' }, 1000, 1000, 1);
  const snapshot = publishVisibleRegions({ width: 1000, height: 1000, regions });
  assert.equal(containsVisiblePoint(snapshot, 200, 50), true, 'rotated edge remains protected');
  assert.equal(containsVisiblePoint(snapshot, 200, 150), false, 'empty box interior is not a hit');
  const ellipse = publishVisibleRegions({ width: 1000, height: 1000, regions: regionsForMark({ op: 'circle', id: 'c', x: 100, y: 100, w: 200, h: 100, rot: 90, color: 'blue' }, 1000, 1000, 1) });
  assert.equal(containsVisiblePoint(ellipse, 200, 50), true, 'rotated ellipse edge remains protected');
  assert.equal(containsVisiblePoint(ellipse, 200, 150), false, 'ellipse interior is not a hit');
});

test('capture-control regions are distinct and zero-alpha or cleared content cannot hit', () => {
  const snapshot = publishVisibleRegions({ width: 900, height: 600, regions: [
    { id: 'send', kind: 'capture-control', alpha: 1, shape: { type: 'rect', x: 20, y: 30, w: 70, h: 30 } },
    { id: 'faded', kind: 'content', alpha: 0, shape: { type: 'circle', x: 200, y: 150, r: 24 } },
  ] });
  assert.equal(snapshot.regions[0]?.kind, 'capture-control');
  assert.equal(containsVisiblePoint(snapshot, 30, 40), true);
  assert.equal(containsVisiblePoint(snapshot, 200, 150), false);
  const cleared = clearVisibleRegions();
  assert.equal(cleared.regions.length, 0);
  assert.ok(cleared.revision > snapshot.revision);
  assert.equal(containsVisiblePoint(readVisibleRegions(), 30, 40), false);
});

test('label hit bounds use the measured, clamped rendered pill including pulse', async () => {
  const { labelLayout } = await import('../src/overlay/marks.ts');
  const ctx = { font: '', measureText: () => ({ width: 200 }) } as unknown as CanvasRenderingContext2D;
  const frame = { mark: { op: 'label', id: 'l', x: 900, y: 100, text: 'wide', size: 24 }, appear: 1, pulse: 0.5 } as Parameters<typeof labelLayout>[1];
  const result = labelLayout(ctx, frame, { width: 1000, height: 1000, dpr: 1 });
  assert.ok(result);
  assert.ok(result.hit.x < 800, 'right-aligned label is clamped to viewport');
  assert.ok(result.hit.w > 200, 'measured text and pill padding are both included');
  assert.ok(result.hit.h > 44, 'pulse enlarges visible pill');
});

test('arrowhead footprint protects its drawn wing without capturing nearby blank space', () => {
  const regions = regionsForMark({ op: 'arrow', id: 'a', x1: 100, y1: 100, x2: 300, y2: 100, color: 'red' }, 1000, 1000, 1);
  const snapshot = publishVisibleRegions({ width: 1000, height: 1000, regions });
  assert.equal(containsVisiblePoint(snapshot, 288, 106), true, 'visible arrowhead');
  assert.equal(containsVisiblePoint(snapshot, 288, 112), false, 'space outside the arrowhead');
});

test('underline hit covers the drawn highlighter band but not blank space', () => {
  const regions = regionsForMark({ op: 'underline', id: 'u', x: 100, y: 100, w: 400, color: 'red' }, 1000, 1000, 1);
  const s = publishVisibleRegions({ width: 1000, height: 1000, regions });
  assert.equal(containsVisiblePoint(s, 200, 88), true);
  assert.equal(containsVisiblePoint(s, 200, 75), false);
});

test('underline hit excludes the part wiped away during fade', () => {
  const regions = regionsForMark({ op: 'underline', id: 'u', x: 100, y: 100, w: 400, color: 'red' }, 1000, 1000, 1, 1, 1, 0.5);
  const s = publishVisibleRegions({ width: 1000, height: 1000, regions });
  assert.equal(containsVisiblePoint(s, 150, 88), false, 'wiped portion is no longer interactive');
  assert.equal(containsVisiblePoint(s, 450, 88), true, 'remaining band stays interactive');
});
