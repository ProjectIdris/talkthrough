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
    const run = grabChild(electron, out, ['--grab', 'samples/scenes/request-flow.json', '--steps', '0:0,1:1', '--out', out, '--size', '480x270', '--scale', '2', '--grab-metadata'], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    // At scale 2 the expected 960x540 PNG remains within the 1024x720 capture observed on hosted Windows.
    const stems = ['request0-step0-t0', 'request1-step1-t1'];
    const hashes = stems.map((stem) => {
      const metadata = JSON.parse(readFileSync(join(out, `${stem}.json`), 'utf8'));
      assert.deepEqual([metadata.width, metadata.height, metadata.scaleFactor], [480, 270, 2]);
      const f = join(out, `${stem}.png`);
      const bytes = readFileSync(f);
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      assert.deepEqual([width, height], [metadata.width * metadata.scaleFactor, metadata.height * metadata.scaleFactor]);
      assert.equal(width * 9, height * 16, 'the PNG keeps the requested 16:9 aspect ratio');
      assert.ok(width <= 1024 && height <= 720, 'the PNG remains within the hosted capture bounds');
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

test('sequential fixed-time grabs fit large scale changes and returns on the first seek', { timeout: 120_000 }, (t) => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const out = mkdtempSync(join(tmpdir(), 'tt-grab-camera-'));
  try {
    const input = join(out, 'scale-return.json');
    writeFileSync(input, JSON.stringify({ steps: [
      { say: '', actions: [
        { op: 'panel', x: 100, y: 100, w: 800, h: 800 },
        { op: 'add', shape: 'group', id: 'model' },
        { op: 'add', shape: 'box', id: 'body', parent: 'model', size: [3, 2, 2] },
      ] },
      { say: '', actions: [{ op: 'scale', id: 'model', to: [30, 30, 30], dur: 0 }] },
      { say: '', actions: [{ op: 'orbit', az: 65, el: 18, dur: 0 }] },
      { say: '', actions: [{ op: 'scale', id: 'model', to: [1, 1, 1], dur: 0 }] },
    ] }));
    const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: out, LOCALAPPDATA: out };
    delete env.ELECTRON_RUN_AS_NODE; delete env.TALKTHROUGH_OVERLAY_PAGE;
    const run = grabChild(runtime.executable!, out, ['--grab', input, '--steps', '0:5:15:12,1:5:15:12,2:5:65:18,3:5:15:12', '--out', out, '--size', '640x360', '--layout-seeks', '15', '--grab-metadata'], env);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const records = [0, 1, 2, 3].map(i => JSON.parse(readFileSync(join(out, `request${i}-step${i}-t5-az${i === 2 ? 65 : 15}-el${i === 2 ? 18 : 12}.json`), 'utf8')));
    const positions = records.map((record, i) => {
      const initial = record.initial.renderer, attempt = record.attempt.renderer;
      assert.ok(initial?.worldCamera && attempt?.worldCamera, `request ${i} has a real rendered camera`);
      assert.ok(initial.worldCamera.position.every(Number.isFinite));
      const az = i === 2 ? 65 : 15, el = i === 2 ? 18 : 12;
      assert.deepEqual(initial.camera, { az, el, zoom: 1 });
      assert.deepEqual(attempt.camera, initial.camera);
      const a = az * Math.PI / 360, e = el * Math.PI / 360;
      const orientation = [-Math.sin(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e) * Math.sin(a), Math.cos(e) * Math.cos(a)];
      const radius = Math.hypot(...initial.worldCamera.position);
      assert.ok(radius > 1, 'the real camera has a nonzero fitting distance');
      const direction = [Math.sin(2 * a) * Math.cos(2 * e), Math.sin(2 * e), Math.cos(2 * a) * Math.cos(2 * e)];
      for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(initial.worldCamera.position[axis] / radius - direction[axis]!) < 1e-6, 'world position follows the requested view');
      for (let axis = 0; axis < 4; axis++) assert.ok(Math.abs(initial.worldCamera.quaternion[axis] - orientation[axis]!) < 1e-6, 'world orientation follows the requested view');
      assert.ok(Math.abs(initial.seekClock - (i * 16 + 1) * 1000 / 30) < 1e-6, 'layout clock still advances per seek');
      const drift = Math.hypot(...initial.worldCamera.position.map((x: number, axis: number) => x - attempt.worldCamera.position[axis]));
      assert.ok(drift < 1e-6, `request ${i}: fixed camera must not drift through layout attempts (${drift})`);
      const png = readFileSync(join(out, `request${i}-step${i}-t5-az${i === 2 ? 65 : 15}-el${i === 2 ? 18 : 12}-initial.png`));
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [640, 360]);
      return initial.worldCamera.position as number[];
    });
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(positions[1]![axis]! - positions[0]![axis]! * 30) < 1e-5, 'uniform scale changes camera distance proportionally on its first seek');
      assert.ok(Math.abs(positions[3]![axis]! - positions[0]![axis]!) < 1e-6, 'return has the original framing without a renderer reset');
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
