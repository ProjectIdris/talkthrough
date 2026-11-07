import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { evaluate, frameAt, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';
import { DETAIL, drawFraction, samplePath, tubeGeometry } from '../src/overlay/geometry.ts';
import type { Vec3 } from '../src/scene/types.ts';

const uneven: Vec3[] = [[0, 0, 0], [0.01, 0, 0], [10, 0, 0], [10.01, 0, 0]];

test('uneven straight tube controls do not introduce backwards loops or overshoot', () => {
  const sampled = samplePath(uneven, true, 18);
  for (let i = 1; i < sampled.length; i++) {
    assert.ok(sampled[i]![0] > sampled[i - 1]![0], `backwards at ${i}: ${sampled[i - 1]![0]} -> ${sampled[i]![0]}`);
    assert.deepEqual(sampled[i]!.slice(1), [0, 0]);
  }
  assert.deepEqual(sampled[0], uneven[0]);
  assert.deepEqual(sampled.at(-1), uneven.at(-1));
});

test('consecutive repeated controls do not create extra tube rings or change its curve', () => {
  const controls: Vec3[] = [[0, 0, 0], [0.2, 0.5, 0.1], [3, 2, -1], [4, 0, 1]];
  const repeated = controls.flatMap(p => [[...p] as Vec3, [...p] as Vec3]);
  const before = structuredClone(repeated);
  assert.deepEqual(samplePath(repeated, true, 12), samplePath(controls, true, 12));
  assert.deepEqual(repeated, before);
});

test('two tube controls produce evenly spaced rings, including when one control repeats', () => {
  const a: Vec3 = [2, -1, 3], b: Vec3 = [10, 7, -5];
  const expected: Vec3[] = [[2, -1, 3], [4, 1, 1], [6, 3, -1], [8, 5, -3], [10, 7, -5]];
  assert.deepEqual(samplePath([a, b], true, 4), expected);
  assert.deepEqual(samplePath([a, a, b, b], true, 4), expected);
});

test('straight line paths retain every authored corner and ignore the smooth sampling count', () => {
  const pts: Vec3[] = [[2, 0, 1], [2, 0, 1], [4, -3, 2], [2, 5, -1]];
  const got = samplePath(pts, false, 18);
  assert.deepEqual(got, pts);
  assert.notEqual(got, pts);
  assert.notEqual(got[0], pts[0]);
});

const near = (a: number, b: number, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test('centripetal knots give the hand-derived midpoint of an uneven right-angle span', () => {
  // Chord lengths 1, 4, 9 give knot intervals 1, 2, 3. The middle-span
  // midpoint from nonuniform interpolation is (13/15, 28/15, 0).
  const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 4, 0], [10, 4, 0]];
  const mid = samplePath(pts, true, 4)[6]!;
  near(mid[0], 13 / 15); near(mid[1], 28 / 15); near(mid[2], 0);
});

test('tube curves interpolate distinct controls, reverse consistently and keep tangent direction at joins', () => {
  const pts: Vec3[] = [[-3, -2, 1], [-2.9, -1.8, 1.1], [1, 3, -1], [4, 2, 3]];
  for (const count of [8, 12, 18]) {
    const result = samplePath(pts, true, count);
    assert.equal(result.length, (pts.length - 1) * count + 1);
    pts.forEach((p, i) => assert.deepEqual(result[i * count], p));
    const reverse = samplePath([...pts].reverse(), true, count).reverse();
    result.forEach((p, i) => p.forEach((v, axis) => near(v, reverse[i]![axis]!)));
  }
  const dense = samplePath(pts, true, 4096);
  for (const i of [4096, 8192]) {
    const left = new Vector3(...dense[i]!).sub(new Vector3(...dense[i - 1]!)).normalize();
    const right = new Vector3(...dense[i + 1]!).sub(new Vector3(...dense[i]!)).normalize();
    assert.ok(left.dot(right) > 0.99999, 'the same geometric tangent on both sides');
  }
});

test('local curve arithmetic preserves small profiles and translated small profiles', () => {
  const controls: Vec3[] = [[0, 0, 0], [0.01, 0.02, -0.01], [3, 4, 1], [3.1, 4, 1.2]];
  const reference = samplePath(controls, true, 12);
  for (const scale of [1e-200, 1e-100, 1e-8, 1, 20]) {
    const actual = samplePath(controls.map(p => p.map(v => v * scale) as Vec3), true, 12);
    actual.forEach((p, i) => p.forEach((v, axis) => near(v / scale, reference[i]![axis]!, 2e-12)));
  }
  const scale = 1e-6, offset = 80;
  const translated = samplePath(controls.map(p => p.map(v => offset + v * scale) as Vec3), true, 12);
  translated.forEach((p, i) => p.forEach((v, axis) => near((v - offset) / scale, reference[i]![axis]!, 1e-7)));
});

test('collapsed controls and deliberate reversals remain finite without discarding nonconsecutive controls', () => {
  assert.deepEqual(samplePath([[1, 2, 3], [1, 2, 3], [1, 2, 3]], true, 18), [[1, 2, 3], [1, 2, 3]]);
  const pts: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]];
  const sampled = samplePath(pts, true, 18);
  pts.forEach((p, i) => assert.deepEqual(sampled[i * 18], p));
  assert.ok(sampled.flat().every(Number.isFinite));
  for (const path of [sampled, samplePath([[1, 2, 3], [1, 2, 3]], true, 8)]) {
    const geo = tubeGeometry(path, 0.1, 1, 10);
    for (const name of ['position', 'normal']) assert.ok(Array.from(geo.getAttribute(name).array).every(Number.isFinite));
    geo.dispose();
  }
});

test('the tube mesh follows the corrected centerline within existing tier and reveal budgets', () => {
  for (const detail of Object.values(DETAIL)) for (const flat of [0.15, 1]) {
    const sampled = samplePath(uneven, true, detail.tube);
    const geo = tubeGeometry(sampled, 0.005, flat, detail.radial, [[0, 1], [1, 0.6]]);
    const positions = geo.getAttribute('position'), normals = geo.getAttribute('normal');
    for (let i = 0; i < sampled.length; i++) {
      const ring = i * (detail.radial + 1);
      // An even ring averages to its center, excluding the duplicate wrap vertex.
      const center = new Vector3();
      for (let j = 0; j < detail.radial; j++) center.add(new Vector3().fromBufferAttribute(positions, ring + j));
      center.divideScalar(detail.radial);
      near(center.x, sampled[i]![0], 1e-6); near(center.y, 0, 1e-6); near(center.z, 0, 1e-6);
    }
    for (let i = 0; i < normals.count; i++) near(new Vector3().fromBufferAttribute(normals, i).length(), 1, 1e-6);
    const all = geo.index!.count;
    drawFraction(geo, 0); assert.equal(geo.drawRange.count, 0);
    drawFraction(geo, 0.5); assert.ok(geo.drawRange.count > 0 && geo.drawRange.count < all - geo.userData.endCap);
    drawFraction(geo, 1); assert.equal(geo.drawRange.count, all);
    const maxControls: Vec3[] = Array.from({ length: 24 }, (_, i) => [i, Math.sin(i), 0]);
    const max = tubeGeometry(samplePath(maxControls, true, detail.tube), 0.1, flat, detail.radial);
    assert.ok(max.getAttribute('position').count <= (23 * detail.tube + 11) * (detail.radial + 1));
    max.dispose(); geo.dispose();
  }
});

const frame = (...actions: unknown[]): Frame => frameAt([{ say: 'x', actions } as Step], 0, 99);
const meshOf = (scene: PanelScene, f: Frame, id: string): Mesh => {
  let mesh: Mesh | undefined;
  scene.nodeOf(f.objects.find(o => o.id === id)!.key)?.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh); return mesh;
};

test('actual scene tubes preserve transformed streams, independent reveal and disposal after duplicate removal', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const scene = new PanelScene({ tier });
    const add = (id: string, draw = 1) => ({ op: 'add', shape: 'tube', id, parent: 'g', pts: uneven.flatMap(p => [p, p]), radius: 0.1, draw });
    const f = frame(
      { op: 'add', shape: 'group', id: 'g', pos: [2, -1, 3], rot: [0, 0, 90] },
      add('a'), add('b', 0.5), { op: 'add', shape: 'stream', id: 's', along: 'a', count: 1, period: 4 },
    );
    f.objects.find(o => o.id === 's')!.phase = 0.5;
    scene.sync(f, 1);
    const a = meshOf(scene, f, 'a').geometry, b = meshOf(scene, f, 'b').geometry;
    assert.notEqual(a, b);
    assert.equal(a.userData.rings, 3 * DETAIL[tier].tube + 1);
    assert.ok(b.drawRange.count < a.drawRange.count);
    const marker = meshOf(scene, f, 's').getWorldPosition(new Vector3());
    near(marker.x, 2, 1e-6); near(marker.y, 4.005, 1e-6); near(marker.z, 3, 1e-6);
    let disposed = 0; a.addEventListener('dispose', () => disposed++);
    scene.sync(f, 1); assert.equal(disposed, 0); assert.equal(meshOf(scene, f, 'a').geometry, a);
    const replacement = evaluate(planStep(f, { say: 'x', actions: [{ ...add('a'), pts: [[0, 0, 0], [3, 2, 0]] }] } as Step), 99);
    scene.sync(replacement, 1); assert.equal(disposed, 1); assert.notEqual(meshOf(scene, replacement, 'a').geometry, a);
    scene.sync({ ...f, objects: [] }, 1); assert.equal(scene.count(), 0);
    scene.destroy(); assert.equal(disposed, 1);
  }
});
