import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
import { drawPin } from '../src/overlay/annotations.ts';
import { LabelBoard, Occupancy } from '../src/overlay/labels.ts';
import type { Placement } from '../src/overlay/labels.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

type Sample = { steps: Step[] };
type PinPlacement = Pick<Placement, 'rect' | 'attach'>;

function handLabel(name: 'hand.json' | 'hand-jointed.json'): { leader: number; pathDistance: number } {
  const sample = JSON.parse(readFileSync(resolve('samples/organic', name), 'utf8')) as Sample;
  const frame = frameAt(sample.steps, sample.steps.length - 1, 20);
  assert.ok(frame.panel, `${name} has its authored stage`);
  const { rect } = frame.panel;
  const view = { rect, width: 1000, height: 1000 };
  const panel = new PanelScene({ tier: 'low' });
  try {
    panel.sync(frame, rect.w / rect.h, view);
    const bounds = panel.screenBounds(view.width, view.height);
    assert.ok(bounds, `${name} has model bounds`);
    const occ = new Occupancy(view.width, view.height);
    for (const hull of panel.silhouette(view.width, view.height)) occ.fillConvex(hull);

    const board = new LabelBoard();
    board.beginFrame({ width: view.width, height: view.height, model: bounds.model, dragging: false, now: 0 });
    const placements = new Map<number, PinPlacement>();
    // A fixed text metric keeps this headless integration test deterministic while sizing real drawPin requests.
    const ctx = new Proxy({ measureText: (text: string) => ({ width: [...text].length * 7 }) }, {
      get(target, key: string) { return key in target ? target[key as keyof typeof target] : () => undefined; },
      set(target, key: string, value: unknown) { Reflect.set(target, key, value); return true; },
    });
    const annotator = {
      view: { width: view.width, height: view.height, dpr: 1 },
      stage: { w: rect.w, h: rect.h },
      project: (key: number, point: [number, number, number] | undefined, anchor?: string) => panel.project(key, point, view.width, view.height, anchor),
      place: (key: number, request: Parameters<typeof board.place>[1]) => {
        const placed = board.place(key, request, () => ({ occ }));
        placements.set(key, placed);
        return placed;
      },
    };
    frame.marks.forEach((mark, i) => drawPin(ctx as unknown as CanvasRenderingContext2D, mark, annotator, i));
    const pin = frame.marks.find((mark) => mark.mark.op === 'pin' && mark.mark.text === 'Little finger');
    assert.ok(pin?.onKey, `${name} contains the Little finger pin`);
    const placed = placements.get(pin.key);
    assert.ok(placed, `${name} places the Little finger tag`);
    const anchor = panel.project(pin.onKey, pin.mark.op === 'pin' ? pin.mark.point : undefined, view.width, view.height, pin.mark.op === 'pin' ? pin.mark.anchor : undefined);
    assert.ok(anchor?.visible, `${name} projects its fused finger`);

    const little = sample.steps.flatMap((step) => step.actions).find((action) => action.op === 'add' && action.id === 'little');
    assert.ok(little && 'pts' in little && Array.isArray(little.pts), `${name} has the authored little-finger path`);
    const object = panel.nodeOf(pin.onKey);
    assert.ok(object);
    object.updateWorldMatrix(true, false);
    const pathDistance = Math.min(...little.pts.map((point) => {
      const p = new Vector3(...point).applyMatrix4(object.matrixWorld).project(panel.camera);
      const x = ((p.x + 1) / 2) * view.width, y = ((1 - p.y) / 2) * view.height;
      return Math.hypot(anchor.x - x, anchor.y - y);
    }));
    return { leader: Math.hypot(placed.attach.x - anchor.x, placed.attach.y - anchor.y), pathDistance };
  } finally {
    panel.destroy();
  }
}

test('Little finger labels stay connected to their fused fingers in both organic hand samples', () => {
  for (const sample of ['hand.json', 'hand-jointed.json'] as const) {
    const result = handLabel(sample);
    assert.ok(result.pathDistance < 40, `${sample}: pin anchor stays on its finger (${result.pathDistance.toFixed(1)} px)`);
    assert.ok(result.leader <= 170, `${sample}: tag leader remains near the finger (${result.leader.toFixed(1)} px)`);
  }
});
