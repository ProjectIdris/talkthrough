import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electronRuntime } from './support/electron-runtime.ts';

// Electron's profile switch must take effect before the application reaches readiness.
function grabChild(electron: string, out: string, args: string[], env: NodeJS.ProcessEnv) {
  const profile = join(out, 'electron-profile');
  const receipt = join(out, `profile-${Math.random().toString(36).slice(2)}.json`);
  const run = spawnSync(electron, [resolve('test/support/grab-profile.cjs'), `--user-data-dir=${profile}`, ...args], {
    env: { ...env, TT_GRAB_EXPECTED_PROFILE: profile, TT_GRAB_PROFILE_RECEIPT: receipt }, encoding: 'utf8', timeout: 90_000,
  });
  assert.ok(existsSync(receipt), `missing actual child profile receipt: ${run.stdout}${run.stderr}`);
  const observed = JSON.parse(readFileSync(receipt, 'utf8'));
  assert.equal(observed.preReady, true);
  for (const key of ['userData', 'sessionData', 'storage']) assert.equal(resolve(observed[key]).toLowerCase(), resolve(profile).toLowerCase(), key);
  return { ...run, workArea: observed.workArea as { width: number; height: number } };
}

test('grab profile mismatch fails before main or window using two scratch profiles', { timeout: 30_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const electron = runtime.executable!;
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-profile-negative-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TT_GRAB_EXPECTED_PROFILE: join(out, 'expected-b'), TT_GRAB_PROFILE_RECEIPT: join(out, 'receipt.json') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(electron, [resolve('test/support/grab-profile.cjs'), `--user-data-dir=${join(out, 'actual-a')}`, '--grab', 'samples/scenes/request-flow.json'], { env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.status, 23, run.stdout + run.stderr);
    assert.match(run.stderr, /profile mismatch before ready/);
    assert.equal(existsSync(env.TT_GRAB_PROFILE_RECEIPT!), false);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// Runs the real Electron main process offscreen with the stand-in overlay page: checks that a scene
// goes through the validator, the preload contract and the seek/rendered handshake into PNG files.
test('a grab draws a scene offscreen and writes a different frame per moment', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const electron = runtime.executable!;
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out, TALKTHROUGH_OVERLAY_PAGE: resolve('test/support/stub-overlay/index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = grabChild(electron, out, ['--grab', 'samples/scenes/request-flow.json', '--steps', '0:0,1:1', '--out', out, '--size', '640x360', '--scale', '2'], env);
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

test('a grab keeps its requested width when it exceeds the display work area', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-wide-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out, TALKTHROUGH_OVERLAY_PAGE: resolve('test/support/stub-overlay/index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = ['--grab', 'samples/scenes/request-flow.json', '--steps', '0:0', '--out', out, '--scale', '2'];
    const probe = grabChild(runtime.executable!, out, [...args, '--size', '100x100'], env);
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.ok(Number.isInteger(probe.workArea.width) && probe.workArea.width > 0);
    // Use the real scaled display size so even a large developer monitor exercises the clamp.
    const width = probe.workArea.width + 64;
    const run = grabChild(runtime.executable!, out, [...args, '--size', `${width}x360`], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const png = readFileSync(join(out, 'step0-t0.png'));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width * 2, 720]);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('layout attempts retain duplicate requests and accept a legacy token-only renderer', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const electron = runtime.executable!;
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-attempt-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out, TALKTHROUGH_OVERLAY_PAGE: resolve('test/support/stub-overlay/index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = grabChild(electron, out, ['--grab', 'samples/scenes/request-flow.json,samples/scenes/diagram-flow.json', '--steps', '6:0,6:0', '--out', out, '--size', '640x360', '--layout-seeks', '2', '--grab-metadata'], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    for (const i of [0, 1]) {
      const stem = `request${i}-step6-t0`;
      assert.ok(existsSync(join(out, `${stem}-initial.png`)));
      assert.ok(existsSync(join(out, `${stem}-layout-attempt-2.png`)));
      const metadata = JSON.parse(readFileSync(join(out, `${stem}.json`), 'utf8'));
      assert.equal(metadata.request.step, 6); assert.equal(metadata.request.t, 0); assert.equal(metadata.inputs.length, 2);
      assert.equal(metadata.layoutSeeks, 2); assert.equal(metadata.initial.seekCount, i * 3 + 1); assert.equal(metadata.attempt.seekCount, i * 3 + 3);
      assert.equal(metadata.initial.renderer, null); assert.equal(metadata.attempt.renderer, null);
      assert.match(metadata.inputs[0].sha256, /^[a-f0-9]{64}$/);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('real hidden renderer acknowledges the observed seek clock and view', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const electron = runtime.executable!;
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-real-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out };
    delete env.ELECTRON_RUN_AS_NODE; delete env.TALKTHROUGH_OVERLAY_PAGE;
    const run = grabChild(electron, out, ['--grab', 'samples/scenes/wind-turbine.json', '--steps', '0:4:0:10', '--out', out, '--size', '640x360', '--software', '--layout-seeks', '1', '--grab-metadata'], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const stem = 'request0-step0-t4-az0-el10';
    assert.ok(existsSync(join(out, `${stem}-layout-attempt-1.png`)));
    const m = JSON.parse(readFileSync(join(out, `${stem}.json`), 'utf8'));
    assert.equal(m.initial.renderer.camera.az, 0); assert.equal(m.initial.renderer.camera.el, 10);
    assert.equal(m.initial.renderer.worldCamera.position.length, 3); assert.equal(m.initial.renderer.worldCamera.quaternion.length, 4);
    assert.ok([...m.initial.renderer.worldCamera.position, ...m.initial.renderer.worldCamera.quaternion].every(Number.isFinite));
    assert.deepEqual(m.attempt.renderer.camera, m.initial.renderer.camera);
    assert.ok(Math.abs(m.initial.renderer.seekClock - 1000 / 30) < 1e-6);
    assert.ok(Math.abs(m.attempt.renderer.seekClock - 2000 / 30) < 1e-6);
    assert.equal(m.layoutSeeks, 1); assert.ok(!('settled' in m));
    const noStage = grabChild(electron, out, ['--grab', 'samples/scenes/request-flow.json', '--steps', '0:0', '--out', out, '--size', '640x360', '--software', '--grab-metadata'], env);
    assert.equal(noStage.status, 0, noStage.stdout + noStage.stderr);
    const plain = JSON.parse(readFileSync(join(out, 'request0-step0-t0.json'), 'utf8'));
    assert.equal(plain.initial.renderer.camera, null, 'no rendered 3D stage is not a camera measurement'); assert.equal(plain.initial.renderer.worldCamera, null);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('unknown token and malformed metadata cannot replace the capture acknowledgement', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const electron = runtime.executable!;
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-invalid-'));
  try {
    const html = readFileSync(resolve('test/support/stub-overlay/index.html'), 'utf8');
    const stub = readFileSync(resolve('test/support/stub-overlay/stub.js'), 'utf8');
    const changed = stub.replace('window.talkthrough.rendered(m.token)', 'window.talkthrough.rendered(m.token+1,{seekClock:1,camera:null}),window.talkthrough.rendered(m.token,{seekClock:1e100,camera:null})');
    assert.notEqual(changed, stub);
    writeFileSync(join(out, 'index.html'), html); writeFileSync(join(out, 'stub.js'), changed);
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out, TALKTHROUGH_OVERLAY_PAGE: join(out, 'index.html') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = grabChild(electron, out, ['--grab', 'samples/scenes/request-flow.json', '--steps', '0:0', '--out', out, '--size', '640x360', '--grab-metadata'], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const metadata = JSON.parse(readFileSync(join(out, 'request0-step0-t0.json'), 'utf8'));
    assert.equal(metadata.initial.renderer, null);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
