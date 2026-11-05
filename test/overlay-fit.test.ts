import test from 'node:test';
import assert from 'node:assert/strict';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const settled = (...actions: unknown[]): Frame => frameAt([step({ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, ...actions)], 0, 99);
const WIN = { width: 1400, height: 900 };

test('a long model fills a wide stage, and a tall one a tall stage, instead of the all-round sphere leaving them small', () => {
  const wide = { x: 100, y: 100, w: 800, h: 300 };
  const long = settled({ op: 'add', shape: 'box', id: 'a', size: [40, 2, 2] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene = new PanelScene();
  scene.sync(long, wide.w / wide.h, { rect: wide, ...WIN });
  const b = scene.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(b.w / wide.w > 0.8, `long model across a wide stage: ${Math.round((b.w / wide.w) * 100)}%`);
  assert.ok(b.x >= wide.x - 4 && b.x + b.w <= wide.x + wide.w + 4, 'and inside it');
  const tall = { x: 100, y: 50, w: 260, h: 700 };
  const mast = settled({ op: 'add', shape: 'box', id: 'a', size: [2, 40, 2] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene2 = new PanelScene();
  scene2.sync(mast, tall.w / tall.h, { rect: tall, ...WIN });
  const t = scene2.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(t.h / tall.h > 0.8 && t.y >= tall.y - 4 && t.y + t.h <= tall.y + tall.h + 4, `tall: ${Math.round((t.h / tall.h) * 100)}%`);
});

test('a ball is bounded by the ball, not by the box round it', () => {
  const stage = { x: 100, y: 100, w: 500, h: 500 };
  const frame = settled({ op: 'add', shape: 'sphere', id: 'a', size: [6, 6, 6] }, { op: 'orbit', az: 30, el: 20, dur: 0 });
  const scene = new PanelScene();
  scene.sync(frame, 1, { rect: stage, ...WIN });
  const b = scene.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(Math.abs(b.w - b.h) < b.w * 0.05, `round on screen: ${Math.round(b.w)} by ${Math.round(b.h)}`);
});

test('the camera stands still while a part is posed or pulses: it frames the model at rest', () => {
  const stage = { x: 100, y: 100, w: 500, h: 400 };
  const rest = settled({ op: 'add', shape: 'box', id: 'body', size: [6, 2, 2] }, { op: 'add', shape: 'box', id: 'rod', size: [1, 1, 1], pos: [0, 2, 0] }, { op: 'orbit', az: 20, el: 10, dur: 0 });
  const scene = new PanelScene();
  scene.sync(rest, 1.25, { rect: stage, ...WIN });
  const at = scene.camera.position.clone();
  const rod = rest.objects.find((o) => o.id === 'rod')!;
  for (const moved of [{ ...rod, pose: { pos: [0, 2, 9] as [number, number, number] } }, { ...rod, pulse: 1 }]) {
    const frame: Frame = { ...rest, objects: rest.objects.map((o) => (o.id === 'rod' ? moved : o)) };
    scene.sync(frame, 1.25, { rect: stage, ...WIN });
    assert.ok(scene.camera.position.distanceTo(at) < 1e-6, 'the camera did not move');
  }
});
