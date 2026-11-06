import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { electronRuntime } from './support/electron-runtime.ts';

function packageFixture(t: { after(fn: () => void): void }, path?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'tt-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (path !== undefined) {
    writeFileSync(join(dir, 'path.txt'), path);
    if (path && !path.includes('..')) {
      mkdirSync(dirname(join(dir, 'dist', path)), { recursive: true });
      writeFileSync(join(dir, 'dist', path), 'fixture');
    }
  }
  return dir;
}

test('a missing Electron binary is reported without running a package installer', (t) => {
  const electronDir = packageFixture(t);
  writeFileSync(join(electronDir, 'index.js'), 'throw new Error("must not be loaded")');
  assert.match(electronRuntime({ electronDir, platform: 'win32', env: {} }).reason ?? '', /not installed/);
});

test('installed Electron paths work for Windows, Linux and macOS layouts', (t) => {
  for (const [platform, path] of [['win32', 'electron.exe'], ['linux', 'electron'], ['darwin', 'Electron.app/Contents/MacOS/Electron']]) {
    const electronDir = packageFixture(t, path);
    assert.deepEqual(electronRuntime({ electronDir, platform, env: { DISPLAY: ':99' } }), { executable: join(electronDir, 'dist', path!) });
  }
});

test('Linux requires a display, even for offscreen Electron windows', (t) => {
  const electronDir = packageFixture(t, 'electron');
  assert.match(electronRuntime({ electronDir, platform: 'linux', env: {} }).reason ?? '', /display/i);
  assert.equal(electronRuntime({ electronDir, platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }).executable, join(electronDir, 'dist', 'electron'));
});

test('empty, escaping, absolute and missing executable paths are not usable installations', (t) => {
  for (const path of ['', '../outside', '/outside', 'C:\\outside.exe', '..\\outside.exe', 'missing']) {
    const electronDir = packageFixture(t);
    writeFileSync(join(electronDir, 'path.txt'), path);
    assert.equal(electronRuntime({ electronDir, platform: 'win32', env: {} }).executable, undefined, path);
  }
  const electronDir = packageFixture(t);
  writeFileSync(join(electronDir, 'path.txt'), 'directory');
  mkdirSync(join(electronDir, 'dist', 'directory'), { recursive: true });
  assert.equal(electronRuntime({ electronDir, platform: 'win32', env: {} }).executable, undefined);
});
