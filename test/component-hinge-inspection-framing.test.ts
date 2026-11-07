import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3 } from 'three';
import { hingeExamples } from '../scripts/components/hinged-panels-examples.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

for (const tier of ['low', 'mid', 'high'] as const) {
  test(`${tier}: withdrawn hinge pin and folded assembly stay inside the native capture`, () => {
    const scene = hingeExamples()['hinged-panels-inspect']!;
    const panel = new PanelScene({ tier });
    const view = { rect: { x: 120, y: 100, w: 960, h: 800 }, width: 1200, height: 1000 };
    let now = 0;
    const sync = (step: number) => {
      const frame = frameAt(scene.steps, step, 10);
      // The actual grab path advances its layout/seek clock by one frame per
      // acknowledgement, rather than instantly settling camera fit as an
      // untimed CPU sync would. Exercise both the initial and second seek.
      panel.sync(frame, view.rect.w / view.rect.h, { ...view, now: now += 1000 / 30 });
      return frame;
    };
    try {
      sync(0); sync(0);
      for (const step of [1, 1, 2, 2]) {
        const frame = sync(step);
        const root = panel.nodeOf(frame.objects.find(o => o.id === 'inspect')!.key)!;
        const pin = frame.objects.find(o => o.id === 'inspect_pin')!;
        assert.deepEqual(pin.pose?.pos ?? pin.pos, [1.2, 3, 0], 'keep the full authored withdrawal');
        let vertices = 0;
        root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const points = object.geometry.getAttribute('position');
          const point = new Vector3();
          for (let i = 0; i < points.count; i++) {
            point.fromBufferAttribute(points, i).applyMatrix4(object.matrixWorld).project(panel.camera);
            const x = (point.x + 1) * view.width / 2, y = (1 - point.y) * view.height / 2;
            assert.ok(Number.isFinite(x) && Number.isFinite(y));
            assert.ok(x >= 16 && x <= view.width - 16 && y >= 16 && y <= view.height - 16,
              `step ${step} mesh ${object.type} vertex ${i} clipped at ${x.toFixed(2)}, ${y.toFixed(2)}`);
            vertices++;
          }
        });
        assert.ok(vertices > 0);
      }
    } finally { panel.destroy(); }
  });
}
