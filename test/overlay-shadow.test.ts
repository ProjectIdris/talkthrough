import assert from 'node:assert/strict';
import test from 'node:test';
import type { Mesh } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const WIN = { width: 1920, height: 1080 };
const STAGE = { x: 1248, y: 221, w: 568, h: 432 };

const fakeCanvas = (w: number, h: number) => {
  const ctx = new Proxy({ createRadialGradient: () => ({ addColorStop: () => {} }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => {}),
    set: () => true,
  });
  return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
};

test('the soft shadow under the model stays close to its footprint: it does not spread across the stage and out of it', () => {
  const frame = frameAt([step({ op: 'panel', x: 500, y: 160, w: 360, h: 660 },
    { op: 'add', shape: 'box', id: 'base', pos: [0, 0, 0], size: [3, 2, 3] },
    { op: 'orbit', az: 20, el: 15, dur: 0 })], 0, 99);
  const scene = new PanelScene({ makeCanvas: fakeCanvas });
  scene.sync(frame, STAGE.w / STAGE.h, { rect: STAGE, ...WIN });
  const blob = (scene as unknown as { blob: Mesh }).blob;
  assert.ok(blob.visible, 'the soft shadow is drawn');
  assert.ok(blob.scale.x >= 3 && blob.scale.z >= 3, `it covers the foot of the model (${blob.scale.x.toFixed(2)} x ${blob.scale.z.toFixed(2)} for a 3 x 3 foot)`);
  assert.ok(blob.scale.x <= 3.7 && blob.scale.z <= 3.7, `and is not much wider than it (${blob.scale.x.toFixed(2)} x ${blob.scale.z.toFixed(2)})`);
});
