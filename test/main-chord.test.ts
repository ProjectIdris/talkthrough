import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChordTracker, KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT, KEY_Z, undoAccelerator } from '../src/main/chord.ts';

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

// ---- a chord of the person's choosing --------------------------------------------------------------------------------

import { CHORD_KEYS, DEFAULT_HOTKEY, parseHotkey } from '../src/main/chord.ts';

test('a hotkey names two different modifier keys; anything else is refused', () => {
  const d = parseHotkey(DEFAULT_HOTKEY)!;
  assert.deepEqual([d.lead, d.second, d.label], [KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT, 'Right Ctrl + Right Shift']);
  assert.equal(parseHotkey(' Right-Alt + LEFT-CTRL ')!.label, 'Right Alt + Left Ctrl');
  for (const bad of ['right-ctrl+right-ctrl', 'right-ctrl', 'right-ctrl+a', 'f1+f2', '', 'right-ctrl+right-shift+left-alt', null, 5]) assert.equal(parseHotkey(bad), null, String(bad));
  assert.equal(Object.keys(CHORD_KEYS).length, 6);
});

test('with another pair, only that pair makes the chord, and the first key held alone arms the early microphone', () => {
  const log: string[] = [];
  const keys = parseHotkey('right-alt+left-ctrl')!;
  const tracker = createChordTracker({ arm: () => log.push('arm'), cancel: () => log.push('cancel'), start: () => log.push('start'), stop: () => log.push('stop') }, keys);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  assert.deepEqual(log, [], 'the usual pair does nothing now');
  tracker.keyUp(KEY_RIGHT_CTRL);
  tracker.keyUp(KEY_RIGHT_SHIFT);
  tracker.keyDown(keys.lead);
  assert.deepEqual(log, ['arm']);
  tracker.keyUp(keys.lead);
  assert.deepEqual(log, ['arm', 'cancel']);
  tracker.keyDown(keys.lead);
  tracker.keyDown(keys.second);
  assert.deepEqual(log, ['arm', 'cancel', 'arm', 'start']);
  tracker.keyUp(keys.second);
  assert.deepEqual(log, ['arm', 'cancel', 'arm', 'start', 'stop']);
});

test('Z while the chord is held is an undo, once for each press of Z; Z at any other time is nothing', () => {
  const log: string[] = [];
  const tracker = createChordTracker({ start: () => log.push('start'), stop: () => log.push('stop'), undo: () => log.push('undo') });
  tracker.keyDown(KEY_Z); // before the chord
  tracker.keyUp(KEY_Z);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_Z); // the chord is not complete yet
  tracker.keyUp(KEY_Z);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_Z);
  tracker.keyDown(KEY_Z); // auto-repeat
  tracker.keyDown(KEY_Z);
  tracker.keyUp(KEY_Z);
  tracker.keyDown(KEY_Z); // a second press
  tracker.keyUp(KEY_Z);
  tracker.keyUp(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_Z); // after the chord
  assert.deepEqual(log, ['start', 'undo', 'undo', 'stop']);
});

test('Z held down before the chord is made does not undo when the chord completes, and the chord is unchanged by Z', () => {
  const log: string[] = [];
  const tracker = createChordTracker({ start: () => log.push('start'), stop: () => log.push('stop'), undo: () => log.push('undo') });
  tracker.keyDown(KEY_Z);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(KEY_RIGHT_SHIFT);
  tracker.keyDown(KEY_Z); // the repeat of a Z that was already down
  assert.deepEqual(log, ['start']);
  assert.equal(tracker.held, true);
});

test('the system key that holds the undo from the app beneath is the chord\'s modifiers and Z, and nothing for a pair that makes no such key', () => {
  assert.equal(undoAccelerator(parseHotkey('right-ctrl+right-shift')!), 'Control+Shift+Z');
  assert.equal(undoAccelerator(parseHotkey('right-ctrl+right-alt')!), 'Control+Alt+Z');
  assert.equal(undoAccelerator(parseHotkey('left-shift+right-alt')!), 'Shift+Alt+Z');
  assert.equal(undoAccelerator(parseHotkey('left-ctrl+right-ctrl')!), undefined);
});
