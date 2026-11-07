import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import type { SceneMessage } from '../src/shared/ipc.ts';

// The Electron window is the external boundary. Real runGrab parses the scene,
// sends each initial/layout request, and writes its optional metadata.
const bundle = await build({ entryPoints: [resolve('src/main/grab.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] });
const require = createRequire(import.meta.url);
for (const metadata of [false, true]) test(`still grabs request instant camera fitting with metadata ${metadata}`, async () => {
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-camera-contract-'));
  const input = join(out, 'scene.json');
  writeFileSync(input, JSON.stringify({ steps: [{ say: '', actions: [{ op: 'add', shape: 'box', id: 'body', size: [3, 2, 2] }] }] }));
  const ipcMain = new EventEmitter();
  const sent: Extract<SceneMessage, { kind: 'seek' }>[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  class BrowserWindow {
    webContents = {
      beginFrameSubscription() {}, endFrameSubscription() {}, isDestroyed: () => false,
      send: (channel: string, message: SceneMessage) => {
        if (channel !== 'tt:scene' || message.kind !== 'seek') return;
        sent.push(message);
        queueMicrotask(() => ipcMain.emit('tt:rendered', { sender: this.webContents }, message.token));
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('fake window pixels') }),
    };
    setContentSize() {}
    async loadFile() { queueMicrotask(() => ipcMain.emit('tt:ready', { sender: this.webContents })); }
    destroy() {}
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
  try {
    await module.exports.runGrab({ scenes: [input], steps: [{ step: 0, t: 5 }, { step: 0, t: 6 }], out, width: 640, height: 360, scaleFactor: 1, layoutSeeks: 2, metadata }, undefined, { preload: join(out, 'preload.cjs'), page: join(out, 'index.html') });
    assert.equal(sent.length, 6);
    assert.deepEqual(sent.map(message => message.t), [5, 5, 5, 6, 6, 6]);
    for (const message of sent) {
      assert.equal((message as SceneMessage & { cameraFit?: string }).cameraFit, 'instant', 'fixed frames opt in independently of telemetry');
      assert.equal(message.captureMetadata, metadata ? true : undefined);
    }
    if (metadata) {
      const receipt = JSON.parse(readFileSync(join(out, 'request0-step0-t5.json'), 'utf8'));
      assert.equal(receipt.request.cameraFit, 'instant');
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    rmSync(out, { recursive: true, force: true });
  }
});
