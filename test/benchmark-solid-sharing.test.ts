import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkSolidSharing } from '../scripts/benchmark-solid-sharing.ts';

test('the offline benchmark measures validated repeated and unique meshes in every tier', () => {
  const result = benchmarkSolidSharing({ samples: 1, warmups: 0 }) as {
    cases: Array<{ tier: string; fixture: string; meshes: number; uniqueGeometries: number; logicalBytes: number; uniqueBytes: number; firstSyncMs: { p50: number }; warmSyncMs: { p50: number }; geometryDigest: string }>;
  };
  assert.equal(result.cases.length, 9);
  for (const row of result.cases) {
    assert.ok(['low', 'mid', 'high'].includes(row.tier));
    assert.equal(row.meshes, row.fixture === 'first-piece' ? 1 : 60);
    assert.equal(row.uniqueGeometries, row.fixture === 'repeated' ? 6 : row.meshes);
    assert.ok(row.uniqueBytes > 0);
    assert.ok(row.logicalBytes >= row.uniqueBytes);
    if (row.fixture === 'repeated') assert.equal(row.logicalBytes, row.uniqueBytes * 10);
    assert.ok(row.firstSyncMs.p50 >= 0);
    assert.ok(row.warmSyncMs.p50 >= 0);
    assert.match(row.geometryDigest, /^[a-f0-9]{64}$/);
  }
});

test('the offline benchmark refuses unbounded or invalid repetition counts', () => {
  for (const samples of [0, -1, 101, NaN, Infinity, 1.5]) {
    assert.throws(() => benchmarkSolidSharing({ samples, warmups: 0 }), /samples/);
  }
  for (const warmups of [-1, 11, NaN, Infinity, 0.5]) {
    assert.throws(() => benchmarkSolidSharing({ samples: 1, warmups }), /warmups/);
  }
});
