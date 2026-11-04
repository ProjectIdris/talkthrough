import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error a plain script with no type declarations
import { ensureElectron } from '../scripts/ensure-electron.mjs';

/** A folder standing for node_modules/electron, removed when the test ends. */
function withPackage(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tt-electron-'));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What Electron's own installer leaves behind when it works. */
const install = (dir: string): void => {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'path.txt'), 'electron.exe');
};

test('a package with its program downloaded is left alone', () => {
  withPackage((dir) => {
    install(dir);
    let ran = 0;
    assert.equal(ensureElectron({ electronDir: dir, run: () => { ran++; return 0; } }), false);
    assert.equal(ran, 0);
  });
});

test('a package whose install step was skipped runs its installer once, and is then ready', () => {
  withPackage((dir) => {
    const scripts: string[] = [];
    assert.equal(ensureElectron({ electronDir: dir, run: (file: string) => { scripts.push(file); install(dir); return 0; } }), true);
    assert.deepEqual(scripts, [join(dir, 'install.js')]);
    assert.equal(ensureElectron({ electronDir: dir, run: () => { throw new Error('must not run again'); } }), false);
  });
});

test('a program folder without path.txt is an unfinished install (what npm 11 leaves after `npm ci`)', () => {
  withPackage((dir) => {
    mkdirSync(join(dir, 'dist'));
    let ran = 0;
    assert.equal(ensureElectron({ electronDir: dir, run: () => { ran++; install(dir); return 0; } }), true);
    assert.equal(ran, 1);
  });
});

test('an installer that fails, or that exits cleanly leaving nothing, is reported in plain words', () => {
  withPackage((dir) => {
    assert.throws(() => ensureElectron({ electronDir: dir, run: () => 1 }), /installer failed.*node_modules\/electron\/install\.js/);
    // ELECTRON_SKIP_BINARY_DOWNLOAD makes the installer succeed without downloading anything.
    assert.throws(() => ensureElectron({ electronDir: dir, run: () => 0 }), /ELECTRON_SKIP_BINARY_DOWNLOAD/);
  });
});
