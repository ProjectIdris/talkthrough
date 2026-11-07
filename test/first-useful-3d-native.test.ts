import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electronRuntime } from './support/electron-runtime.ts';

const runtime = electronRuntime({ env: { ...process.env, DISPLAY: process.env.DISPLAY ?? 'headless-probe' } });
test('native 3D timing supplies pixel evidence or an explicit non-pass, never invented model latency', { skip: runtime.reason, timeout: 40_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'tt-useful-3d-result-'));
  try {
    let stdout: string;
    let code = 0;
    try {
      ({ stdout } = await promisify(execFile)(process.execPath, [resolve('scripts/prototypes/benchmark-first-visual.ts'), '--fixture', '3d', '--out', out], { timeout: 35_000, maxBuffer: 100_000 }));
    } catch (error) {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 2, String(error));
      code = result.code;
      stdout = result.stdout;
    }
    const report = JSON.parse(stdout);
    assert.equal(report.mode, 'offline-hand-written-3d-fixture');
    assert.equal(report.model.called, false);
    assert.equal(report.model.firstTokenMs, null);
    assert.equal(report.model.firstOutputMs, null);
    assert.equal(report.target.met, null);
    assert.equal(report.usefulness.accepted, null);
    assert.equal(report.usefulness.firstUsefulOutputMs, null);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')), report);
    if (report.status === 'unavailable') {
      assert.equal(code, 2);
      assert.equal(report.renderer.webgl2, false);
      assert.equal(report.pipeline, null);
      assert.equal(report.catalogue, null);
      assert.match(report.reason, /WebGL2/);
      assert.equal(existsSync(join(out, 'first-paint.png')), false);
    } else {
      assert.equal(report.status, 'measured');
      assert.equal(code, 0);
      assert.equal(report.renderer.webgl2, true);
      assert.equal(report.renderer.evidence.qualifies, true);
      assert.ok(report.renderer.evidence.magenta.pixels >= 600);
      assert.ok(report.renderer.evidence.green.pixels >= 600);
      assert.equal(report.renderer.negativeControlMaxMarkerPixels, 0);
      assert.equal(report.renderer.baselineMarkerPixels, 0);
      assert.equal(report.renderer.streamedBeforeStepClose, true);
      assert.equal(report.renderer.blockedRequests, 0);
      assert.equal(report.pipeline.acceptedActions, 4);
      assert.equal(report.pipeline.validationIssues, 0);
      const ordered = [report.catalogue.readyAfterRequestMs, report.pipeline.fixtureStartMs, report.pipeline.firstSentActionMs, report.pipeline.firstSubstantial3dPaintReceiptMs, report.pipeline.firstStepMs];
      ordered.forEach(value => assert.ok(Number.isFinite(value) && value >= 0));
      for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i] >= ordered[i - 1]);
      assert.deepEqual(readFileSync(join(out, 'first-paint.png')).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// Even an unavailable new run must not make an old image look like current evidence.
test('3D timing refuses a reused output directory without replacing earlier evidence', async () => {
  const out = mkdtempSync(join(tmpdir(), 'tt-useful-3d-existing-'));
  try {
    writeFileSync(join(out, 'first-paint.png'), 'old image');
    writeFileSync(join(out, 'result.json'), 'old report');
    await assert.rejects(promisify(execFile)(process.execPath, [resolve('scripts/prototypes/benchmark-first-visual.ts'), '--fixture', '3d', '--out', out], { timeout: 35_000 }), (error: unknown) => {
      const result = error as { code: number; stderr: string };
      assert.equal(result.code, 1);
      assert.match(result.stderr, /empty output directory/);
      return true;
    });
    assert.equal(readFileSync(join(out, 'first-paint.png'), 'utf8'), 'old image');
    assert.equal(readFileSync(join(out, 'result.json'), 'utf8'), 'old report');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
