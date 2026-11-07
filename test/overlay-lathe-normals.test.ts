import test from 'node:test';
import assert from 'node:assert/strict';
import { LatheGeometry, Mesh, Vector2, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Action, Scene } from '../src/scene/types.ts';
import { latheGeometry, roundedCylinderGeometry } from '../src/overlay/geometry.ts';
import type { Vec2 } from '../src/scene/types.ts';

const near = (actual: number, expected: number, why: string, tolerance = 2e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${why}: ${actual} != ${expected}`);
const normal = (g: ReturnType<typeof latheGeometry>, i: number) => new Vector3().fromBufferAttribute(g.getAttribute('normal'), i);

// A cylinder's radial normal is independent of which triangle touches its corner.
test('round lathe walls have radial normals without a diagonal lighting bias', () => {
  for (const sides of [9, 20, 36, 64, 96]) {
    const g = latheGeometry([[1, -2], [1, 2]], sides);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const n = normal(g, i), length = Math.hypot(p.getX(i), p.getZ(i));
      near(n.x, p.getX(i) / length, `x at ${sides}/${i}`);
      near(n.y, 0, `y at ${sides}/${i}`);
      near(n.z, p.getZ(i) / length, `z at ${sides}/${i}`);
    }
    g.dispose();
  }
});

test('profile normals do not merge nearby surfaces when a lathe is small', () => {
  const profile: Vec2[] = [[0, -1], [0.8, -1], [1, -0.8], [1, 0.7], [0.7, 1], [0, 1]];
  const reference = latheGeometry(profile, 36);
  for (const scale of [1e-6, 0.001, 0.1, 20]) {
    const g = latheGeometry(profile.map(([r, y]) => [r * scale, y * scale]), 36);
    const normals = g.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) near(normal(g, i).distanceTo(normal(reference, i)), 0, `scale ${scale}/${i}`);
    g.dispose();
  }
  reference.dispose();
});

test('a sharp lathe shoulder keeps the cap flat and the side radial', () => {
  const g = latheGeometry([[0, -1], [1, -1], [1, 1], [0, 1]], 36);
  for (let sector = 0; sector < 36; sector++) {
    for (let i = 0; i < 6; i++) {
      near(normal(g, sector * 18 + i).y, -1, 'bottom cap');
      near(normal(g, sector * 18 + 6 + i).y, 0, 'cylinder wall');
      near(normal(g, sector * 18 + 12 + i).y, 1, 'top cap');
    }
  }
  g.dispose();
});

test('a faceted lathe keeps each circumferential face planar', () => {
  for (const sides of [3, 4, 6, 8]) {
    const g = latheGeometry([[1, -1], [0.6, 1]], sides);
    const p = g.getAttribute('position');
    for (let sector = 0; sector < sides; sector++) {
      const base = sector * 6;
      const a = new Vector3().fromBufferAttribute(p, base), b = new Vector3().fromBufferAttribute(p, base + 1), c = new Vector3().fromBufferAttribute(p, base + 2);
      const outward = b.sub(a).cross(c.sub(a)).normalize();
      for (let i = 0; i < 6; i++) near(normal(g, base + i).distanceTo(outward), 0, `facet ${sides}/${sector}/${i}`);
    }
    g.dispose();
  }
});

test('normal correction preserves the lathe triangle positions, winding and UVs', () => {
  const profile: Vec2[] = [[0, -1], [0.7, -1], [1, -0.7], [0.8, 0.5], [0.4, 1], [0, 1]];
  for (const sides of [3, 8, 9, 20, 36, 64]) {
    const original = new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), sides).toNonIndexed();
    const g = latheGeometry(profile, sides);
    assert.equal(g.index, null);
    assert.deepEqual(g.getAttribute('position').array, original.getAttribute('position').array);
    assert.deepEqual(g.getAttribute('uv').array, original.getAttribute('uv').array);
    g.dispose(); original.dispose();
  }
});

test('rounded cylinders keep finite unit normals on small and elliptic bodies', () => {
  for (const size of [[1e-4, 2e-4, 1e-4], [2, 5, 0.3], [6, 0.02, 4]]) {
    for (const sides of [20, 36, 64]) {
      const g = roundedCylinderGeometry(size[0]!, size[1]!, size[2]!, sides);
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) near(normal(g, i).length(), 1, `unit at ${size}/${sides}/${i}`);
      g.dispose();
    }
  }
});

test('gentle profile bends share the angle bisector, while sharp bends stay split', () => {
  // The middle joint turns 45 degrees, below the round-form 0.9-radian crease limit.
  const g = latheGeometry([[1, -1], [1, 0], [0.5, 0.5]], 36);
  const left = normal(g, 2), right = normal(g, 6);
  near(left.distanceTo(right), 0, 'continuous joint');
  near(left.y, Math.sin(Math.PI / 8), 'equal-angle vertical component');
  near(left.z, Math.cos(Math.PI / 8), 'equal-angle radial component');
  g.dispose();
});

test('closed profiles shade continuously at their explicit join and through duplicate points', () => {
  const profile: Vec2[] = Array.from({ length: 17 }, (_, i) => {
    const theta = i % 16 / 16 * Math.PI * 2;
    return [1 + 0.25 * Math.cos(theta), 0.25 * Math.sin(theta)];
  });
  // Follow the section clockwise so its boundary normals point out.
  profile.reverse();
  const g = latheGeometry(profile, 36), count = profile.length - 1;
  for (let sector = 0; sector < 36; sector++) {
    near(normal(g, sector * count * 6).distanceTo(normal(g, (sector * count + count - 1) * 6 + 2)), 0, 'profile join');
    const nextSector = (sector + 1) % 36;
    for (let j = 0; j < count; j++) near(normal(g, (sector * count + j) * 6 + 1).distanceTo(normal(g, (nextSector * count + j) * 6)), 0, 'angular seam');
  }
  g.dispose();
  for (const p of [
    [[1, -1], [1, -1], [1, 1], [1, 1]],
    [[0, 0], [0, 0], [0, 0]],
    [[1, -1], [1, 0], [1, 0], [0.5, 0.5]],
    [[-1, -1], [-1, 1]],
  ] as Vec2[][]) {
    const duplicate = latheGeometry(p, 36);
    for (let i = 0; i < duplicate.getAttribute('normal').count; i++) near(normal(duplicate, i).length(), 1, 'duplicate finite unit normal');
    duplicate.dispose();
  }
});

test('hollow, reversed and repeated profiles keep normals facing their drawable triangles', () => {
  const profiles: Vec2[][] = [
    [[0.7, -1], [1, -1], [1, 1], [0.7, 1], [0.7, -1]],
    [[0, -1], [1, -1], [1, 0.5], [0.5, 1], [0, 1]],
    [[1, -1], [1, -1], [1, 0], [0.5, 0.5], [0, 0.5]],
  ];
  for (const profile of profiles) for (const p of [profile, [...profile].reverse()]) for (const sides of [3, 8, 9, 20, 36, 64]) {
    const g = latheGeometry(p, sides), positions = g.getAttribute('position');
    for (let i = 0; i < positions.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(positions, i), b = new Vector3().fromBufferAttribute(positions, i + 1), c = new Vector3().fromBufferAttribute(positions, i + 2);
      const face = b.sub(a).cross(c.sub(a));
      if (face.lengthSq() < 1e-20) continue;
      face.normalize();
      for (let j = 0; j < 3; j++) assert.ok(face.dot(normal(g, i + j)) > 0.5, `outward ${sides}/${i + j}`);
    }
    g.dispose();
  }
});


test('lathe shading survives PanelScene transforms, copies, replacement and disposal at every tier', () => {
  const actions: Action[] = [
    { op: 'add', shape: 'group', id: 'assembly', pos: [2, 1, -1], rot: [20, 30, 10] },
    { op: 'add', shape: 'lathe', id: 'body', parent: 'assembly', profile: [[1, -1], [1, 1]], color: 'blue' },
    { op: 'scale', id: 'body', to: [1.5, 0.7, 0.5] },
    { op: 'add', shape: 'array', id: 'copies', of: 'body', count: 3, step: [2, 0, 0] },
  ];
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    const first = frameAt([{ say: '', actions }], 0, 99);
    panel.sync(first, 1.4);
    const body = panel.nodeOf(first.objects.find(o => o.id === 'body')!.key) as Mesh;
    assert.ok(body instanceof Mesh);
    const expected = latheGeometry([[1, -1], [1, 1]], { low: 20, mid: 36, high: 64 }[tier]);
    assert.deepEqual(body.geometry.getAttribute('normal').array, expected.getAttribute('normal').array);
    const copies = first.objects.filter(o => o.id !== 'body' && o.shape !== 'group');
    assert.equal(copies.length, 2, 'count includes the source plus two copies');
    for (const copy of copies) {
      const mesh = panel.nodeOf(copy.key) as Mesh;
      assert.deepEqual(mesh.geometry.getAttribute('normal').array, body.geometry.getAttribute('normal').array);
    }
    let released = 0;
    body.geometry.addEventListener('dispose', () => released++);
    panel.sync(first, 1.4);
    assert.equal(released, 0, 'unchanged frame retains the live body');
    const replacement = frameAt([{ say: '', actions: [
      ...actions,
      { op: 'add', shape: 'lathe', id: 'body', profile: [[0.5, -1], [1, 1]], color: 'red' },
    ] }], 0, 99);
    panel.sync(replacement, 1.4);
    assert.equal(released, 1, 'replacement releases the old geometry');
    panel.destroy();
    assert.equal(released, 1, 'teardown does not release it twice');
    expected.dispose();
  }
});

test('the hand-written lathe surface example validates unchanged and builds on every tier', () => {
  const input: Scene = JSON.parse(readFileSync(new URL('../samples/scenes/lathe-surfaces.json', import.meta.url), 'utf8'));
  const checked = validateScene(input);
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  assert.deepEqual(checked.scene, input);
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    for (let step = 0; step < input.steps.length; step++) {
      panel.sync(frameAt(input.steps, step, 99), 1.4);
      panel.scene.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const normals = object.geometry.getAttribute('normal');
        if (normals) for (let i = 0; i < normals.count; i++) near(new Vector3().fromBufferAttribute(normals, i).length(), 1, 'sample normal');
      });
    }
    panel.destroy();
  }
});

test('smooth rounded poles share one axial normal across all drawable triangles', () => {
  const profile: Vec2[] = Array.from({ length: 9 }, (_, i) => {
    const angle = i / 8 * Math.PI;
    return [i === 0 || i === 8 ? 0 : Math.sin(angle), -Math.cos(angle)];
  });
  const g = latheGeometry(profile, 36), positions = g.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    if (positions.getX(i) !== 0 || positions.getZ(i) !== 0) continue;
    const n = normal(g, i);
    near(n.x, 0, 'pole x'); near(n.z, 0, 'pole z');
    near(n.y, Math.sign(positions.getY(i)), 'pole y');
  }
  g.dispose();
});

test('zero-area axis spans do not influence adjacent drawable profile surfaces', () => {
  const cone = latheGeometry([[0, 0], [1, 1]], 36);
  const extended = latheGeometry([[0, -1], [0, 0], [1, 1]], 36);
  for (let sector = 0; sector < 36; sector++) for (let i = 0; i < 6; i++) {
    near(normal(cone, sector * 6 + i).distanceTo(normal(extended, sector * 12 + 6 + i)), 0, 'visible cone unaffected by axis span');
  }
  cone.dispose(); extended.dispose();
});
