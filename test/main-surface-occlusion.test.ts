import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSync } from 'esbuild';
import { electronRuntime } from './support/electron-runtime.ts';

test('native opaque surfaces preserve glass coverage across draw priorities and opacity transitions', { timeout: 60_000 }, t => {
  const runtime = electronRuntime();
  if (runtime.reason) return t.skip(runtime.reason);
  const out = mkdtempSync(join(tmpdir(), 'tt-surface-occlusion-'));
  try {
    buildSync({ entryPoints: [resolve('test/support/surface-occlusion-render.ts')], outfile: join(out, 'probe.js'), bundle: true, platform: 'browser', format: 'iife' });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = spawnSync(runtime.executable!, [resolve('test/support/surface-occlusion.cjs'), out], { env, encoding: 'utf8', timeout: 50_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));
    t.diagnostic(JSON.stringify(result));
    assert.equal(result.cases, 9);
    assert.equal(result.transitionChecks, 36);
    assert.equal(result.panelCases, 3);
    assert.deepEqual(result.failures, [], JSON.stringify(result));
    assert.ok(result.maxOrderError <= 1, JSON.stringify(result));
    assert.ok(result.minGlassEffect >= 10, 'the rear half visibly retains its glass cover');
    assert.equal(result.frontGlassEffect, 0, 'the front half occludes glass');
    assert.ok(result.maxTransitionError <= 1, 'warmed fade/return shaders match fresh materials');
    assert.ok(result.maxPanelScaleError <= 1, 'production sphere size/scale choices do not change glass coverage');
    assert.ok(result.minPanelGlassEffect >= 10, 'production spheres remain visibly behind glass');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
