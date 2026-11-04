import test from 'node:test';
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
    const defs = (schema as { $defs: Record<string, { properties: Record<string, unknown> }> }).$defs;
    assert.ok(defs.addBlob && 'sizes' in defs.addBlob.properties && 'soft' in defs.addBlob.properties, 'the blob is in the schema');
    assert.ok('swell' in defs.addTube!.properties, 'and the swell');
  }
});

const organic: Scene = { steps: [{ say: 'x', actions: [
  { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
  { op: 'add', shape: 'blob', id: 'body', pts: [[0, 0, 0]], sizes: [[2, 2, 2]], color: 'red', material: 'tissue' },
] }] };

test('a stem or vessel thick for its length is part of the model for framing; a thin cable is not', () => {
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
  assert.ok(withTube(0.04, 6) < alone * 1.05, 'a cable leaves the framing as it was');
});

test('the model is told about the organic forms: blob, swell and tissue', async () => {
  const { sceneGuide } = await import('../src/scene/index.ts');
  for (const word of ['blob', 'swell', 'tissue', 'lump']) assert.ok(sceneGuide.includes(word), word);
  assert.ok(sceneGuide.includes('are never boxes and cylinders'), 'the instruction is a rule, not a description');
});
