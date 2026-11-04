import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_LAG, NO_BOUNDARY_MS, captionSpot, createCaptionDriver } from '../src/overlay/captions.ts';
import type { CaptionState } from '../src/overlay/captions.ts';
import type { CaptionMode } from '../src/shared/captions.ts';
import { LabelBoard, Occupancy } from '../src/overlay/labels.ts';
import { cardFootprint } from '../src/overlay/placement.ts';
import type { Box } from '../src/overlay/placement.ts';
import type { Mark } from '../src/scene/index.ts';

/** A driver on a clock the test moves. */
function rig(mode: CaptionMode) {
  let t = 0;
  const timers: Array<{ at: number; run: () => void; every?: number; dead: boolean }> = [];
  const seen: Array<CaptionState | null> = [];
  const driver = createCaptionDriver({
    mode,
    onChange: (s) => seen.push(s),
    now: () => t,
    after: (ms, run) => {
      const x = { at: t + ms, run, dead: false };
      timers.push(x);
      return () => void (x.dead = true);
    },
    every: (ms, run) => {
      const x = { at: t + ms, run, every: ms, dead: false };
      timers.push(x);
      return () => void (x.dead = true);
    },
  });
  const advance = (ms: number): void => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at;
      if (due.every) due.at += due.every;
      else due.dead = true;
      due.run();
    }
    t = end;
  };
  return { driver, seen, advance, last: () => seen[seen.length - 1] };
}
const SAY = 'The piston moves up, then down.';

test('voice only: nothing is ever shown', () => {
  const r = rig('voice');
  r.driver.stepStart(SAY);
  r.driver.voiceStart(2000);
  r.driver.boundary(4);
  r.driver.voiceEnd();
  assert.ok(r.seen.every((s) => s === null));
  assert.equal(r.driver.current, null);
});

test('text only: the whole step is shown at once, and the words stay when its time is up', () => {
  const r = rig('text');
  r.driver.stepStart(SAY);
  assert.deepEqual(r.last(), { text: SAY, upTo: SAY.length, endedAt: undefined });
  r.advance(4000);
  r.driver.voiceEnd();
  assert.equal(r.last()?.endedAt, 4000);
  assert.equal(r.last()?.upTo, SAY.length);
});

test('voice and text: nothing is shown until the voice comes to a word, then up to the end of that word, never back, and all at the end', () => {
  const r = rig('both');
  r.driver.stepStart(SAY);
  assert.equal(r.last()?.upTo, 0, 'the step has begun but nothing has been said');
  r.driver.voiceStart(2000);
  assert.equal(r.last()?.upTo, 0);
  r.driver.boundary(0);
  assert.equal(r.last()?.upTo, 3, '"The" is being said');
  r.driver.boundary(4);
  assert.equal(r.last()?.upTo, 10, 'up to the end of "piston"');
  r.driver.boundary(0);
  assert.equal(r.last()?.upTo, 10, 'a word already shown does not take words back');
  r.driver.boundary(11); // "moves", a word start
  assert.equal(r.last()?.upTo, 16);
  r.driver.voiceEnd();
  assert.equal(r.last()?.upTo, SAY.length);
  assert.ok(r.last()?.endedAt !== undefined);
});

test('a boundary in the middle of a word shows that word; one past the end shows the rest', () => {
  const r = rig('both');
  r.driver.stepStart(SAY);
  r.driver.voiceStart(2000);
  r.driver.boundary(6); // inside "piston"
  assert.equal(r.last()?.upTo, 10);
  r.driver.boundary(500);
  assert.equal(r.last()?.upTo, SAY.length);
});

test('a voice with no word boundaries is followed by the clock, slower than the voice, from 1.5 s after it started', () => {
  const r = rig('both');
  r.driver.stepStart(SAY);
  r.driver.voiceStart(2000);
  r.advance(NO_BOUNDARY_MS - 10);
  assert.equal(r.last()?.upTo, 0, 'not before the wait is over');
  r.advance(500);
  const shown = r.last()?.upTo ?? 0;
  assert.ok(shown > 0, 'the clock has begun to show words');
  // At 2 s a 2 s voice has said it all; the clock, 1.25 times slower, has not shown it all yet.
  assert.ok(CLOCK_LAG > 1 && shown < SAY.length);
  r.advance(1000);
  assert.equal(r.last()?.upTo, SAY.length, 'in the end all of it');
});

test('a voice that does give boundaries never has the clock add words of its own', () => {
  const r = rig('both');
  r.driver.stepStart(SAY);
  r.driver.voiceStart(2000);
  r.driver.boundary(0);
  r.advance(10000);
  assert.equal(r.last()?.upTo, 3, 'only what the voice reached');
});

test('a new step or a clear stops what the last one was doing', () => {
  const r = rig('both');
  r.driver.stepStart(SAY);
  r.driver.voiceStart(2000);
  r.driver.stepStart('Next, the valve.');
  r.advance(10000);
  assert.deepEqual(r.last(), { text: 'Next, the valve.', upTo: 0, endedAt: undefined }, 'the old clock did not touch the new words');
  r.driver.clear();
  assert.equal(r.last(), null);
});

test('the caption goes to the bottom middle, and to the top when the marks are there, and to a corner when both are taken', () => {
  const view = { width: 2000, height: 1000 };
  const size = { w: 800, h: 80 };
  assert.deepEqual(captionSpot(view, size, []), { x: 600, y: 880 });
  const onBottom = [{ x: 500, y: 850, w: 1000, h: 150 }];
  assert.deepEqual(captionSpot(view, size, onBottom), { x: 600, y: 40 });
  const both = [...onBottom, { x: 500, y: 0, w: 1000, h: 150 }];
  const corner = captionSpot(view, size, both);
  assert.ok(corner.x === 40 || corner.x === 2000 - 800 - 40, 'a corner, clear of the middle');
});

test('a caption stays where it was while that place is still clear, and moves when something comes onto it', () => {
  const view = { width: 2000, height: 1000 };
  const size = { w: 800, h: 80 };
  const top = { x: 600, y: 40 };
  assert.deepEqual(captionSpot(view, size, [], top), top, 'the bottom middle is clear too, but it does not hop');
  assert.deepEqual(captionSpot(view, size, [{ x: 500, y: 0, w: 1000, h: 150 }], top), { x: 600, y: 880 }, 'something came onto the top: it goes to the bottom');
});

test('the caption keeps off a note card, the enlarged picture an image mark is drawn on, and a tag beside the model (what captionKeepOut gathers)', () => {
  const view = { width: 2000, height: 1000 };
  const size = { w: 800, h: 80 };
  const px = (b: Box) => ({ x: (b.x / 1000) * view.width, y: (b.y / 1000) * view.height, w: (b.w / 1000) * view.width, h: (b.h / 1000) * view.height });
  const noted = cardFootprint({ op: 'card', id: 'c', x: 300, y: 880, w: 300, title: 'Note', rows: ['one'] } as Mark, view.height).map(px);
  assert.equal(noted.length, 1, 'a card has a footprint');
  const image = cardFootprint({ op: 'image', id: 'i', sx: 10, sy: 10, sw: 100, sh: 80, dx: 350, dy: 860, dw: 300 } as Mark, view.height).map(px);
  assert.ok(image[0] && image[0].x === 700 && image[0].w === 600, 'the card the picture is drawn on, not the part it was cut from');
  const overCard = captionSpot(view, size, noted);
  assert.ok(!overlaps(overCard, size, noted[0]!), JSON.stringify(overCard));
  const overImage = captionSpot(view, size, image);
  assert.ok(!overlaps(overImage, size, image[0]!), JSON.stringify(overImage));
  const board = new LabelBoard();
  board.beginFrame({ width: view.width, height: view.height, model: { x: 900, y: 300, w: 200, h: 300 }, dragging: false, now: 0 });
  board.place(1, { anchor: { x: 1000, y: 880 }, w: 300, h: 34 }, () => ({ occ: new Occupancy(view.width, view.height) }));
  const tags = board.shownRects();
  assert.equal(tags.length, 1);
  const overTag = captionSpot(view, size, tags);
  assert.ok(!overlaps(overTag, size, tags[0]!), JSON.stringify(overTag));
  assert.deepEqual(new LabelBoard().shownRects(), [], 'no tags, nothing to keep off');
});
const overlaps = (at: { x: number; y: number }, size: { w: number; h: number }, r: { x: number; y: number; w: number; h: number }): boolean => at.x < r.x + r.w && r.x < at.x + size.w && at.y < r.y + r.h && r.y < at.y + size.h;
