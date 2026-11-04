import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLICK_LEASE_MS, createClickGuard, createKeyHold, ignoreMouse, keyWanted } from '../src/main/interaction.ts';

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

// ---- the E key is ours only while the person is on a model they pressed -------------------------------

const on = { engaged: true, held: true, penOn: false, alive: true };

test('E is wanted only when the model was pressed, the click lease is held, the pen is off and the window is alive', () => {
  assert.equal(keyWanted([on]), true);
  for (const off of [{ engaged: false }, { held: false }, { penOn: true }, { alive: false }]) assert.equal(keyWanted([{ ...on, ...off }]), false, JSON.stringify(off));
  assert.equal(keyWanted([]), false);
  assert.equal(keyWanted([{ ...on, engaged: false }, on]), true, 'any one display is enough');
});

function keyRig() {
  const calls: string[] = [];
  let owned = true; // another program may own the key
  const hold = createKeyHold({
    accelerator: 'E',
    register: (a) => { calls.push(`register ${a}`); return owned; },
    unregister: (a) => { calls.push(`unregister ${a}`); },
    onKey: () => undefined,
  });
  return { hold, calls, other: (v: boolean) => { owned = v; } };
}

test('the key is taken once when wanted and given back the moment it is not', () => {
  const { hold, calls } = keyRig();
  hold.want(true);
  hold.want(true);
  assert.deepEqual(calls, ['register E']);
  assert.equal(hold.held, true);
  hold.want(false);
  hold.want(false);
  assert.deepEqual(calls, ['register E', 'unregister E']);
  assert.equal(hold.held, false);
});

test('a key another program owns is not held, and is tried again the next time it is wanted', () => {
  const { hold, calls, other } = keyRig();
  other(false);
  hold.want(true);
  assert.equal(hold.held, false);
  other(true);
  hold.want(true);
  assert.equal(hold.held, true);
  assert.equal(calls.filter((c) => c === 'register E').length, 2);
});

test('an unregister that throws still leaves the key not held by us', () => {
  const hold = createKeyHold({ accelerator: 'E', register: () => true, unregister: () => { throw new Error('gone'); }, onKey: () => undefined });
  hold.want(true);
  assert.throws(() => hold.want(false));
  assert.equal(hold.held, false);
});

test('however the press ends, the key does not outlive it: leaving, the lease running out, the pen, the window going', () => {
  // The overlay manager's own wiring in miniature: a click guard, the pen flag, and the key hold fed by keyWanted.
  const t = manualTimers();
  const calls: string[] = [];
  const hold = createKeyHold({ accelerator: 'E', register: () => { calls.push('register'); return true; }, unregister: () => { calls.push('unregister'); }, onKey: () => undefined });
  const state = { engaged: false, penOn: false, alive: true };
  const guard = createClickGuard({ onExpire: () => { state.engaged = false; refresh(); }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  const refresh = () => hold.want(keyWanted([{ ...state, held: guard.held }]));
  const press = () => { guard.grant(); state.engaged = true; refresh(); };
  const ends: Array<[string, () => void]> = [
    ['the pointer leaves the model', () => { guard.release(); state.engaged = false; refresh(); }],
    ['the lease runs out', () => t.fire()],
    ['the pen goes on', () => { state.penOn = true; state.engaged = false; refresh(); state.penOn = false; }],
    ['the window is closed', () => { guard.release(); state.engaged = false; state.alive = false; refresh(); state.alive = true; }],
    ['the lease is released with the press still marked', () => { guard.release(); refresh(); }],
  ];
  for (const [name, end] of ends) {
    press();
    assert.equal(hold.held, true, `held after a press (${name})`);
    end();
    assert.equal(hold.held, false, `given back when ${name}`);
  }
  assert.deepEqual(calls.filter((c) => c === 'register').length, calls.filter((c) => c === 'unregister').length, 'every take was given back');
});
