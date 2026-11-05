import assert from 'node:assert/strict';
import test from 'node:test';
import { LabelBoard, Occupancy, attachPoint, busyFromGray, convexHull, segmentHitsRect, segmentsCross } from '../src/overlay/labels.ts';
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

test('a leader that ends up across another leader or tag while the parts move is put right', () => {
  // Five pins whose anchors drift to new places (seeded, so the same every run). Without the mending
  // step several of these runs end with a leader across another leader or tag.
  const occ = new Occupancy(W, H);
  occ.fillConvex([{ x: 760, y: 300 }, { x: 1320, y: 300 }, { x: 1320, y: 680 }, { x: 760, y: 680 }]);
  let bad = 0;
  for (const seedStart of [4, 5, 25, 29, 30]) {
    let seed = seedStart;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sizes = Array.from({ length: 5 }, () => ({ w: 80 + Math.round(rnd() * 120), h: 36 }));
    const pt = (): Pt => ({ x: 780 + rnd() * 520, y: 320 + rnd() * 340 });
    const start = Array.from({ length: 5 }, pt), end = Array.from({ length: 5 }, pt);
    const b = new LabelBoard();
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: 0 });
    start.forEach((a, i) => b.place(i, { anchor: a, ...(sizes[i] as { w: number; h: number }) }, () => ({ occ })));
    let last: Array<{ rect: Rect; attach: Pt }> = [];
    for (let f = 1; f < 200; f++) {
      b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: f * 16 });
      const k = Math.min(1, f / 50);
      last = start.map((a, i) => b.place(i, { anchor: { x: a.x + ((end[i] as Pt).x - a.x) * k, y: a.y + ((end[i] as Pt).y - a.y) * k }, ...(sizes[i] as { w: number; h: number }) }, () => ({ occ })));
    }
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        if (i === j) continue;
        const li = last[i] as { rect: Rect; attach: Pt }, lj = last[j] as { rect: Rect; attach: Pt };
        if (j > i && segmentsCross(end[i] as Pt, li.attach, end[j] as Pt, lj.attach)) bad++;
        if (segmentHitsRect(end[i] as Pt, li.attach, lj.rect)) bad++;
      }
    }
  }
  assert.equal(bad, 0, 'leaders still cross');
});

test('a tag keeps off the app\'s own buttons: where a button will be, no tag is put, and a tag the buttons arrive on moves off them', () => {
  const overlapsRect = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const anchor = { x: 1000, y: 360 };
  // Where the tag goes with no buttons.
  const free = board().place(1, { anchor, ...SIZE }, () => env());
  // A button (Explode, with Cut under it) over exactly that spot, before anything is placed.
  const buttons: Rect[] = [{ x: free.rect.x - 10, y: free.rect.y - 4, w: free.rect.w + 20, h: 30 }, { x: free.rect.x + 40, y: free.rect.y + 30, w: 70, h: 30 }];
  const before = board().place(1, { anchor, ...SIZE }, () => ({ ...env(), keepOut: buttons }));
  for (const k of buttons) assert.ok(!overlapsRect(before.rect, k, 4), `a new tag keeps off a button: ${JSON.stringify(before.rect)} vs ${JSON.stringify(k)}`);
  // The tag is placed first, the buttons come after (a finished model shows them): the tag moves off them.
  const b = board();
  let last = b.place(1, { anchor, ...SIZE }, () => env());
  assert.ok(overlapsRect(last.rect, buttons[0]!), 'the test starts with the tag under the button');
  for (let f = 1; f <= 200; f++) {
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: f * 16 });
    last = b.place(1, { anchor, ...SIZE }, () => ({ ...env(), keepOut: buttons }));
  }
  for (const k of buttons) assert.ok(!overlapsRect(last.rect, k, 4), `the tag moved off the button: ${JSON.stringify(last.rect)}`);
  // Where every place is on a button the tag is still shown (somewhere), never dropped.
  const all = board().place(1, { anchor, ...SIZE }, () => ({ ...env(), keepOut: [{ x: 0, y: 0, w: W, h: H }] }));
  assert.ok(all.rect.w > 0 && all.alpha > 0);
});

const SMALL_VIEW = { width: 1000, height: 700 };
const FULL_CARD_CONTROL: Rect = { x: 400, y: 300, w: 240, h: 100 };
const FULL_CARD_REQUEST = { anchor: { x: 520, y: 350 }, w: 100, h: 30 };
const smallViewEnv = (keepOut?: readonly Rect[]) => ({ occ: new Occupancy(SMALL_VIEW.width, SMALL_VIEW.height), ...(keepOut ? { keepOut } : {}) });
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('first label placement prefers a clear viewport slot over a card-only slot under a control', () => {
  const b = new LabelBoard();
  b.beginFrame({ ...SMALL_VIEW, model: undefined, dragging: false, now: 0, within: FULL_CARD_CONTROL });
  const placed = b.place(1, FULL_CARD_REQUEST, () => smallViewEnv([FULL_CARD_CONTROL]));
  assert.equal(overlaps(placed.rect, FULL_CARD_CONTROL), false, `clear viewport space exists outside the card: ${JSON.stringify(placed.rect)}`);
  assert.equal(placed.rect.w, FULL_CARD_REQUEST.w);
  assert.equal(placed.rect.h, FULL_CARD_REQUEST.h);
  assert.equal(placed.alpha, 1);
});

test('retained label escapes a control covering its card when the viewport has room', () => {
  const b = new LabelBoard();
  b.beginFrame({ ...SMALL_VIEW, model: undefined, dragging: false, now: 0, within: FULL_CARD_CONTROL });
  const before = b.place(1, FULL_CARD_REQUEST, () => smallViewEnv());
  assert.deepEqual(before.rect, { x: 537, y: 335, w: 100, h: 30 });

  let placed = before;
  for (let frame = 1; frame <= 140; frame++) {
    b.beginFrame({ ...SMALL_VIEW, model: undefined, dragging: false, now: frame * 16, within: FULL_CARD_CONTROL });
    placed = b.place(1, FULL_CARD_REQUEST, () => smallViewEnv([FULL_CARD_CONTROL]));
  }
  assert.equal(overlaps(placed.rect, FULL_CARD_CONTROL), false, `clear viewport space exists outside the card: ${JSON.stringify(placed.rect)}`);
  assert.equal(placed.rect.w, FULL_CARD_REQUEST.w);
  assert.equal(placed.rect.h, FULL_CARD_REQUEST.h);
  assert.equal(placed.alpha, 1);
  assert.equal(b.moving, false);
});

test('an impossible control keep-out keeps the full label visible as a fallback', () => {
  const b = new LabelBoard();
  const wholeViewport: Rect = { x: 0, y: 0, w: SMALL_VIEW.width, h: SMALL_VIEW.height };
  b.beginFrame({ ...SMALL_VIEW, model: undefined, dragging: false, now: 0, within: FULL_CARD_CONTROL });
  const placed = b.place(1, FULL_CARD_REQUEST, () => smallViewEnv([wholeViewport]));
  assert.equal(placed.rect.w, FULL_CARD_REQUEST.w);
  assert.equal(placed.rect.h, FULL_CARD_REQUEST.h);
  assert.ok(placed.alpha > 0, 'when no clear position exists, keep the label visible');
});

test('a moving visible overlay control repositions a retained pin label without dropping it', () => {
  const b = new LabelBoard();
  const overlapsMeasured = (a: Rect, c: Rect, pad = 0) => a.x < c.x + c.w + pad && c.x < a.x + a.w + pad && a.y < c.y + c.h + pad && c.y < a.y + a.h + pad;
  const anchor = { x: 1000, y: 360 };
  const request = { anchor, ...SIZE };
  let now = 0;
  const frame = () => b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: (now += 16) });
  frame();
  const before = b.place(1, request, () => env()).rect;
  const measuredControl: Rect = { ...before };
  assert.ok(overlapsMeasured(before, measuredControl), 'the measured control starts over the retained label');

  let visible = b.place(1, request, () => ({ ...env(), keepOut: [measuredControl] }));
  assert.ok(visible.rect.w > 0 && visible.alpha > 0, 'the pin label remains visible while its destination changes');
  assert.ok(!overlapsMeasured(visible.rect, measuredControl, 4) || b.moving, 'the retained label begins reflowing away from the new control');
  for (let i = 0; i < 180; i++) {
    frame();
    visible = b.place(1, request, () => ({ ...env(), keepOut: [measuredControl] }));
  }
  assert.ok(!overlapsMeasured(visible.rect, measuredControl, 4), `the settled label is clear of the control: ${JSON.stringify(visible.rect)}`);
  assert.ok(visible.alpha > 0);
});

// The model's card (the frame drawn round it) is no place for a tag to straddle: a tag is wholly inside it, or the card was too small and the tag goes where it can.
const CARD: Rect = { x: 700, y: 300, w: 700, h: 260 };
const inCard = (r: Rect, c: Rect = CARD) => r.x >= c.x && r.y >= c.y && r.x + r.w <= c.x + c.w && r.y + r.h <= c.y + c.h;
const cardEnv = () => {
  const occ = new Occupancy(W, H);
  occ.fillConvex([{ x: 940, y: 330 }, { x: 1160, y: 330 }, { x: 1160, y: 520 }, { x: 940, y: 520 }]); // the model, in the middle of the card
  return { occ };
};
const cardAnchors: Pt[] = [{ x: 1000, y: 335 }, { x: 1100, y: 335 }, { x: 950, y: 420 }];

test('with a card round the model, every tag is wholly inside it (none above its top edge)', () => {
  const b = new LabelBoard();
  b.beginFrame({ width: W, height: H, model: { x: 940, y: 330, w: 220, h: 190 }, dragging: false, now: 0, within: CARD });
  const e = cardEnv();
  const placed = cardAnchors.map((anchor, i) => b.place(i + 1, { anchor, w: 130, h: 32 }, () => e));
  placed.forEach((p, i) => assert.ok(inCard(p.rect), `tag ${i} at ${JSON.stringify(p.rect)} is not inside the card`));
});

test('without a card the same tags are free to go above the model (so the card is what keeps them in)', () => {
  const b = new LabelBoard();
  b.beginFrame({ width: W, height: H, model: { x: 940, y: 330, w: 220, h: 190 }, dragging: false, now: 0 });
  const e = cardEnv();
  const placed = cardAnchors.map((anchor, i) => b.place(i + 1, { anchor, w: 130, h: 32 }, () => e));
  assert.ok(placed.some((p) => !inCard(p.rect)), 'the check above would pass anyway');
});

test('a tag placed before the card was there is moved inside it once the card is', () => {
  const b = new LabelBoard();
  const e = cardEnv();
  let clock = 0;
  const frame = (within?: Rect) => b.beginFrame({ width: W, height: H, model: { x: 940, y: 330, w: 220, h: 190 }, dragging: false, now: (clock += 16), ...(within ? { within } : {}) });
  frame();
  const request = { anchor: cardAnchors[0] as Pt, w: 130, h: 32 };
  const before = b.place(1, request, () => e).rect;
  assert.equal(inCard(before), false, 'the setup: it sits outside');
  for (let i = 0; i < 3; i++) { frame(CARD); b.place(1, request, () => e); }
  for (let i = 0; i < 90 && b.moving; i++) { frame(CARD); b.place(1, request, () => e); }
  assert.ok(inCard(b.place(1, request, () => e).rect));
});

test('a card too small for the tags does not leave them unplaced', () => {
  const b = new LabelBoard();
  const tiny: Rect = { x: 940, y: 330, w: 100, h: 20 };
  b.beginFrame({ width: W, height: H, model: { x: 940, y: 330, w: 220, h: 190 }, dragging: false, now: 0, within: tiny });
  const p = b.place(1, { anchor: cardAnchors[0] as Pt, w: 130, h: 32 }, () => cardEnv());
  assert.ok(p.rect.w === 130 && p.rect.x >= 0 && p.rect.y >= 0);
});

test('with a card round the model, a tag is wholly inside it or wholly outside it: never cut by its edge', () => {
  const card: Rect = { x: 740, y: 280, w: 620, h: 420 };
  const b = new LabelBoard();
  b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: 0, within: card });
  const e = env();
  // Eight tags of 150 x 36 cannot all fit in what the card leaves round the model.
  const spots: Pt[] = [{ x: 900, y: 380 }, { x: 1000, y: 420 }, { x: 1100, y: 500 }, { x: 1200, y: 480 }, { x: 860, y: 480 }, { x: 960, y: 300 }, { x: 1150, y: 330 }, { x: 1000, y: 500 }];
  const rects = spots.map((anchor, i) => b.place(i + 1, { anchor, ...SIZE }, () => e).rect);
  const touches = (r: Rect) => r.x < card.x + card.w && r.x + r.w > card.x && r.y < card.y + card.h && r.y + r.h > card.y;
  const inside = (r: Rect) => r.x >= card.x && r.y >= card.y && r.x + r.w <= card.x + card.w && r.y + r.h <= card.y + card.h;
  for (const [i, r] of rects.entries()) assert.ok(inside(r) || !touches(r), `tag ${i} straddles the card's edge: ${JSON.stringify(r)}`);
});

test('a tag prefers a leader that does not cross a control when a clear placement exists', () => {
  const anchor = { x: 900, y: 380 }, req = { anchor, ...SIZE }, e = env();
  const initial = board().place(1, req, () => e);
  const obstacle = { x: (anchor.x + initial.attach.x) / 2 - 5, y: (anchor.y + initial.attach.y) / 2 - 5, w: 10, h: 10 };
  assert.ok(segmentHitsRect(anchor, initial.attach, obstacle));
  const placed = board().place(1, req, () => ({ ...e, keepOut: [obstacle] }));
  assert.equal(segmentHitsRect(anchor, placed.attach, obstacle), false, 'initial search should choose a clear leader');
});

test('a persistent new control crossing moves an existing tag to a clear leader', () => {
  const anchor = { x: 900, y: 380 }, req = { anchor, ...SIZE }, e = env(), b = board();
  const initial = b.place(1, req, () => e);
  const obstacle = { x: (anchor.x + initial.attach.x) / 2 - 5, y: (anchor.y + initial.attach.y) / 2 - 5, w: 10, h: 10 };
  assert.ok(segmentHitsRect(anchor, initial.attach, obstacle));
  let p = initial;
  for (let i = 1; i <= 100; i++) {
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: i * 16 });
    p = b.place(1, req, () => ({ ...e, keepOut: [obstacle] }));
  }
  assert.equal(segmentHitsRect(anchor, p.attach, obstacle), false, 'persistent crossing must mend when a clear alternative exists');
});

test('a control containing the anchor does not hide the tag or cause endless movement', () => {
  const anchor = { x: 900, y: 380 }, req = { anchor, ...SIZE }, e = { ...env(), keepOut: [{x: 880, y: 360, w: 40, h: 40}] }, b = board();
  let p = b.place(1, req, () => e);
  for (let i = 1; i <= 160; i++) { b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: i * 16 }); p = b.place(1, req, () => e); }
  assert.equal(p.rect.w, SIZE.w); assert.equal(p.rect.h, SIZE.h); assert.equal(p.alpha, 1); assert.equal(b.moving, false);
});

test('an enclosed anchor with no clear route keeps a full-size tag and retries boundedly', () => {
  const anchor = { x: 900, y: 380 }, req = { anchor, ...SIZE }, b = board();
  const keepOut = [{x: 870,y:350,w:60,h:5},{x:870,y:405,w:60,h:5},{x:870,y:355,w:5,h:50},{x:925,y:355,w:5,h:50}];
  const e = { ...env(), keepOut };
  let p = b.place(1, req, () => e); let changes = 0; let last = p.rect;
  for (let i = 1; i <= 240; i++) { b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: i * 16 }); p = b.place(1, req, () => e); if (p.rect.x !== last.x || p.rect.y !== last.y) changes++; last = p.rect; }
  assert.equal(p.rect.w, SIZE.w); assert.equal(p.rect.h, SIZE.h); assert.equal(p.alpha, 1); assert.equal(changes, 0);
});

test('a moving control crossing a retained leader is avoided after it stops', () => {
  const anchor = { x: 900, y: 380 }, req = { anchor, ...SIZE }, e = env(), b = board();
  const initial = b.place(1, req, () => e);
  const target = { x: (anchor.x + initial.attach.x) / 2 - 5, y: (anchor.y + initial.attach.y) / 2 - 5, w: 10, h: 10 };
  let p = initial;
  for (let i = 1; i <= 120; i++) {
    const control = { ...target, x: target.x + Math.max(0, 25 - i) * 5 };
    b.beginFrame({ width: W, height: H, model: MODEL, dragging: false, now: i * 16 });
    p = b.place(1, req, () => ({ ...e, keepOut: [control] }));
  }
  assert.equal(segmentHitsRect(anchor, p.attach, target), false);
});
