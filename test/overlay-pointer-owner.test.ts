import test from 'node:test';
import assert from 'node:assert/strict';
import { createDismissCapture, createPointerOwner, routePointer } from '../src/overlay/pointer-owner.ts';

test('capture controls precede pen, guide targets pass, content holds and background dismisses', () => {
  assert.equal(routePointer({ captureControl: true, pen: true, guideTarget: true, content: true }), 'control');
  assert.equal(routePointer({ pen: true, guideTarget: true }), 'pen');
  assert.equal(routePointer({ pill: true, guideTarget: true }), 'control');
  assert.equal(routePointer({ guideTarget: true, content: true }), 'guide');
  assert.equal(routePointer({ content: true }), 'content');
  assert.equal(routePointer({}), 'dismiss');
});

test('background dismissal waits for matching release and abort does not dismiss', () => {
  let dismissed = 0;
  const c = createDismissCapture(() => dismissed++);
  assert.equal(c.begin(4), true);
  assert.equal(c.begin(5), false);
  c.release(5); assert.equal(dismissed, 0); assert.equal(c.held, true);
  c.release(4); assert.equal(dismissed, 1); assert.equal(c.held, false);
  c.release(4); assert.equal(dismissed, 1);
  c.begin(6); c.abort(); assert.equal(c.held, false); assert.equal(dismissed, 1);
  c.begin(7); c.suppress(); assert.equal(c.held, true, 'superseded press still holds its release');
  c.release(7); assert.equal(c.held, false); assert.equal(dismissed, 1, 'stale press cannot dismiss a new turn');
});

test('lost capture, cancel and blur release a drag once; a later drag can begin', () => {
  const changes: boolean[] = [];
  const owner = createPointerOwner((on) => changes.push(on));
  owner.begin(7); assert.equal(owner.dragging, true);
  owner.lost(8); assert.equal(owner.dragging, true, 'another pointer cannot end this drag');
  owner.lost(7); assert.equal(owner.dragging, false);
  owner.cancel(); owner.blur();
  owner.begin(9); owner.blur();
  assert.deepEqual(changes, [true, false, true, false]);
});

test('a stalled drag times out, and pointer motion renews its bounded hold', () => {
  let timer: (() => void) | undefined;
  const changes: boolean[] = [];
  const owner = createPointerOwner((on) => changes.push(on), {
    setTimer: (fn) => { timer = fn; return fn; },
    clearTimer: () => { timer = undefined; },
  });
  owner.begin(3); const old = timer;
  owner.move(3); assert.notEqual(timer, old, 'movement renews the deadline');
  old?.(); assert.equal(owner.dragging, true, 'a stale timer cannot release a renewed drag');
  timer?.(); assert.equal(owner.dragging, false);
  assert.deepEqual(changes, [true, false]);
});

test('background hold survives blur or capture loss until release, with a bounded fallback', () => {
  const timers: { fire?: () => void } = {}; let dismissed = 0, expired = 0;
  const owner = createDismissCapture(() => dismissed++, {
    setTimer: (fn: () => void) => { timers.fire = fn; return fn; },
    clearTimer: () => { delete timers.fire; },
    onTimeout: () => expired++,
  });
  owner.begin(1); owner.lost(1);
  assert.equal(owner.held, true, 'capture loss must not release ownership early');
  owner.release(1);
  assert.equal(dismissed, 1); assert.equal(owner.held, false); assert.equal(Boolean(timers.fire), false);
  owner.begin(2); owner.lost(2); const stale = timers.fire; owner.release(2);
  owner.begin(3); owner.lost(3); stale?.(); assert.equal(owner.held, true, 'stale timeout cannot end a new press');
  timers.fire?.(); assert.equal(owner.held, false); assert.equal(dismissed, 3); assert.equal(expired, 1);
  owner.begin(4); owner.lost(4); owner.suppress(); timers.fire?.(); assert.equal(dismissed, 3, 'superseded press cannot dismiss new content');
});
