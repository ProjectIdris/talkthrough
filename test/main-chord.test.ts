import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChordTracker, KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT } from '../src/main/chord.ts';

const LEFT_CTRL = 29;
const LEFT_SHIFT = 42;

function setup() {
  const log: string[] = [];
  const tracker = createChordTracker({ start: () => log.push('start'), stop: () => log.push('stop') });
  return { log, tracker };
}

test('starts when both right keys are down and stops when either is released', () => {
  const { log, tracker } = setup();
  tracker.keyDown(KEY_RIGHT_CTRL);
  assert.deepEqual(log, []);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  assert.deepEqual(log, ['start']);
  assert.equal(tracker.held, true);
  tracker.keyUp(KEY_RIGHT_SHIFT);
  assert.deepEqual(log, ['start', 'stop']);
  tracker.keyUp(KEY_RIGHT_CTRL);
  assert.deepEqual(log, ['start', 'stop']);
});

test('the left keys and every other key do nothing', () => {
  const { log, tracker } = setup();
  tracker.keyDown(LEFT_CTRL);
  tracker.keyDown(LEFT_SHIFT);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(LEFT_SHIFT);
  tracker.keyDown(30);
  assert.deepEqual(log, []);
  assert.equal(tracker.held, false);
});

test('auto-repeat does not start twice, and a new press starts again', () => {
  const { log, tracker } = setup();
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyUp(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_CTRL);
  assert.deepEqual(log, ['start', 'stop', 'start']);
});

test('reset ends a held chord and forgets the keys', () => {
  const { log, tracker } = setup();
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.reset();
  assert.deepEqual(log, ['start', 'stop']);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  assert.deepEqual(log, ['start', 'stop']);
});

function armed() {
  const log: string[] = [];
  const tracker = createChordTracker({ arm: () => log.push('arm'), cancel: () => log.push('cancel'), start: () => log.push('start'), stop: () => log.push('stop') });
  return { log, tracker };
}

test('Right Ctrl first arms the chord; Right Shift then starts it without arming again', () => {
  const { log, tracker } = armed();
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_CTRL); // key repeat
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyUp(KEY_RIGHT_SHIFT);
  tracker.keyUp(KEY_RIGHT_CTRL);
  assert.deepEqual(log, ['arm', 'start', 'stop']);
});

test('Right Ctrl released alone cancels; Right Shift first never arms', () => {
  const { log, tracker } = armed();
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyUp(KEY_RIGHT_CTRL);
  assert.deepEqual(log, ['arm', 'cancel']);
  log.length = 0;
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyUp(KEY_RIGHT_CTRL);
  assert.deepEqual(log, ['start', 'stop']);
});

test('reset while armed cancels', () => {
  const { log, tracker } = armed();
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.reset();
  assert.deepEqual(log, ['arm', 'cancel']);
});
