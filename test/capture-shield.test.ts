import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptureShield, SETTLE_MS } from '../src/main/capture-shield.ts';
import type { ShieldWindow } from '../src/main/capture-shield.ts';

// Our windows are out of our own screenshot only for the moment it is taken: raised before the read, lowered right after, one capture at a time.

const events: string[] = [];
class W implements ShieldWindow {
  protectedNow = false;
  destroyed = false;
  name: string;
  visible: boolean;
  constructor(name: string, visible = true) { this.name = name; this.visible = visible; }
  setContentProtection(on: boolean): void { this.protectedNow = on; events.push(`${this.name}:${on ? 'up' : 'down'}`); }
  isVisible(): boolean { return this.visible; }
  isDestroyed(): boolean { return this.destroyed; }
}
const gate = () => { let open!: () => void; const promise = new Promise<void>((resolve) => { open = resolve; }); return { promise, open }; };
const reset = () => { events.length = 0; };

test('windows are not protected until a capture of ours, are raised before it reads and lowered right after it', async () => {
  reset();
  const a = new W('a'), b = new W('b', false);
  const shield = createCaptureShield({ enabled: true, wait: async () => { events.push('wait'); } });
  shield.add(a); shield.add(b);
  assert.equal(events.length, 0, 'added windows are left as they are');
  assert.equal(shield.raised, false);
  const got = await shield.around(async (settled) => {
    assert.equal(a.protectedNow && b.protectedNow, true, 'every window, up or down, is out of the capture while it runs');
    assert.equal(shield.raised, true);
    await settled;
    events.push('read');
    return 42;
  });
  assert.equal(got, 42);
  assert.deepEqual(events, ['a:up', 'b:up', 'wait', 'read', 'a:down', 'b:down']);
  assert.equal(shield.raised, false);
});

test('the read waits for the change to reach the picture: the settle is handed to the work and is not done early', async () => {
  reset();
  const open = gate();
  let waitedMs = -1;
  const shield = createCaptureShield({ enabled: true, wait: (ms) => { waitedMs = ms; return open.promise; } });
  shield.add(new W('a'));
  let read = false;
  const run = shield.around(async (settled) => { await settled; read = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(waitedMs, SETTLE_MS, 'the built-in wait');
  assert.equal(read, false, 'not read while the wait is out');
  open.open();
  await run;
  assert.equal(read, true);
  const custom = createCaptureShield({ enabled: true, settleMs: 7, wait: async (ms) => { waitedMs = ms; } });
  custom.add(new W('a'));
  await custom.around(async (settled) => { await settled; });
  assert.equal(waitedMs, 7, 'the figure can be set (the check script finds the least safe one)');
});

test('nothing is waited for when no window of ours is up', async () => {
  reset();
  const shield = createCaptureShield({ enabled: true, wait: async () => { events.push('wait'); } });
  shield.add(new W('a', false));
  await shield.around(async (settled) => { await settled; });
  assert.deepEqual(events, ['a:up', 'a:down'], 'the flag is still set (a window shown during the capture is shown out of it), with no wait');
});

test('captures run one at a time, and the protection is kept up between them and lowered only after the last', async () => {
  reset();
  const a = new W('a');
  const shield = createCaptureShield({ enabled: true, wait: async () => { events.push('wait'); } });
  shield.add(a);
  const first = gate();
  const one = shield.around(async (settled) => { await settled; events.push('one reads'); await first.promise; events.push('one done'); });
  const two = shield.around(async (settled) => { await settled; events.push('two reads'); events.push(`two sees protection ${a.protectedNow}`); });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ['a:up', 'wait', 'one reads'], 'the second has not started');
  first.open();
  await Promise.all([one, two]);
  assert.deepEqual(events, ['a:up', 'wait', 'one reads', 'one done', 'two reads', 'two sees protection true', 'a:down'], 'raised once, never lowered under the other, lowered after the last');
  await shield.around(async () => undefined);
  assert.equal(events.filter((e) => e === 'a:up').length, 2, 'a later capture raises it again');
});

test('a capture queued behind one that fails early still waits for the change to reach the picture', async () => {
  reset();
  const open = gate();
  const shield = createCaptureShield({ enabled: true, wait: () => { events.push('wait'); return open.promise; } });
  shield.add(new W('a'));
  const first = gate();
  const one = shield.around(async () => { await first.promise; throw new Error('no source'); });
  let secondRead = false;
  const two = shield.around(async (settled) => { await settled; secondRead = true; events.push('two reads'); });
  first.open();
  await assert.rejects(one, /no source/);
  await new Promise((r) => setImmediate(r));
  assert.equal(secondRead, false, 'the second must not read inside the time the flag needs to take effect');
  open.open();
  await two;
  assert.deepEqual(events, ['a:up', 'wait', 'two reads', 'a:down']);
});

test('a capture that fails still lowers the windows, and the next one runs', async () => {
  reset();
  const a = new W('a');
  const shield = createCaptureShield({ enabled: true, wait: async () => undefined });
  shield.add(a);
  await assert.rejects(shield.around(async () => { throw new Error('the capture failed'); }), /the capture failed/);
  assert.equal(a.protectedNow, false);
  assert.equal(shield.raised, false);
  assert.equal(await shield.around(async () => 'next'), 'next');
});

test('a window added during a capture is raised with the rest, one that closed or was destroyed is left alone', async () => {
  reset();
  const a = new W('a'), late = new W('late', false), gone = new W('gone'), dead = new W('dead');
  const shield = createCaptureShield({ enabled: true, wait: async () => undefined });
  shield.add(a);
  const removeGone = shield.add(gone);
  shield.add(dead);
  dead.destroyed = true;
  removeGone();
  await shield.around(async () => {
    shield.add(late);
    assert.equal(late.protectedNow, true, 'made in the middle of a capture, it is out of it');
  });
  assert.equal(late.protectedNow, false, 'and back after');
  assert.deepEqual(events.filter((e) => e.startsWith('gone') || e.startsWith('dead')), [], 'closed and destroyed windows are never touched');
});

test('with --visible-to-capture the shield does nothing at all: no window is ever protected, and the work still runs', async () => {
  reset();
  const a = new W('a');
  const shield = createCaptureShield({ enabled: false });
  shield.add(a);
  const result = await shield.around(async (settled) => { await settled; return 'ran'; });
  assert.equal(result, 'ran');
  assert.equal(events.length, 0);
  assert.equal(shield.raised, false);
});
