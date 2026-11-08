import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';

const near = (actual: number, expected: number, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} vs ${expected}`);
const group = (id: string, extra: object = {}) => ({ op: 'add', shape: 'group', id, ...extra });
const connector = (extra: object = {}) => ({ op: 'add', shape: 'connector', id: 'link', from: 'a', to: 'b', radius: 0.2, ...extra });
function rig(actions: unknown[]) {
  const plan = planStep(emptyFrame(), { say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, ...actions] } as Step);
  const scene = new PanelScene();
  const at = (t: number) => {
    const frame = evaluate(plan, t); scene.sync(frame, 1);
    const node = (id: string): Object3D => scene.nodeOf(frame.objects.find(o => o.id === id)!.key)!;
    const mesh = node('link').children[0] as Mesh;
    return { frame, mesh, node, bounds: new Box3().setFromObject(node('link')) };
  };
  return { scene, at };
}
const radiusAt = (geo: BufferGeometry, y: number): number => {
  const p = geo.getAttribute('position'); let radius = 0;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 1e-4) radius = Math.max(radius, Math.hypot(p.getX(i), p.getZ(i)));
  return radius;
};

// Ignoring fromPoint/toPoint would join the group origins, not these transformed sockets.
test('explicit local sockets follow rotation and nonuniform scale, before named anchors or sides', () => {
  const { at } = rig([
    group('a', { pos: [1, 2, 0], rot: [0, 0, 90] }), group('b', { pos: [-3, 6, 0], rot: [0, 0, 90] }),
    { op: 'scale', id: 'a', to: [2, 3, 1], dur: 0 },
    connector({ fromPoint: [1, 0, 0], toPoint: [0, -1, 0], fromAnchor: 'origin', fromSide: 'bottom', radius: 0.01 }),
  ]);
  const { bounds } = at(1);
  near(bounds.min.x, -2, 0.02); near(bounds.max.x, 1, 0.02);
  near(bounds.min.y, 4, 0.02); near(bounds.max.y, 6, 0.02);
});

test('a smooth profile has thin ends and a wide belly, not a uniform cylinder', () => {
  const { at } = rig([group('a'), group('b', { pos: [0, 4, 0] }), connector({ swell: [[0, 0.15], [0.5, 1], [1, 0.15]] })]);
  const { mesh } = at(1);
  near(radiusAt(mesh.geometry, 0), 0.03);
  near(radiusAt(mesh.geometry, 2), 0.2);
  near(radiusAt(mesh.geometry, 4), 0.03);
});

test('shortening to one quarter doubles the radius and returning restores the authored geometry', () => {
  const actions = [group('a'), group('b', { pos: [0, 4, 0] }), connector({ restLength: 4 }),
    { op: 'move', id: 'b', to: [0, 1, 0], at: 2, dur: 1 }];
  const { at } = rig(actions);
  const original = Array.from(at(1).mesh.geometry.getAttribute('position').array);
  near(radiusAt(at(1).mesh.geometry, 2), 0.2);
  near(radiusAt(at(4).mesh.geometry, 0.5), 0.4);
  assert.deepEqual(Array.from(at(1).mesh.geometry.getAttribute('position').array), original);
  assert.deepEqual(Array.from(rig(actions).at(4).mesh.geometry.getAttribute('position').array), Array.from(at(4).mesh.geometry.getAttribute('position').array), 'fresh seek has no first-frame reference length');
});

test('reference length is measured in connector space so a scaled parent does not falsely stretch it', () => {
  const { at } = rig([group('parent', { rot: [0, 0, 35] }), group('a', { parent: 'parent' }), group('b', { parent: 'parent', pos: [0, 4, 0] }),
    connector({ parent: 'parent', restLength: 4 }), { op: 'scale', id: 'parent', to: [3, 2, 1], dur: 0 }]);
  near(radiusAt(at(1).mesh.geometry, 2), 0.2);
});

test('slack uses its full sampled path length rather than its endpoint distance', () => {
  const { at } = rig([group('a'), group('b', { pos: [4, 0, 0] }), connector({ restLength: 4, kind: 'slack', sag: 0.25 })]);
  const { mesh } = at(1);
  const p = mesh.geometry.getAttribute('position');
  const radius = Math.hypot(p.getX(0), p.getY(0), p.getZ(0));
  // Integral of sqrt(1+(1-2x)^2) over x=0..1 is about 1.1478; radius is 0.2/sqrt(1.1478).
  near(radius, 0.18669, 0.0002);
});

test('near-zero and very long spans keep finite normals and bounded radius (a squashed cord keeps its authored radius)', () => {
  for (const [length, expected] of [[0, 0.2], [0.000001, 0.2], [1000, 0.05]]) {
    const { at } = rig([group('a'), group('b', { pos: [0, length, 0] }), connector({ restLength: 4 })]);
    const { mesh, bounds } = at(1);
    for (const name of ['position', 'normal']) assert.ok(Array.from(mesh.geometry.getAttribute(name).array).every(Number.isFinite));
    near(Math.max(bounds.max.x, bounds.max.z), expected!, 1e-4);
  }
});

test('stationary profiled connectors keep their geometry and reveal remains supported', () => {
  const { at } = rig([group('a'), group('b', { pos: [0, 4, 0] }), connector({ restLength: 4, swell: [[0, 0.2], [0.5, 1], [1, 0.2]] }),
    { op: 'reveal', id: 'link', to: 0.5, at: 2, dur: 0 }]);
  const geo = at(1).mesh.geometry;
  assert.equal(at(1.5).mesh.geometry, geo);
  const partial = at(3).mesh.geometry;
  assert.equal(partial, geo);
  assert.ok(partial.drawRange.count < partial.getIndex()!.count);
});

test('stream dots stay outside a contracted profiled connector and shrink again on reverse seeks', () => {
  const { at } = rig([group('a'), group('b', { pos: [0, 4, 0] }), connector({ restLength: 4, swell: [[0, 0.2], [0.5, 2], [1, 0.2]] }),
    { op: 'add', shape: 'stream', id: 'flow', along: 'link', count: 1, period: 2 },
    { op: 'move', id: 'b', to: [0, 1, 0], at: 2, dur: 1 }]);
  for (const time of [1, 5, 1]) {
    const { mesh, node } = at(time);
    const centre = time === 5 ? 0.5 : 2;
    const radius = radiusAt(mesh.geometry, centre);
    const dot = node('flow').children[0] as Mesh;
    assert.ok(dot.visible);
    assert.ok(dot.scale.x * 0.5 > radius, `dot radius ${dot.scale.x * 0.5} must exceed connector radius ${radius}`);
    near(dot.scale.x * 0.5, time === 5 ? 0.75 : 0.6); // contracted: the belly is bounded by half the span (0.5), and the dot is 3 radii across
  }
});
