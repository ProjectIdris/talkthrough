// Execute the real probe bundle; only the Electron/process boundary is simulated so
// delayed IPC/paint delivery is deterministic on every platform. Native pixel checks
// remain in first-visual-native.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { CHANNEL } from '../src/shared/ipc.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import { partCards } from '../scripts/prototypes/catalogue-parts.ts';

const bundled = await build({ entryPoints: [resolve('scripts/prototypes/first-visual-electron.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'] });
const require = createRequire(import.meta.url);

async function runProbe(options: { startupPaint?: boolean; contaminatedControl?: boolean; missingControlDone?: boolean; missingPaint?: boolean; missingRepaint?: boolean } = {}) {
  let now = 0, nextTimer = 0, exitCode: number | undefined;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const schedule = (callback: () => void, ms = 0) => { const id = ++nextTimer; timers.set(id, { at: now + ms, callback }); return id; };
  const errors: string[] = [], files = new Map<string, string | Buffer>();
  const ipcMain = new EventEmitter();
  let firstFixtureSentAt: number | undefined;
  let controlDoneAt: number | undefined;
  const blank = Buffer.alloc(640 * 480 * 4);
  const marked = Buffer.from(blank);
  // Twelve hand-placed bright magenta pixels inside the fixture region.
  for (let x = 200; x < 212; x++) marked.set([255, 0, 255, 255], (200 * 640 + x) * 4);
  const image = (marker = false) => ({ getSize: () => ({ width: 640, height: 480 }), toBitmap: () => marker ? marked : blank, toPNG: () => Buffer.from('fixture PNG') });
  class Contents extends EventEmitter {
    setAudioMuted() {} setWindowOpenHandler() {} setFrameRate() {}
    invalidate() { if (!options.missingPaint && !options.missingRepaint) schedule(() => this.emit('paint', {}, {}, image()), 1); }
    send(channel: string, message: SceneMessage) {
      if (channel !== CHANNEL.scene) return;
      if (message.kind === 'end' && firstFixtureSentAt === undefined) {
        // IPC-ready does not mean the renderer or compositor has serviced the control.
        if (options.startupPaint && !options.missingPaint) schedule(() => this.emit('paint', {}, {}, image()), 10);
        if (!options.missingPaint) schedule(() => this.emit('paint', {}, {}, image(options.contaminatedControl)), 500);
        schedule(() => ipcMain.emit(CHANNEL.done, { sender: {} }), 5); // another window cannot acknowledge this control
        if (!options.missingControlDone) schedule(() => { controlDoneAt = now; ipcMain.emit(CHANNEL.done, { sender: this }); }, 600);
      }
      if (message.kind === 'action') {
        firstFixtureSentAt = now;
        if (!options.missingPaint) schedule(() => this.emit('paint', {}, {}, image(true)), 20);
      }
      if (message.kind === 'seek') schedule(() => ipcMain.emit(CHANNEL.rendered, { sender: this }, message.token), 1);
    }
  }
  class Window {
    webContents = new Contents();
    async loadFile() { ipcMain.emit(CHANNEL.ready, { sender: this.webContents }); }
    destroy() {}
  }
  const app = { disableHardwareAcceleration() {}, commandLine: { appendSwitch() {} }, on() {}, whenReady: async () => {}, exit: (code: number) => { exitCode = code; } };
  const isolated = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } };
  const customRequire = (name: string) => {
    if (name === 'electron') return { app, BrowserWindow: Window, ipcMain, session: { fromPartition: () => isolated } };
    if (name === 'node:perf_hooks') return { performance: { now: () => now } };
    if (name === 'node:fs') return { readFileSync: () => Buffer.from(JSON.stringify(partCards)), writeFileSync: (path: string, data: string | Buffer) => files.set(path, data) };
    if (name.endsWith('electron-profile-guard.cjs')) return () => {};
    return require(name);
  };
  vm.runInNewContext(bundled.outputFiles[0]!.text, {
    require: customRequire, Buffer, structuredClone, console: { error: (...args: unknown[]) => errors.push(args.map(String).join(' ')) },
    process: { env: { TT_PROBE_ROOT: resolve('.'), TT_PROBE_WORK: resolve('probe-test-work'), TT_TEST_PROFILE: 'temporary-test-profile' }, versions: { electron: 'test', chrome: 'test' }, version: process.version, platform: 'test', arch: 'test', on() {} },
    setTimeout: schedule, clearTimeout: (id: number) => timers.delete(id),
  });
  for (let turns = 0; exitCode === undefined && turns < 200; turns++) {
    // Drain async continuations before choosing the next simulated external event.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    if (exitCode !== undefined) break;
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(next, 'probe must finish or have a bounded pending operation');
    timers.delete(next[0]); now = next[1].at; next[1].callback();
  }
  const output = files.get(resolve('probe-test-work/result.json'));
  return { exitCode, errors: errors.join('\n'), firstFixtureSentAt, controlDoneAt, report: output ? JSON.parse(String(output)) : undefined };
}

test('a delayed control paint is awaited instead of failing after 250 ms', async () => {
  const result = await runProbe();
  assert.equal(result.exitCode, 0, result.errors);
  assert.ok(result.controlDoneAt !== undefined);
  assert.ok(result.firstFixtureSentAt! >= result.controlDoneAt!);
  assert.ok(result.report.renderer.negativeControlPaints > 0);
  assert.equal(result.report.renderer.negativeControlMaxMarkerPixels, 0);
});

test('a startup blank paint cannot finish the control before narration completes', async () => {
  const result = await runProbe({ startupPaint: true });
  assert.equal(result.exitCode, 0, result.errors);
  assert.ok(result.controlDoneAt !== undefined, 'control completion must be observed before the fixture starts');
  assert.ok(result.firstFixtureSentAt! >= result.controlDoneAt!);
});

test('marker contamination after a startup blank paint still fails the negative control', async () => {
  const result = await runProbe({ startupPaint: true, contaminatedControl: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /negative control/);
  assert.equal(result.firstFixtureSentAt, undefined);
});

test('a missing control completion fails explicitly without starting the measured fixture', async () => {
  const result = await runProbe({ startupPaint: true, missingControlDone: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /control.*(complet|timed out)/);
  assert.equal(result.firstFixtureSentAt, undefined);
});

test('a completed control without compositor paints still fails explicitly', async () => {
  const result = await runProbe({ missingPaint: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /paint/);
  assert.equal(result.firstFixtureSentAt, undefined);
});


test('prior control paints cannot replace a fresh receipt after completion', async () => {
  const result = await runProbe({ startupPaint: true, missingRepaint: true });
  assert.equal(result.exitCode, 1);
  assert.match(result.errors, /negative control paint/);
  assert.equal(result.firstFixtureSentAt, undefined);
});
