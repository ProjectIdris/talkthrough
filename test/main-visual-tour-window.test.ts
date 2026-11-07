import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { electronRuntime } from './support/electron-runtime.ts';

const runtime = electronRuntime();
test('offline visual explorer: real renderer, isolated IPC, navigation and lifecycle', { skip: runtime.reason, timeout: 90000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'tt-tour-test-'));
  const profile = join(root, 'profile');
  mkdirSync(profile);
  try {
    for (const [entry, out, platform] of [
      ['test/support/visual-tour-window.ts', 'fixture.cjs', 'node'],
      ['src/main/preload.ts', 'preload.cjs', 'node'],
      ['src/main/settings-preload.ts', 'settings-preload.cjs', 'node'],
      ['src/firstrun/firstrun.ts', 'firstrun/firstrun.js', 'browser'],
      ['src/main/visual-tour-preload.ts', 'tour-preload.cjs', 'node'],
      ['src/overlay/overlay.ts', 'overlay/overlay.js', 'browser'],
      ['src/tour/tour.ts', 'tour/tour.js', 'browser'],
    ] as const) await build({ entryPoints: [entry], outfile: join(root, out), bundle: true, platform, format: platform === 'node' ? 'cjs' : 'iife', external: ['electron'], logLevel: 'silent' });
    for (const dir of ['overlay', 'tour', 'shared', 'firstrun']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync('src/overlay/index.html', join(root, 'overlay/index.html'));
    copyFileSync('src/firstrun/index.html', join(root, 'firstrun/index.html'));
    copyFileSync('src/tour/index.html', join(root, 'tour/index.html'));
    copyFileSync('src/shared/glass.css', join(root, 'shared/glass.css'));
    copyFileSync('test/support/electron-profile-guard.cjs', join(root, 'profile-guard.cjs'));
    const env: NodeJS.ProcessEnv = { ...process.env, TT_TEST_PROFILE: profile, TT_TOUR_SAMPLES: resolve('samples/scenes') };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = await new Promise<{ code: number | null; output: string }>((done, fail) => {
      const child = spawn(runtime.executable!, [join(root, 'fixture.cjs'), `--user-data-dir=${profile}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', data => { output += String(data); });
      child.stderr.on('data', data => { output += String(data); });
      const timer = setTimeout(() => { child.kill(); fail(new Error(`visual tour timed out\n${output}`)); }, 75000);
      child.once('error', error => { clearTimeout(timer); fail(error); });
      child.once('close', code => { clearTimeout(timer); done({ code, output }); });
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /TOUR_CHECKS_PASSED/);
    const receipt = JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8'));
    assert.equal(receipt.preReady, true);
    assert.equal(resolve(receipt.userData), resolve(profile));
    console.log(result.output);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
