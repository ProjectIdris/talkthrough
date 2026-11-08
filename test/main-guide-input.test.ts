import assert from 'node:assert/strict';
import test from 'node:test';
import { uIOhook } from 'uiohook-napi';
import { watchGuideInput } from '../src/main/hotkey.ts';

// The guide's input watcher, fed by hand: the hook is never started, so nothing is read from or sent to the system.

test('the mouse wheel reaches the guide while it watches, and stops reaching it once the watch is taken off', () => {
  let wheels = 0, keys = 0;
  const stop = watchGuideInput({ down: () => undefined, up: () => undefined, escape: () => undefined, key: () => void keys++, wheel: () => void wheels++ });
  try {
    uIOhook.emit('wheel', { x: 1, y: 1, amount: 3, direction: 3, rotation: -1 });
    assert.equal(wheels, 1);
    assert.equal(keys, 0, 'a wheel turn is not a key');
  } finally {
    stop();
  }
  uIOhook.emit('wheel', { x: 1, y: 1, amount: 3, direction: 3, rotation: 1 });
  assert.equal(wheels, 1, 'nothing after the watch ended');
  assert.equal(uIOhook.listenerCount('wheel'), 0, 'and no listener is left behind');
});

test('a watcher that does not ask about the wheel is not troubled by it', () => {
  const stop = watchGuideInput({ down: () => undefined, up: () => undefined, escape: () => undefined });
  try {
    assert.doesNotThrow(() => uIOhook.emit('wheel', { x: 1, y: 1, amount: 3, direction: 3, rotation: 1 }));
  } finally {
    stop();
  }
});
