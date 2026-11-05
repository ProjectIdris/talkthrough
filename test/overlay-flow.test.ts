import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep, settle, withMotion } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { isMoving } from '../src/overlay/motion.ts';

// A stream (markers running along a path, a connector or a flow diagram's arrow) has no clock of its own: how far round it is
// is a function of the time since the step began, so a frame, a clip and the live page agree, and a finished scene goes on running.

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const tube = (id: string, extra: object = {}) => ({ op: 'add', shape: 'tube', id, pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1, ...extra });
const wheel = (id: string) => ({ op: 'add', shape: 'cylinder', id, size: [2, 0.4, 2], rot: [90, 0, 0] });
const run = (...actions: unknown[]) => planStep(emptyFrame(), step(...actions));
const stream = (f: Frame, id: string) => f.objects.find((o) => o.id === id);

test('a stream is a function of time: half a period in, half a lap; the same time gives the same place', () => {
  const plan = run(tube('pipe'), { op: 'add', shape: 'stream', id: 's', along: 'pipe', period: 2, at: 1 });
  near(stream(evaluate(plan, 0.5), 's')?.phase ?? 0, 0);
  near(stream(evaluate(plan, 2), 's')?.phase, 0.5);
  near(stream(evaluate(plan, 3), 's')?.phase, 1);
  near(stream(evaluate(plan, 2), 's')?.phase, 0.5);
  assert.equal(stream(evaluate(plan, 2), 's')?.parentKey, evaluate(plan, 2).objects.find((o) => o.id === 'pipe')?.key);
});

test('a negative period runs backwards; the default is four seconds a lap', () => {
  near(stream(evaluate(run(tube('p'), { op: 'add', shape: 'stream', id: 's', along: 'p', period: -2 }), 1), 's')?.phase, -0.5);
  near(stream(evaluate(run(tube('p'), { op: 'add', shape: 'stream', id: 's', along: 'p' }), 1), 's')?.phase, 0.25);
});

test('a stream locked to a spinning part keeps step with it: ratio laps for each turn', () => {
  const plan = run(wheel('w'), tube('belt'), { op: 'spin', id: 'w', rpm: 60, dur: 0 }, { op: 'add', shape: 'stream', id: 's', along: 'belt', by: 'w', ratio: 2 });
  near(stream(evaluate(plan, 0.5), 's')?.phase, 1); // half a second is half a turn of the wheel: one lap
  near(stream(evaluate(plan, 1), 's')?.phase, 2);
});

test('it goes on running when the scene has finished, and the next step starts where it left off', () => {
  const first = settle(run(tube('p'), { op: 'add', shape: 'stream', id: 's', along: 'p', period: 4 }));
  assert.ok(isMoving(first.motion));
  const later = withMotion(first, 1);
  near(stream(later, 's')?.phase, (stream(first, 's')?.phase ?? 0) + 0.25);
  const next = planStep(later, step({ op: 'style', id: 'p', color: 'red' }));
  near(stream(evaluate(next, 0), 's')?.phase, stream(later, 's')?.phase ?? -1);
  near(stream(evaluate(next, 2), 's')?.phase, (stream(later, 's')?.phase ?? 0) + 0.5);
});

test('a stream goes with the path it runs along', () => {
  const first = settle(run(tube('p'), { op: 'add', shape: 'stream', id: 's', along: 'p' }));
  const next = planStep(first, step({ op: 'clear', target: 'p' }));
  const gone = evaluate(next, 5);
  assert.equal(stream(gone, 's'), undefined);
  assert.equal(isMoving(gone.motion), false);
});

test('a stream added again under its id takes its place, and runs once', () => {
  const first = settle(run(tube('p'), { op: 'add', shape: 'stream', id: 's', along: 'p', period: 4 }));
  const plan = planStep(first, step({ op: 'add', shape: 'stream', id: 's', along: 'p', period: 1 }));
  const f = evaluate(plan, 5);
  assert.equal(f.objects.filter((o) => o.id === 's' && o.appear > 0).length, 1);
  assert.equal(f.motion.spins.filter((s) => s.key < 0 && s.rate !== 0).length, 1);
});

// ---- on a flat diagram -----------------------------------------------------------------------------------------------------------

const flow = [
  { op: 'diagram', id: 'd', kind: 'flow', x: 50, y: 50, w: 600, h: 300 },
  { op: 'node', id: 'a', of: 'd', text: 'Farm' }, { op: 'node', id: 'b', of: 'd', text: 'Shop' },
  { op: 'edge', id: 'e', from: 'a', to: 'b', text: 'milk' },
];

test('on a flow diagram a stream runs along an arrow, begins once the arrow is there, and has its lap count on the piece', () => {
  const plan = run(...flow, { op: 'add', shape: 'stream', id: 's', along: 'e', period: 2 });
  const items = (t: number) => evaluate(plan, t).diagrams[0]?.items ?? [];
  const at = (t: number) => items(t).find((i) => i.id === 's');
  assert.equal(at(0)?.appear, 0);
  const start = at(3)?.phase ?? NaN;
  near((at(4)?.phase ?? NaN) - start, 0.5);
  assert.equal(evaluate(plan, 4).objects.length, 0, 'it is on the diagram, not on the 3D stage');
  assert.ok(isMoving(evaluate(plan, 4).motion));
});

test('a flow diagram cleared takes its streams and their running with it', () => {
  const first = settle(run(...flow, { op: 'add', shape: 'stream', id: 's', along: 'e' }));
  assert.ok(isMoving(first.motion));
  const gone = evaluate(planStep(first, step({ op: 'clear', target: 'marks' })), 5);
  assert.equal(isMoving(gone.motion), false);
  assert.equal(gone.diagrams.length, 0);
});

// The markers on the flat diagram are drawn along the arrow, where the lap count puts them.
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';

function dotsOf(frame: Frame): Array<[number, number]> {
  const dots: Array<[number, number]> = [];
  const state: Record<string, unknown> = { font: '10px x' };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      if (k === 'arc') return (x: number, y: number) => { dots.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]); };
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  new DiagramPainter().draw(ctx, frame.diagrams, { width: 1920, height: 804, dpr: 1 }, 0);
  return dots;
}

test('dots are drawn along the arrow, and are in other places a moment later', () => {
  const first = settle(run(...flow, { op: 'add', shape: 'stream', id: 's', along: 'e', mark: 'dot', count: 3, period: 4 }));
  const none = dotsOf(settle(run(...flow)));
  const a = dotsOf(first), b = dotsOf(withMotion(first, 0.6));
  assert.equal(none.length, 0, 'no dots without a stream');
  assert.ok(a.length >= 2 && b.length >= 2, `${a.length} ${b.length}`);
  assert.notDeepEqual(a, b);
  assert.deepEqual(dotsOf(first), a, 'the same lap count draws the same places');
  // they run along one line from the first node toward the second: left to right here
  const xs = a.map((d) => d[0]).sort((p, q) => p - q);
  const moved = b.map((d) => d[0]).sort((p, q) => p - q);
  assert.ok((moved[moved.length - 1] as number) > (xs[xs.length - 1] as number) - 1e-6 || (moved[0] as number) < (xs[0] as number), 'they have gone on, or one has come round to the start');
});
