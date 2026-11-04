import assert from 'node:assert/strict';
import test from 'node:test';
import { LabelBoard, Occupancy, attachPoint, busyFromGray, convexHull, segmentsCross } from '../src/overlay/labels.ts';
import type { Pt, Rect } from '../src/overlay/labels.ts';

const W = 1920, H = 1080;
const MODEL: Rect = { x: 760, y: 300, w: 560, h: 380 };

function env(extra?: { busy?: ReturnType<typeof busyFromGray> }) {
  const occ = new Occupancy(W, H);
  occ.fillConvex([{ x: MODEL.x, y: MODEL.y }, { x: MODEL.x + MODEL.w, y: MODEL.y }, { x: MODEL.x + MODEL.w, y: MODEL.y + MODEL.h }, { x: MODEL.x, y: MODEL.y + MODEL.h }]);
  return { occ, ...(extra?.busy ? { busy: extra.busy } : {}) };
}

function board(): LabelBoard {
  const b = new LabelBoard();
  b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: 0 });
  return b;
}

const anchors: Pt[] = [{ x: 900, y: 380 }, { x: 1000, y: 420 }, { x: 1100, y: 500 }, { x: 1200, y: 600 }, { x: 860, y: 620 }];
const SIZE = { w: 150, h: 36 };

function placeAll(b: LabelBoard, e = env()) {
  return anchors.map((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => e));
}

test('the convex hull keeps the outline and drops what is inside', () => {
  const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }, { x: 5, y: 0 }]);
  assert.equal(hull.length, 4);
  const o = new Occupancy(100, 100, 10);
  o.fillConvex(hull.map((p) => ({ x: p.x * 3, y: p.y * 3 })));
  assert.ok(o.at(15, 15) && !o.at(45, 45));
});

test('tags keep off the model and off each other', () => {
  const e = env();
  const placed = placeAll(board(), e);
  for (const p of placed) assert.equal(e.occ.fraction(p.rect), 0, 'a tag on the model');
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = (placed[i] as { rect: Rect }).rect, b = (placed[j] as { rect: Rect }).rect;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `tags ${i} and ${j} overlap`);
    }
  }
});

test('no leader crosses another leader or a tag', () => {
  const placed = placeAll(board());
  const segs = placed.map((p, i) => [anchors[i] as Pt, p.attach] as [Pt, Pt]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      assert.equal(segmentsCross((segs[i] as [Pt, Pt])[0], (segs[i] as [Pt, Pt])[1], (segs[j] as [Pt, Pt])[0], (segs[j] as [Pt, Pt])[1]), false, `leaders ${i} and ${j} cross`);
    }
    for (let j = 0; j < placed.length; j++) {
      if (i === j) continue;
      const r = (placed[j] as { rect: Rect }).rect;
      const [a, b] = segs[i] as [Pt, Pt];
      const through = [0.25, 0.5, 0.75].some((t) => {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
      });
      assert.equal(through, false, `leader ${i} runs through tag ${j}`);
    }
  }
});

test('tags stay put while the model turns, and only their leaders follow', () => {
  const b = board();
  const first = placeAll(b);
  // The anchors move a long way (the model turned) but the model's rectangle stays about as it was.
  const turned = anchors.map((p) => ({ x: p.x + 90, y: p.y - 40 }));
  b.beginFrame({ width: W, height: H, model: { ...MODEL, x: MODEL.x + 20 }, dragging: false, now: 16 });
  const second = turned.map((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => env()));
  second.forEach((p, i) => {
    assert.deepEqual(p.rect, (first[i] as { rect: Rect }).rect);
  });
  assert.ok(second.some((p, i) => p.attach.x !== (first[i] as { attach: Pt }).attach.x || p.attach.y !== (first[i] as { attach: Pt }).attach.y), 'the leaders follow');
});

test('a long move of the model lays the tags out again and they glide there', () => {
  const b = board();
  const first = placeAll(b);
  const moved: Rect = { x: 200, y: 300, w: 560, h: 380 };
  const occ = new Occupancy(W, H);
  occ.fillConvex([{ x: moved.x, y: moved.y }, { x: moved.x + moved.w, y: moved.y }, { x: moved.x + moved.w, y: moved.y + moved.h }, { x: moved.x, y: moved.y + moved.h }]);
  const shifted = anchors.map((p) => ({ x: p.x - 560, y: p.y }));
  b.beginFrame({ width: W, height: H, model: moved, dragging: false, now: 100 });
  const next = shifted.map((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => ({ occ })));
  assert.equal(b.moving, true);
  for (let n = 1; n < 80; n++) {
    b.beginFrame({ width: W, height: H, model: moved, dragging: false, now: 100 + n * 16 });
    shifted.forEach((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => ({ occ })));
  }
  assert.equal(b.moving, false, 'the tags settle');
  const e = { occ };
  const settled = shifted.map((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => e));
  for (const p of settled) assert.equal(occ.fraction(p.rect), 0);
  settled.forEach((p, i) => assert.notDeepEqual(p.rect, (first[i] as { rect: Rect }).rect, 'a tag did not move'));
  assert.equal(next.length, settled.length);
});

test('tags keep off the busy part of the page', () => {
  // A page that is blank except for a block of text to the right of the model.
  const cols = 192, rows = 108;
  const gray = new Uint8Array(cols * rows).fill(240);
  for (let r = 38; r < 70; r++) for (let c = 140; c < 190; c++) gray[r * cols + c] = (c + r) % 2 === 0 ? 20 : 235;
  const busy = busyFromGray(gray, cols, rows, W, H);
  assert.ok(busy.mean({ x: 1500, y: 450, w: 300, h: 200 }) > 0.3);
  assert.ok(busy.mean({ x: 100, y: 100, w: 300, h: 200 }) < 0.01);
  const b = board();
  const p = b.place(1, { anchor: { x: 1250, y: 520 }, ...SIZE }, () => env({ busy }));
  assert.ok(busy.mean(p.rect) < 0.05, 'the tag sits on the text');
  // Without the page's text in the way the same pin goes nearer to its anchor.
  const near = board().place(1, { anchor: { x: 1250, y: 520 }, ...SIZE }, () => env());
  assert.ok(Math.hypot(near.rect.x - 1250, near.rect.y - 520) <= Math.hypot(p.rect.x - 1250, p.rect.y - 520) + 1);
});

test('a hint steers the side a tag goes to', () => {
  const left = board().place(1, { anchor: { x: 1000, y: 300 }, ...SIZE, hint: { x: -100, y: 0 } }, () => env());
  const right = board().place(1, { anchor: { x: 1000, y: 300 }, ...SIZE, hint: { x: 100, y: 0 } }, () => env());
  assert.ok(left.rect.x + left.rect.w / 2 < right.rect.x + right.rect.w / 2);
});

test('pins that are gone free their room, and the attach point sits on the tag outline', () => {
  const b = board();
  placeAll(b);
  b.keep(new Set([1]));
  const p = b.place(2, { anchor: anchors[1] as Pt, ...SIZE }, () => env());
  assert.ok(p.rect.w === SIZE.w);
  const r: Rect = { x: 100, y: 100, w: 150, h: 36 };
  const a = attachPoint(r, { x: 400, y: 118 });
  assert.equal(a.x, 250);
  const t = attachPoint(r, { x: 150, y: 20 });
  assert.equal(t.y, 100);
});

test('when the model turns and two leaders would cross, the two tags swap places', () => {
  const b = board();
  const e = env();
  const f1 = b.place(1, { anchor: { x: 880, y: 420 }, ...SIZE, hint: { x: -100, y: -80 } }, () => e);
  const f2 = b.place(2, { anchor: { x: 1180, y: 420 }, ...SIZE, hint: { x: 100, y: -80 } }, () => e);
  assert.ok(f1.rect.x < f2.rect.x, 'tag 1 starts on the left');
  // The model turns: the parts trade sides while the tags stay where they were.
  b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: 16 });
  const a1 = { x: 1180, y: 420 }, a2 = { x: 880, y: 420 };
  let p1 = b.place(1, { anchor: a1, ...SIZE }, () => e);
  let p2 = b.place(2, { anchor: a2, ...SIZE }, () => e);
  // The swap is made on the targets; let the glide finish.
  for (let n = 1; n < 60; n++) {
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: 16 + n * 16 });
    p1 = b.place(1, { anchor: a1, ...SIZE }, () => e);
    p2 = b.place(2, { anchor: a2, ...SIZE }, () => e);
  }
  assert.equal(segmentsCross(a1, p1.attach, a2, p2.attach), false, 'the leaders no longer cross');
  assert.ok(p1.rect.x > p2.rect.x, 'the tags traded places');
});

test('two tags that would have to pass through each other fade out and in instead of gliding across', () => {
  const b = board();
  const e = env();
  b.place(1, { anchor: { x: 880, y: 420 }, ...SIZE, hint: { x: -100, y: -80 } }, () => e);
  b.place(2, { anchor: { x: 1180, y: 420 }, ...SIZE, hint: { x: 100, y: -80 } }, () => e);
  // The parts trade sides, so the tags swap places.
  const a1 = { x: 1180, y: 420 }, a2 = { x: 880, y: 420 };
  let worst = 0, faded = false;
  for (let n = 1; n < 80; n++) {
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: n * 16 });
    const p1 = b.place(1, { anchor: a1, ...SIZE }, () => e);
    const p2 = b.place(2, { anchor: a2, ...SIZE }, () => e);
    if (p1.alpha < 1 || p2.alpha < 1) faded = true;
    // How much of the one is covered by the other while both are shown at all.
    const ox = Math.min(p1.rect.x + p1.rect.w, p2.rect.x + p2.rect.w) - Math.max(p1.rect.x, p2.rect.x);
    const oy = Math.min(p1.rect.y + p1.rect.h, p2.rect.y + p2.rect.h) - Math.max(p1.rect.y, p2.rect.y);
    if (ox > 0 && oy > 0 && Math.min(p1.alpha, p2.alpha) > 0.05) worst = Math.max(worst, ox * oy);
  }
  assert.ok(faded, 'the tags faded');
  assert.equal(worst, 0, 'two visible tags overlapped on the way');
  assert.equal(b.moving, false);
});
