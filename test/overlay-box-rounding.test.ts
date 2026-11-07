import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, BufferGeometry, LineSegments, Mesh, Vector3 } from 'three';
import { boxGeometry, defaultBevel, DETAIL } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Vec3, Step } from '../src/scene/index.ts';

const tiers = ['low', 'mid', 'high'] as const;
function near(actual: number, expected: number, tolerance = 2e-6): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be ${expected} ± ${tolerance}`);
}

// The surface of a rounded box is offset by radius from the inner box.
// Its outward normal is the normalized vector from the closest inner-box point.
function roundedSurface(geo: BufferGeometry, size: Vec3, radius: number): void {
  const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal');
  let curved = 0;
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const delta = p.map((v, j) => v - Math.max(-size[j]! / 2 + radius, Math.min(size[j]! / 2 - radius, v)));
    near(Math.hypot(...delta) / radius, 1, 0.003);
    const n = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    near(Math.hypot(...n), 1);
    const projection = delta.reduce((sum, v, j) => sum + v * n[j]!, 0) / radius;
    assert.ok(projection > 0.999, `normal follows rounded surface: ${projection}`);
    if (n.filter(v => Math.abs(v) > 0.1).length >= 2) curved++;
  }
  assert.ok(curved > 0, 'curved corners exist rather than only six flat faces');
}

test('default rounding survives at the smallest authored box size and on thin panels', () => {
  for (const tier of tiers) for (const size of [[0.01, 0.01, 0.01], [3, 2, 0.01], [0.02, 0.06, 0.04]] as Vec3[]) {
    const geo = boxGeometry(size, defaultBevel(size), DETAIL[tier]);
    try { roundedSurface(geo, size, Math.min(...size) * 0.1); }
    finally { geo.dispose(); }
  }
});

test('proportional explicit bevels keep the same silhouette, normals and topology across scales', () => {
  for (const tier of tiers) {
    const reference = boxGeometry([1, 2, 3], 0.1, DETAIL[tier]);
    try {
      for (const scale of [0.01, 0.02, 0.1, 1, 10]) {
        const geo = boxGeometry([scale, scale * 2, scale * 3], scale * 0.1, DETAIL[tier]);
        try {
          assert.equal(geo.getAttribute('position').count, reference.getAttribute('position').count);
          for (let i = 0; i < geo.getAttribute('position').array.length; i++) {
            near(geo.getAttribute('position').array[i]! / scale, reference.getAttribute('position').array[i]!);
            near(geo.getAttribute('normal').array[i]!, reference.getAttribute('normal').array[i]!);
          }
        } finally { geo.dispose(); }
      }
    } finally { reference.dispose(); }
  }
});

test('maximum rounding retains a proportional flat seam instead of an absolute inset', () => {
  for (const tier of tiers) {
    const reference = boxGeometry([1, 2, 3], 20, DETAIL[tier]);
    const compact = boxGeometry([0.01, 0.02, 0.03], 20, DETAIL[tier]);
    try {
      assert.equal(compact.getAttribute('position').count, reference.getAttribute('position').count);
      for (let i = 0; i < compact.getAttribute('position').array.length; i++) {
        near(compact.getAttribute('position').array[i]! * 100, reference.getAttribute('position').array[i]!);
      }
    } finally { reference.dispose(); compact.dispose(); }
  }
});

test('zero bevel stays an exact inexpensive sharp box at every size and tier', () => {
  for (const tier of tiers) for (const size of [[0.01, 0.02, 0.03], [1, 2, 3], [100, 20, 50]] as Vec3[]) {
    const geo = boxGeometry(size, 0, DETAIL[tier]);
    const reference = new BoxGeometry(...size);
    try {
      for (const name of ['position', 'normal', 'uv']) assert.deepEqual(geo.getAttribute(name).array, reference.getAttribute(name).array);
      assert.deepEqual(geo.index!.array, reference.index!.array);
    } finally { geo.dispose(); reference.dispose(); }
  }
});

test('a compact rounded box stays rounded after the real scene applies nested enlargement', () => {
  const steps: Step[] = [{ say: 'x', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'add', shape: 'group', id: 'assembly', rot: [20, 30, 10] },
    { op: 'scale', id: 'assembly', to: [10, 10, 10], dur: 0 },
    { op: 'add', shape: 'box', id: 'small', parent: 'assembly', size: [0.01, 0.02, 0.03], color: 'blue', edges: false },
    { op: 'scale', id: 'small', to: [10, 10, 10], dur: 0 },
  ] }];
  const frame = frameAt(steps, 0, 99);
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      const mesh = panel.nodeOf(frame.objects.find(o => o.id === 'small')!.key) as Mesh;
      roundedSurface(mesh.geometry, [0.01, 0.02, 0.03], 0.001);
      const world = mesh.getWorldScale(new Vector3());
      near(world.x, 100); near(world.y, 100); near(world.z, 100);
    } finally { panel.destroy(); }
  }
});

test('bounded bevels preserve centered dimensions, finite UVs and unit normals across the authored size range', () => {
  for (const tier of tiers) for (const size of [[0.01, 0.01, 0.01], [100, 0.01, 20], [0.01, 100, 100], [100, 100, 100], [0.011, 0.026, 0.013]] as Vec3[]) {
    for (const radius of [0, 1e-12, Math.min(...size) * 0.1, 20]) {
      const geo = boxGeometry(size, radius, DETAIL[tier]);
      try {
        geo.computeBoundingBox();
        const min = geo.boundingBox!.min.toArray(), max = geo.boundingBox!.max.toArray();
        for (let j = 0; j < 3; j++) {
          near(min[j]! / size[j]!, -0.5);
          near(max[j]! / size[j]!, 0.5);
        }
        for (const name of ['position', 'normal', 'uv']) {
          assert.ok(Array.from(geo.getAttribute(name).array).every(Number.isFinite), `${name} is finite`);
        }
        const n = geo.getAttribute('normal');
        for (let i = 0; i < n.count; i++) near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1);
        // Same maximum per-tier geometry as the already supported rounded unit box.
        assert.ok(geo.getAttribute('position').count <= 36 * (2 * DETAIL[tier].bevel + 1) ** 2);
      } finally { geo.dispose(); }
    }
  }
});

test('negligible relative rounding keeps the sharp-box path instead of allocating invisible detail', () => {
  for (const tier of tiers) for (const size of [[0.01, 0.01, 0.01], [1, 2, 3], [100, 100, 100]] as Vec3[]) {
    const geo = boxGeometry(size, Math.min(...size) * 1e-8, DETAIL[tier]);
    try { assert.equal(geo.getAttribute('position').count, 24); }
    finally { geo.dispose(); }
  }
});

test('repeated sync, replacement and clear retain rounded meshes and release them exactly once', () => {
  const steps: Step[] = [
    { say: 'x', actions: [
      { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
      { op: 'add', shape: 'box', id: 'a', size: [0.01, 0.02, 0.03] },
      { op: 'add', shape: 'box', id: 'b', size: [0.01, 0.02, 0.03], pos: [0.04, 0, 0] },
      { op: 'cut', id: 'a', axis: 'z', to: 0, dur: 0 },
    ] },
    { say: 'replace', actions: [{ op: 'add', shape: 'box', id: 'a', size: [0.02, 0.03, 0.04], bevel: 0.002 }] },
    { say: 'clear', actions: [{ op: 'clear', target: 'all' }] },
  ];
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      const first = frameAt(steps, 0, 99), next = frameAt(steps, 1, 99), empty = frameAt(steps, 2, 99);
      panel.sync(first, 1);
      const original = panel.nodeOf(first.objects.find(o => o.id === 'a')!.key) as Mesh;
      roundedSurface(original.geometry, [0.01, 0.02, 0.03], 0.001);
      const peer = panel.nodeOf(first.objects.find(o => o.id === 'b')!.key) as Mesh;
      assert.equal(peer.geometry, original.geometry, 'identical compact boxes share their immutable surface');
      let oldDisposed = 0;
      original.geometry.addEventListener('dispose', () => oldDisposed++);
      for (let i = 0; i < 20; i++) panel.sync(first, 1);
      assert.equal(oldDisposed, 0);
      assert.equal((panel.nodeOf(first.objects.find(o => o.id === 'a')!.key) as Mesh).geometry, original.geometry);
      panel.sync(next, 1);
      assert.equal(oldDisposed, 0, 'the surviving peer still owns the original surface');
      assert.equal((panel.nodeOf(next.objects.find(o => o.id === 'b')!.key) as Mesh).geometry, original.geometry);
      const replacement = panel.nodeOf(next.objects.find(o => o.id === 'a')!.key) as Mesh;
      roundedSurface(replacement.geometry, [0.02, 0.03, 0.04], 0.002);
      let freshDisposed = 0;
      replacement.geometry.addEventListener('dispose', () => freshDisposed++);
      panel.sync(empty, 1);
      assert.equal(oldDisposed, 1, 'clearing the final peer releases the shared surface once');
      assert.equal(freshDisposed, 1);
      panel.destroy();
      assert.equal(oldDisposed, 1);
      assert.equal(freshDisposed, 1);
    } finally { panel.destroy(); }
  }
});

test('explicit bevels below position precision avoid collapsed or reversed triangles on wide thin boxes', () => {
  for (const tier of tiers) for (const size of [[100, 100, 0.01], [100, 0.01, 100], [0.01, 100, 100]] as Vec3[]) {
    for (const bevel of [1e-6, 1e-5]) {
      const geo = boxGeometry(size, bevel, DETAIL[tier]);
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
      try {
        const count = geo.index?.count ?? p.count;
        for (let i = 0; i < count; i += 3) {
          const indices = [i, i + 1, i + 2].map(j => geo.index ? geo.index.getX(j) : j);
          const vertices = indices.map(j => new Vector3().fromBufferAttribute(p, j));
          const normal = new Vector3().subVectors(vertices[1]!, vertices[0]!).cross(new Vector3().subVectors(vertices[2]!, vertices[0]!));
          assert.ok(normal.lengthSq() > 0, `${tier} ${size}: collapsed triangle at ${i}`);
          const smooth = indices.reduce((sum, j) => sum.add(new Vector3().fromBufferAttribute(n, j)), new Vector3());
          assert.ok(normal.dot(smooth) > 0, `${tier} ${size}: reversed triangle at ${i}`);
        }
      } finally { geo.dispose(); }
    }
  }
});

test('compact example is accepted unchanged and retains matching enlarged silhouettes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { validateScene } = await import('../src/scene/index.ts');
  const scene = JSON.parse(await readFile(new URL('../samples/scenes/compact-rounded-boxes.json', import.meta.url), 'utf8'));
  const checked = validateScene(scene);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.issues, []);
  assert.deepEqual(checked.scene, scene);
  const frame = frameAt(checked.scene!.steps, 0, 99);
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      for (const name of ['housing', 'plate', 'round']) {
        const full = panel.nodeOf(frame.objects.find(o => o.id === `${name}-full`)!.key) as Mesh;
        const small = panel.nodeOf(frame.objects.find(o => o.id === `${name}-small`)!.key) as Mesh;
        const largePos = full.geometry.getAttribute('position'), smallPos = small.geometry.getAttribute('position');
        assert.equal(smallPos.count, largePos.count);
        const scale = small.getWorldScale(new Vector3());
        for (let i = 0; i < largePos.count; i++) {
          near(smallPos.getX(i) * scale.x, largePos.getX(i));
          near(smallPos.getY(i) * scale.y, largePos.getY(i));
          near(smallPos.getZ(i) * scale.z, largePos.getZ(i));
        }
      }
    } finally { panel.destroy(); }
  }
});


test('rounded boxes have no false crease lines while sharp boxes keep their outlines', () => {
  const steps: Step[] = [{ say: 'x', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'add', shape: 'box', id: 'default', size: [0.01, 0.01007, 0.01007] },
    { op: 'add', shape: 'box', id: 'explicit', size: [0.01, 0.01, 0.01], bevel: 0.0001 },
    { op: 'add', shape: 'box', id: 'wide', size: [100, 100, 0.01], bevel: 0.0001001 },
    { op: 'add', shape: 'box', id: 'sharp', size: [0.01, 0.01, 0.01], bevel: 0 },
  ] }];
  const frame = frameAt(steps, 0, 99);
  for (const tier of ['mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      for (const id of ['default', 'explicit', 'wide', 'sharp']) {
        const mesh = panel.nodeOf(frame.objects.find(o => o.id === id)!.key) as Mesh;
        const lines = mesh.children.find(o => o instanceof LineSegments) as LineSegments;
        assert.ok(lines, 'ordinary outline lifecycle remains present');
        assert.equal(lines.geometry.getAttribute('position')?.count ?? 0, id === 'sharp' ? 24 : 0, `${tier}: ${id}`);
      }
    } finally { panel.destroy(); }
  }
});

test('kit pieces use the same smooth rounded-box outline rule without retaining temporary geometry', () => {
  const steps: Step[] = [{ say: 'x', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'add', shape: 'part', part: 'chip', id: 'chip', size: [0.01, 0.01007, 0.01007] },
  ] }];
  const frame = frameAt(steps, 0, 99);
  for (const tier of ['mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      let rounded = 0, outlines = 0;
      panel.nodeOf(frame.objects.find(o => o.id === 'chip')!.key)!.traverse(o => {
        if (o instanceof Mesh && o.geometry.type === 'RoundedBoxGeometry') {
          rounded++;
          for (const child of o.children) if (child instanceof LineSegments) {
            outlines++;
            assert.equal(child.geometry.getAttribute('position').count, 0);
            assert.equal('parameters' in child.geometry, false, 'no retained edge input');
          }
        }
      });
      assert.ok(rounded > 0);
      assert.equal(outlines, rounded);
    } finally { panel.destroy(); }
  }
});
