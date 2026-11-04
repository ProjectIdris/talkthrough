import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error a plain script with no type declarations
import { ensureElectron } from '../scripts/ensure-electron.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'tt-electron-'));

test('a package with its program downloaded is left alone', () => {
  const dir = fresh();
  try {
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'path.txt'), 'electron.exe');
    let ran = 0;
    assert.equal(ensureElectron({ electronDir: dir, run: () => { ran++; return 0; } }), false);
    assert.equal(ran, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a package whose install step was skipped runs its installer, once, and says so', () => {
  const dir = fresh();
  try {
    const scripts: string[] = [];
    assert.equal(ensureElectron({ electronDir: dir, run: (file: string) => { scripts.push(file); return 0; } }), true);
    assert.deepEqual(scripts, [join(dir, 'install.js')]);
    // dist present but path.txt missing is also an unfinished install (this is what `npm ci` on npm 11 leaves).
    mkdirSync(join(dir, 'dist'));
    assert.equal(ensureElectron({ electronDir: dir, run: () => 0 }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
