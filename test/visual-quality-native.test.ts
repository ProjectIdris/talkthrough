import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { electronRuntime } from './support/electron-runtime.ts';
const runtime = electronRuntime({ env: { ...process.env, DISPLAY: process.env.DISPLAY ?? 'headless-probe' } });
test('native visual harness saves honest unsupported or real-pixel evidence without sandbox bypass', { skip: runtime.reason, timeout: 90_000 }, t => {
  const parent = mkdtempSync(join(tmpdir(), 'tt-visual-test-'));
  const out = join(parent, 'result');
  try {
    const child = spawnSync(process.execPath, [resolve('scripts/prototypes/check-visual-quality.ts'), '--out', out], { encoding: 'utf8', timeout: 85_000, maxBuffer: 100_000 });
    assert.ok(child.status === 0 || child.status === 2, child.stderr + child.stdout);
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
    assert.equal(report.nativeVisualAcceptance, null);
    assert.equal(report.modelCalled, false);
    assert.equal(report.blockedRequests, 0);
    assert.equal(report.renderer.browserOnlySubstitute, false);
    assert.ok(existsSync(join(out, 'inspection.html')));
    assert.ok(existsSync(join(out, 'baseline.png')));
    assert.equal(Object.keys(report.sourceHashes).length > 3, true);
    if (report.status === 'unsupported') {
      assert.equal(child.status, 2);
      assert.equal(report.renderer.available, false);
      assert.equal(report.captures.length, 0);
      assert.match(report.reason, /WebGL/);
      t.diagnostic('Native WebGL unavailable: fallback and diagnostic artifacts verified, 3D visual checks NOT accepted.');
    } else {
      assert.equal(report.status, 'passed-smoke-checks');
      assert.equal(child.status, 0);
      assert.equal(report.captures.length, 6);
      for (const c of report.captures) {
        assert.equal(c.analysis.status, 'pass');
        assert.ok(c.analysis.metrics.changedPixels > 0);
        assert.ok(c.metadata.camera);
        assert.deepEqual(readFileSync(join(out, c.image)).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
      }
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
