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

// ---- Whatever size a model writes a part at -------------------------------------------------------------------

import { normalSize, rodEnds } from '../src/overlay/mechanism-geometry.ts';

const extent = (part: string, size: Vec3, variant?: string) => {
  const built = buildPart({ op: 'add', shape: 'part', id: 'x', part, size, ...(variant ? { variant } : {}) } as AddPart, DETAIL.low);
  built.root.updateMatrixWorld(true);
  return { built, got: new Box3().setFromObject(built.root).getSize(new Vector3()) };
};

test('a part written at an odd size is turned to its own axes and fitted inside the box: no huge pills, no stretched parts', () => {
  const orders = (s: Vec3): Vec3[] => [[s[0], s[1], s[2]], [s[1], s[2], s[0]], [s[2], s[0], s[1]], [s[0], s[2], s[1]], [s[1], s[0], s[2]], [s[2], s[1], s[0]]];
  for (const part of MECHANISM) {
    for (const size of [...orders(SIZES[part] as Vec3), [3, 3, 3] as Vec3, [3.5, 0.9, 0.9] as Vec3, [1, 1, 8] as Vec3]) {
      const fitted = normalSize(part, size);
      // The box it is built to is never bigger than the one written, on its longest side or its smallest.
      const sorted = (v: Vec3) => [...v].sort((a, b) => a - b);
      assert.ok(sorted(fitted).every((v, i) => v <= (sorted(size)[i] as number) + 1e-9), `${part} ${size}: ${fitted} fits inside it`);
      const { got } = extent(part, size);
      for (let i = 0; i < 3; i++) assert.ok([got.x, got.y, got.z][i]! <= fitted[i]! * 1.3 + 0.05, `${part} written ${size}: axis ${i} is ${[got.x, got.y, got.z][i]!.toFixed(2)} in a ${fitted[i]} box`);
    }
  }
});

test('a camshaft written with its length first is a shaft along z, not a pill; a gear written on its edge is a thin disc about z', () => {
  const cam = extent('camshaft', [3.5, 0.9, 0.9]).got;
  assert.ok(cam.z > 3 && cam.x < 1.1 && cam.y < 1.1, `${cam.x.toFixed(2)} x ${cam.y.toFixed(2)} x ${cam.z.toFixed(2)}`);
  const gear = extent('gear', [1, 5, 5]).got;
  assert.ok(gear.z < 1.5 && gear.x > 4.5 && gear.y > 4.5, `${gear.x.toFixed(2)} x ${gear.y.toFixed(2)} x ${gear.z.toFixed(2)}`);
  const piston = extent('piston', [3.5, 0.9, 0.9]).got;
  assert.ok(piston.x <= 1 && piston.z <= 1, 'a piston keeps a round section that fits the smaller side');
});

test('a connecting rod written lying along x is stood up along y, and the ends the crank action uses are the ones it is built with', () => {
  const written: Vec3 = [6, 1, 1.6];
  const { built, got } = extent('connecting-rod', written);
  assert.ok(got.y > 5 && got.x < 1.3, `${got.x.toFixed(2)} x ${got.y.toFixed(2)}`);
  const ends = rodEnds(written);
  assert.ok(Math.abs((built.anchors['big-end'] as Vec3)[1] - ends.big) < 1e-9 && Math.abs((built.anchors['small-end'] as Vec3)[1] - ends.small) < 1e-9);
});
