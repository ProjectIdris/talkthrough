import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';

// Exercise runGrab's ownership around the native compositor boundary. The real
// Electron test separately verifies pixels and the renderer acknowledgement.
const bundle = await build({ entryPoints: [resolve('src/main/grab.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] });
const require = createRequire(import.meta.url);

function fixture(fail: 'none' | 'capture' | 'subscribe' = 'none') {
  const directory = mkdtempSync(join(tmpdir(), 'tt-grab-session-'));
  const input = join(directory, 'scene.json');
  writeFileSync(input, JSON.stringify({ v: 1, steps: [{ say: '', actions: [{ op: 'add', shape: 'box', id: 'body', size: [1, 1, 1] }] }] }));
  const ipcMain = new EventEmitter();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const observed = { active: false, subscriptions: 0, releases: 0, destroyed: false, seeks: 0, captures: 0 };
  class BrowserWindow {
    webContents = {
      beginFrameSubscription: (onlyDirty: boolean, _callback: unknown) => {
        assert.equal(onlyDirty, true);
        if (fail === 'subscribe') throw new Error('subscription refused');
        assert.equal(observed.active, false);
        observed.active = true; observed.subscriptions++;
      },
      endFrameSubscription: () => {
        assert.equal(observed.destroyed, false, 'release happens before window destruction');
        assert.equal(observed.active, true);
        observed.active = false; observed.releases++;
      },
      isDestroyed: () => observed.destroyed,
      send: (channel: string, message: { kind?: string; token?: number }) => {
        if (channel !== 'tt:scene' || message.kind !== 'seek') return;
        observed.seeks++;
        queueMicrotask(() => ipcMain.emit('tt:rendered', { sender: this.webContents }, message.token, { seekClock: observed.seeks * 1000 / 30, camera: null }));
      },
      capturePage: async () => {
        assert.equal(observed.active, true, 'hidden capture has an active compositor consumer throughout the session');
        if (fail === 'capture') throw new Error('capture failed');
        observed.captures++;
        return { toPNG: () => Buffer.from(`captured frame ${observed.seeks}`) };
      },
    };
    setContentSize() {}
    async loadFile() { queueMicrotask(() => ipcMain.emit('tt:ready', { sender: this.webContents })); }
    destroy() { assert.equal(observed.active, false, 'release before destroying window'); observed.destroyed = true; }
  }
  const module = { exports: {} as typeof import('../src/main/grab.ts') };
  vm.runInNewContext(bundle.outputFiles[0]!.text, {
    module, exports: module.exports, Buffer, console, queueMicrotask,
    require: (name: string) => name === 'electron' ? { BrowserWindow, ipcMain } : require(name),
    setTimeout: (callback: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); clearTimeout(timer); },
  });
  return {
    observed, ipcMain, directory,
    run: () => module.exports.runGrab({ scenes: [input], steps: [{ step: 0, t: 0 }, { step: 0, t: 1 }], out: directory, width: 640, height: 360, scaleFactor: 1, layoutSeeks: 2, metadata: true }, undefined, { preload: join(directory, 'preload.cjs'), page: join(directory, 'index.html') }),
    cleanup: () => { for (const timer of timers) clearTimeout(timer); rmSync(directory, { recursive: true, force: true }); },
  };
}

test('grab owns one compositor subscription across all seeks and captures, then releases it', async () => {
  const f = fixture();
  try {
    const written = await f.run();
    assert.equal(written.length, 4); assert.equal(f.observed.seeks, 6); assert.equal(f.observed.captures, 4);
    assert.equal(readFileSync(written[0]!, 'utf8'), 'captured frame 1');
    assert.equal(readFileSync(written[3]!, 'utf8'), 'captured frame 6');
    assert.deepEqual([f.observed.subscriptions, f.observed.releases, f.observed.active, f.observed.destroyed], [1, 1, false, true]);
    assert.equal(f.ipcMain.listenerCount('tt:rendered'), 0); assert.equal(f.ipcMain.listenerCount('tt:ready'), 0);
  } finally { f.cleanup(); }
});

test('a failed capture releases its compositor subscription and renderer listeners', async () => {
  const f = fixture('capture');
  try {
    await assert.rejects(f.run(), /capture failed/);
    assert.deepEqual([f.observed.subscriptions, f.observed.releases, f.observed.active, f.observed.destroyed], [1, 1, false, true]);
    assert.equal(f.ipcMain.listenerCount('tt:rendered'), 0); assert.equal(f.ipcMain.listenerCount('tt:ready'), 0);
  } finally { f.cleanup(); }
});

test('a refused compositor subscription destroys the hidden window without capturing', async () => {
  const f = fixture('subscribe');
  try {
    await assert.rejects(f.run(), /subscription refused/);
    assert.deepEqual([f.observed.subscriptions, f.observed.releases, f.observed.captures, f.observed.active, f.observed.destroyed], [0, 0, 0, false, true]);
    assert.equal(f.ipcMain.listenerCount('tt:rendered'), 0); assert.equal(f.ipcMain.listenerCount('tt:ready'), 0);
  } finally { f.cleanup(); }
});
