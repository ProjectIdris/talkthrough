import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { buildPart } from '../src/overlay/parts.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import { PARTS } from '../src/scene/index.ts';
import type { AddPart, Vec3 } from '../src/scene/index.ts';

const SIZES: Record<string, Vec3> = {
  'cylinder-block': [4, 5, 4], piston: [3, 3.4, 3.2], 'connecting-rod': [1.6, 6, 1], crankshaft: [5, 5, 6], valve: [2, 6, 2],
  camshaft: [3.2, 3.2, 7], 'spark-plug': [1.4, 5, 1.4], gear: [5, 5, 1], spring: [2, 4.5, 2], bearing: [4, 4, 1.2], pipe: [1.6, 5, 1.6], elbow: [4, 4, 1.6], housing: [5, 4, 4],
};

const MECHANISM = PARTS.filter((p) => p in SIZES);

test('every part in the language can be built, and the mechanism kit fits its size box', () => {
  assert.equal(MECHANISM.length, Object.keys(SIZES).length, 'every mechanism part has a test size');
  for (const part of MECHANISM) {
    for (const variant of [undefined, 'cutaway', 'finned'] as const) {
      const size = SIZES[part] as Vec3;
      const def = { op: 'add', shape: 'part', id: 'x', part, size, ...(variant ? { variant } : {}) } as AddPart;
      const built = buildPart(def, DETAIL.mid);
      assert.ok(built.pieces.length > 0, `${part} has pieces`);
      built.root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(built.root);
      assert.ok(!box.isEmpty(), part);
      const got = box.getSize(new Vector3());
      for (let i = 0; i < 3; i++) {
        const want = size[i] as number;
        const have = [got.x, got.y, got.z][i] as number;
        assert.ok(Number.isFinite(have), `${part} axis ${i} is a number`);
        assert.ok(have <= want * 1.4 + 0.05, `${part} ${variant ?? ''} axis ${i}: ${have.toFixed(2)} is far over ${want}`);
      }
      // The part is about as big as asked on its longest side, not a speck.
      assert.ok(Math.max(got.x, got.y, got.z) >= Math.max(...size) * 0.7, `${part} fills its box`);
      for (const [name, p] of Object.entries(built.anchors)) assert.ok(p.every((v) => Number.isFinite(v)), `${part} anchor ${name}`);
      assert.ok(Object.keys(built.anchors).length > 0, `${part} offers named anchors`);
    }
  }
});

test('each part builds the same way whatever size it is given, and its size scales it', () => {
  const small = buildPart({ op: 'add', shape: 'part', id: 'a', part: 'piston', size: [1, 1.1, 1] } as AddPart, DETAIL.low);
  const big = buildPart({ op: 'add', shape: 'part', id: 'a', part: 'piston', size: [4, 4.4, 4] } as AddPart, DETAIL.low);
  const w = (b: ReturnType<typeof buildPart>) => new Box3().setFromObject(b.root).getSize(new Vector3()).x;
  assert.ok(Math.abs(w(big) / w(small) - 4) < 0.05);
});

test('a pin lands on a part\'s named anchor, and an unknown name falls back to the middle', async () => {
  const { PanelScene } = await import('../src/overlay/scene3d.ts');
  const { frameAt } = await import('../src/overlay/timeline.ts');
  const f = frameAt([{ say: 'x', actions: [
    { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
    { op: 'add', shape: 'part', id: 'p', part: 'piston', size: [3, 3.4, 3.2], pos: [1, 2, 0] },
  ] }] as never, 0, 99);
  const scene = new PanelScene();
  scene.sync(f, 1);
  const key = f.objects.find((o) => o.id === 'p')?.key ?? -1;
  const crown = scene.project(key, undefined, 800, 800, 'crown');
  const byPoint = scene.project(key, [0, 1.7, 0], 800, 800);
  assert.ok(crown && byPoint);
  assert.ok(Math.abs(crown.x - byPoint.x) < 0.01 && Math.abs(crown.y - byPoint.y) < 0.01, 'the crown is the top middle of the piston');
  const middle = scene.project(key, undefined, 800, 800);
  const unknown = scene.project(key, undefined, 800, 800, 'nonsense');
  assert.deepEqual(unknown, middle);
  assert.ok(crown.y < (middle?.y ?? 0), 'the crown is above the middle on screen');
});
