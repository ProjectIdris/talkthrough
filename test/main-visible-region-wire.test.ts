import test from 'node:test';
import assert from 'node:assert/strict';
import { containsWireRegion, createVisibleRegionReceiver, readVisibleRegionSnapshot } from '../src/main/visible-region-wire.ts';

test('visible regions require a current bounded snapshot with valid shapes', () => {
  const snapshot = { version: 1, revision: 4, units: 'css-px', width: 800, height: 600, regions: [
    { id: 'stroke', kind: 'content', alpha: 1, shape: { type: 'line', x1: 1, y1: 2, x2: 5, y2: 9, width: 3 } },
    { id: 'button', kind: 'capture-control', alpha: 1, shape: { type: 'rect', x: 100, y: 50, w: 80, h: 32 } },
  ] };
  assert.equal(readVisibleRegionSnapshot(snapshot, 3)?.regions.length, 2);
  assert.equal(readVisibleRegionSnapshot(snapshot, 4), undefined, 'stale revision is refused');
  assert.equal(readVisibleRegionSnapshot({ ...snapshot, regions: new Array(2049).fill(snapshot.regions[0]) }, 3), undefined);
  assert.equal(readVisibleRegionSnapshot({ ...snapshot, regions: [{ ...snapshot.regions[0], shape: { type: 'circle', x: NaN, y: 0, r: 2 } }] }, 3), undefined);
  assert.equal(readVisibleRegionSnapshot({ ...snapshot, revision: 5, regions: [] }, 4)?.regions.length, 0, 'clear replaces old hits');
  const line = { id: 'outline', kind: 'content', alpha: 1, shape: { type: 'polyline', width: 2, closed: true, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] } };
  assert.deepEqual(readVisibleRegionSnapshot({ ...snapshot, revision: 6, regions: [line] }, 4)?.regions[0], line, 'compact outlines remain shape-aware');
  const outline = readVisibleRegionSnapshot({ ...snapshot, revision: 6, regions: [line] }, 4)!;
  assert.equal(containsWireRegion(outline, 3, 4, 'content'), true);
  assert.equal(containsWireRegion(outline, 10, 30, 'content'), false, 'blank space is not a content hit');
});

test('receiver retains newest snapshot, clears it and ignores an older publication', () => {
  const receiver = createVisibleRegionReceiver();
  const snapshot = { version: 1, revision: 1, units: 'css-px', width: 800, height: 600, regions: [
    { id: 'a', kind: 'pill', alpha: 1, shape: { type: 'rect', x: 1, y: 1, w: 10, h: 10 } },
  ] };
  assert.equal(receiver.accept(snapshot), true);
  assert.equal(receiver.current?.regions.length, 1);
  assert.equal(receiver.accept({ ...snapshot, revision: 2, regions: [] }), true);
  assert.equal(receiver.current?.regions.length, 0);
  assert.equal(receiver.accept(snapshot), false);
  assert.equal(receiver.current?.regions.length, 0);
  receiver.reset(); assert.equal(receiver.current, undefined);
});
