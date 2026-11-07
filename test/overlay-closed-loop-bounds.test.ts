import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Step } from '../src/scene/index.ts';

const view = { rect: { x: 120, y: 100, w: 960, h: 760 }, width: 1200, height: 1000 };
const loop = { op: 'add', shape: 'tube', id: 'loop', closed: true,
  pts: [[-2, 0, 0], [0, 2, 0], [2, 0, 0], [0, -2, 0]], radius: 0.04 };
const steps = (actions: unknown[]): Step[] => [{ say: 'A closed ring.', actions: [
  { op: 'panel', x: 100, y: 100, w: 800, h: 760 }, ...actions,
] }] as Step[];

for (const tier of ['low', 'mid', 'high'] as const) {
  test(`${tier}: thin closed loops supply the model bounds that gate production rendering`, () => {
    const panel = new PanelScene({ tier });
    try {
      for (const t of [0.5, 2]) {
        const frame = frameAt(steps([loop]), 0, t);
        panel.sync(frame, view.rect.w / view.rect.h, view);
        const bounds = panel.screenBounds(view.width, view.height);
        assert.ok(bounds, 'overlay.draw must receive bounds before it calls the renderer or publishes camera metadata');
        assert.ok([bounds.model.x, bounds.model.y, bounds.model.w, bounds.model.h].every(Number.isFinite));
        assert.ok(bounds.model.w > 0 && bounds.model.h > 0);
        assert.ok(bounds.model.w > view.rect.w * 0.5 || bounds.model.h > view.rect.h * 0.5, 'the loop is framed as the model');
      }
      const before = panel.screenBounds(view.width, view.height)!.model;
      const camera = panel.camera.position.clone();
      const withCable = frameAt(steps([loop, { op: 'add', shape: 'tube', id: 'cable',
        pts: [[0, 0, 0], [50, 50, 0], [100, 0, 0]], radius: 0.02 }]), 0, 2);
      panel.sync(withCable, view.rect.w / view.rect.h, view);
      const after = panel.screenBounds(view.width, view.height)!.model;
      // Updating depth planes can change projection arithmetic at machine precision,
      // but the cable must not change the model's screen framing.
      for (const key of ['x', 'y', 'w', 'h'] as const) assert.ok(Math.abs(after[key] - before[key]) < 1e-9, 'thin open cables remain outside model framing');
      assert.ok(panel.camera.position.distanceTo(camera) < 1e-8);
    } finally { panel.destroy(); }
  });

  test(`${tier}: original closed-loop sample supplies render bounds at every nonempty native checkpoint`, () => {
    const raw = JSON.parse(readFileSync(new URL('../samples/scenes/closed-loops.json', import.meta.url), 'utf8'));
    const checked = validateScene(raw);
    assert.deepEqual(checked.issues, []);
    assert.ok(checked.scene);
    const panel = new PanelScene({ tier });
    try {
      for (const [step, t] of [[1, 3], [2, 2.1], [2, 5]]) {
        panel.sync(frameAt(checked.scene.steps, step!, t!), view.rect.w / view.rect.h, view);
        const bounds = panel.screenBounds(view.width, view.height);
        assert.ok(bounds, `${step}:${t} must reach the renderer's nonempty-model gate`);
        assert.ok(Object.values(bounds.model).every(Number.isFinite));
        assert.ok(bounds.model.w > 0 && bounds.model.h > 0);
      }
    } finally { panel.destroy(); }
  });
}
