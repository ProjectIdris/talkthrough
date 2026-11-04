import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import type { Scene } from '../src/scene/index.ts';
import { PanelScene, FOV_DEGREES, FRAMING_UNITS } from '../src/overlay/scene3d.ts';
import { drawMarks, lineWidth, px, snap } from '../src/overlay/marks.ts';
import { emptyFrame, frameAt, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const sample = (name: string): Scene => JSON.parse(readFileSync(new URL(`../samples/scenes/${name}`, import.meta.url), 'utf8')) as Scene;
const lastFrame = (s: Scene, base?: Frame) => frameAt(s.steps, s.steps.length - 1, 999, base);
const keyOf = (f: Frame, id: string) => f.objects.find((o) => o.id === id)?.key ?? -1;
const world = (p: PanelScene, f: Frame, id: string) => p.nodeOf(keyOf(f, id))?.getWorldPosition(new Vector3()) ?? new Vector3(NaN, NaN, NaN);

test('the 3D scene mirrors a frame: parents hold children, transforms are applied, removed objects go', () => {
  const bars = sample('bar-chart.json');
  const frame = lastFrame(bars);
  const panel = new PanelScene();
  panel.sync(frame, 1.4);
  const body = world(panel, frame, 'bar1-body');
  // The bar grows from its base: a group at the floor, its body offset by half a unit and scaled 2.1 tall.
  assert.ok(Math.abs(body.x - -3.6) < 1e-6 && Math.abs(body.y - (-3 + 0.5 * 2.1)) < 1e-6, body.toArray().join());
  assert.equal(panel.nodeOf(keyOf(frame, 'bar1-body'))?.parent, panel.nodeOf(keyOf(frame, 'bar1')));

  const before = panel.count();
  const cleared = settle(planStep(frame, { say: '', actions: [{ op: 'clear', target: 'bar1' }] }));
  panel.sync(cleared, 1.4);
  assert.equal(panel.count(), before - 2, 'the bar and its body go; the other bars stay');
});

test('the camera frames twelve units on the shorter side, orbits, zooms and follows focus', () => {
  const frame = lastFrame(sample('earth-layers.json'));
  const panel = new PanelScene();
  panel.sync({ ...frame, camera: { az: 0, el: 0, zoom: 1, focus: { key: null, k: 1 } } }, 1);
  const expected = (FRAMING_UNITS / 2) / Math.tan((FOV_DEGREES * Math.PI) / 360);
  assert.ok(Math.abs(panel.camera.position.length() - expected) < 1e-6);
  assert.ok(Math.abs(panel.camera.position.z - expected) < 1e-6, 'azimuth 0 looks from the front');

  panel.sync({ ...frame, camera: { az: 90, el: 0, zoom: 2, focus: { key: null, k: 1 } } }, 1);
  assert.ok(Math.abs(panel.camera.position.x - expected / 2) < 1e-6, 'azimuth 90 looks from the right, twice as close');

  panel.sync({ ...frame, camera: { az: 0, el: 45, zoom: 1, focus: { key: null, k: 1 } } }, 1);
  assert.ok(panel.camera.position.y > 0.7 * expected && panel.camera.position.y < 0.71 * expected);

  // A tall panel frames twelve units across its width.
  panel.sync({ ...frame, camera: { az: 0, el: 0, zoom: 1, focus: { key: null, k: 1 } } }, 0.5);
  assert.ok(Math.abs(panel.camera.position.length() - expected / 0.5) < 1e-6);

  // Focus on an object that has moved: the camera looks at where it is now.
  const moved = settle(planStep(frame, { say: '', actions: [{ op: 'move', id: 'core', to: [3, 2, 1] }] }));
  const key = keyOf(moved, 'core');
  panel.sync({ ...moved, camera: { az: 0, el: 0, zoom: 1, focus: { key, k: 1 } } }, 1);
  assert.ok(Math.abs(panel.camera.position.x - 3) < 1e-6 && Math.abs(panel.camera.position.y - 2) < 1e-6);
  // Half way between the old and new focus point.
  panel.sync({ ...moved, camera: { az: 0, el: 0, zoom: 1, focus: { key, from: { key: null, k: 1 }, k: 0.5 } } }, 1);
  assert.ok(Math.abs(panel.camera.position.x - 1.5) < 1e-6);
});

test('every shape the language has can be built, at the size it was given', () => {
  const panel = new PanelScene();
  const frame = settle(planStep(emptyFrame(), {
    say: '',
    actions: [
      ...(['box', 'sphere', 'cylinder', 'cone', 'plane'] as const).map((shape) => ({ op: 'add', shape, id: shape, size: [2, 4, 3], color: 'red' })),
      { op: 'add', shape: 'torus', id: 'torus', size: [6, 1, 4], color: 'red' },
      { op: 'add', shape: 'line', id: 'line', pts: [[0, 0, 0], [1, 1, 0], [2, 0, 0]], color: 'blue' },
      { op: 'add', shape: 'arrow', id: 'arrow', pts: [[0, 0, 0], [0, 3, 0]], color: 'blue' },
      { op: 'add', shape: 'group', id: 'group' },
      { op: 'add', shape: 'text', id: 'text', text: 'hi', height: 1, color: 'white' },
    ],
  } as never));
  panel.sync(frame, 1);
  assert.equal(panel.count(), 10);
  for (const o of frame.objects) assert.ok(panel.nodeOf(o.key), o.id);
  type Geo = { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void };
  const extent = (id: string): number[] => {
    const g = (panel.nodeOf(keyOf(frame, id)) as unknown as { geometry: Geo }).geometry;
    g.computeBoundingBox();
    const b = g.boundingBox as { min: Vector3; max: Vector3 };
    return b.max.clone().sub(b.min).toArray().map((n) => Math.round(n * 1000) / 1000);
  };
  for (const id of ['box', 'sphere', 'cylinder', 'cone']) assert.deepEqual(extent(id), [2, 4, 3], id);
  assert.deepEqual(extent('plane').slice(0, 2), [2, 4]);
  assert.deepEqual(extent('torus'), [6, 1, 4], 'a torus lies flat: outer diameter x and z, tube thickness y');
});

/** A drawing context that records what is asked of it. */
function recordingContext() {
  const calls: string[] = [];
  const target = { canvas: {}, measureText: () => ({ width: 100 }) } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => { calls.push(`${key}(${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : '')).join(',')})`); };
    },
    set() { return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

test('marks sit on physical pixels at any display scaling', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    for (const v of [0, 0.3, 17.77, 640.4, 1919.99]) {
      const s = snap(v, dpr);
      assert.ok(Math.abs(s * dpr - Math.round(s * dpr)) < 1e-9, `${v} at ${dpr}`);
      assert.ok(Math.abs(s - v) <= 0.5 / dpr + 1e-9);
    }
  }
  assert.equal(px(500, 1920, 1), 960);
  assert.equal(px(1000, 1080, 2), 1080);
  assert.equal(lineWidth({ width: 1920, height: 1080, dpr: 1 }), 5);
  assert.equal(lineWidth({ width: 800, height: 400, dpr: 1 }), 3);
});

test('every mark of every sample draws, hidden and fully faded ones draw nothing', () => {
  for (const name of ['bar-chart.json', 'request-flow.json', 'earth-layers.json']) {
    const frame = lastFrame(sample(name));
    const { ctx, calls } = recordingContext();
    drawMarks(ctx, frame.marks, { width: 1920, height: 1080, dpr: 1.25 });
    assert.ok(calls.some((c) => c.startsWith('stroke') || c.startsWith('fill')), name);
  }
  const frame = lastFrame(sample('bar-chart.json'));
  const hidden = recordingContext();
  drawMarks(hidden.ctx, frame.marks.map((m) => ({ ...m, appear: 0 })), { width: 1920, height: 1080, dpr: 1 });
  assert.ok(!hidden.calls.some((c) => c.startsWith('stroke') || c.startsWith('fill')));
  const faded = recordingContext();
  drawMarks(faded.ctx, frame.marks.map((m) => ({ ...m, fade: 0 })), { width: 1920, height: 1080, dpr: 1 });
  assert.ok(!faded.calls.some((c) => c.startsWith('stroke') || c.startsWith('fill')));
});

test('a box is drawn where the scene says, across the whole display', () => {
  const frame = frameAt([{ say: '', actions: [{ op: 'box', id: 'b', x: 500, y: 250, w: 100, h: 500, color: 'red' }] }], 0, 5);
  const { ctx, calls } = recordingContext();
  drawMarks(ctx, frame.marks, { width: 2000, height: 1000, dpr: 1 });
  // The rounded corner path starts at x + radius on the top edge: 1000 + 8, 250.
  assert.ok(calls.includes('moveTo(1008,250)'), calls.slice(0, 12).join(' '));
  assert.ok(calls.some((c) => c.startsWith('arcTo(1200,250,1200,750')), 'right edge is at 1200, bottom at 750');
});
