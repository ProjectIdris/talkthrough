import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import { validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

// A solid of flesh, bone, a plant or food is rounded like a living thing: its ends and edges give way over most of the radius, not a thin machined rim.

const solid = (shape: string, material: string, size: number[]): Scene => ({
  steps: [{ say: 'a solid', actions: [{ op: 'panel', x: 100, y: 100, w: 800, h: 800 }, { op: 'add', shape, id: 's', size, material }] }],
}) as unknown as Scene;

/** How far from the axis the topmost ring of the solid's mesh reaches, against its half width: 1 is a flat end, near 0 a dome. */
function topReach(shape: string, material: string): number {
  const result = validateScene(solid(shape, material, [1, 3, 1]));
  const frame = frameAt(result.scene!.steps, 0, 99);
  const panel = new PanelScene({ tier: 'high' });
  try {
    panel.sync(frame, 1);
    const root = panel.nodeOf(frame.objects.find((o) => o.id === 's')!.key)!;
    let reach = 0;
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = o.geometry.getAttribute('position');
      let top = -Infinity;
      for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top - 1e-4) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
    });
    return reach / 0.5;
  } finally { panel.destroy(); }
}

test('a bone cylinder has a domed end where a plastic one keeps a flat face with a thin rim', () => {
  assert.ok(topReach('cylinder', 'plastic') > 0.8, 'plastic keeps its flat end');
  assert.ok(topReach('cylinder', 'bone') < 0.5, 'bone is rounded over most of its radius');
  assert.ok(topReach('cylinder', 'flesh') < 0.5);
});

test('a soft box is rounded over a third of its smallest side; a hard one keeps its small rim', () => {
  assert.ok(topReach('box', 'plastic') > 0.8);
  assert.ok(topReach('box', 'bone') < 0.7);
});
