import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the real Electron main process offscreen with the stand-in overlay page: checks that a scene
// goes through the validator, the preload contract and the seek/rendered handshake into PNG files.
test('a grab draws a scene offscreen and writes a different frame per moment', { timeout: 120_000 }, (t) => {
  const electron = createRequire(import.meta.url)('electron') as string;
  if (!existsSync(electron)) return t.skip('electron binary is not installed');
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TALKTHROUGH_OVERLAY_PAGE: resolve('test/support/stub-overlay/index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(electron, ['.', '--grab', 'samples/scenes/request-flow.json', '--steps', '0:0,1:1', '--out', out, '--size', '640x360', '--scale', '2'], { env, encoding: 'utf8', timeout: 90_000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const files = ['step0-t0.png', 'step1-t1.png'].map((f) => join(out, f));
    const hashes = files.map((f) => {
      const bytes = readFileSync(f);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      // The window is 640x360 at a device scale of 2, so the picture is at physical size.
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
      return createHash('sha1').update(bytes).digest('hex');
    });
    assert.notEqual(hashes[0], hashes[1]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
