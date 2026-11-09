import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uIOhook } from 'uiohook-napi';
import { createChordTracker, KEY_RIGHT_CTRL, KEY_RIGHT_SHIFT } from '../src/main/chord.ts';
import { startHotkey } from '../src/main/hotkey.ts';
import { createHookCare, createStallMeter, kindOfEvent } from '../src/main/hook-health.ts';

// A hook that Windows has silently removed: it stops delivering until it is started again. The system's own idea of "seconds since the last input" is the clock for the person's use.
function rig(o: { quiet?: () => boolean; failRestarts?: number } = {}) {
  const lines: string[] = [];
  let now = 1_000_000;
  let lastInputAt = now;
  let alive = true;
  let restarts = 0;
  let fail = o.failRestarts ?? 0;
  const care = createHookCare({
    now: () => now,
    restart: () => {
      if (fail > 0) { fail--; throw new Error('could not start'); }
      restarts++;
      alive = true;
    },
    quiet: o.quiet ?? (() => true),
    idleSeconds: () => Math.max(0, (now - lastInputAt) / 1000),
    stall: () => ({ lapMs: 12, maxMs: 40 }),
    log: (l) => lines.push(l),
  });
  return {
    care,
    lines,
    restarts: () => restarts,
    kill: () => { alive = false; },
    /** The person uses the keyboard or mouse: the hook hears it only while it is alive. */
    input(kind: 'key' | 'mouse' | 'move' = 'move') { lastInputAt = now; if (alive) care.note(kind); },
    advance(ms: number) { now += ms; },
  };
}

test('the hook health line counts events per answer and since the start, never which key', () => {
  const r = rig();
  r.input('key'); r.input('key'); r.input('mouse'); r.input('move'); r.input('move'); r.input('move');
  r.care.answerEnded();
  r.input('key');
  r.care.answerEnded();
  assert.match(r.lines[0]!, /during this answer keys 2, mouse 1, moves 3; since start keys 2, mouse 1, moves 3; longest main-thread stall 12 ms this answer, 40 ms since start/);
  assert.match(r.lines[2]!, /during this answer keys 1, mouse 0, moves 0; since start keys 3, mouse 1, moves 3/);
});

test('an answer that ends restarts the hook once, logged; a held chord waits for its turn', () => {
  let quiet = false;
  const r = rig({ quiet: () => quiet });
  r.care.answerEnded();
  assert.equal(r.restarts(), 0, 'a key of the chord is down: the hook is left alone');
  quiet = true;
  r.advance(10_000);
  r.input('key');
  r.care.check();
  assert.equal(r.restarts(), 1, 'the restart that had to wait is made at the next check');
  assert.equal(r.lines.filter((l) => /restarted/.test(l)).length, 1);
  r.advance(10_000);
  r.care.check();
  assert.equal(r.restarts(), 1, 'and only once');
});

test('a hook that went silent while the person used the system is restarted, once, and hears again', () => {
  const r = rig();
  r.input('key');
  r.kill();
  for (let i = 0; i < 6; i++) { r.advance(10_000); r.input('move'); r.care.check(); }
  assert.equal(r.restarts(), 1, 'restarted once, not at every check');
  assert.match(r.lines.find((l) => /restarted/.test(l))!, /input the hook did not hear/);
  r.input('key');
  assert.equal(r.care.totals().keys, 2, 'the restarted hook delivers again');
});

test('a quiet hook is left alone while nobody is using the system', () => {
  const r = rig();
  r.input('key');
  for (let i = 0; i < 30; i++) { r.advance(10_000); r.care.check(); }
  assert.equal(r.restarts(), 0);
});

test('a hook that stays silent after a restart is retried less and less often, and a heard event starts over', () => {
  const r = rig();
  r.input('key');
  // Still silent after every restart (the person is in a window the hook cannot hear): the restarts thin out.
  const dead = () => { r.kill(); };
  let made = 0;
  for (let i = 0; i < 120; i++) { dead(); r.advance(10_000); r.input('move'); const before = r.restarts(); r.care.check(); if (r.restarts() > before) made++; }
  assert.ok(made >= 2 && made <= 8, `restarts thin out, got ${made} in 20 minutes`);
});

test('a restart that fails is logged and tried again after a wait', () => {
  const r = rig({ failRestarts: 1 });
  r.care.answerEnded();
  assert.match(r.lines.find((l) => /restart failed/.test(l))!, /could not start/);
  r.advance(10_000);
  r.care.check();
  assert.equal(r.restarts(), 0, 'not at the very next check');
  r.advance(25_000);
  r.care.check();
  assert.equal(r.restarts(), 1);
});

test('a chord key left down by a hook that died does not block the restart for ever', () => {
  // The hook died between a chord key going down and coming up: the tracker still says it is down, and nothing more will be heard.
  const r = rig({ quiet: () => false });
  r.input('key');
  r.kill();
  for (let i = 0; i < 3; i++) { r.advance(10_000); r.care.check(); }
  assert.equal(r.restarts(), 0, 'for the first seconds a key may really be held');
  r.care.answerEnded();
  for (let i = 0; i < 6; i++) { r.advance(10_000); r.care.check(); }
  assert.equal(r.restarts(), 1, 'a key down with no event for half a minute counts as released, and the hook is restarted');
  assert.match(r.lines.find((l) => /restarted/.test(l))!, /counted as released/);
});

test('a chord key really held (events keep coming) is never restarted under the person', () => {
  const r = rig({ quiet: () => false });
  for (let i = 0; i < 40; i++) { r.advance(10_000); r.input('key'); r.care.check(); }
  assert.equal(r.restarts(), 0);
});

test('a restart that keeps failing is tried and logged less and less often', () => {
  const r = rig({ failRestarts: 1000 });
  r.care.answerEnded();
  for (let i = 0; i < 360; i++) { r.advance(10_000); r.input('move'); r.care.check(); }
  const failures = r.lines.filter((l) => /restart failed/.test(l)).length;
  assert.ok(failures >= 3 && failures <= 14, `in an hour of checks the failures thin out, got ${failures} lines`);
});

test('the chord tracker says when any key of the chord is down', () => {
  const t = createChordTracker({ start: () => undefined, stop: () => undefined });
  assert.equal(t.active, false);
  t.keyDown(KEY_RIGHT_CTRL);
  assert.equal(t.active, true);
  t.keyDown(KEY_RIGHT_SHIFT);
  t.keyUp(KEY_RIGHT_CTRL);
  assert.equal(t.active, true);
  t.keyUp(KEY_RIGHT_SHIFT);
  assert.equal(t.active, false);
});

test('events are sorted into kinds only', () => {
  assert.equal(kindOfEvent(4), 'key');
  assert.equal(kindOfEvent(5), 'key');
  assert.equal(kindOfEvent(7), 'mouse');
  assert.equal(kindOfEvent(11), 'mouse');
  assert.equal(kindOfEvent(9), 'move');
  assert.equal(kindOfEvent(99), null);
});

test('a hook that was stopped is not started again by a restart', { skip: process.platform !== 'win32' }, () => {
  const downs: number[] = [];
  const hook = startHotkey({ start: () => undefined, stop: () => undefined });
  hook.stop();
  hook.restart();
  uIOhook.on('keydown', (e) => downs.push(e.keycode));
  // A hook started again here would be running with nobody to hear it; stopping it now is harmless either way, so the check is that stop() has nothing left to stop.
  assert.equal(hook.running(), false);
  uIOhook.removeAllListeners();
});

test('the real hook restarts with every listener kept (nothing is sent to the system)', { skip: process.platform !== 'win32' }, () => {
  const seen: number[] = [];
  const downs: number[] = [];
  const hook = startHotkey({ start: () => undefined, stop: () => undefined }, undefined, undefined, (t) => seen.push(t));
  uIOhook.on('keydown', (e) => downs.push(e.keycode));
  try {
    hook.restart();
    hook.restart();
    // The same emitter the native hook feeds: the listeners the first start attached still hear it.
    uIOhook.emit('input', { type: 7 });
    uIOhook.emit('keydown', { type: 4, keycode: 1 });
    assert.deepEqual(seen.slice(-1), [7]);
    assert.deepEqual(downs.slice(-1), [1]);
  } finally {
    hook.stop();
  }
});

test('the stall meter reports how long the main thread was blocked', async () => {
  const meter = createStallMeter();
  try {
    await new Promise((r) => setTimeout(r, 60));
    meter.lap();
    await new Promise((r) => setTimeout(r, 30));
    const end = Date.now() + 400;
    while (Date.now() < end) { /* block the thread */ }
    await new Promise((r) => setTimeout(r, 60));
    const { lapMs, maxMs } = meter.lap();
    assert.ok(lapMs >= 300, `the 400 ms block shows (${lapMs} ms)`);
    assert.ok(maxMs >= lapMs);
  } finally {
    meter.stop();
  }
});
