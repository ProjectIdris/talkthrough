import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLICK_LEASE_MS, createClickGuard, ignoreMouse } from '../src/main/interaction.ts';

test('click-through unless the page wants clicks, and never click-through while the pen is on', () => {
  assert.equal(ignoreMouse(false, false), true);
  assert.equal(ignoreMouse(true, false), false);
  assert.equal(ignoreMouse(false, true), false); // the page says no, the pen says yes
  assert.equal(ignoreMouse(true, true), false);
  // the pen going off gives click-through back whatever the page last said
  assert.equal(ignoreMouse(false, false), true);
});

// ---- the click lease: a window the page made solid never stays solid by accident ----------------------

/** Timers the test runs by hand, so "eight seconds of silence" takes no time. */
function manualTimers() {
  let next = 1;
  const live = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void): unknown => { const id = next++; live.set(id, fn); return id; },
    clearTimer: (id: unknown): void => { live.delete(id as number); },
    fire: (): void => { const fns = [...live.values()]; live.clear(); for (const fn of fns) fn(); },
    count: (): number => live.size,
  };
}

test('a window the page made solid goes back to click-through when the page goes quiet', () => {
  const t = manualTimers();
  let expired = 0;
  const guard = createClickGuard({ onExpire: () => { expired++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  assert.equal(guard.held, false);
  guard.grant();
  assert.equal(guard.held, true);
  assert.equal(ignoreMouse(guard.held, false), false, 'solid while held');
  t.fire(); // the page never says anything again
  assert.equal(expired, 1);
  assert.equal(guard.held, false);
  assert.equal(ignoreMouse(guard.held, false), true, 'click-through again');
});

test('while the page keeps saying so the lease starts over, and only one timer ever runs', () => {
  const t = manualTimers();
  let expired = 0;
  const guard = createClickGuard({ onExpire: () => { expired++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  guard.grant();
  guard.grant();
  guard.grant();
  assert.equal(t.count(), 1);
  assert.equal(expired, 0);
});

test('letting go cancels the lease, so a stale timer never fires on a later grab', () => {
  const t = manualTimers();
  let expired = 0;
  const guard = createClickGuard({ onExpire: () => { expired++; }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  guard.grant();
  guard.release();
  assert.equal(guard.held, false);
  assert.equal(t.count(), 0);
  t.fire();
  assert.equal(expired, 0);
  guard.release(); // twice is harmless
});

test('the real timer lease expires too (short lease, real clock), and the default outlasts the page\'s heartbeat', async () => {
  let expired = 0;
  const guard = createClickGuard({ onExpire: () => { expired++; }, leaseMs: 20 });
  guard.grant();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(expired, 1);
  assert.equal(guard.held, false);
  assert.ok(CLICK_LEASE_MS > 3000, 'the page repeats itself every 3 s');
});
