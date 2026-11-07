import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('runner preserves previous evidence and refuses unsupported tier or flags before launching', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tt-visual-cli-'));
  try {
    writeFileSync(join(parent, 'report.json'), 'previous evidence');
    const run = (args: string[]) => spawnSync(process.execPath, [resolve('scripts/prototypes/check-visual-quality.ts'), ...args], { encoding: 'utf8', timeout: 10_000 });
    const existing = run(['--out', parent]);
    assert.equal(existing.status, 1);
    assert.match(existing.stderr, /already exists/);
    assert.equal(readFileSync(join(parent, 'report.json'), 'utf8'), 'previous evidence');
    for (const args of [['--out', join(parent, 'new'), '--tier', 'ultra'], ['--out', join(parent, 'new'), '--no-sandbox']]) {
      assert.equal(run(args).status, 1);
      assert.equal(existsSync(join(parent, 'new')), false);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
