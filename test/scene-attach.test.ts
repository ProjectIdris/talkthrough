import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTolerance, landOn } from '../src/scene/attach.ts';
import type { Body } from '../src/scene/attach.ts';

// Which part's surface a point lies on: a sphere, a box turned with its group, a blob; the answer in the space the point was given in, and in the part's own.

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const bodies = (o: Record<string, Body>) => new Map(Object.entries(o));

test('a point a hair off a sphere lands on its surface, straight out from the centre', () => {
  const b = bodies({ bulb: { shape: 'sphere', size: [1.4, 1.4, 1.4], pos: [2, 0, 0], rot: [0, 0, 0] } });
  const hit = landOn(b, undefined, [2, 0.8, 0], 0.15);
  assert.equal(hit?.part, 'bulb');
  near(hit!.snapped[1], 0.7);
  near(hit!.local[1], 0.7);
  assert.equal(landOn(b, undefined, [2, 1.2, 0], 0.15), undefined, 'half a unit off is clear air');
});

test('a part in a turned group: the point is found in the part\'s own space, and the answer comes back in the holder\'s', () => {
  const b = bodies({
    rig: { shape: 'group', pos: [4, 1, 0], rot: [0, 0, 90] },
    block: { shape: 'box', size: [2, 1, 1], pos: [0, 0, 0], rot: [0, 0, 0], parent: 'rig' }, // long along x in the group; the group is turned a quarter about z, so it stands tall
  });
  const hit = landOn(b, undefined, [4, 2.05, 0], 0.1); // the block's top end in the scene: y = 1 + 1
  assert.equal(hit?.part, 'block');
  near(hit!.snapped[1], 2);
  near(hit!.local[0], 1); // its own +x end
});

test('a blob is as near as its nearest lump; a group is never landed on', () => {
  const b = bodies({
    g: { shape: 'group', pos: [0, 0, 0], rot: [0, 0, 0] },
    heart: { shape: 'blob', pts: [[0, 0, 0], [2, 0, 0]], sizes: [[1, 1, 1], [1, 1, 1]], pos: [0, 0, 0], rot: [0, 0, 0] },
  });
  assert.equal(landOn(b, undefined, [2.55, 0, 0], 0.1)?.part, 'heart');
  assert.equal(landOn(b, undefined, [1, 0, 0], 0.1), undefined, 'between the lumps, clear of both');
});

test('a fat pipe has a wider reach than a thin one, within bounds', () => {
  assert.ok(attachTolerance(0.3) > attachTolerance(0.02));
  assert.ok(attachTolerance(5) <= 0.5);
  assert.ok(attachTolerance(undefined) >= 0.1);
});
