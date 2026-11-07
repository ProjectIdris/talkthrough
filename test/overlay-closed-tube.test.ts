import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { DETAIL, drawFraction, samplePath, tubeGeometry } from '../src/overlay/geometry.ts';
import { closedTubeGeometry } from '../src/overlay/closed-tube.ts';
import { emptyFrame, evaluate, frameAt, planStep } from '../src/overlay/timeline.ts';
import { createDetailState, createSceneState, validateStep } from '../src/scene/index.ts';
import type { Vec3, Step } from '../src/scene/index.ts';

const pts: Vec3[] = [[-2, 0, 0], [0, 2, 0], [2, 0, 0], [0, -2, 0]];
const loop = (extra = {}) => ({ op: 'add', shape: 'tube', id: 'ring', pts, radius: 0.25, closed: true, ...extra });
const validate = (actions: unknown[], state = createSceneState()) => validateStep({ say: 'Loop', actions }, state);
function build(action = loop()) {
  const frame = frameAt([{ say: 'Loop', actions: [action] } as unknown as Step], 0, 100);
  const scene = new PanelScene();
  scene.sync(frame, 1);
  const node = scene.nodeOf(frame.objects[0]!.key)!;
  const mesh = node.children.find((c): c is Mesh => c instanceof Mesh)!;
  return { scene, geo: mesh.geometry, frame, node };
}
const rowAt = (geo: BufferGeometry, at: number, name: string) => {
  const a = geo.getAttribute(name);
  return [a.getX(at), a.getY(at), a.getZ(at)];
};
function assertSeam(geo: BufferGeometry) {
  const rings = geo.userData.rings as number;
  const row = (geo.userData.indicesPerRing as number) / 6 + 1;
  for (const attr of ['position', 'normal']) {
    for (let j = 0; j < row; j++) assert.deepEqual(rowAt(geo, j, attr), rowAt(geo, (rings - 1) * row + j, attr), `${attr} seam ${j}`);
  }
}

test('closed tubes retain the flag and need three distinct points', () => {
  const valid = validate([loop()]);
  assert.equal((valid.step!.actions[0] as unknown as { closed?: boolean }).closed, true);
  assert.deepEqual(valid.issues, []);
  for (const points of [[[0, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0], [0, 0, 0]]]) {
    const r = validate([loop({ pts: points })]);
    assert.equal(r.step!.actions.length, 0);
    assert.match(r.issues[0]!.message, /three distinct/i);
  }
});

test('a closed tube has matching first and last rings with no overlapping caps', () => {
  const { geo, scene } = build();
  assert.equal(geo.userData.startCap, 0);
  assert.equal(geo.userData.endCap, 0);
  assertSeam(geo);
  const rings = geo.userData.rings as number, per = geo.userData.indicesPerRing as number;
  assert.equal(geo.index!.count, (rings - 1) * per);
  for (const fraction of [0, 0.25, 0.5, 1]) {
    drawFraction(geo, fraction);
    assert.equal(geo.drawRange.count, Math.round(fraction * (rings - 1)) * per);
  }
  scene.destroy();
});

test('closed loops never attach their seam to earlier or later solids', () => {
  const state = createSceneState();
  const box = { op: 'add', shape: 'box', id: 'box', pos: [-2.5, 0, 0], size: [1, 1, 1] };
  const first = validate([box, loop()], state);
  assert.equal('attach' in first.step!.actions[1]!, false);
  assert.equal(state.loose.has('ring'), false);
  const secondState = createSceneState();
  validate([loop()], secondState);
  const later = validate([box], secondState);
  assert.equal(later.step!.actions.length, 1, 'no replacement loop is generated');
});

test('a repeated closing point and consecutive duplicate points produce the same closed surface', () => {
  const a = build(), b = build(loop({ pts: [pts[0], pts[0], ...pts.slice(1), pts[0]] }));
  assert.deepEqual(a.geo.getAttribute('position').array, b.geo.getAttribute('position').array);
  assert.deepEqual(a.geo.getAttribute('normal').array, b.geo.getAttribute('normal').array);
  a.scene.destroy(); b.scene.destroy();
});

test('flattened non-planar loops with swell have finite unit normals and close smoothly', () => {
  const { scene, geo } = build(loop({ pts: [[-2, 0, 0], [0, 2, 1], [2, 0, 0], [0, -2, -0.5]], flat: 0.15, swell: [[0, 1], [0.4, 2], [1, 0.4]] }));
  assertSeam(geo);
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(new Vector3().fromBufferAttribute(n, i).length() - 1) < 1e-6, `normal ${i}`);
  scene.destroy();
});

test('stream beads keep their size across a completed loop seam, but still fade at a reveal head', () => {
  const scene = new PanelScene();
  const plan = (draw: number, closed = true) => planStep(emptyFrame(), { say: 'Flow', actions: [loop({ draw, closed }), { op: 'add', shape: 'stream', id: 'flow', along: 'ring', count: 1, period: 4 }] } as unknown as Step);
  for (const [draw, closed] of [[1, true], [0.5, true], [1, false]] as const) {
    const path = plan(draw, closed);
    const positions: Vector3[] = [];
    for (const time of [3.9999, 4, 4.0001]) {
      const frame = evaluate(path, time); scene.sync(frame, 1);
      const node = scene.nodeOf(frame.objects.find((o) => o.id === 'flow')!.key)!;
      const bead = node.children[0] as Mesh;
      if (closed && draw === 1) {
        assert.ok(bead.visible);
        assert.ok(Math.abs(bead.scale.x - 0.75) < 1e-8);
        positions.push(bead.position.clone());
      } else assert.ok(bead.scale.x < 1e-6, 'open ends retain their existing fade');
    }
    if (positions.length) assert.ok(positions[0]!.distanceTo(positions[2]!) < 0.01, 'the bead moves through the join without a jump');
  }
  scene.destroy();
});

test('closed geometry has outward faces, bounded detail and welded seams at every tier', () => {
  for (const detail of Object.values(DETAIL)) {
    const { geo, sampled } = closedTubeGeometry(pts, 0.25, 0.5, detail.radial, detail.tube);
    assertSeam(geo);
    assert.deepEqual(sampled[0], sampled[sampled.length - 1]);
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), index = geo.index!;
    assert.equal(p.count, (pts.length * detail.tube + 1) * (detail.radial + 1));
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
    const edges = new Map<string, number>();
    const pointKey = (i: number) => rowAt(geo, i, 'position').join(',');
    for (let i = 0; i < index.count; i += 3) {
      const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
      a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib).sub(a); c.fromBufferAttribute(p, ic).sub(a);
      normal.fromBufferAttribute(n, ia);
      assert.ok(b.cross(c).dot(normal) > 0, `outward triangle ${i / 3}`);
      for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]]) {
        const key = [pointKey(u!), pointKey(v!)].sort().join('|'); edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every((n) => n === 2), 'every geometric edge has two incident triangles, including both seams');
    geo.dispose();
  }
});

test('closed loops stay finite at extreme scale and at a retracing control point', () => {
  for (const scale of [0.0001, 1, 50]) {
    for (const flat of [0.05, 0.5, 1]) {
      for (const controls of [pts, [[-2, 0, 0], [0, 0, 0], [2, 0, 0]] as Vec3[]]) {
        const { geo } = closedTubeGeometry(controls.map((p) => p.map((v) => v * scale) as Vec3), Math.max(0.01, 0.25 * scale), flat, 10, 8, [[0, 0.02], [0.5, 10]]);
        assertSeam(geo);
        for (const attr of ['position', 'normal']) assert.ok([...geo.getAttribute(attr).array].every(Number.isFinite));
        const n = geo.getAttribute('normal');
        for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-6);
        geo.dispose();
      }
    }
  }
});

test('open tube geometry is unchanged when closed is omitted or false', () => {
  const expected = tubeGeometry(samplePath(pts, true, DETAIL.mid.tube), 0.25, 1, DETAIL.mid.radial);
  for (const closed of [undefined, false]) {
    const { scene, geo } = build(loop({ closed }));
    assert.deepEqual(geo.getAttribute('position').array, expected.getAttribute('position').array);
    assert.deepEqual(geo.getAttribute('normal').array, expected.getAttribute('normal').array);
    assert.deepEqual(geo.index!.array, expected.index!.array);
    assert.deepEqual(geo.userData, expected.userData);
    scene.destroy();
  }
  expected.dispose();
});

test('closed loops follow parents, retain geometry across sync, and dispose on replacement and clear', () => {
  const scene = new PanelScene();
  const step = (...actions: unknown[]) => ({ say: 'Loop', actions }) as Step;
  let frame = evaluate(planStep(emptyFrame(), step({ op: 'add', shape: 'group', id: 'holder', pos: [3, 2, 1], rot: [0, 0, 90] }, loop({ parent: 'holder' }))), 1);
  scene.sync(frame, 1);
  const key = frame.objects.find((o) => o.id === 'ring')!.key;
  const mesh = scene.nodeOf(key)!.children[0] as Mesh;
  const geo = mesh.geometry;
  const at = mesh.localToWorld(new Vector3());
  assert.ok(at.distanceTo(new Vector3(3, 2, 1)) < 1e-8);
  let disposed = 0;
  geo.addEventListener('dispose', () => disposed++);
  scene.sync(frame, 1);
  assert.equal((scene.nodeOf(key)!.children[0] as Mesh).geometry, geo);
  frame = evaluate(planStep(frame, step(loop({ parent: 'holder', radius: 0.4 }))), 1);
  scene.sync(frame, 1);
  assert.equal(disposed, 1);
  const nextKey = frame.objects.find((o) => o.id === 'ring')!.key;
  assert.notEqual(nextKey, key);
  const nextGeo = (scene.nodeOf(nextKey)!.children[0] as Mesh).geometry;
  assertSeam(nextGeo);
  nextGeo.addEventListener('dispose', () => disposed++);
  frame = evaluate(planStep(frame, step({ op: 'clear', target: 'holder' })), 1);
  scene.sync(frame, 1);
  assert.equal(disposed, 2);
  assert.equal(scene.count(), 0);
  scene.destroy();
});

test('a detail pass replacing an open tube with a loop removes its pending endpoint attachment', () => {
  const state = createSceneState();
  validate([loop({ closed: false })], state);
  assert.ok(state.loose.has('ring'));
  const detail = createDetailState(state);
  const result = validate([loop()], detail);
  assert.equal(result.issues.length, 0);
  assert.equal(detail.loose.has('ring'), false);
  assert.equal('attach' in result.step!.actions[0]!, false);
});

test('a tiny loop translated far from zero retains unit fallback normals', () => {
  const tiny: Vec3[] = [[50, 50, 50], [50 + 1e-11, 50, 50], [50, 50 + 1e-11, 50]];
  assert.equal(validate([loop({ pts: tiny })]).issues.length, 0, 'a valid bounded input');
  for (const detail of Object.values(DETAIL)) {
    const { geo } = closedTubeGeometry(tiny, 0.01, 0.05, detail.radial, detail.tube);
    const n = geo.getAttribute('normal');
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-6, `normal ${i}`);
    geo.dispose();
  }
});

test('stream beads ease out of their endpoint fade as a loop finishes revealing', () => {
  const scene = new PanelScene();
  const plan = planStep(emptyFrame(), { say: 'Close', actions: [
    loop({ draw: 0 }),
    { op: 'add', shape: 'stream', id: 'flow', along: 'ring', count: 1, period: 4 },
    { op: 'reveal', id: 'ring', to: 1, dur: 4 },
  ] } as unknown as Step);
  const sizes: number[] = [], positions: Vector3[] = [];
  for (const time of [3.9999, 3.999999, 4]) {
    const frame = evaluate(plan, time); scene.sync(frame, 1);
    const node = scene.nodeOf(frame.objects.find((o) => o.id === 'flow')!.key)!;
    const bead = node.children[0] as Mesh;
    sizes.push(bead.scale.x); positions.push(bead.position.clone());
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) < 1e-5, `no size pop at completion: ${sizes}`);
  assert.ok(positions[0]!.distanceTo(positions[2]!) < 0.01);
  scene.destroy();
});
