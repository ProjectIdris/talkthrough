import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import {
  APPEAR_SECONDS, DEFAULT_CAMERA, DEFAULT_PANEL, FADE_OUT_SECONDS, emptyFrame, estimateSpeechSeconds, evaluate, frameAt,
  parseColor, planStep, settle, shiftCamera,
} from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const samplesDir = new URL('../samples/scenes/', import.meta.url);
const sample = (name: string): Scene => JSON.parse(readFileSync(new URL(name, samplesDir), 'utf8')) as Scene;
const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const cube = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], color: 'blue', ...extra });
const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id);

test('every sample plays to the end with finite numbers at any time', () => {
  for (const name of readdirSync(samplesDir).filter((f) => f.endsWith('.json') && !f.includes('followup'))) {
    const scene = sample(name);
    let frame = emptyFrame();
    for (const [i, s] of scene.steps.entries()) {
      const plan = planStep(frame, s);
      for (const t of [0, 0.1, plan.duration / 2, plan.duration, Infinity]) {
        const text = JSON.stringify(evaluate(plan, t), (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'BAD' : v));
        assert.ok(!text.includes('"BAD"'), `${name} step ${i} t=${t}`);
      }
      frame = settle(plan);
    }
  }
});

test('marks draw in over the appear time, at their own offset', () => {
  const s = step({ op: 'box', id: 'b', x: 10, y: 10, w: 100, h: 50, color: 'red', at: 1 });
  const plan = planStep(emptyFrame(), s);
  assert.equal(evaluate(plan, 0.9).marks.length, 0);
  near(evaluate(plan, 1).marks[0]?.appear, 0);
  const mid = evaluate(plan, 1 + APPEAR_SECONDS / 2).marks[0]?.appear ?? -1;
  assert.ok(mid > 0.3 && mid < 0.7, String(mid));
  assert.equal(evaluate(plan, 2).marks[0]?.appear, 1);
  assert.equal(plan.duration, 1 + APPEAR_SECONDS);
});

test('a tween runs from where the property is, and a later one starts from the middle of an earlier one', () => {
  const plan = planStep(emptyFrame(), step(
    cube('c'),
    { op: 'move', id: 'c', to: [10, 0, 0], at: 0, dur: 2 },
    { op: 'move', id: 'c', to: [0, 0, 0], at: 1, dur: 1 },
  ));
  near(obj(evaluate(plan, 0), 'c')?.pos[0], 0);
  const atOne = obj(evaluate(plan, 1), 'c')?.pos[0] ?? NaN;
  assert.ok(atOne > 0 && atOne < 10);
  // The second tween is in charge from t=1 and starts at that value, then returns to 0.
  const justAfter = obj(evaluate(plan, 1.001), 'c')?.pos[0] ?? NaN;
  assert.ok(Math.abs(justAfter - atOne) < 0.1);
  near(obj(evaluate(plan, 2), 'c')?.pos[0], 0);
  near(obj(settle(plan), 'c')?.pos[0], 0);
});

test('actions are played in time order, whatever order they are listed in', () => {
  const plan = planStep(emptyFrame(), step(
    cube('c'),
    { op: 'move', id: 'c', to: [10, 0, 0], at: 2, dur: 0 },
    { op: 'move', id: 'c', to: [5, 0, 0], at: 1, dur: 0 },
  ));
  near(obj(evaluate(plan, 1.5), 'c')?.pos[0], 5);
  near(obj(settle(plan), 'c')?.pos[0], 10);
});

test('a spin to 360 turns all the way round and ends where it began', () => {
  const plan = planStep(emptyFrame(), step(cube('c'), { op: 'turn', id: 'c', to: [0, 360, 0], at: 0, dur: 2 }));
  near(obj(evaluate(plan, 1), 'c')?.rot[1], 180);
  near(obj(evaluate(plan, 1.5), 'c')?.rot[1] ?? 0, 360 * 0.875 + 0, 120); // somewhere past halfway
  near(obj(settle(plan), 'c')?.rot[1], 360);
});

test('the next step starts from the settled frame, so ids and positions carry over', () => {
  const first = planStep(emptyFrame(), step(cube('c', { pos: [1, 2, 3] }), { op: 'move', id: 'c', to: [5, 5, 5], dur: 1 }));
  const base = settle(first);
  const second = planStep(base, step({ op: 'move', id: 'c', to: [0, 0, 0], at: 0, dur: 1 }));
  near(obj(evaluate(second, 0), 'c')?.pos[0], 5);
  near(obj(evaluate(second, 0.5), 'c')?.pos[0] ?? NaN, 2.5, 2.4);
  near(obj(settle(second), 'c')?.pos[0], 0);
  assert.equal(obj(base, 'c')?.key, obj(settle(second), 'c')?.key, 'the same object, not a new one');
});

test('clear fades a mark or an object out, takes what hangs from it, and an id can come back as a new object', () => {
  const plan = planStep(emptyFrame(), step(
    { op: 'add', shape: 'group', id: 'g' }, cube('a', { parent: 'g' }), cube('free'),
    { op: 'box', id: 'm', x: 1, y: 1, w: 5, h: 5, color: 'red' },
    { op: 'clear', target: 'g', at: 1 }, { op: 'clear', target: 'm', at: 1 },
  ));
  const during = evaluate(plan, 1 + FADE_OUT_SECONDS / 2);
  assert.deepEqual(during.objects.map((o) => o.id).sort(), ['a', 'free', 'g']);
  assert.ok((obj(during, 'a')?.fade ?? 1) < 1);
  assert.equal(during.marks[0]?.id, 'm');
  assert.ok((during.marks[0]?.fade ?? 1) < 1);
  const after = settle(plan);
  assert.deepEqual(after.objects.map((o) => o.id), ['free']);
  assert.equal(after.marks.length, 0);

  const cleared = settle(planStep(after, step({ op: 'clear', target: 'free' })));
  assert.equal(cleared.objects.length, 0);
  const reborn = settle(planStep(cleared, step(cube('free'))));
  assert.notEqual(obj(reborn, 'free')?.key, obj(after, 'free')?.key);
});

test('clear marks leaves the 3D panel, clear panel leaves the marks and resets the camera', () => {
  const base = settle(planStep(emptyFrame(), step(
    { op: 'box', id: 'm', x: 1, y: 1, w: 5, h: 5, color: 'red' }, cube('c'),
    { op: 'orbit', az: 80, el: 40 }, { op: 'zoom', to: 2 },
  )));
  assert.equal(base.camera.az, 80);
  const marksGone = settle(planStep(base, step({ op: 'clear', target: 'marks' })));
  assert.equal(marksGone.marks.length, 0);
  assert.equal(marksGone.objects.length, 1);
  assert.ok(marksGone.panel);
  assert.equal(marksGone.camera.az, 80);
  const panelGone = settle(planStep(base, step({ op: 'clear', target: 'panel' })));
  assert.equal(panelGone.marks.length, 1);
  assert.equal(panelGone.objects.length, 0);
  assert.equal(panelGone.panel, null);
  assert.deepEqual([panelGone.camera.az, panelGone.camera.el, panelGone.camera.zoom], [DEFAULT_CAMERA.az, DEFAULT_CAMERA.el, DEFAULT_CAMERA.zoom]);
});

test('adding an object with no panel makes the default panel; a panel op moves and resizes it', () => {
  const f = settle(planStep(emptyFrame(), step(cube('c'))));
  assert.deepEqual(f.panel?.rect, DEFAULT_PANEL);
  const plan = planStep(f, step({ op: 'panel', x: 100, y: 100, w: 500, h: 300, dur: 1 }));
  const mid = evaluate(plan, 0.5).panel?.rect.x ?? NaN;
  assert.ok(mid > DEFAULT_PANEL.x && mid < 100 || (mid < DEFAULT_PANEL.x && mid > 100));
  assert.deepEqual(settle(plan).panel?.rect, { x: 100, y: 100, w: 500, h: 300 });
});

test('a camera action after a drag starts from where the camera is', () => {
  const plan = planStep(emptyFrame(), step(cube('c'), { op: 'orbit', az: 90, el: 20, at: 1, dur: 1 }));
  near(evaluate(plan, 0).camera.az, 0);
  shiftCamera(plan, 30, 10);
  near(evaluate(plan, 0.5).camera.az, 30);
  near(evaluate(plan, 0.5).camera.el, DEFAULT_CAMERA.el + 10);
  // The orbit moves from the dragged position to its own target, shifted the same way.
  near(settle(plan).camera.az, 120);
  shiftCamera(plan, 0, 500);
  assert.equal(evaluate(plan, 0).camera.el, 89);
});

test('focus blends from the old target to the new and settles on the object', () => {
  const plan = planStep(emptyFrame(), step(cube('a'), cube('b'), { op: 'focus', id: 'b', at: 1, dur: 1 }));
  const b = obj(settle(plan), 'b');
  assert.deepEqual(evaluate(plan, 0).camera.focus, { key: null, k: 1 });
  const mid = evaluate(plan, 1.5).camera.focus;
  assert.equal(mid.key, b?.key);
  assert.ok(mid.from && mid.k > 0 && mid.k < 1);
  assert.deepEqual(settle(plan).camera.focus, { key: b?.key, k: 1 });
  const back = settle(planStep(settle(plan), step({ op: 'focus' })));
  assert.deepEqual(back.camera.focus, { key: null, k: 1 });
});

test('highlight is a pulse that returns to nothing; style tweens colour and opacity', () => {
  const plan = planStep(emptyFrame(), step(
    cube('c'), { op: 'highlight', id: 'c', at: 1, dur: 1, color: 'red' },
    { op: 'style', id: 'c', color: 'red', opacity: 0.2, at: 0, dur: 1 },
  ));
  assert.equal(obj(evaluate(plan, 0.5), 'c')?.pulse, 0);
  assert.ok((obj(evaluate(plan, 1.5), 'c')?.pulse ?? 0) > 0.9);
  assert.deepEqual(obj(evaluate(plan, 1.5), 'c')?.pulseColor, parseColor('red'));
  assert.equal(obj(settle(plan), 'c')?.pulse, 0);
  near(obj(settle(plan), 'c')?.opacity, 0.2);
  assert.deepEqual(obj(settle(plan), 'c')?.color, parseColor('red'));
});

test('an action for an object that does not exist yet, or any more, does nothing', () => {
  const plan = planStep(emptyFrame(), step(
    { op: 'move', id: 'late', to: [4, 0, 0], at: 0, dur: 0 }, cube('late', { at: 1 }), { op: 'move', id: 'nobody', to: [1, 1, 1] },
  ));
  near(obj(settle(plan), 'late')?.pos[0], 0);
  assert.equal(obj(settle(plan), 'nobody'), undefined);
  const gone = planStep(emptyFrame(), step(cube('c'), { op: 'clear', target: 'c', at: 1 }, { op: 'move', id: 'c', to: [4, 0, 0], at: 2 }));
  assert.equal(settle(gone).objects.length, 0);
});

test('the bar chart sample grows its first bar in time with the narration and the follow-up reaches the earth by id', () => {
  const bars = sample('bar-chart.json');
  const before = frameAt(bars.steps, 2, 1.0);
  assert.equal(obj(before, 'bar1'), undefined);
  const growing = obj(frameAt(bars.steps, 2, 2.0), 'bar1');
  assert.ok(growing && growing.scale[1] > 0.5 && growing.scale[1] < 2.1, String(growing?.scale));
  near(obj(frameAt(bars.steps, 2, 99), 'bar1')?.scale[1], 2.1);
  assert.equal(frameAt(bars.steps, 5, 0).marks.length, 5, 'the earlier marks stay');

  const earth = sample('earth-layers.json');
  const settled = frameAt(earth.steps, earth.steps.length - 1, 99);
  const follow = sample('earth-layers-followup.json');
  const f = frameAt(follow.steps, 0, 99, settled);
  near(obj(f, 'crust')?.opacity, 0.04);
  assert.equal(f.camera.focus.key, obj(f, 'core')?.key);
});

test('a scene the validator passes can be played, and timings read from the words', () => {
  const state = createSceneState();
  const r = validateScene(sample('request-flow.json'), state);
  assert.ok(r.scene);
  const f = frameAt(r.scene.steps, r.scene.steps.length - 1, 99);
  assert.equal(f.objects.filter((o) => o.shape === 'box').length, 2);
  assert.equal(estimateSpeechSeconds('one two three four five'), 2);
  assert.equal(estimateSpeechSeconds(''), 0.8);
});
