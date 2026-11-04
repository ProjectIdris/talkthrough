import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import {
  APPEAR_SECONDS, DEFAULT_CAMERA, IDLE_DELAY_SECONDS, IDLE_MAX_SECONDS, idleAngle, DEFAULT_PANEL, FADE_OUT_SECONDS, emptyFrame, estimateSpeechSeconds, evaluate, frameAt,
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
  near(obj(f, 'crust')?.opacity, 0.12);
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

test('explode pushes the parts of a group apart and back, without moving the group itself', () => {
  const f = (t: number) => frameAt([step(
    { op: 'add', shape: 'group', id: 'g' }, cube('a', { parent: 'g', pos: [2, 1, 0] }),
    { op: 'explode', id: 'g', to: 1, at: 0, dur: 2 },
  )], 0, t);
  near(obj(f(0), 'g')?.spread, 0);
  near(obj(f(99), 'g')?.spread, 1);
  assert.ok((obj(f(1), 'g')?.spread ?? 0) > 0.2 && (obj(f(1), 'g')?.spread ?? 1) < 0.8, 'it moves over the time given');
  assert.deepEqual(obj(f(99), 'a')?.pos, [2, 1, 0], 'a part keeps its own position; the renderer applies the spread');
  const back = frameAt([step({ op: 'add', shape: 'group', id: 'g' }, { op: 'explode', id: 'g', to: 1, dur: 0 }, { op: 'explode', id: 'g', to: 0, at: 1, dur: 1 })], 0, 99);
  near(obj(back, 'g')?.spread, 0);
});

test('along moves an object through the points and ends on the last', () => {
  const s = step(cube('a'), { op: 'along', id: 'a', pts: [[2, 0, 0], [4, 3, 0], [6, 0, 0]], at: 0, dur: 2 });
  assert.deepEqual(obj(frameAt([s], 0, 99), 'a')?.pos, [6, 0, 0]);
  const mid = obj(frameAt([s], 0, 1), 'a')?.pos as number[];
  assert.ok(mid[1] !== undefined && mid[1] > 1.0, `half way it is up between the first and second point, not on the straight line (${mid.join()})`);
  assert.ok(Math.abs((mid[0] ?? 0) - 3) < 0.6);
  const start = obj(frameAt([s], 0, 0), 'a')?.pos as number[];
  assert.deepEqual(start, [0, 0, 0]);
});

test('reveal draws a tube on, from its start', () => {
  const s = step({ op: 'add', shape: 'tube', id: 'c', pts: [[0, 0, 0], [1, 1, 0]], radius: 0.2, draw: 0 }, { op: 'reveal', id: 'c', to: 1, at: 1, dur: 2 });
  near(obj(frameAt([s], 0, 0.5), 'c')?.draw, 0);
  const half = obj(frameAt([s], 0, 2), 'c')?.draw ?? 0;
  assert.ok(half > 0.3 && half < 0.7, `${half}`);
  near(obj(frameAt([s], 0, 99), 'c')?.draw, 1);
  near(obj(frameAt([step({ op: 'add', shape: 'tube', id: 'c', pts: [[0, 0, 0], [1, 1, 0]], radius: 0.2 })], 0, 99), 'c')?.draw, 1, 1e-9);
});

test('an array makes its copies in pivots that carry the step and turn, and the original joins the group', () => {
  const f = frameAt([step(cube('blade', { pos: [1, 0, 0] }), { op: 'add', shape: 'array', id: 'blades', of: 'blade', count: 4, turn: [0, 90, 0] })], 0, 99);
  assert.equal(f.objects.filter((o) => o.id.startsWith('blades#') && !o.id.includes('.')).length, 3, 'three pivots for the three copies');
  const group = obj(f, 'blades');
  assert.equal(obj(f, 'blade')?.parentKey, group?.key, 'the original sits in the group');
  const pivot = obj(f, 'blades#2');
  assert.deepEqual(pivot?.rot, [0, 180, 0]);
  const copy = f.objects.find((o) => o.id === 'blades#2.blade');
  assert.equal(copy?.parentKey, pivot?.key);
  assert.deepEqual(copy?.pos, [1, 0, 0], 'a copy has the original\'s own place inside its pivot');
  const linear = frameAt([step(cube('p'), { op: 'add', shape: 'array', id: 'row', of: 'p', count: 3, step: [2, 0, 0] })], 0, 99);
  assert.deepEqual(obj(linear, 'row#2')?.pos, [4, 0, 0]);
});

test('an array copies the whole subtree, wired to its own copies', () => {
  const f = frameAt([step(
    { op: 'add', shape: 'group', id: 'unit' }, cube('top', { parent: 'unit' }), cube('side', { parent: 'unit', pos: [1, 0, 0] }),
    { op: 'add', shape: 'array', id: 'units', of: 'unit', count: 2, step: [5, 0, 0] },
  )], 0, 99);
  const copyUnit = f.objects.find((o) => o.id === 'units#1.unit');
  const copyTop = f.objects.find((o) => o.id === 'units#1.top');
  const copySide = f.objects.find((o) => o.id === 'units#1.side');
  assert.ok(copyUnit && copyTop && copySide);
  assert.equal(copyTop.parentKey, copyUnit.key);
  assert.equal(copySide.parentKey, copyUnit.key);
  assert.notEqual(copyTop.key, obj(f, 'top')?.key);
});

test('a pin follows its object and goes when the object does', () => {
  const s1 = step(cube('a', { pos: [1, 1, 1] }), { op: 'pin', id: 'p', on: 'a', text: 'Part', at: 0.5 });
  const early = frameAt([s1], 0, 0.2);
  assert.equal(early.marks.length, 0, 'not before its time');
  const f = frameAt([s1], 0, 99);
  const pin = f.marks.find((m) => m.id === 'p');
  assert.equal(pin?.onKey, obj(f, 'a')?.key);
  assert.equal(pin?.tinted, false, 'no colour given: the look chooses');
  const gone = frameAt([s1, step({ op: 'clear', target: 'a' })], 1, 99);
  assert.equal(gone.marks.length, 0);
  const fading = frameAt([s1, step({ op: 'clear', target: 'a' })], 1, FADE_OUT_SECONDS / 2);
  const fadingPin = fading.marks.find((m) => m.id === 'p');
  assert.ok(fadingPin && fadingPin.fade < 0.9 && fadingPin.fade > 0.1, 'it fades with the object');
  assert.equal(frameAt([step({ op: 'pin', id: 'p', on: 'ghost', text: 'x' })], 0, 9).marks.length, 0);
});

test('style and highlight on a group reach everything inside it', () => {
  const s = step(
    { op: 'add', shape: 'group', id: 'g' }, cube('a', { parent: 'g' }), cube('b', { parent: 'g', color: 'red' }),
    { op: 'style', id: 'g', opacity: 0.3, color: 'green', dur: 0 }, { op: 'highlight', id: 'g', at: 5, dur: 2 },
  );
  const f = frameAt([s], 0, 99);
  assert.equal(obj(f, 'a')?.opacity, 0.3);
  assert.deepEqual(obj(f, 'b')?.color, parseColor('green'));
  const mid = frameAt([s], 0, 6);
  assert.ok((obj(mid, 'a')?.pulse ?? 0) > 0.5 && (obj(mid, 'b')?.pulse ?? 0) > 0.5);
});

test('an object with no colour takes the colour of its surface or part', () => {
  const f = frameAt([step(
    { op: 'add', shape: 'box', id: 'a', size: [1, 1, 1], material: 'pcb' }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] },
    { op: 'add', shape: 'part', id: 'c', part: 'chip', variant: 'metal', size: [1, 1, 1] }, { op: 'add', shape: 'part', id: 'd', part: 'chip', size: [1, 1, 1] },
  )], 0, 99);
  assert.ok((obj(f, 'a')?.color[1] ?? 0) > (obj(f, 'a')?.color[0] ?? 255) * 2, 'a circuit board is green');
  assert.ok((obj(f, 'b')?.color[0] ?? 0) > 180, 'plastic is light');
  assert.ok((obj(f, 'c')?.color[0] ?? 0) > 150 && (obj(f, 'd')?.color[0] ?? 255) < 80, 'a metal-lidded chip is light, a plain one dark');
});

test('the stage keeps its frame flag when it moves', () => {
  const f = frameAt([step({ op: 'panel', x: 1, y: 1, w: 100, h: 100, frame: true }, { op: 'panel', x: 5, y: 5, w: 200, h: 200, at: 1, dur: 0 })], 0, 99);
  assert.equal(f.panel?.frame, true);
  assert.equal(frameAt([step({ op: 'panel', x: 1, y: 1, w: 100, h: 100 })], 0, 99).panel?.frame, false);
});

test('the idle turn waits a moment after the last step, then speeds up gently', () => {
  assert.equal(idleAngle(0), 0);
  assert.equal(idleAngle(IDLE_DELAY_SECONDS), 0);
  const a = idleAngle(IDLE_DELAY_SECONDS + 1), b = idleAngle(IDLE_DELAY_SECONDS + 2), c = idleAngle(IDLE_DELAY_SECONDS + 5);
  assert.ok(a > 0 && b > a && c > b);
  assert.ok(b - a > a, 'it eases in');
  assert.equal(idleAngle(1000), idleAngle(IDLE_MAX_SECONDS), 'and stops after a while');
});
