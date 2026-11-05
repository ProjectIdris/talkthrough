import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, Vector3 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const WIN = { width: 1920, height: 1080 };
const STAGE = { x: 1248, y: 221, w: 568, h: 432 };
const settled = (...actions: unknown[]): Frame => frameAt([step({ op: 'panel', x: 500, y: 160, w: 360, h: 660 }, ...actions)], 0, 99);

/** How far (pixels) anything the scene draws lies outside the rectangle the render is cut to; 0 when all of it is inside. */
function cutOff(scene: PanelScene, drawn: { x: number; y: number; w: number; h: number }): number {
  scene.scene.updateMatrixWorld(true);
  const v = new Vector3();
  let worst = 0;
  scene.scene.traverseVisible((o) => {
    const m = o as Mesh;
    const mat = m.material as { type?: string } | undefined;
    if (!m.isMesh || mat?.type === 'ShadowMaterial' || m.geometry.type === 'PlaneGeometry') return; // the floor's shadow has a rectangle of its own
    const pos = m.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(scene.camera);
      const sx = ((v.x + 1) / 2) * WIN.width, sy = ((1 - v.y) / 2) * WIN.height;
      if (sx < 0 || sy < 0 || sx > WIN.width || sy > WIN.height) continue; // off the display: nothing to cut
      worst = Math.max(worst, drawn.x - sx, sx - (drawn.x + drawn.w), drawn.y - sy, sy - (drawn.y + drawn.h));
    }
  });
  return worst;
}

test('a line or an arrow that runs far past the parts is drawn whole: the render is never cut tighter than what is drawn', () => {
  const frame = settled(
    { op: 'add', shape: 'box', id: 'tank', pos: [-3, 0, 0], size: [3, 3, 3] },
    { op: 'add', shape: 'cylinder', id: 'pump', pos: [3, 0, 0], size: [2, 3, 2] },
    { op: 'add', shape: 'arrow', id: 'flow', pts: [[3, -2, 0], [9, -4, 2], [-8, -4, 2], [-3, -2, 0]] },
    { op: 'add', shape: 'line', id: 'trace', pts: [[-3, 2, 0], [-6, 6, 0], [0, 9, 0], [6, 6, 0], [3, 2, 0]] },
    { op: 'orbit', az: -25, el: 14, dur: 0 },
  );
  const scene = new PanelScene();
  scene.sync(frame, STAGE.w / STAGE.h, { rect: STAGE, ...WIN });
  const bounds = scene.screenBounds(WIN.width, WIN.height)!;
  const out = cutOff(scene, bounds.drawn);
  assert.ok(out < 1, `${out.toFixed(1)} px of the drawing lies outside the rectangle it is cut to`);
});

test('a model that is pulled apart or posed past where it was fitted is drawn whole', () => {
  const frame = settled(
    { op: 'add', shape: 'group', id: 'g', pos: [0, 0, 0] },
    { op: 'add', parent: 'g', shape: 'box', id: 'base', pos: [0, 0, 0], size: [3, 1, 3] },
    { op: 'add', parent: 'g', shape: 'cylinder', id: 'top', pos: [0, 2, 0], size: [1, 2, 1], explode: [0, 6, 0] },
    { op: 'explode', id: 'g', to: 1, dur: 0 },
    { op: 'orbit', az: 30, el: 20, dur: 0 },
  );
  const scene = new PanelScene();
  scene.sync(frame, STAGE.w / STAGE.h, { rect: STAGE, ...WIN });
  const bounds = scene.screenBounds(WIN.width, WIN.height)!;
  assert.ok(cutOff(scene, bounds.drawn) < 1);
});
