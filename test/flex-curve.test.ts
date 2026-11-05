import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodicCurve, samplePeriodicCurve } from '../src/overlay/flex-curve.ts';

test('periodic irregular curve remains inside each interval and closes smoothly', () => {
  const curve = periodicCurve([0, 0.15, 0.7, 1], [0, 2, -1, 0]);
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(curve.values[i]!, curve.values[i + 1]!);
    const hi = Math.max(curve.values[i]!, curve.values[i + 1]!);
    for (let j = 0; j <= 100; j++) {
      const t = curve.times[i]! + (curve.times[i + 1]! - curve.times[i]!) * j / 100;
      const v = samplePeriodicCurve(curve, t);
      assert.ok(v >= lo - 1e-10 && v <= hi + 1e-10, `${t}: ${v} outside ${lo}..${hi}`);
    }
  }
  assert.equal(samplePeriodicCurve(curve, 0), samplePeriodicCurve(curve, 1));
  const e = 1e-5;
  const left = (samplePeriodicCurve(curve, 1) - samplePeriodicCurve(curve, 1 - e)) / e;
  const right = (samplePeriodicCurve(curve, e) - samplePeriodicCurve(curve, 0)) / e;
  assert.ok(Math.abs(left - right) < 0.01, `${left} != ${right}`);
});

test('curve rejects nonfinite, duplicate, and nonclosing keys', () => {
  assert.throws(() => periodicCurve([0, .5, 1], [0, 2, 1]));
  assert.throws(() => periodicCurve([0, 0, 1], [0, 2, 0]));
  assert.throws(() => periodicCurve([0, .5, 1], [0, NaN, 0]));
});
