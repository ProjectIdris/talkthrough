import test from 'node:test';
import assert from 'node:assert/strict';

// A pin written at a point inside a solid is on the object, not behind anything: the middle of a kit wheel (a barrel with a cap set into each end)
// has a closed piece's near face between it and the camera, and its label was never drawn.
async function pinAt(part: Record<string, unknown>, point: [number, number, number]) {
  const { PanelScene } = await import('../src/overlay/scene3d.ts');
  const { frameAt } = await import('../src/overlay/timeline.ts');
  const f = frameAt([{ say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, { op: 'add', id: 'p', ...part }] }] as never, 0, 99);
  const scene = new PanelScene();
  scene.sync(f, 1);
  const key = f.objects.find((o) => o.id === 'p')?.key ?? -1;
  return scene.project(key, point, 800, 800);
}

const wheel = { shape: 'part', part: 'wheel', n: 8, size: [2, 2, 0.4] };

test('a pin inside the hub of a kit wheel is drawn, and so is one on the rim', async () => {
  for (const point of [[0, 0, 0], [0, 0, 0.05], [0, 0, 0.1], [0.3, 0, 0], [0.9, 0, 0]] as Array<[number, number, number]>) {
    const at = await pinAt(wheel, point);
    assert.ok(at?.visible, `point ${JSON.stringify(point)} is on the wheel`);
  }
});

test('a point behind a surface of the object, in an empty cavity, is still not drawn', async () => {
  const shell = { shape: 'shell', size: [4, 4, 4], inner: 0.6, latitude: [-90, 90] };
  const cavity = await pinAt(shell, [0, 0, 0]);
  assert.ok(!cavity?.visible, 'the middle of a closed hollow shell is hidden by its wall');
});
