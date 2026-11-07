import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import { validateScene } from '../src/scene/index.ts';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, frameAt, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const stream = { op: 'add', shape: 'stream', id: 'flow', along: 'pipe', count: 4, mark: 'dot' };
function watch(panel: PanelScene, frame: Frame): () => number {
  const key = frame.objects.find(o => o.id === 'flow')!.key;
  const markers: Mesh[] = [];
  panel.nodeOf(key)!.traverse(o => { if (o instanceof Mesh) markers.push(o); });
  assert.equal(markers.length, 4);
  const geometry = markers[0]!.geometry;
  assert.ok(markers.every(m => m.geometry === geometry));
  assert.equal(new Set(markers.map(m => m.material)).size, 4);
  let count = 0;
  geometry.addEventListener('dispose', () => count++);
  return () => count;
}
for (const mode of ['clear', 'replacement', 'destroy'] as const) {
  test(`shared stream geometry releases exactly once on ${mode} and repeated destroy`, () => {
    const checked = validateScene({ steps: [{ say: 'A flow.', actions: [
      { op: 'add', shape: 'tube', id: 'pipe', pts: [[0,0,0],[3,0,0]], radius: 0.1 }, stream,
    ] }] });
    assert.deepEqual(checked.issues, []); assert.ok(checked.scene);
    const frame = frameAt(checked.scene.steps, 0, 99), panel = new PanelScene();
    try {
      panel.sync(frame, 1);
      const oldCount = watch(panel, frame);
      for (let n = 0; n < 5; n++) panel.sync(frame, 1);
      assert.equal(oldCount(), 0);
      let newCount: (() => number) | undefined;
      if (mode === 'clear') panel.sync(emptyFrame(), 1);
      else if (mode === 'replacement') {
        const next = settle(planStep(frame, { say: 'Replace the flow.', actions: [{ ...stream, period: 2 }] } as Step));
        panel.sync(next, 1); newCount = watch(panel, next);
        assert.equal(newCount(), 0);
      } else panel.destroy();
      assert.equal(oldCount(), 1);
      panel.destroy(); panel.destroy();
      assert.equal(oldCount(), 1);
      if (newCount) assert.equal(newCount(), 1);
    } finally { panel.destroy(); }
  });
}
