import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { buildPart } from '../src/overlay/parts.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import type { AddPart } from '../src/scene/types.ts';

const wheel = (n = 5, tier: keyof typeof DETAIL = 'mid') => {
  const b = buildPart({ op: 'add', shape: 'part', id: 'wheel', part: 'wheel', size: [5, 5, 1.4], n } as AddPart, DETAIL[tier]);
  b.root.updateMatrixWorld(true);
  return b;
};
const hits = (b: ReturnType<typeof wheel>, x: number, y: number, sign = 1) =>
  new Raycaster(new Vector3(x, y, sign * 10), new Vector3(0, 0, -sign)).intersectObject(b.root, true);

test('wheel has a true opening between each pair of spokes from either side', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const n of Array.from({ length: 64 }, (_, i) => i + 1)) {
    const b = wheel(n, tier);
    for (let i = 0; i < n; i++) {
      const angle = (i + 0.5) * Math.PI * 2 / n;
      for (const sign of [-1, 1]) assert.equal(hits(b, 1.25 * Math.cos(angle), 1.25 * Math.sin(angle), sign).length, 0, `${tier}/${n}: gap ${i} from ${sign}`);
    }
  }
});

test('open wheel keeps spokes, rim, hub and tyre as tangible geometry', () => {
  const b = wheel();
  for (const sign of [-1, 1]) {
    assert.ok(hits(b, 0, 0, sign).length, 'hub');
    assert.ok(hits(b, 1.25, 0, sign).length, 'spoke');
    const angle = Math.PI / 5;
    assert.ok(hits(b, 1.65 * Math.cos(angle), 1.65 * Math.sin(angle), sign).some(h => b.pieces.find(p => p.object === h.object)?.surface === 'metal'), 'metal annular rim');
    assert.ok(hits(b, 2.2 * Math.cos(angle), 2.2 * Math.sin(angle), sign).some(h => b.pieces.find(p => p.object === h.object)?.surface === 'rubber'), 'rubber tyre');
  }
});

import { Box3, BufferGeometry, Mesh, MeshPhysicalMaterial } from 'three';
import type { Vec3 } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

const triangles = (g: BufferGeometry) => (g.index?.count ?? g.getAttribute('position').count) / 3;

test('wheel geometry is finite, independently owned and bounded at every detail and spoke count', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const n of [1, 2, 3, 5, 8, 16, 64]) {
    for (const size of [[5, 5, 1.4], [0.01, 0.01, 0.01], [100, 100, 0.01], [0.01, 100, 100], [100, 100, 100]] as Vec3[]) {
      const b = buildPart({ op: 'add', shape: 'part', part: 'wheel', id: 'x', size, n }, DETAIL[tier]);
      const geometry = new Set(b.pieces.map(p => p.object.geometry));
      assert.equal(geometry.size, b.pieces.length, 'each piece owns its geometry for disposal');
      const box = new Box3().setFromObject(b.root), extent = box.getSize(new Vector3());
      assert.ok(extent.x <= size[0] * 1.0001 && extent.y <= size[0] * 1.0001, 'legacy x-diameter envelope');
      assert.ok(extent.z <= size[2] * 1.0001, 'depth envelope');
      assert.ok(extent.x >= size[0] * 0.99 && extent.y >= size[0] * 0.99, 'not an empty wheel');
      assert.ok(box.getCenter(new Vector3()).length() < Math.max(...size) * 1e-6, 'centred');
      assert.equal(b.pieces.length, n + 5);
      assert.ok([...geometry].reduce((sum, g) => sum + triangles(g), 0) <= 18_000, 'bounded geometry budget');
      for (const g of geometry) {
        const p = g.getAttribute('position'), normals = g.getAttribute('normal');
        assert.ok([...p.array].every(Number.isFinite), 'finite vertices');
        assert.ok([...normals.array].every(Number.isFinite), 'finite normals');
        // Three.js lathe caps contain degenerate pole triangles. Check normals on drawable
        // triangles rather than the unused corners of those collapsed triangles.
        const a = new Vector3(), b = new Vector3(), c = new Vector3(), cross = new Vector3();
        for (let i = 0; i < (g.index?.count ?? p.count); i += 3) {
          const ids = [0, 1, 2].map(k => g.index ? g.index.getX(i + k) : i + k);
          a.fromBufferAttribute(p, ids[0]!); b.fromBufferAttribute(p, ids[1]!); c.fromBufferAttribute(p, ids[2]!);
          cross.crossVectors(b.sub(a), c.sub(a));
          if (cross.length() < size[0] * Math.min(size[0], size[2]) * 1e-12) continue;
          for (const id of ids) {
            const length = Math.hypot(normals.getX(id), normals.getY(id), normals.getZ(id));
            assert.ok(length > 0.99 && length < 1.01, `unit drawable normal, ${size}/${tier}/${n}: ${length}`);
          }
        }
      }
    }
  }
});

test('wheel count changes real spokes and retains metal tint independently from tyre and cap colors', () => {
  for (const n of [1, 5, 64]) {
    const b = wheel(n);
    const seen = new Set<number>();
    const r = 1.25, samples = n * 24;
    let previous = false, sectors = 0;
    for (let i = 0; i <= samples; i++) {
      const a = (i - 0.5) / samples * Math.PI * 2;
      const present = hits(b, r * Math.cos(a), r * Math.sin(a)).length > 0;
      if (present && !previous) sectors++;
      previous = present;
    }
    // The first spoke straddles 0, so the traversal may count it at both ends.
    assert.equal(sectors, n + 1);
    for (const hit of hits(b, 1.25, 0)) {
      const p = b.pieces.find(p => p.object === hit.object)!;
      assert.equal(p.tint, true); seen.add(hit.object.id);
    }
    assert.ok(seen.size);
    assert.equal(b.pieces.filter(p => p.surface === 'rubber').length, 1);
    assert.equal(b.pieces.filter(p => p.surface === 'rubber')[0]!.tint, false);
  }
});

test('wheel stays open in actual PanelScene with transformed copies, recoloring and disposal', () => {
  const scene = new PanelScene();
  const steps = [{ say: 'A wheel.', actions: [
    { op: 'panel', x: 50, y: 50, w: 900, h: 900 },
    { op: 'add', shape: 'group', id: 'holder', pos: [2, 1, -1], rot: [20, 35, 10] },
    { op: 'add', shape: 'part', part: 'wheel', id: 'w', parent: 'holder', size: [5, 5, 1.4], color: '#ee6644', n: 5 },
    { op: 'add', shape: 'array', id: 'copies', of: 'w', count: 2, step: [7, 0, 0] },
    { op: 'turn', id: 'w', to: [0, 0, 36], at: 0, dur: 1 },
    { op: 'scale', id: 'w', to: [1.2, 0.8, 1.1], at: 0, dur: 1 },
  ] }];
  const f = frameAt(steps as never, 0, 99); scene.sync(f, 1);
  const nodes = (scene as unknown as { nodes: Map<number, { obj: Mesh; geometries: BufferGeometry[]; pieces: { object: Mesh; surface: MeshPhysicalMaterial; tint: boolean }[] }> }).nodes;
  const wheelNodes = [...nodes.values()].filter(n => n.pieces.length === 10);
  assert.equal(wheelNodes.length, 2, 'count includes the original wheel');
  for (const node of wheelNodes) {
    node.obj.updateWorldMatrix(true, true);
    const a = Math.PI / 5;
    const origin = new Vector3(1.25 * Math.cos(a), 1.25 * Math.sin(a), 10).applyMatrix4(node.obj.matrixWorld);
    const end = new Vector3(1.25 * Math.cos(a), 1.25 * Math.sin(a), -10).applyMatrix4(node.obj.matrixWorld);
    assert.equal(new Raycaster(origin, end.sub(origin).normalize()).intersectObject(node.obj, true).length, 0);
    assert.ok(node.pieces.some(p => p.tint && p.surface.color.getHexString() === 'ee6644'), 'authored tint');
    assert.ok(node.pieces.some(p => !p.tint && p.surface.color.getHexString() === '202228'), 'rubber keeps its color');
  }
  const geometries = [...new Set(wheelNodes.flatMap(n => n.geometries))];
  const disposal = new Map(geometries.map(g => [g, 0]));
  for (const g of geometries) g.addEventListener('dispose', () => disposal.set(g, disposal.get(g)! + 1));
  scene.sync(frameAt([{ say: 'Gone.', actions: [] }], 0, 0), 2);
  for (const count of disposal.values()) assert.equal(count, 1);
  scene.destroy();
});

test('wheel ring and spoke surfaces are closed with outward-facing triangles', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const b = wheel(5, tier);
    for (const piece of b.pieces) {
      const g = piece.object.geometry, p = g.getAttribute('position');
      const edges = new Map<string, number>(), direction = new Map<string, number>();
      const points = [new Vector3(), new Vector3(), new Vector3()];
      let volume = 0;
      const key = (v: Vector3) => v.toArray().map(x => Math.round(x * 1e6)).join(',');
      for (let i = 0; i < (g.index?.count ?? p.count); i += 3) {
        points.forEach((v, k) => v.fromBufferAttribute(p, g.index ? g.index.getX(i + k) : i + k));
        const [a, b, c] = points as [Vector3, Vector3, Vector3];
        const cross = b.clone().sub(a).cross(c.clone().sub(a));
        if (cross.length() < 1e-10) continue; // collapsed lathe poles
        volume += a.dot(b.clone().cross(c)) / 6;
        const normals = g.getAttribute('normal');
        for (let k = 0; k < 3; k++) {
          const normal = new Vector3().fromBufferAttribute(normals, g.index ? g.index.getX(i + k) : i + k);
          assert.ok(cross.dot(normal) > 0, 'shading normal faces out of its drawable triangle');
        }
        for (let k = 0; k < 3; k++) {
          const from = key(points[k]!), to = key(points[(k + 1) % 3]!);
          const edge = [from, to].sort().join('/');
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
          direction.set(edge, (direction.get(edge) ?? 0) + (from < to ? 1 : -1));
        }
      }
      assert.ok(volume > 0, 'closed outward volume');
      for (const [edge, count] of edges) {
        assert.equal(count, 2, `closed edge ${edge}`);
        assert.equal(direction.get(edge), 0, 'opposite edge directions');
      }
    }
  }
});

import { readFileSync } from 'node:fs';
import { validateScene } from '../src/scene/index.ts';

test('wheel study sample validates unchanged and uses both sides of actual wheels', () => {
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/wheel-spokes.json', import.meta.url), 'utf8'));
  const result = validateScene(raw);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.scene, raw);
  const scene = new PanelScene();
  for (const i of [0, 1, 2]) {
    scene.sync(frameAt(raw.steps, i, 99), 1000 + i);
    assert.equal(scene.count(), 2);
  }
  scene.destroy();
});

test('replacing a wheel rebuilds the spoke count and releases the old closed pieces', () => {
  const scene = new PanelScene();
  const def: AddPart = { op: 'add', shape: 'part', part: 'wheel', id: 'w', size: [5, 5, 1.4], n: 5 };
  const steps = [{ say: 'First wheel', actions: [def] }, { say: 'Replace wheel', actions: [{ ...def, n: 8 }] }];
  scene.sync(frameAt(steps, 0, 99), 1);
  const nodes = (scene as unknown as { nodes: Map<number, { obj: Mesh; geometries: BufferGeometry[]; pieces: { closed: boolean }[] }> }).nodes;
  const old = [...nodes.values()][0]!;
  assert.ok(old.pieces.every(p => p.closed), 'closed pieces participate in cutaways');
  let disposed = 0;
  for (const g of old.geometries) g.addEventListener('dispose', () => disposed++);
  scene.sync(frameAt(steps, 1, 99), 2);
  assert.equal(scene.count(), 1);
  const next = [...nodes.values()][0]!;
  assert.equal(next.pieces.length, 13);
  assert.equal(disposed, old.geometries.length);
  assert.ok(next.geometries.every(g => !old.geometries.includes(g)));
  assert.ok(next.pieces.every(p => p.closed));
  const a = Math.PI / 8;
  const ray = new Raycaster(new Vector3(1.25 * Math.cos(a), 1.25 * Math.sin(a), 10), new Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(next.obj, true).length, 0);
  scene.destroy();
});

test('wheel computes normals at a stable unit size before applying authored dimensions', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    const ordinary = wheel(5, tier);
    for (const size of [[0.01, 0.01, 0.01], [100, 100, 0.01], [100, 100, 100]] as Vec3[]) {
      const other = buildPart({ op: 'add', shape: 'part', part: 'wheel', id: 'x', size, n: 5 }, DETAIL[tier]);
      assert.equal(other.pieces.length, ordinary.pieces.length);
      for (let i = 0; i < ordinary.pieces.length; i++) {
        // The normal helper uses fixed-size coordinate buckets. Authored tiny positions in
        // those buckets make it quadratic; only child transforms may depend on these sizes.
        for (const attribute of ['position', 'normal']) assert.deepEqual(
          other.pieces[i]!.object.geometry.getAttribute(attribute).array,
          ordinary.pieces[i]!.object.geometry.getAttribute(attribute).array,
          `${tier}/${size}: dimension-independent ${attribute} buffer`,
        );
      }
    }
  }
});
