import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electronRuntime } from './support/electron-runtime.ts';

test('real overlay keeps follow-up controls clear, focusable and correctly hit-tested across sizes', { timeout: 90_000 }, t => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const profile = mkdtempSync(join(tmpdir(), 'tt-followup-layout-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TT_TEST_PROFILE: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(runtime.executable!, [resolve('test/support/overlay-followup-page.cjs'), `--user-data-dir=${profile}`], { env, encoding: 'utf8', timeout: 75_000 });
    assert.equal(run.error, undefined, `${run.error?.message ?? ''}\n${run.stdout}${run.stderr}`);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /FOLLOWUP_LAYOUT_OK/);
  } finally { rmSync(profile, { recursive: true, force: true }); }
});
