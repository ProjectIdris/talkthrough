import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BufferGeometry, LineSegments, Mesh, Vector3 } from 'three';
import type { MeshPhysicalMaterial } from 'three';
import { validateScene } from '../src/scene/index.ts';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import { emptyFrame, evaluate, frameAt, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const meshOf = (panel: PanelScene, frame: Frame, id: string): Mesh => {
  let mesh: Mesh | undefined;
  panel.nodeOf(frame.objects.find(o => o.id === id)!.key)?.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
  assert.ok(mesh, id);
  return mesh;
};
const polygon = Array.from({ length: 32 }, (_, i) => [0.005 * Math.cos(i * Math.PI / 16), 0.005 * Math.sin(i * Math.PI / 16)]);
const uneven = [[3, 0, 0], [3, 0, 0], [3, 0.01, 0], [3, 2, 0], [3, 2.01, 0], [3, 2.01, 0]];

// Dropping sharing, any of the new builders, or independent mutable ownership breaks
// this real-scene check. Normal expectations come from cylinder/disk geometry, not another builder.
for (const tier of ['low', 'mid', 'high'] as const) {
  test(`${tier}: corrected primitives coexist with independent materials, reveals and exact-once ownership`, () => {
    const actions = [
      { op: 'add', shape: 'group', id: 'rig', rot: [15, 25, 10] },
      { op: 'scale', id: 'rig', to: [2, 0.8, 1.5], dur: 0 },
      ...['a', 'b'].flatMap((suffix, i) => [
        { op: 'add', shape: 'box', id: `box-${suffix}`, parent: 'rig', size: [0.01, 0.02, 0.03], ...(i ? { bevel: 0.001 } : {}), material: i ? 'glass' : 'metal', pos: [i, 0, 0] },
        { op: 'add', shape: 'cylinder', id: `cylinder-${suffix}`, parent: 'rig', size: [0.02, 0.04, 0.02], material: i ? 'plastic' : 'metal', pos: [i, 1, 0] },
        { op: 'add', shape: 'tube', id: `tube-${suffix}`, parent: 'rig', pts: uneven, radius: 0.01, flat: 0.6, swell: [[0, 0.5], [1, 1.5]], draw: i ? 0.75 : 0.25 },
        { op: 'add', shape: 'lathe', id: `lathe-${suffix}`, parent: 'rig', profile: [[0.005, -0.01], [0.005, 0.01]], material: i ? 'glass' : 'plastic' },
        { op: 'add', shape: 'extrude', id: `extrude-${suffix}`, parent: 'rig', outline: polygon, depth: 0.01, bevel: 0, material: i ? 'glass' : 'metal', edges: false },
      ]),
      { op: 'cut', id: 'box-a', axis: 'z', to: 0, dur: 0 },
      { op: 'cut', id: 'cylinder-a', axis: 'z', to: 0, dur: 0 },
      { op: 'cut', id: 'extrude-a', axis: 'z', to: 0, dur: 0 },
    ];
    const checked = validateScene({ v: 1, steps: [{ say: 'Mixed geometry.', actions }] });
    assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
    const first = frameAt(checked.scene.steps, 0, 99);
    const panel = new PanelScene({ tier });
    const disposals = new Map<BufferGeometry, number>();
    const track = (frame: Frame) => {
      for (const object of frame.objects) panel.nodeOf(object.key)?.traverse(o => {
        if (!(o instanceof Mesh || o instanceof LineSegments) || disposals.has(o.geometry)) return;
        disposals.set(o.geometry, 0);
        o.geometry.addEventListener('dispose', () => disposals.set(o.geometry, disposals.get(o.geometry)! + 1));
      });
    };
    try {
      panel.sync(first, 1);
      track(first);
      for (const shape of ['box', 'cylinder']) {
        const a = meshOf(panel, first, `${shape}-a`), b = meshOf(panel, first, `${shape}-b`);
        assert.equal(a.geometry, b.geometry, `${shape} shares corrected immutable geometry`);
        assert.notEqual(a.material, b.material);
        assert.ok((a.material as MeshPhysicalMaterial).clippingPlanes?.length);
        assert.equal((b.material as MeshPhysicalMaterial).clippingPlanes?.length ?? 0, 0);
      }
      const box = meshOf(panel, first, 'box-a');
      assert.equal(box.geometry.type, 'RoundedBoxGeometry');
      for (const child of box.children) if (child instanceof LineSegments) assert.equal(child.geometry.getAttribute('position').count, 0);
      for (const shape of ['tube', 'lathe', 'extrude']) assert.notEqual(meshOf(panel, first, `${shape}-a`).geometry, meshOf(panel, first, `${shape}-b`).geometry);
      const tube = meshOf(panel, first, 'tube-a').geometry;
      assert.equal(tube.userData.rings, 3 * DETAIL[tier].tube + 1);
      assert.ok(tube.drawRange.count < meshOf(panel, first, 'tube-b').geometry.drawRange.count);
      const middle = Math.floor(tube.userData.rings / 2) * (DETAIL[tier].radial + 1);
      assert.ok(tube.getAttribute('normal').getY(middle) < -0.001, 'corrected uneven taper has longitudinal normal slope');
      for (const shape of ['lathe', 'extrude']) {
        const geometry = meshOf(panel, first, `${shape}-a`).geometry;
        const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
        const start = shape === 'extrude' ? geometry.groups[1]!.start : 0;
        for (let i = start; i < p.count; i++) {
          const radial = shape === 'extrude' ? new Vector3(p.getX(i), p.getY(i), 0) : new Vector3(p.getX(i), 0, p.getZ(i));
          assert.ok(radial.normalize().dot(new Vector3().fromBufferAttribute(n, i)) > 0.99999, `${shape} smooth radial normal at ${i}`);
        }
      }
      for (let i = 0; i < 10; i++) panel.sync(first, 1);
      assert.ok([...disposals.values()].every(n => n === 0));
      const oldBox = box.geometry, oldCylinder = meshOf(panel, first, 'cylinder-a').geometry;
      const oldExtrude = meshOf(panel, first, 'extrude-a').geometry;
      const replacement = evaluate(planStep(first, { say: 'Replace one peer.', actions: [
        { op: 'add', shape: 'box', id: 'box-a', size: [0.02, 0.03, 0.04] },
        { op: 'add', shape: 'cylinder', id: 'cylinder-a', size: [0.03, 0.04, 0.03] },
        { op: 'add', shape: 'tube', id: 'tube-a', pts: [[0, 0, 0], [0, 1, 0]], radius: 0.02 },
        { op: 'add', shape: 'extrude', id: 'extrude-a', outline: [[0, 0], [1, 0], [0, 1]], depth: 0.02, bevel: 0 },
      ] } as Step), 99);
      panel.sync(replacement, 1); track(replacement);
      assert.equal(disposals.get(oldBox), 0, 'the box peer still owns the shared buffer');
      assert.equal(disposals.get(oldCylinder), 0, 'the cylinder peer still owns the shared buffer');
      assert.equal(disposals.get(tube), 1, 'mutable tube replacement releases its own buffer');
      assert.equal(disposals.get(oldExtrude), 1, 'extrusion replacement releases its own buffer');
      panel.sync(emptyFrame(), 1);
      assert.equal(panel.count(), 0);
      assert.ok([...disposals.values()].every(n => n === 1), 'every tracked node geometry is disposed exactly once');
      panel.destroy();
      assert.ok([...disposals.values()].every(n => n === 1), 'repeated teardown never disposes a buffer twice');
    } finally { panel.destroy(); }
  });
}

test('named-anchor parts retain their dispatch while attached compact primitives share geometry', () => {
  const checked = validateScene({ steps: [{ say: 'A mounted assembly.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [3, 0.8, 1.2], rot: [20, 30, 10] },
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [2, 0.4, 0.4], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom' },
    { op: 'add', shape: 'box', id: 'a', size: [0.01, 0.02, 0.03], parent: 'base' },
    { op: 'add', shape: 'box', id: 'b', size: [0.01, 0.02, 0.03], parent: 'child' },
    { op: 'move', id: 'base', to: [2, 1, -3], at: 1, dur: 2 },
    { op: 'scale', id: 'base', to: [1.5, 0.7, 2], at: 1, dur: 2 },
  ] }] });
  assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
  const panel = new PanelScene();
  try {
    for (const time of [0, 1.5, 3, 0.5]) {
      const frame = frameAt(checked.scene.steps, 0, time); panel.sync(frame, 1);
      const node = (id: string) => panel.nodeOf(frame.objects.find(o => o.id === id)!.key)!;
      const top = node('base').localToWorld(new Vector3(0, 1.5, 0));
      const bottom = node('child').localToWorld(new Vector3(0, -1, 0));
      assert.ok(top.distanceTo(bottom) < 1e-8, `mounted sockets at ${time}`);
      assert.equal(meshOf(panel, frame, 'a').geometry, meshOf(panel, frame, 'b').geometry);
    }
  } finally { panel.destroy(); }
});


test('combined native fixture validates unchanged and can scrub, clear and rebuild on every tier', () => {
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/geometry-integration.json', import.meta.url), 'utf8'));
  const checked = validateScene(raw);
  assert.deepEqual(checked.issues, []); assert.deepEqual(checked.scene, raw);
  assert.ok(checked.scene);
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    try {
      for (const step of [0, 1, 2, 3, 4, 1, 0, 3, 4]) {
        const frame = frameAt(checked.scene.steps, step, 3);
        panel.sync(frame, 1); panel.sync(frame, 1);
        assert.equal(panel.count(), step === 3 ? 0 : 18);
      }
    } finally { panel.destroy(); }
  }
});
