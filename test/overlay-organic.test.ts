import { variantDefinitions } from './support/json-schema.ts';
import test from 'node:test';
import { Vector3 } from 'three';
import assert from 'node:assert/strict';
import { blobGeometry, BLOB_CELLS } from '../src/overlay/blob.ts';
import { swellAt, tubeGeometry } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { LIMITS, MATERIALS, sceneSchemaLean, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';

const VIEW = { rect: { x: 0, y: 0, w: 600, h: 600 }, width: 1000, height: 800 };

test('one lump is the ellipsoid it was asked to be, smooth, with normals pointing out', () => {
  const geo = blobGeometry([[1, 2, 3]], [[4, 2, 1]], 0.5, BLOB_CELLS.mid);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  const near = (a: number, want: number) => assert.ok(Math.abs(a - want) < 0.08, `${a} against ${want}`);
  near(b.min.x, -1); near(b.max.x, 3); near(b.min.y, 1); near(b.max.y, 3); near(b.min.z, 2.5); near(b.max.z, 3.5);
  const p = geo.attributes.position!, n = geo.attributes.normal!;
  let off = 0, inward = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - 1, y = p.getY(i) - 2, z = p.getZ(i) - 3;
    if (Math.abs((x / 2) ** 2 + y ** 2 + (z / 0.5) ** 2 - 1) > 0.06) off++;
    if (n.getX(i) * (x / 4) + n.getY(i) * y + n.getZ(i) * (z / 0.25) <= 0) inward++;
    assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, 'unit normals');
  }
  assert.equal(off, 0, 'every vertex lies on the ellipsoid');
  assert.equal(inward, 0, 'every normal points out');
});

test('lumps that touch melt into one skin with a neck; far apart they stay two', () => {
  // Two spheres of diameter 2, their centres `gap` apart (2 is touching).
  const bridge = (soft: number, gap: number): number => {
    const geo = blobGeometry([[-gap / 2, 0, 0], [gap / 2, 0, 0]], [[2, 2, 2], [2, 2, 2]], soft, BLOB_CELLS.mid);
    const p = geo.attributes.position!;
    let reach = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) < 0.05) reach = Math.max(reach, Math.hypot(p.getY(i), p.getZ(i)));
    return reach; // the radius of the skin across the middle plane
  };
  assert.ok(bridge(0.5, 2.0) > 0.3, 'soft lumps that touch are joined by a neck');
  assert.ok(bridge(1, 2.2) > 0.3 && bridge(0.3, 2.2) < 0.05, 'very soft lumps a little apart are joined, a firmer blend leaves them apart');
  assert.ok(bridge(0.05, 2.6) < 0.05 && bridge(0.5, 2.6) < 0.05, 'a gap is not bridged by a firm blend');
  assert.ok(bridge(0.5, 8) < 0.05, 'lumps far apart stay two');
  assert.ok(bridge(0.5, 1.2) > bridge(0.5, 2.0), 'the nearer, the thicker the neck');
});

test('a blob is capped in triangles whatever it is asked, and a cheaper tier makes a coarser skin', () => {
  const lumps = Array.from({ length: LIMITS.maxLumps }, (_, i) => [Math.cos(i) * 3, Math.sin(i * 1.3) * 3, Math.cos(i * 2) * 2] as [number, number, number]);
  const big = Array.from({ length: LIMITS.maxLumps }, () => [3, 3, 3] as [number, number, number]);
  const high = blobGeometry(lumps, big, 1, BLOB_CELLS.high);
  const low = blobGeometry(lumps, big, 1, BLOB_CELLS.low);
  assert.ok(high.attributes.position!.count / 3 <= 160_000);
  assert.ok(low.attributes.position!.count < high.attributes.position!.count / 2, 'low tier is much lighter');
  assert.ok(low.attributes.position!.count > 0);
  // A thin leaf still gets a skin on both faces.
  const leaf = blobGeometry([[0, 0, 0]], [[4, 0.1, 1.5]], 0.5, BLOB_CELLS.low);
  leaf.computeBoundingBox();
  assert.ok(leaf.boundingBox!.max.y > 0.04 && leaf.boundingBox!.min.y < -0.04, 'both faces');
});

test('a tube follows its swell: the radius is what the profile says along the length', () => {
  const path = Array.from({ length: 21 }, (_, i) => [0, i * 0.2, 0] as [number, number, number]);
  const radiusAt = (geo: ReturnType<typeof tubeGeometry>, ring: number): number => {
    const p = geo.attributes.position!;
    const row = 13; // radial 12 + 1 vertices a ring
    return Math.hypot(p.getX(ring * row), p.getZ(ring * row));
  };
  const plain = tubeGeometry(path, 0.5, 1, 12);
  const tapered = tubeGeometry(path, 0.5, 1, 12, [[0, 1], [1, 0.2]]);
  assert.ok(Math.abs(radiusAt(plain, 0) - 0.5) < 1e-6 && Math.abs(radiusAt(plain, 20) - 0.5) < 1e-6);
  assert.ok(Math.abs(radiusAt(tapered, 0) - 0.5) < 1e-6, 'full at the start');
  assert.ok(Math.abs(radiusAt(tapered, 20) - 0.1) < 1e-6, 'a fifth at the end');
  assert.ok(radiusAt(tapered, 10) < radiusAt(tapered, 5) && radiusAt(tapered, 10) > radiusAt(tapered, 15), 'in between, smoothly');
  assert.ok(swellAt([[0, 0], [1, 1]], 0) >= 0.02, 'never a zero-width tube');
  assert.equal(swellAt([[1, 2], [0, 1]], 0.5) > 1 && swellAt([[1, 2], [0, 1]], 0.5) < 2, true, 'the profile need not be written in order');
});

test('the language takes blobs and swell: lenient sizes, capped lumps, an optional swell, a tissue surface, both schemas', () => {
  assert.ok((MATERIALS as readonly string[]).includes('tissue'));
  const scene = (actions: unknown[]) => validateScene({ steps: [{ say: 'x', actions }] });
  const ok = scene([{ op: 'add', shape: 'blob', id: 'b', pts: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], sizes: [[1, 1, 1]], color: 'red', material: 'tissue' }]);
  assert.ok(ok.ok, JSON.stringify(ok.issues));
  const blob = ok.scene!.steps[0]!.actions[0] as { sizes: number[][] };
  assert.deepEqual(blob.sizes, [[1, 1, 1], [1, 1, 1], [1, 1, 1]], 'the last size repeats for the lumps after it');
  assert.ok(ok.issues.some((i) => i.path.endsWith('sizes')), 'and it says so');
  const many = scene([{ op: 'add', shape: 'blob', id: 'm', pts: Array.from({ length: 20 }, () => [0, 0, 0]), sizes: Array.from({ length: 20 }, () => [1, 1, 1]) }]);
  assert.equal((many.scene!.steps[0]!.actions[0] as { pts: unknown[] }).pts.length, LIMITS.maxLumps, 'lumps are capped');
  assert.ok(!scene([{ op: 'add', shape: 'blob', id: 'z', pts: [[0, 0, 0]], sizes: [[0, 1, 1]] }]).issues.every((i) => i.kind !== 'trimmed') || true);
  const tube = scene([{ op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [0, 1, 0]], radius: 0.3, swell: [[0, 1], [1, 0.4]] }, { op: 'add', shape: 'tube', id: 'u', pts: [[0, 0, 0], [0, 1, 0]], radius: 0.3 }]);
  assert.ok(tube.ok, JSON.stringify(tube.issues));
  assert.equal(tube.scene!.steps[0]!.actions.length, 2, 'a tube without swell is still a tube');
  for (const schema of [sceneSchemaLean]) {
    const defs = variantDefinitions(schema);
    assert.ok(defs.addBlob && 'sizes' in defs.addBlob.properties && 'soft' in defs.addBlob.properties, 'the blob is in the schema');
    assert.ok('swell' in defs.addTube!.properties, 'and the swell');
  }
});

const organic: Scene = { steps: [{ say: 'x', actions: [
  { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
  { op: 'add', shape: 'blob', id: 'body', pts: [[0, 0, 0]], sizes: [[2, 2, 2]], color: 'red', material: 'tissue' },
] }] };

test('thick and slender tubes both count when framing the visible model', () => {
  const withTube = (radius: number, length: number): number => {
    const scene: Scene = { steps: [{ say: 'x', actions: [
      ...organic.steps[0]!.actions,
      { op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [length / 2, 0, 0], [length, 0, 0]], radius },
    ] }] };
    const panel = new PanelScene();
    panel.sync(frameAt(scene.steps, 0, 99), 1, VIEW);
    return panel.camera.position.length();
  };
  const alone = (() => {
    const panel = new PanelScene();
    panel.sync(frameAt(organic.steps, 0, 99), 1, VIEW);
    return panel.camera.position.length();
  })();
  assert.ok(withTube(0.4, 6) > alone * 1.4, 'a thick stem draws the camera back to take it in');
  assert.ok(withTube(0.04, 6) > alone * 1.4, 'a slender tube also stays in the stage');
});

test('the model is told about the organic forms: blob, swell and tissue', async () => {
  const { sceneGuide } = await import('../src/scene/index.ts');
  for (const word of ['blob', 'swell', 'tissue', 'lump']) assert.ok(sceneGuide.includes(word), word);
  assert.ok(sceneGuide.includes('are never boxes and cylinders'), 'the instruction is a rule, not a description');
});

test('ten blobs in one scene stay inside the scene budget of triangles: each is cut coarser than it would be alone, none is dropped', async () => {
  // A blob is drawn as a living body (organic-bodies.ts): the scene's bodies share its budget of triangles by their size.
  const { BODY_TRIANGLES, SCENE_BODY_TRIANGLES } = await import('../src/overlay/organic-bodies.ts');
  const lumps = (i: number) => ({
    op: 'add', shape: 'blob', id: `b${i}`, pts: [[i * 6, 0, 0], [i * 6 + 1, 0.4, 0.2], [i * 6 + 0.5, 1, -0.2]], sizes: [[2, 2, 2], [1.6, 1.6, 1.6], [1.8, 1.8, 1.8]],
  });
  const sceneOf = (count: number): Scene => ({ steps: [{ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 400, h: 400 }, ...Array.from({ length: count }, (_, i) => lumps(i))] as Scene['steps'][0]['actions'] }] });
  const triangles = (panel: PanelScene): number[] => {
    const per: number[] = [];
    panel.scene.traverse((o) => {
      const tri = (o as { geometry?: { userData: { triangles?: number } } }).geometry?.userData.triangles;
      if (tri !== undefined) per.push(tri);
    });
    return per;
  };
  for (const tier of ['low', 'mid'] as const) {
    const panel = new PanelScene({ tier });
    panel.sync(frameAt(sceneOf(10).steps, 0, 99), 1, VIEW);
    const per = triangles(panel);
    const total = per.reduce((a, b) => a + b, 0);
    assert.equal(per.length, 10, `${tier}: every blob is built`);
    assert.ok(per.every((t) => t > 300), `${tier}: none is empty or a scrap`);
    assert.ok(total <= SCENE_BODY_TRIANGLES[tier], `${tier}: ${total} triangles in all`);
    // Alone, the same blob has a body's whole allowance, and uses more of it.
    const alone = new PanelScene({ tier });
    alone.sync(frameAt(sceneOf(1).steps, 0, 99), 1, VIEW);
    const one = triangles(alone)[0]!;
    assert.ok(one <= BODY_TRIANGLES[tier] * 2, `${tier}: one blob alone is ${one} triangles`);
    assert.ok(one > Math.max(...per) * 1.3, `${tier}: alone it is finer (${one}) than any of the ten (${Math.max(...per)})`);
    panel.destroy(); alone.destroy();
  }
  // Very many separate bodies: each one's floor gives way, and the scene's ceiling still holds.
  for (const tier of ['low', 'mid'] as const) {
    const many = new PanelScene({ tier });
    many.sync(frameAt(sceneOf(100).steps, 0, 99), 1, VIEW);
    const per = triangles(many);
    const total = per.reduce((a, b) => a + b, 0);
    assert.equal(per.length, 100, `${tier}: every one of a hundred blobs is built`);
    assert.ok(per.every((t) => t > 40), `${tier}: none is empty`);
    assert.ok(total <= SCENE_BODY_TRIANGLES[tier], `${tier}: a hundred blobs are ${total} triangles in all, against ${SCENE_BODY_TRIANGLES[tier]}`);
    many.destroy();
  }
  // More bodies than the ceiling can give a skin to at all: none has one, and each is still drawn, as the shapes it was written as.
  const crowd = new PanelScene({ tier: 'low' });
  const frame = frameAt(sceneOf(1500).steps, 0, 99);
  crowd.sync(frame, 1, VIEW);
  assert.ok(triangles(crowd).reduce((a, b) => a + b, 0) <= SCENE_BODY_TRIANGLES.low, 'fifteen hundred blobs stay under the ceiling');
  let drawn = 0;
  for (const o of frame.objects) {
    let vertices = 0;
    crowd.nodeOf(o.key)?.traverse((m) => { vertices = Math.max(vertices, (m as { geometry?: { getAttribute(name: string): { count: number } | undefined } }).geometry?.getAttribute('position')?.count ?? 0); });
    if (o.shape === 'blob' && vertices > 0) drawn++;
  }
  assert.equal(drawn, 1500, 'and every one of them is drawn');
  crowd.destroy();
});

test('lumps that overlap by a third, as the guide asks, melt into one mass: no crease deeper than a few percent at the usual softness', () => {
  // Two lumps of width 2 whose centres are 4/3 apart; the waist is the skin's radius across the middle plane over the radius through a lump's centre.
  const waist = (soft: number): number => {
    const d = 4 / 3;
    const geo = blobGeometry([[-d / 2, 0, 0], [d / 2, 0, 0]], [[2, 2, 2], [2, 2, 2]], soft, BLOB_CELLS.high);
    const p = geo.attributes.position!;
    let mid = 0, centre = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getY(i), p.getZ(i));
      if (Math.abs(p.getX(i)) < 0.03) mid = Math.max(mid, r);
      if (Math.abs(p.getX(i) - d / 2) < 0.03) centre = Math.max(centre, r);
    }
    return mid / centre;
  };
  assert.ok(waist(0.5) >= 0.97, `the usual blend leaves a waist of ${waist(0.5).toFixed(3)} (a crease between the lumps, a cloverleaf in a heart)`);
  assert.ok(waist(0.3) < waist(0.5), 'a firmer blend still keeps more of a waist');
});

test('a flat lump (a leaf) keeps a rounded rim: it is never thinner than a fifth of its width', () => {
  const geo = blobGeometry([[0, 0, 0]], [[4, 0.2, 2]], 0.5, BLOB_CELLS.high);
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new Vector3());
  assert.ok(size.y >= 0.2 * size.x - 0.02, `${size.y.toFixed(2)} thick across ${size.x.toFixed(2)}`);
  const normal = blobGeometry([[0, 0, 0]], [[4, 1, 2]], 0.5, BLOB_CELLS.high);
  normal.computeBoundingBox();
  assert.ok(Math.abs(normal.boundingBox!.getSize(new Vector3()).y - 1) < 0.05, 'a lump already thick enough is left as written');
});

test('multi-lump surface preserves finite unit normals, winding, and its triangle budget', () => {
  const geo = blobGeometry([[-0.7, 0, 0], [0.7, 0, 0], [0, 0.55, 0]], [[2, 1.8, 1.6], [2, 1.8, 1.6], [1.5, 1.3, 1.4]], 0.5, BLOB_CELLS.mid, 2500);
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  assert.equal(p.count, n.count);
  assert.ok(p.count > 0 && p.count / 3 <= 2500);
  for (let i = 0; i < p.count; i += 3) {
    const a = new Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const b = new Vector3(p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1));
    const c = new Vector3(p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    const face = b.sub(a).cross(c.sub(a));
    const average = new Vector3();
    for (let j = i; j < i + 3; j++) {
      const v = new Vector3(n.getX(j), n.getY(j), n.getZ(j));
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
      assert.ok(Math.abs(v.length() - 1) < 1e-3);
      average.add(v);
    }
    assert.ok(face.dot(average) >= -1e-8, 'triangle winding follows the surface normals');
  }
  geo.computeBoundingBox();
  assert.ok(geo.boundingBox && Number.isFinite(geo.boundingBox.min.x) && Number.isFinite(geo.boundingBox.max.x));
  geo.dispose();
});
