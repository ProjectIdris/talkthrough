import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Mesh, Vector3 } from 'three';
import { DETAIL, drawFraction, samplePath, tubeGeometry } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Vec3 } from '../src/scene/types.ts';

const path: Vec3[] = [[0, 0, 0], [0, 1, 0], [0, 2, 0]];

test('a widening tube shades perpendicular to its sloped sides, including flattened sections', () => {
  // Radius grows from 1 to 2 over a length of 2. At the central ring,
  // the hand-derived side slopes are 0.5 along x and 0.5 * flat along z.
  for (const flat of [1, 0.55, 0.2]) {
    const g = tubeGeometry(path, 1, flat, 16, [[0, 1], [1, 2]]);
    const n = g.getAttribute('normal');
    const wantWide = new Vector3(1, -0.5, 0).normalize();
    const wantThin = new Vector3(0, -0.5 * flat, 1).normalize();
    assert.ok(new Vector3().fromBufferAttribute(n, 17).distanceTo(wantWide) < 1e-6, `wide side flat=${flat}`);
    assert.ok(new Vector3().fromBufferAttribute(n, 17 + 4).distanceTo(wantThin) < 1e-6, `thin side flat=${flat}`);
    g.dispose();
  }
});

test('elliptical tube caps shade as ellipsoids rather than spheres', () => {
  const flat = 0.5, radial = 16;
  const g = tubeGeometry(path, 1, flat, radial);
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  // First rounded-cap ring, a quarter turn around the short z axis.
  const i = path.length * (radial + 1) + radial / 4;
  const want = new Vector3(p.getX(i), p.getY(i), p.getZ(i) / (flat * flat)).normalize();
  assert.ok(new Vector3().fromBufferAttribute(n, i).distanceTo(want) < 1e-6, 'gradient of x² + y² + z² / flat²');
  g.dispose();
});


test('curved tapered ribbons shade across the swept skin and meet seamlessly around each ring', () => {
  const points = samplePath([[0, -3, 0], [0.2, -1, 0.2], [0.6, 1, 0.5], [1, 3, 1]], true, 18);
  for (const { radial } of Object.values(DETAIL)) for (const flat of [1, 0.6, 0.15]) {
    const g = tubeGeometry(points, 0.3, flat, radial, [[0, 0.4], [0.4, 1.5], [1, 0.6]]);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), row = radial + 1;
    const vector = (i: number) => new Vector3().fromBufferAttribute(p, i);
    for (let i = 1; i < points.length - 1; i++) {
      const seam = new Vector3().fromBufferAttribute(n, i * row);
      assert.ok(seam.distanceTo(new Vector3().fromBufferAttribute(n, i * row + radial)) < 1e-6);
      for (let j = 0; j < radial; j++) {
        const along = vector((i + 1) * row + j).sub(vector((i - 1) * row + j)).normalize();
        const around = vector(i * row + (j + 1) % radial).sub(vector(i * row + (j + radial - 1) % radial)).normalize();
        const normal = new Vector3().fromBufferAttribute(n, i * row + j);
        assert.ok(Math.abs(normal.dot(along)) < 2e-5, 'normal follows the longitudinal surface slope');
        assert.ok(Math.abs(normal.dot(around)) < 2e-5, 'normal follows the elliptical cross-section');
      }
    }
    g.dispose();
  }
});

test('straight constant-radius tubes keep radial body normals and unchanged ring drawing budgets', () => {
  for (const { radial } of Object.values(DETAIL)) for (const flat of [1, 0.5, 0.1]) {
    const g = tubeGeometry(path, 1, flat, radial), row = radial + 1, n = g.getAttribute('normal');
    const capTriangles = flat >= 0.5 ? 5 * radial * 2 : 0;
    assert.equal(g.getAttribute('position').count, row * (path.length + (flat >= 0.5 ? 10 : 0)));
    assert.equal(g.index!.count, (2 * radial * (path.length - 1) + 2 * capTriangles) * 3);
    for (let i = 0; i < path.length; i++) for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      const expected = new Vector3(flat * Math.cos(angle), 0, Math.sin(angle)).normalize();
      assert.ok(expected.distanceTo(new Vector3().fromBufferAttribute(n, i * row + j)) < 1e-6);
    }
    drawFraction(g, 0); assert.equal(g.drawRange.count, 0);
    drawFraction(g, 0.5); assert.equal(g.drawRange.count, capTriangles * 3 + radial * 6);
    drawFraction(g, 1); assert.equal(g.drawRange.count, g.index!.count);
    g.dispose();
  }
});

test('collapsed, repeated, tiny and translated tube spans retain finite unit normals', () => {
  const paths: Vec3[][] = [
    [[0, 0, 0]],
    [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[0, 0, 0], [0, 0, 0], [0, 1, 0], [0, 1, 0]],
    [[0, 0, 0], [0, 1, 0], [0, 0, 0]],
    [[0, 0, 0], [0, 1e-9, 0], [0, 2e-9, 0]],
    [[99, 99, 99], [99.00001, 99.00002, 99.00001], [99.00002, 99.00004, 99.00002]],
  ];
  for (const points of paths) for (const flat of [0.05, 0.5, 1]) for (const radius of [0.001, 1, 10]) {
    const g = tubeGeometry(points, radius, flat, 24, [[0, 0], [0.5, 10], [1, 0]]);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      const normal = new Vector3().fromBufferAttribute(n, i);
      assert.ok(normal.toArray().every(Number.isFinite));
      assert.ok(Math.abs(normal.length() - 1) < 1e-6);
    }
    g.dispose();
  }
});


test('surface normals survive real PanelScene transforms, copies, replacement and cleanup', () => {
  const result = validateScene({ steps: [{ say: 'A tapered tube', actions: [
    { op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], radius: 0.5, swell: [[0, 1], [1, 2]] },
    { op: 'move', id: 't', to: [2, 3, 1], dur: 0 },
    { op: 'turn', id: 't', to: [10, 20, 30], dur: 0 },
    { op: 'scale', id: 't', to: [2, 0.7, 1.2], dur: 0 },
    { op: 'add', shape: 'array', id: 'copies', of: 't', count: 2, step: [3, 0, 0] },
  ] }, { say: 'Replace it', actions: [
    { op: 'clear', target: 't' },
    { op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], radius: 0.5, swell: [[0, 2], [1, 1]] },
  ] }] });
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  const panel = new PanelScene();
  const first = frameAt(result.scene!.steps, 0, 99);
  panel.sync(first, 1);
  const id = first.objects.find(o => o.id === 't')!.key;
  const owned = new Set<BufferGeometry>();
  panel.nodeOf(id)!.traverse(o => { if (o instanceof Mesh) owned.add(o.geometry); });
  assert.equal(owned.size, 1);
  const geo = [...owned][0]!;
  const n = geo.getAttribute('normal');
  const middle = Math.floor(geo.userData.rings / 2) * (geo.userData.indicesPerRing / 6 + 1);
  assert.ok(n.getY(middle) < -0.2, 'taper slope reaches live geometry');
  let disposed = 0;
  geo.addEventListener('dispose', () => { disposed++; });
  const copies = first.objects.filter(o => o.id !== 't' && o.def.shape === 'tube');
  assert.equal(copies.length, 1);
  let copy: Mesh | undefined;
  panel.nodeOf(copies[0]!.key)!.traverse(o => { if (o instanceof Mesh) copy = o; });
  assert.ok(copy);
  assert.deepEqual(copy.geometry.getAttribute('normal').array, geo.getAttribute('normal').array);
  panel.sync(frameAt(result.scene!.steps, 1, 99), 1);
  const replacement = panel.nodeOf(frameAt(result.scene!.steps, 1, 99).objects.find(o => o.id === 't')!.key)!;
  let replacementGeometry: BufferGeometry | undefined;
  replacement.traverse(o => { if (o instanceof Mesh) replacementGeometry = o.geometry; });
  assert.ok(replacementGeometry);
  assert.ok(replacementGeometry.getAttribute('normal').getY(middle) > 0.2, 'replacement has the opposite taper slope');
  panel.destroy();
  assert.equal(disposed, 1, 'cleanup releases old geometry once');
});


test('the generic tube study validates unchanged and builds at each detail tier', () => {
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/tube-surface-study.json', import.meta.url), 'utf8'));
  const result = validateScene(raw);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene, raw);
  for (const tier of ['low', 'mid', 'high'] as const) {
    const panel = new PanelScene({ tier });
    for (let i = 0; i < raw.steps.length; i++) {
      panel.sync(frameAt(raw.steps, i, 99), i + 1);
      assert.equal(panel.count(), 3);
    }
    panel.destroy();
  }
});
