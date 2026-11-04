import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { createFrontWindowReader } from '../src/main/front-window.ts';
import { createSkipCheck } from '../src/main/skip-list.ts';

const file = (name: string): string => resolve('test/support', name);
const settles = (p: Promise<unknown>, ms: number): Promise<'settled' | 'pending'> => Promise.race([p.then(() => 'settled' as const, () => 'settled' as const), new Promise<'pending'>((r) => setTimeout(() => r('pending'), ms))]);

test('the reader asks a worker thread for the window in front and gets its name, program file and title', async () => {
  const reader = createFrontWindowReader({ file: file('worker-fixed.mjs') });
  try {
    assert.deepEqual(await reader.read(), { title: 'Fixed window', appName: 'Fixture' });
    assert.deepEqual(await reader.read(), { title: 'Fixed window', appName: 'Fixture' });
  } finally {
    reader.dispose();
  }
});

test('the real reader (the one the app ships) loads in its thread and reads a window', async () => {
  const reader = createFrontWindowReader({ file: resolve('src/main/front-window-worker.ts') });
  try {
    const w = await Promise.race([reader.read(), new Promise<never>((_, no) => setTimeout(() => no(new Error('no answer in 20 s')), 20000))]);
    assert.ok(w === null || typeof w === 'object');
    if (w) assert.ok(typeof w.title === 'string' || typeof w.appName === 'string');
  } finally {
    reader.dispose();
  }
});

test('a read that hangs leaves the app free: the skip check gives up at its deadline and forbids the press, and the thread is the only thing stuck', async () => {
  const reader = createFrontWindowReader({ file: file('worker-hung.mjs') });
  try {
    const check = createSkipCheck(() => ['bank'], { read: () => reader.read(), deadlineMs: 80 });
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5); // the main thread keeps running while the read hangs
    const t0 = Date.now();
    const verdict = await check();
    clearInterval(timer);
    assert.equal(verdict?.kind, 'blind');
    assert.ok(Date.now() - t0 < 400);
    assert.ok(ticks >= 5, `the event loop was not blocked (ticks ${ticks})`);
    assert.equal(await settles(reader.read(), 40), 'pending', 'and the read itself stays pending, which is for the deadline to cut off');
  } finally {
    reader.dispose();
  }
});

test('a reader that will not load, or dies, makes every read fail, so the check forbids; it is started again later, not at once', async () => {
  for (const name of ['worker-fatal.mjs', 'worker-crash.mjs']) {
    let clock = 0;
    let launches = 0;
    const reader = createFrontWindowReader({ file: file(name), now: () => clock, start: (f) => (launches++, new Worker(f)) });
    try {
      await assert.rejects(Promise.race([reader.read(), new Promise((_, no) => setTimeout(() => no(new Error('still waiting')), 2000))]), /load|stopped|exit|still/, name);
      await new Promise((r) => setTimeout(r, 100));
      await assert.rejects(reader.read(), /./, `${name}: it is down`);
      assert.equal(launches, 1, `${name}: not started again at once`);
      clock += 6000;
      void reader.read().catch(() => undefined);
      assert.equal(launches, 2, `${name}: started again after the wait`);
      const check = createSkipCheck(() => ['bank'], { read: () => reader.read(), deadlineMs: 100 });
      assert.equal((await check())?.kind, 'blind');
    } finally {
      reader.dispose();
    }
  }
});
