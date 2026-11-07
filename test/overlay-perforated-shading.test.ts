import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix3, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial } from 'three';
import { DETAIL, extrudeGeometry } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, frameAt, planStep } from '../src/overlay/timeline.ts';
import { createDetailState, createSceneState, validateScene } from '../src/scene/index.ts';
import type { Vec2 } from '../src/scene/types.ts';

const tiers = ['low', 'mid', 'high'] as const;
type Ring = { centre: Vec2; radius: number; inward?: boolean; points: number };
const polygon = ({ centre: [x, y], radius, points }: Ring): Vec2[] => Array.from({ length: points }, (_, i) => [
  x + radius * Math.cos(i * 2 * Math.PI / points), y + radius * Math.sin(i * 2 * Math.PI / points),
]);
const near = (a: number, b: number, tolerance = 1e-5): void => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

// Removing hole-path smoothing fails the radial checks. Wrong winding, smoothing
// across a cap or joining nearby walls fails the independent direction checks.
function radialWalls(geo: BufferGeometry, rings: Ring[], matrix = new Matrix3()): void {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const walls = geo.groups[1]!;
  const seen = rings.map(() => 0);
  for (let i = walls.start; i < walls.start + walls.count; i++) {
    const errors = rings.map(r => Math.abs(Math.hypot(p.getX(i) - r.centre[0], p.getY(i) - r.centre[1]) - r.radius));
    const ringIndex = errors.indexOf(Math.min(...errors));
    const ring = rings[ringIndex]!;
    assert.ok(errors[ringIndex]! < ring.radius * 1e-5);
    const expected = new Vector3(p.getX(i) - ring.centre[0], p.getY(i) - ring.centre[1], 0);
    if (ring.inward) expected.negate();
    expected.applyNormalMatrix(matrix);
    const normal = new Vector3().fromBufferAttribute(n, i);
    near(normal.length(), 1);
    normal.applyNormalMatrix(matrix);
    near(normal.x, expected.x); near(normal.y, expected.y); near(normal.z, expected.z);
    seen[ringIndex]!++;
  }
  assert.ok(seen.every(count => count > 0));
  const caps = geo.groups[0]!;
  for (let i = caps.start; i < caps.start + caps.count; i++) {
    near(n.getX(i), 0); near(n.getY(i), 0); near(n.getZ(i), Math.sign(p.getZ(i)));
  }
}

test('round perforated walls shade radially on both sides while cap boundaries stay sharp', () => {
  const rings: Ring[] = [
    { centre: [0, 0], radius: 2, points: 32 },
    { centre: [0, 0], radius: 1, points: 24, inward: true },
  ];
  for (const tier of tiers) for (const reverseOuter of [false, true]) for (const reverseHole of [false, true]) for (const close of [false, true]) {
    const ring = (r: Ring, reverse: boolean): Vec2[] => {
      const points = polygon(r);
      if (reverse) points.reverse();
      return close ? [...points, points[0]!] : points;
    };
    const geo = extrudeGeometry(ring(rings[0]!, reverseOuter), 0.8, 0.2, DETAIL[tier], [ring(rings[1]!, reverseHole)]);
    try { radialWalls(geo, rings); } finally { geo.dispose(); }
  }
});

test('compact nearby inner and outer walls keep opposite normals at every tier', () => {
  for (const tier of tiers) for (const scale of [0.0001, 0.005, 1, 10]) {
    const rings: Ring[] = [
      { centre: [scale * 0.13, scale * -0.19], radius: scale, points: 24 },
      { centre: [scale * 0.13, scale * -0.19], radius: scale * 0.99, points: 24, inward: true },
    ];
    const geo = extrudeGeometry(polygon(rings[0]!), scale, 0, DETAIL[tier], [polygon(rings[1]!)]);
    try { radialWalls(geo, rings); } finally { geo.dispose(); }
  }
});

test('the maximum 128-point curved profile keeps each opening independently lit', () => {
  const rings: Ring[] = [{ centre: [0, 0], radius: 5, points: 32 },
    ...([[-2, -2], [2, -2], [-2, 2], [2, 2]] as Vec2[]).map(centre => ({ centre, radius: 1, points: 24, inward: true }))];
  const outline = polygon(rings[0]!), holes = rings.slice(1).map(polygon);
  const source = { v: 1, steps: [{ say: 'Four openings.', actions: [{ op: 'add', shape: 'extrude', id: 'plate', outline, holes, depth: 1 }] }] };
  assert.deepEqual(validateScene(source).issues, []);
  for (const tier of tiers) {
    const geo = extrudeGeometry(outline, 1, 0, DETAIL[tier], holes);
    try { radialWalls(geo, rings); } finally { geo.dispose(); }
  }
});

test('faceted holes keep their authored sharp corners instead of becoming round', () => {
  const outer: Vec2[] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  for (const points of [3, 4, 6, 8]) for (const tier of tiers) {
    const geo = extrudeGeometry(outer, 1, 0, DETAIL[tier], [polygon({ centre: [0, 0], radius: 1, points })]);
    try {
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
      for (let i = 0; i < p.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(p, i);
        const face = new Vector3().fromBufferAttribute(p, i + 1).sub(a).cross(new Vector3().fromBufferAttribute(p, i + 2).sub(a)).normalize();
        for (let j = 0; j < 3; j++) near(new Vector3().fromBufferAttribute(n, i + j).dot(face), 1);
      }
    } finally { geo.dispose(); }
  }
});

test('real perforated scenes preserve lighting through transforms, cuts, reuse and replacement', () => {
  const rings: Ring[] = [
    { centre: [0, 0], radius: 0.01, points: 32 },
    { centre: [0, 0], radius: 0.006, points: 24, inward: true },
  ];
  const source = { v: 1, steps: [{ say: 'Hollow body.', actions: [
    { op: 'add', shape: 'group', id: 'parent', rot: [20, 30, 10] },
    { op: 'scale', id: 'parent', to: [100, 80, 60], dur: 0 },
    ...['a', 'b'].map((id, i) => ({ op: 'add', shape: 'extrude', id, parent: 'parent', outline: polygon(rings[0]!), holes: [polygon(rings[1]!)], depth: 0.02, edges: false, material: i ? 'glass' : 'metal' })),
    { op: 'cut', id: 'a', axis: 'z', to: 0, dur: 0 },
  ] }] };
  const state = createSceneState();
  const checked = validateScene(source, state); assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
  const detail = validateScene({ v: 1, steps: [{ say: 'Replace one.', actions: [{ op: 'add', shape: 'box', id: 'a', size: [1, 1, 1] }] }] }, createDetailState(state));
  assert.deepEqual(detail.issues, []); assert.ok(detail.scene);
  const first = frameAt(checked.scene.steps, 0, 99), replacement = evaluate(planStep(first, detail.scene.steps[0]!), 99);
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(first, 1);
      const node = (id: string) => panel.nodeOf(first.objects.find(o => o.id === id)!.key) as Mesh;
      const a = node('a'), b = node('b');
      radialWalls(a.geometry, rings, new Matrix3().getNormalMatrix(a.matrixWorld));
      assert.notEqual(a.geometry, b.geometry); assert.notEqual(a.material, b.material);
      assert.ok((a.material as MeshPhysicalMaterial).clippingPlanes?.length);
      assert.equal((b.material as MeshPhysicalMaterial).clippingPlanes?.length ?? 0, 0);
      let disposedA = 0, disposedB = 0;
      a.geometry.addEventListener('dispose', () => disposedA++);
      b.geometry.addEventListener('dispose', () => disposedB++);
      for (let i = 0; i < 12; i++) panel.sync(first, 1);
      assert.equal(node('a').geometry, a.geometry); assert.equal(disposedA, 0); assert.equal(disposedB, 0);
      panel.sync(replacement, 1); assert.equal(disposedA, 1); assert.equal(disposedB, 0);
      radialWalls(b.geometry, rings);
      panel.sync(emptyFrame(), 1); assert.equal(disposedB, 1);
      panel.destroy(); assert.equal(disposedA, 1); assert.equal(disposedB, 1);
    } finally { panel.destroy(); }
  }
});

test('the authored perforated sample validates unchanged and scaled rings shade alike', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = JSON.parse(await readFile(new URL('../samples/scenes/perforated-shading.json', import.meta.url), 'utf8'));
  const checked = validateScene(source);
  assert.ok(checked.scene); assert.deepEqual(checked.issues, []); assert.deepEqual(checked.scene, source);
  const frame = frameAt(checked.scene.steps, 0, 99);
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      const ring = (id: string) => panel.nodeOf(frame.objects.find(o => o.id === id)!.key) as Mesh;
      const full = ring('round-full'), small = ring('round-small');
      const a = full.geometry.getAttribute('position'), b = small.geometry.getAttribute('position');
      const an = full.geometry.getAttribute('normal'), bn = small.geometry.getAttribute('normal');
      assert.equal(a.count, b.count);
      for (let i = 0; i < a.count; i++) {
        for (const coordinate of ['getX', 'getY', 'getZ'] as const) {
          near(a[coordinate](i), b[coordinate](i) * 100);
          near(an[coordinate](i), bn[coordinate](i), 2e-5);
        }
      }
    } finally { panel.destroy(); }
  }
});
