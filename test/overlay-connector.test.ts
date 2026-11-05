import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { arcPoint, beltPoints, endPoint, ropePoints, roundOf } from '../src/overlay/connector.ts';
import type { Vec3 } from '../src/scene/types.ts';

// A connector's shape is worked out from where its two objects are: a taut rope is the line between its ends, a slack one hangs, a belt goes
// round two wheels (the strands touch each wheel along a tangent, whatever the sizes).

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const length = (pts: readonly Vec3[]): number => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - (pts[i] as Vec3)[0], p[1] - (pts[i] as Vec3)[1], p[2] - (pts[i] as Vec3)[2]), 0);
const placed = (pos: Vec3, rot: Vec3 = [0, 0, 0], scale = 1): Group => {
  const g = new Group();
  g.position.set(...pos);
  g.rotation.set((rot[0] * Math.PI) / 180, (rot[1] * Math.PI) / 180, (rot[2] * Math.PI) / 180);
  g.scale.setScalar(scale);
  g.updateMatrixWorld(true);
  return g;
};
const disc = { shape: 'cylinder', size: [2, 0.4, 2] }; // a wheel standing on its edge needs rot [90,0,0]: axis z

test('a straight rope is the line between its ends and a slack one hangs below it by a fraction of its length', () => {
  const a = new Vector3(0, 0, 0), b = new Vector3(4, 0, 0);
  const taut = ropePoints(a, b, 0, 8);
  assert.deepEqual(taut[0], [0, 0, 0]);
  assert.deepEqual(taut[8], [4, 0, 0]);
  near(length(taut), 4);
  const slack = ropePoints(a, b, 0.25, 8);
  near((slack[4] as Vec3)[1], -1); // the middle hangs a quarter of 4 below
  assert.deepEqual([slack[0], slack[8]], [[0, 0, 0], [4, 0, 0]]);
});

test('the rim of a wheel on its side is the rim in that direction; a box has its face', () => {
  const wheel = placed([2, 3, 0], [90, 0, 0]);
  const left = endPoint(wheel, disc, 'left', undefined, undefined);
  near(left.x, 1); near(left.y, 3); near(left.z, 0);
  const top = endPoint(wheel, disc, 'top', undefined, undefined);
  near(top.x, 2); near(top.y, 4);
  const front = endPoint(wheel, disc, 'front', undefined, undefined);
  near(front.z, 0.2); // the face of the wheel, half its thickness out
  assert.equal(roundOf(disc, wheel)?.axis.z !== undefined && Math.abs((roundOf(disc, wheel)?.axis.z ?? 0)) > 0.99, true);
});

test('the rim follows the wheel when it is moved or scaled', () => {
  const wheel = placed([5, 0, 0], [90, 0, 0], 2);
  const right = endPoint(wheel, disc, 'right', undefined, undefined);
  near(right.x, 7);
});

test('a side of a box is the middle of that face; an anchor is a point of the part, where the part is', () => {
  const weight = new Mesh(new BoxGeometry(1, 2, 1));
  weight.position.set(0, -3, 0);
  weight.updateMatrixWorld(true);
  const top = endPoint(weight, { shape: 'box', size: [1, 2, 1] }, 'top', undefined, undefined);
  near(top.x, 0); near(top.y, -2); near(top.z, 0);
  const p = endPoint(placed([1, 1, 1]), { shape: 'group' }, undefined, 'tip', { tip: [0, 1, 0] });
  near(p.x, 1); near(p.y, 2); near(p.z, 1);
});

test('a belt round two wheels is as long as the strands and arcs say, for equal and for unequal wheels', () => {
  const round = (x: number, r: number) => ({ centre: new Vector3(x, 0, 0), axis: new Vector3(0, 0, 1), radius: r, width: 0.4 });
  for (const [r1, r2, d] of [[1, 1, 4], [1.5, 0.5, 4]] as const) {
    const belt = beltPoints(round(0, r1), round(d, r2), 0, (1 * Math.PI) / 180) as Vec3[];
    const phi = Math.acos((r1 - r2) / d);
    const want = 2 * Math.sqrt(d * d - (r1 - r2) ** 2) + (2 * Math.PI - 2 * phi) * r1 + 2 * phi * r2;
    near(length(belt) / want, 1, 0.003);
    assert.deepEqual(belt[0], belt[belt.length - 1]);
    // every point is on the rim of a wheel or on a strand: none is inside either wheel
    for (const p of belt) assert.ok(Math.hypot(p[0], p[1]) >= r1 - 1e-6 || Math.hypot(p[0] - d, p[1]) >= r2 - 1e-6);
  }
});

test('a belt stands off the rim by the lift, and is not made for wheels that do not suit it', () => {
  const a = { centre: new Vector3(0, 0, 0), axis: new Vector3(0, 0, 1), radius: 1, width: 0.4 };
  const b = { centre: new Vector3(3, 0, 0), axis: new Vector3(0, 0, 1), radius: 1, width: 0.4 };
  const belt = beltPoints(a, b, 0.1) as Vec3[];
  const off = belt.map((p) => Math.min(Math.hypot(p[0], p[1]), Math.hypot(p[0] - 3, p[1])));
  near(Math.min(...off), 1.1, 1e-3);
  assert.equal(beltPoints(a, { ...b, axis: new Vector3(1, 0, 0) }, 0), undefined);
  assert.equal(beltPoints(a, { ...b, centre: new Vector3(0.2, 0, 0), radius: 0.3 }, 0), undefined, 'one wheel inside the other');
});

test('a point by length along a run of points, and the way it heads', () => {
  const out = { p: new Vector3(), dir: new Vector3() };
  const bent: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 3, 0]];
  arcPoint(bent, 0.5, out); // half of 4 is 2: one up the second leg
  near(out.p.x, 1); near(out.p.y, 1); near(out.dir.y, 1);
  arcPoint(bent, 0, out);
  near(out.p.x, 0);
  arcPoint(bent, 1, out);
  near(out.p.y, 3);
});
