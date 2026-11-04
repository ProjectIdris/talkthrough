import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, sceneGuide } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';
import { drawMarks } from '../src/overlay/marks.ts';
import { markFootprint } from '../src/overlay/placement.ts';
import { pathLength, smoothPath, tiltedCorners } from '../src/overlay/shapes.ts';
import { frameAt, strokeSeconds } from '../src/overlay/timeline.ts';

const scene = (...actions: unknown[]) => ({ steps: [{ say: 'ok', actions }] });
const actionsOf = (r: ReturnType<typeof validateScene>) => (r.scene as Scene).steps.flatMap((s) => s.actions);

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
const VIEW = { width: 1920, height: 1080, dpr: 1 };
const draw = (s: unknown) => {
  const result = validateScene(s);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const scn = result.scene as Scene;
  const frame = frameAt(scn.steps, scn.steps.length - 1, 999);
  const rec = recordingContext();
  drawMarks(rec.ctx, frame.marks, VIEW);
  return rec.calls;
};

test('the new marks pass the validator with their fields, and bad ones are dropped', () => {
  const r = validateScene(scene(
    { op: 'box', id: 'a', x: 10, y: 10, w: 100, h: 100, rot: 30, color: 'red' },
    { op: 'circle', id: 'c', x: 10, y: 10, w: 100, h: 100, rot: -45, color: 'red' },
    { op: 'poly', id: 'p', pts: [[10, 10], [100, 20], [50, 90]], color: 'blue' },
    { op: 'point', id: 'q', x: 500, y: 500, color: 'green' },
    { op: 'trace', id: 't', pts: [[10, 10], [100, 20], [50, 90]], head: true, color: 'red' },
  ));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
  const got = actionsOf(r);
  assert.equal((got[0] as { rot?: number }).rot, 30);
  assert.equal((got[2] as { pts: unknown[] }).pts.length, 3);
  assert.equal((got[4] as { head?: boolean }).head, true);
  // A polygon needs three corners, a trace two; a point must be on the screen; a tilt is a turn, not a number of turns.
  const bad = validateScene(scene(
    { op: 'poly', id: 'p', pts: [[10, 10], [100, 20]], color: 'blue' },
    { op: 'trace', id: 't', pts: [[10, 10]], color: 'red' },
    { op: 'point', id: 'q', x: 5000, y: 5, color: 'green' },
    { op: 'box', id: 'a', x: 10, y: 10, w: 100, h: 100, rot: 5000, color: 'red' },
  ));
  const kept = actionsOf(bad);
  assert.ok(!kept.some((a) => a.op === 'poly' || a.op === 'trace'), 'too few points: dropped');
  assert.ok(bad.issues.length >= 3);
});

test('a polygon is drawn closed and filled, a trace open, a point as a ring, and a tilted box is turned about its middle', () => {
  const poly = draw(scene({ op: 'poly', id: 'p', pts: [[100, 100], [300, 120], [200, 300]], color: 'purple' }));
  assert.ok(poly.some((c) => c.startsWith('closePath')) && poly.some((c) => c.startsWith('fill')) && poly.some((c) => c.startsWith('stroke')), 'closed, filled and stroked');
  const trace = draw(scene({ op: 'trace', id: 't', pts: [[100, 100], [300, 120], [200, 300], [500, 400]], color: 'red' }));
  assert.ok(!trace.some((c) => c.startsWith('closePath')), 'a trace is open');
  assert.ok(trace.filter((c) => c.startsWith('lineTo')).length > 8, 'smoothed into many short segments');
  const arrowed = draw(scene({ op: 'trace', id: 't', pts: [[100, 100], [300, 120], [500, 400]], head: true, color: 'red' }));
  assert.ok(arrowed.some((c) => c.startsWith('closePath')), 'a head is drawn');
  const point = draw(scene({ op: 'point', id: 'q', x: 500, y: 500, color: 'green' }));
  assert.ok(point.some((c) => c.startsWith('arc(')) && point.some((c) => c.startsWith('fill')), 'a ring and a dot');
  const tilted = draw(scene({ op: 'box', id: 'a', x: 100, y: 100, w: 200, h: 200, rot: 30, color: 'red' }));
  const flat = draw(scene({ op: 'box', id: 'a', x: 100, y: 100, w: 200, h: 200, color: 'red' }));
  assert.ok(tilted.some((c) => c.startsWith('rotate(0.52')), `turned 30 degrees: ${tilted.filter((c) => c.startsWith('rotate')).join()}`);
  assert.ok(!flat.some((c) => c.startsWith('rotate')), 'an upright box is not turned');
});

test('the geometry: tilted corners, a smooth path through its points, lengths', () => {
  const upright = tiltedCorners(100, 100, 40, 20, 0);
  assert.deepEqual(upright.map(([x, y]) => [Math.round(x), Math.round(y)]), [[80, 90], [120, 90], [120, 110], [80, 110]]);
  const quarter = tiltedCorners(100, 100, 40, 20, 90).map(([x, y]) => [Math.round(x), Math.round(y)]);
  assert.deepEqual(quarter, [[110, 80], [110, 120], [90, 120], [90, 80]], 'a quarter turn clockwise on screen axes');
  const pts: [number, number][] = [[0, 0], [100, 50], [200, 0], [300, 80]];
  const curve = smoothPath(pts, 6);
  for (const p of pts) assert.ok(curve.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6), `passes through ${p}`);
  assert.ok(pathLength(curve) > pathLength(pts) * 0.99 && pathLength(curve) < pathLength(pts) * 1.2);
  assert.equal(pathLength([[0, 0], [3, 4]]), 5);
  assert.equal(pathLength([[0, 0], [3, 0], [3, 4]], true), 12);
});

test('strokes take time by their length; a polygon and a trace are strokes, a point appears', () => {
  const poly = strokeSeconds({ op: 'poly', id: 'p', pts: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], color: 'red' });
  const small = strokeSeconds({ op: 'poly', id: 'p', pts: [[0, 0], [10, 0], [10, 10]], color: 'red' });
  assert.ok(poly !== undefined && small !== undefined && poly > small && poly <= 1.2 && small >= 0.8);
  assert.ok(strokeSeconds({ op: 'trace', id: 't', pts: [[0, 0], [500, 500]], color: 'red' }) !== undefined);
  assert.equal(strokeSeconds({ op: 'point', id: 'q', x: 5, y: 5, color: 'red' }), undefined);
});

test('what a mark covers is kept clear of cards: a tilted box by its turned outline, a polygon, a trace and a point by their bounds', () => {
  const upright = markFootprint({ op: 'box', id: 'a', x: 100, y: 100, w: 200, h: 200, color: 'red' }, 1)[0]!;
  assert.deepEqual(upright, { x: 100, y: 100, w: 200, h: 200 });
  const tilted = markFootprint({ op: 'box', id: 'a', x: 100, y: 100, w: 200, h: 200, rot: 45, color: 'red' }, 1)[0]!;
  assert.ok(tilted.w > 270 && tilted.w < 290 && tilted.x < 70, `a square turned 45 degrees spans about 283: ${JSON.stringify(tilted)}`);
  const poly = markFootprint({ op: 'poly', id: 'p', pts: [[100, 100], [300, 150], [200, 400]], color: 'red' }, 1)[0]!;
  assert.deepEqual(poly, { x: 100, y: 100, w: 200, h: 300 });
  assert.equal(markFootprint({ op: 'trace', id: 't', pts: [[10, 10], [50, 90]], color: 'red' }, 1)[0]!.h, 80);
  const dot = markFootprint({ op: 'point', id: 'q', x: 500, y: 500, color: 'red' }, 2)[0]!;
  assert.ok(dot.x < 500 && dot.x + dot.w > 500 && dot.y < 500 && dot.y + dot.h > 500);
});

test('the model is told about the new marks', () => {
  for (const word of ['poly', 'point', 'trace', 'rot']) assert.ok(sceneGuide.includes(word), word);
  assert.ok(sceneGuide.includes('a tilted square is a poly'), 'the tilted square rule is in the guide');
  // Live, the shapes were chosen only once the instruction stood in the first rule (as for diagrams), not in a later description.
  const first = sceneGuide.split('\n').find((l) => l.startsWith('- Step 1'))!;
  for (const word of ['poly', 'point', 'trace']) assert.ok(first.includes(word), `the first rule names ${word}`);
});
