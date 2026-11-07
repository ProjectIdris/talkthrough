import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BufferGeometry, LineSegments, Mesh, MeshPhysicalMaterial } from 'three';
import { validateScene } from '../src/scene/index.ts';
import { emptyFrame, frameAt } from '../src/overlay/timeline.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';

const names = ['hull','patch','sweep','loft','shell','sector','extrusion-holes','extrusion-taper','closed-tube'];
for (const name of names) {
  test(`${name}: native fixture admits all actions and survives authored views and cut lifecycle`, () => {
    const raw = JSON.parse(readFileSync(new URL(`../samples/scenes/integration-${name}-finish.json`, import.meta.url), 'utf8'));
    const checked = validateScene(raw);
    assert.deepEqual(checked.issues, [], name); assert.ok(checked.scene);
    assert.equal(checked.scene.steps.reduce((sum, s) => sum + s.actions.length, 0), raw.steps.reduce((sum: number, s: { actions: unknown[] }) => sum + s.actions.length, 0));
    const panel = new PanelScene({ tier: 'mid' }), owned = new Map<BufferGeometry, number>();
    try {
      const checkpoints = name === 'closed-tube' ? [[0,2],[1,2.1],[2,2.1]] : [[0,2],[1,2.1],[2,0.5],[2,1.5],[2,1.9],[2,1.95],[2,2.1],[3,2.1]];
      for (const [step, time] of checkpoints) {
        const frame = frameAt(checked.scene.steps, step!, time!);
        panel.sync(frame, 1.2, { rect: { x: 0, y: 0, w: 1200, h: 1000 }, width: 1200, height: 1000 });
        assert.ok(panel.screenBounds(1200, 1000), `${name} reaches the production render gate at ${step}:${time}`);
        for (const object of frame.objects) panel.nodeOf(object.key)?.traverse(o => {
          if (!(o instanceof Mesh || o instanceof LineSegments)) return;
          assert.ok(o.geometry.getAttribute('position'));
          if (owned.has(o.geometry)) return;
          owned.set(o.geometry, 0);
          o.geometry.addEventListener('dispose', () => owned.set(o.geometry, owned.get(o.geometry)! + 1));
        });
        for (const id of ['matte','polished']) {
          const object = frame.objects.find(o => o.id === id)!;
          let mesh: Mesh | undefined;
          panel.nodeOf(object.key)?.traverse(o => { if (!mesh && o instanceof Mesh) mesh = o; });
          assert.ok(mesh, `${name}.${id} has actual mesh`);
          assert.ok(mesh.geometry.getAttribute('position').count > 0);
          const mat = mesh.material as MeshPhysicalMaterial;
          assert.equal(mat.roughness, id === 'matte' ? 0.9 : 0.12);
          if (id === 'polished') assert.equal(mat.clippingPlanes?.length ?? 0, 0, 'right-hand peer remains uncut');
        }
      }
      panel.sync(emptyFrame(), 1.2);
      assert.deepEqual([...owned.entries()].filter(([, n]) => n !== 1).map(([g, n]) => [g.type, n]), [], 'all fixture buffers released once');
      panel.destroy();
      assert.ok([...owned.values()].every(n => n === 1), 'teardown does not double-dispose');
    } finally { panel.destroy(); }
  });
}
