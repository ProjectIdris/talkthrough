import test from 'node:test';
import assert from 'node:assert/strict';
import { followupKeepOut, followupSpot } from '../src/overlay/followup-placement.ts';
import type { VisibleRegion } from '../src/overlay/visible-regions.ts';

type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const size = { w: 90, h: 34 };

test('follow-up controls retain their familiar corner when it is clear', () => {
  assert.deepEqual(followupSpot({ width: 960, height: 640 }, size, []), { x: 22, y: 578 });
});

test('a measured bottom credit moves the control, not the credit', () => {
  const credit = { x: 52, y: 594, w: 410, h: 22 };
  const before = { ...credit };
  const at = followupSpot({ width: 960, height: 640 }, size, [credit]);
  assert.equal(overlap({ ...at, ...size }, credit), 0);
  assert.ok(at.y + size.h <= credit.y - 8 || at.x >= credit.x + credit.w + 8);
  assert.deepEqual(credit, before);
});

test('controls avoid cards and captions as a complete Send/Cancel group', () => {
  const obstacles = [{ x: 0, y: 500, w: 220, h: 140 }, { x: 250, y: 560, w: 450, h: 60 }, { x: 730, y: 450, w: 230, h: 190 }];
  const group = { w: 174, h: 34 };
  const at = followupSpot({ width: 960, height: 640 }, group, obstacles);
  for (const r of obstacles) assert.equal(overlap({ ...at, ...group }, r), 0);
});

test('a clear position is stable but moves when new content occupies it', () => {
  const view = { width: 960, height: 640 }, previous = { x: 550, y: 520 };
  assert.deepEqual(followupSpot(view, size, [], previous), previous);
  const obstacle = { ...previous, ...size };
  const at = followupSpot(view, size, [obstacle], previous);
  assert.equal(overlap({ ...at, ...size }, obstacle), 0);
});

test('resize and large text keep the entire control group within the viewport', () => {
  for (const view of [{ width: 360, height: 640 }, { width: 640, height: 360 }, { width: 1280, height: 720 }]) {
    const group = { w: 290, h: 64 };
    const at = followupSpot(view, group, [{ x: 0, y: view.height - 90, w: view.width, h: 90 }], { x: 900, y: 600 });
    assert.ok(at.x >= 0 && at.y >= 0 && at.x + group.w <= view.width && at.y + group.h <= view.height);
    assert.ok(at.y + group.h <= view.height - 98);
  }
});

test('a full scene keeps a visible least-overlapping control instead of hiding it', () => {
  const at = followupSpot({ width: 360, height: 240 }, size, [{ x: 0, y: 0, w: 360, h: 240 }]);
  assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y));
  assert.ok(at.x >= 0 && at.y >= 0 && at.x + size.w <= 360 && at.y + size.h <= 240);
});

test('a free interior slot combines edges belonging to different obstacles', () => {
  const walls = [
    { x: 0, y: 0, w: 400, h: 110 }, { x: 0, y: 190, w: 400, h: 110 },
    { x: 0, y: 0, w: 140, h: 300 }, { x: 270, y: 0, w: 130, h: 300 },
  ];
  const at = followupSpot({ width: 400, height: 300 }, size, walls);
  for (const wall of walls) assert.equal(overlap({ ...at, ...size }, wall), 0);
});

test('fractional glyph bounds leave real pixel clearance instead of drifting on the next draw', () => {
  const title = { x: 4, y: 64, w: 389.0382775878906, h: 47.84 };
  const lower = { x: 0, y: 165.3, w: 360, h: 474.7 };
  const view = { width: 360, height: 640 };
  const at = followupSpot(view, size, [title, lower]);
  assert.ok(Number.isInteger(at.x) && Number.isInteger(at.y), 'CSS pixel placement does not round into the required gap');
  assert.deepEqual(followupSpot(view, size, [title, lower], at), at);
});

test('measured scene shapes and other HUD controls remain obstacles, but not the group itself', () => {
  const region = (id: string, shape: VisibleRegion['shape'], alpha = 1): VisibleRegion => ({ id, kind: 'content', alpha, shape });
  assert.deepEqual(followupKeepOut([
    region('label', { type: 'rect', x: 40, y: 50, w: 200, h: 22 }),
    region('point', { type: 'circle', x: 20, y: 30, r: 5 }),
    region('arrow', { type: 'line', x1: 10, y1: 20, x2: 40, y2: 60, width: 8 }),
    region('trace', { type: 'polyline', points: [{ x: 50, y: 20 }, { x: 20, y: 30 }], width: 6 }),
    region('head', { type: 'polygon', points: [{ x: 5, y: 10 }, { x: 20, y: 30 }] }),
    region('button:undo', { type: 'rect', x: 3, y: 4, w: 80, h: 34 }),
    ...['button:ask-more', 'button:send-followup', 'button:cancel-followup'].map(id => region(id, { type: 'rect', x: 0, y: 0, w: 90, h: 34 })),
    region('faded', { type: 'rect', x: 0, y: 0, w: 900, h: 900 }, 0.01),
  ]), [
    { x: 40, y: 50, w: 200, h: 22 }, { x: 15, y: 25, w: 10, h: 10 },
    { x: 6, y: 16, w: 38, h: 48 }, { x: 17, y: 17, w: 36, h: 16 },
    { x: 5, y: 10, w: 15, h: 20 }, { x: 3, y: 4, w: 80, h: 34 },
  ]);
});
