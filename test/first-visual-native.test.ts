import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electronRuntime } from './support/electron-runtime.ts';

// The standalone harness supports Linux headless Ozone without disabling the sandbox.
const runtime = electronRuntime({ env: { ...process.env, DISPLAY: process.env.DISPLAY ?? 'headless-probe' } });
test('offline native fixture proves pixels before a complete step without reporting model latency', { skip: runtime.reason, timeout: 40_000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'tt-first-visual-result-'));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('scripts/prototypes/benchmark-first-visual.ts'), '--out', out], { timeout: 35_000, maxBuffer: 100_000 });
    const report = JSON.parse(stdout);
    assert.equal(report.mode, 'offline-hand-written-2d-fixture');
    assert.equal(report.model.called, false);
    assert.equal(report.model.firstTokenMs, null);
    assert.equal(report.model.firstOutputMs, null);
    assert.equal(report.target.met, null);
    assert.equal(report.renderer.baselineMarkerPixels, 0);
    assert.ok(report.renderer.negativeControlPaints > 0);
    assert.equal(report.renderer.negativeControlMaxMarkerPixels, 0);
    assert.equal(report.renderer.streamedBeforeStepClose, true);
    assert.equal(report.renderer.blockedRequests, 0);
    assert.ok(report.renderer.markerPixels >= 12);
    assert.equal(report.catalogue.entries, 21);
    assert.ok(report.catalogue.responseBytes <= 4096);
    assert.equal(report.pipeline.acceptedActions, 1);
    assert.equal(report.pipeline.validationIssues, 0);
    const ordered = [report.catalogue.readyAfterRequestMs, report.pipeline.fixtureStartMs, report.pipeline.firstPieceMs, report.pipeline.firstActionMs, report.pipeline.firstValidatedActionMs, report.pipeline.firstSentActionMs, report.pipeline.firstQualifyingPaintReceiptMs, report.pipeline.firstStepMs];
    for (const value of ordered) assert.ok(Number.isFinite(value) && value >= 0);
    for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i] >= ordered[i - 1]);
    assert.deepEqual(readFileSync(join(out, 'first-paint.png')).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')), report);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
