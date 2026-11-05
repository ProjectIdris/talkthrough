import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChordTracker, KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT, pressChord } from '../src/main/chord.ts';

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
import { hotkeyWarning } from '../src/shared/chord-keys.ts';

test('a hotkey names one to four different keys; anything else is refused', () => {
  const d = parseHotkey(DEFAULT_HOTKEY)!;
  assert.deepEqual([...d.keys, d.label, d.early], [KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT, 'Right Ctrl + Right Shift', true]);
  assert.equal(parseHotkey(' Right-Alt + LEFT-CTRL ')!.label, 'Right Alt + Left Ctrl');
  for (const bad of ['right-ctrl+right-ctrl', 'right-ctrl+a+a', '', 'escape', 'right-ctrl+nope', 'a+b+c+d+e', null, 5]) assert.equal(parseHotkey(bad), null, String(bad));
  assert.ok(Object.keys(CHORD_KEYS).length > 100);
  assert.deepEqual(parseHotkey('right-ctrl+a')!.keys, [KEY_RIGHT_CTRL, 30], 'any two keys');
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
  tracker.keyDown(keys.keys[0]!);
  assert.deepEqual(log, ['arm']);
  tracker.keyUp(keys.keys[0]!);
  assert.deepEqual(log, ['arm', 'cancel']);
  tracker.keyDown(keys.keys[0]!);
  tracker.keyDown(keys.keys[1]!);
  assert.deepEqual(log, ['arm', 'cancel', 'arm', 'start']);
  tracker.keyUp(keys.keys[1]!);
  assert.deepEqual(log, ['arm', 'cancel', 'arm', 'start', 'stop']);
});

test('a chord made for a check goes into the tracker, start then stop, and the release is given back and happens once', () => {
  const log: string[] = [];
  const tracker = createChordTracker({ arm: () => log.push('arm'), start: () => log.push('start'), stop: () => log.push('stop') });
  const waiting: Array<() => void> = [];
  const release = pressChord(tracker, { keys: [KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT], label: 'test', early: true }, 1500, (fn) => void waiting.push(fn));
  assert.deepEqual(log, ['arm', 'start']);
  assert.equal(tracker.held, true);
  release();
  assert.deepEqual(log, ['arm', 'start', 'stop']);
  waiting[0]?.(); // the timer firing afterwards does nothing more
  assert.deepEqual(log, ['arm', 'start', 'stop']);
});

test('one key is a hotkey: it starts on press, stops on release, repeats do nothing, and the microphone is never opened early', () => {
  const log: string[] = [];
  const keys = parseHotkey('f13')!;
  assert.deepEqual([keys.keys.length, keys.early, keys.label], [1, false, 'F13']);
  const tracker = createChordTracker({ arm: () => log.push('arm'), cancel: () => log.push('cancel'), start: () => log.push('start'), stop: () => log.push('stop') }, keys);
  tracker.keyDown(KEY_RIGHT_CTRL);
  tracker.keyDown(keys.keys[0]!);
  tracker.keyDown(keys.keys[0]!);
  assert.deepEqual(log, ['start']);
  assert.equal(tracker.held, true);
  tracker.keyUp(keys.keys[0]!);
  assert.deepEqual(log, ['start', 'stop']);
  tracker.keyDown(keys.keys[0]!);
  tracker.reset();
  assert.deepEqual(log, ['start', 'stop', 'start', 'stop']);
});

test('three keys make the hotkey in any order; letting go of any one ends it; only a chord that starts with Ctrl, Shift or Alt arms early', () => {
  const log: string[] = [];
  const keys = parseHotkey('right-ctrl+right-shift+f13')!;
  assert.equal(keys.early, true);
  const tracker = createChordTracker({ arm: () => log.push('arm'), cancel: () => log.push('cancel'), start: () => log.push('start'), stop: () => log.push('stop') }, keys);
  tracker.keyDown(keys.keys[0]!);
  tracker.keyDown(keys.keys[1]!);
  assert.deepEqual(log, ['arm'], 'two of three is not enough');
  tracker.keyDown(keys.keys[2]!);
  assert.deepEqual(log, ['arm', 'start']);
  tracker.keyUp(keys.keys[1]!);
  assert.deepEqual(log, ['arm', 'start', 'stop']);
  tracker.keyUp(keys.keys[0]!);
  tracker.keyUp(keys.keys[2]!);
  // the other way round: the last key first, and the first key last, does not arm
  tracker.keyDown(keys.keys[2]!);
  tracker.keyDown(keys.keys[1]!);
  tracker.keyDown(keys.keys[0]!);
  assert.deepEqual(log, ['arm', 'start', 'stop', 'start']);
  assert.equal(parseHotkey('a+right-ctrl')!.early, false, 'a key that types never opens the microphone on its own');
});

test('what a person is told about the keys they chose', () => {
  assert.equal(hotkeyWarning(['right-ctrl', 'right-shift']), null);
  assert.equal(hotkeyWarning(['f13']), null);
  assert.match(hotkeyWarning(['space']) ?? '', /typing or in programs/);
  assert.match(hotkeyWarning(['right-ctrl']) ?? '', /shortcuts/);
  assert.match(hotkeyWarning(['a', 'b']) ?? '', /type fast/);
  assert.equal(hotkeyWarning(['a', 'left-ctrl']), null);
});

test('nothing in the app sends key or mouse input to the system (only to its own windows): no keyToggle, keyTap, SendInput or the like in src or scripts', () => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mjs|cjs|js)$/.test(entry.name) && /\b(keyToggle|keyTap|SendInput|SendKeys|keybd_event|mouse_event)\b/.test(readFileSync(path, 'utf8'))) found.push(path);
    }
  };
  for (const dir of ['../src', '../scripts']) walk(fileURLToPath(new URL(dir, import.meta.url)));
  assert.deepEqual(found, []);
});
