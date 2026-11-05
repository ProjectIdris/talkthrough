import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CLICK_LEASE_MS, createClickGuard, createGuideArmGate, createKeyGate, createKeyHold, ignoreMouse, keyWanted } from '../src/main/interaction.ts';

test('guide targets rearm only after the current generation and snapshot are acknowledged', () => {
  const gate = createGuideArmGate();
  const old = gate.begin(); gate.disable(); const next = gate.begin();
  assert.equal(gate.ack(old, 2, 2, true), false);
  assert.equal(gate.ack(next, 1, 2, true), false, 'stale target snapshot cannot arm');
  assert.equal(gate.ack(next, 2, 2, false), false, 'missing target cannot arm');
  assert.equal(gate.ack(next, 2, 2, true), true);
  assert.equal(gate.ready, true); gate.disable(); assert.equal(gate.ready, false);
  assert.equal(gate.ack(next, 2, 2, true), false, 'late acknowledgment cannot rearm');
});

test('active explanation owns background clicks but a guide target reaches the page', () => {
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: false, control: false, held: false }), false);
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: false, held: false }), true);
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: true, held: false }), false);
  assert.equal(ignoreMouse(false, true, { active: true, guideTarget: true, control: false, held: false }), false);
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: false, held: true }), false, 'held release stays owned');
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: false, held: false, modelPossible: true }), false, 'unknown model hit is not leaked to the page');
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: false, held: false, modelPossible: true, modelHit: true }), false);
  assert.equal(ignoreMouse(false, false, { active: true, guideTarget: true, control: false, held: false, modelPossible: true, modelHit: false }), true, 'a verified hole can reach the target');
});

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

test('a check or development run registers no system-wide key at all, whatever the page says', () => {
  const calls: string[] = [];
  const hold = createKeyHold({ enabled: false, accelerator: 'E', register: () => { calls.push('register'); return true; }, unregister: () => { calls.push('unregister'); }, onKey: () => undefined });
  hold.want(true);
  hold.want(true);
  assert.deepEqual(calls, []);
  assert.equal(hold.held, false);
});

// ---- the real pointer: a synthetic one can never hold the key ---------------------------------------------

const REGION = { x: 100, y: 100, w: 300, h: 200 };

function gateRig(idleMs?: number) {
  const at = { cursor: { x: 0, y: 0 }, now: 0 };
  const gate = createKeyGate({ cursor: () => at.cursor, now: () => at.now, ...(idleMs ? { idleMs } : {}) });
  return { at, gate };
}

test('the key is ours only while the real cursor is inside the model\'s region and has moved or pressed there in the last ten seconds', () => {
  const { at, gate } = gateRig();
  assert.equal(gate.check(REGION), false, 'cursor outside');
  at.cursor = { x: 150, y: 150 };
  at.now = 1000;
  assert.equal(gate.check(REGION), true, 'moved into it');
  at.now = 6000;
  assert.equal(gate.check(REGION), true, 'resting there, within ten seconds');
  at.now = 11_500;
  assert.equal(gate.check(REGION), false, 'ten seconds without a movement gives it back');
  at.cursor = { x: 151, y: 150 };
  at.now = 12_000;
  assert.equal(gate.check(REGION), true, 'a real movement takes it again');
  at.cursor = { x: 900, y: 900 };
  assert.equal(gate.check(REGION), false, 'leaving the region gives it back at once');
  assert.equal(gate.check(undefined), false, 'no region, no key');
});

test('a page that keeps saying "over the model" while the cursor is elsewhere does not keep E', () => {
  // The overlay manager's wiring in miniature: the page's lease is renewed again and again (a driven page does that), the cursor stays elsewhere.
  const t = manualTimers();
  const { at, gate } = gateRig();
  const calls: string[] = [];
  const hold = createKeyHold({ accelerator: 'E', register: () => { calls.push('register'); return true; }, unregister: () => { calls.push('unregister'); }, onKey: () => undefined });
  const state = { engaged: false, penOn: false, alive: true };
  const guard = createClickGuard({ onExpire: () => { state.engaged = false; refresh(); }, setTimer: t.setTimer, clearTimer: t.clearTimer });
  const refresh = () => {
    if (state.engaged && !gate.check(REGION)) state.engaged = false;
    hold.want(keyWanted([{ ...state, held: guard.held }]));
  };
  at.cursor = { x: 1500, y: 900 }; // the person's real cursor, nowhere near the model
  for (let i = 0; i < 5; i++) {
    guard.grant(); // "the pointer is over the model", said again by a page driven with synthetic events
    state.engaged = gate.press(REGION); // and "pressed", which counts only with the real cursor inside
    refresh();
    assert.equal(hold.held, false, `renewal ${i}`);
  }
  assert.deepEqual(calls, []);
  // the same page with the real cursor on the model does get it
  at.cursor = { x: 200, y: 200 };
  guard.grant();
  state.engaged = gate.press(REGION);
  refresh();
  assert.equal(hold.held, true);
  // and loses it the moment the cursor goes
  at.cursor = { x: 1500, y: 900 };
  refresh();
  assert.equal(hold.held, false);
});

test('the only system-wide shortcut in the app is the E key, held through createKeyHold, and main turns it off for every check run', () => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|mjs|cjs|js)$/.test(entry.name) && /globalShortcut/.test(readFileSync(path, 'utf8'))) found.push(entry.name);
    }
  };
  for (const dir of ['../src', '../scripts']) walk(fileURLToPath(new URL(dir, import.meta.url)));
  assert.deepEqual(found, ['overlay-windows.ts']);
  assert.match(readFileSync(fileURLToPath(new URL('../src/main/main.ts', import.meta.url)), 'utf8'), /globalKeys: !isCheckRun\(options\)/);
});
