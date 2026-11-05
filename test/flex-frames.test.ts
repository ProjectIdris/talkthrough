import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleFrames } from '../src/overlay/flex-frames.ts';

const straight = [
  { u: 0, center: [0,0,0], chord: [0,0,1], halfWidth: .2, camber: .02, profileDelta: .01 },
  { u: .5, center: [1,0,0], chord: [0,0,1], halfWidth: .5, camber: .04, profileDelta: .02 },
  { u: 1, center: [2,0,0], chord: [0,0,1], halfWidth: .2, camber: .02, profileDelta: .01 },
] as const;
test('samples 25 continuous frames and interpolates sections', () => {
  const frames = sampleFrames(straight);
  assert.equal(frames.length, 25);
  assert.deepEqual(frames[12]!.center.toArray(), [1,0,0]);
  assert.equal(frames[12]!.halfWidth, .5);
  for (const f of frames) {
    assert.ok(Math.abs(f.tangent.dot(f.chord)) < 1e-10);
    assert.ok(Math.abs(f.normal.length() - 1) < 1e-10);
  }
});
test('rejects degenerate projected chord and reversing centerline', () => {
  assert.throws(() => sampleFrames(straight.map(s => ({...s, chord:[1,0,0]}))));
  assert.throws(() => sampleFrames([straight[0], straight[1], {...straight[2], center:[0,0,0]}]));
});

test('normal is authored chord cross tangent, including at straight rest',()=>{
  const f=sampleFrames(straight)[0]!;
  assert.ok(f.normal.distanceTo(new (f.normal.constructor as typeof import('three').Vector3)(0,1,0))<1e-10);
});
