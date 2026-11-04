import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_GAIN, EXPLODE_SECONDS, ExplodeValue, SOFT_REACH, USER_SPREAD, depthOf, spreadPosition, userOffsets } from '../src/overlay/explode.ts';
import type { Part } from '../src/overlay/explode.ts';
import { HOVER_MARGIN, createHold, explodeButtonBox, overModel, wheelFactor } from '../src/overlay/orbit.ts';
import { Player, createSilentVoice } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';
import { ZOOM_MAX, ZOOM_MIN } from '../src/overlay/timeline.ts';
import type { Scene } from '../src/scene/index.ts';

const part = (key: number, parentKey: number | null, pos: [number, number, number], extra: Partial<Part> = {}): Part => ({ key, parentKey, pos, ...extra });
const near = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((x, i) => assert.ok(Math.abs(x - (b[i] as number)) < eps, `${a} vs ${b}`));
const at = (m: Map<number, [number, number, number]>, key: number): [number, number, number] => m.get(key) ?? [0, 0, 0];

// ---- the maths ------------------------------------------------------------------------------------

test('the model\'s own spread: outward from the parent\'s origin, or along the part\'s own direction', () => {
  near(spreadPosition([1, 2, 3], undefined, 0), [1, 2, 3]);
  near(spreadPosition([1, 2, 3], undefined, 1), [2, 4, 6]);
  near(spreadPosition([1, 2, 3], [0, 5, 0], 0.5), [1, 4.5, 3]);
  near(spreadPosition([1, 2, 3], [0, 5, 0], 0), [1, 2, 3]);
});

test('with no spread nothing moves, and a part alone in its group stays put', () => {
  const list = [part(1, null, [0, 0, 0]), part(2, 1, [1, 0, 0]), part(3, 1, [-1, 0, 0]), part(4, null, [9, 9, 9])];
  assert.equal(userOffsets(list, 0).size, 0);
  assert.equal(userOffsets(list, -1).size, 0);
  assert.equal(userOffsets(list, Number.NaN).size, 0);
  const moved = userOffsets(list, 1);
  assert.ok(moved.has(2) && moved.has(3) && moved.has(4), 'siblings 1 and 4 at the top, 2 and 3 under 1');
  assert.ok(!userOffsets([part(1, null, [3, 3, 3])], 1).has(1), 'a lone part has nothing to move away from');
});

test('parts move away from the middle of the parts around them, in opposite directions, and further the deeper they are', () => {
  const list = [part(1, null, [0, 0, 0]), part(2, 1, [1, 0, 0]), part(3, 1, [-1, 0, 0]), part(4, 2, [0.5, 0, 0]), part(5, 2, [-0.5, 0, 0])];
  const m = userOffsets(list, 1);
  assert.ok(at(m, 2)[0] > 0 && at(m, 3)[0] < 0, 'siblings go opposite ways');
  near([at(m, 2)[0]], [-at(m, 3)[0]]);
  assert.ok(at(m, 4)[0] > 0 && at(m, 5)[0] < 0);
  // The same distance from their middles at depth 2 and depth 3: the deeper one moves further.
  const same = userOffsets([part(1, null, [0, 0, 0]), part(2, 1, [1, 0, 0]), part(3, 1, [-1, 0, 0]), part(4, 2, [1, 0, 0]), part(5, 2, [-1, 0, 0])], 1);
  assert.ok(Math.abs(at(same, 4)[0]) > Math.abs(at(same, 2)[0]));
  // The offset scales with the spread.
  near([at(userOffsets(list, 0.5), 2)[0]], [at(m, 2)[0] / 2]);
});

test('a part with its own explode direction moves along it; text and fixed parts stay', () => {
  const list = [part(1, null, [0, 0, 0]), part(2, 1, [1, 0, 0], { explode: [0, 4, 0] }), part(3, 1, [-1, 0, 0]), part(4, 1, [0, 0, 5], { fixed: true })];
  const m = userOffsets(list, 0.5);
  near(at(m, 2), [0, 2 * (1 + DEPTH_GAIN), 0]);
  assert.ok(!m.has(4), 'a fixed part (text) does not move');
  assert.ok(at(m, 3)[0] < 0, 'a sibling with no direction still moves away from the middle of the movable ones');
});

test('a far sibling moves further than a near one but not in proportion (a tower under its head)', () => {
  const list = [part(1, null, [0, 0, 0]), part(2, null, [0, 12.9, 0]), part(3, null, [0, 1, 0])];
  const m = userOffsets(list, 1);
  const y = (k: number) => Math.abs(at(m, k)[1]);
  const far = 12.9 - (0 + 12.9 + 1) / 3;
  assert.ok(y(2) < far * USER_SPREAD, 'less than a straight multiple');
  assert.ok(y(2) > y(3), 'but still more than the near one');
  near([y(2)], [(far / (1 + far / SOFT_REACH)) * USER_SPREAD]);
});

test('depth counts the parents above a part and survives a loop in the data', () => {
  const map = new Map([part(1, null, [0, 0, 0]), part(2, 1, [0, 0, 0]), part(3, 2, [0, 0, 0])].map((p) => [p.key, p] as const));
  assert.equal(depthOf(map, 1), 1);
  assert.equal(depthOf(map, 3), 3);
  const loop = new Map([part(1, 2, [0, 0, 0]), part(2, 1, [0, 0, 0])].map((p) => [p.key, p] as const));
  assert.ok(depthOf(loop, 1) <= 64);
});

test('the Explode value eases both ways, can be turned round half way, and jumps for frame grabs', () => {
  const v = new ExplodeValue();
  assert.equal(v.value(0), 0);
  v.set(true, 1000);
  assert.equal(v.open, true);
  assert.equal(v.value(1000), 0);
  const half = v.value(1000 + EXPLODE_SECONDS * 500);
  assert.ok(half > 0.4 && half < 0.6, `about half way at half the time: ${half}`);
  assert.equal(v.value(1000 + EXPLODE_SECONDS * 1000), 1);
  assert.equal(v.value(1000 + EXPLODE_SECONDS * 5000), 1);
  assert.equal(v.moving(1000 + 100), true);
  assert.equal(v.moving(1000 + EXPLODE_SECONDS * 1000 + 1), false);
  // Turned round a quarter of the way: it goes back down from where it was, not from 1.
  const q = 1000 + EXPLODE_SECONDS * 250;
  const was = v.value(q);
  v.set(false, q);
  assert.equal(v.open, false);
  assert.ok(Math.abs(v.value(q) - was) < 1e-9, 'no jump when turned round');
  assert.equal(v.value(q + EXPLODE_SECONDS * 2000), 0);
  v.toggle(5000);
  assert.equal(v.open, true);
  v.jump(0.7);
  assert.equal(v.value(123456), 0.7);
  v.reset();
  assert.equal(v.value(123456), 0);
  assert.equal(v.open, false);
});

// ---- the pointer rules ------------------------------------------------------------------------------

test('the pointer is on the model inside its bounds plus the margin, and nowhere when there is no model', () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  assert.equal(overModel(r, 150, 150), true);
  assert.equal(overModel(r, 100 - HOVER_MARGIN, 100), true);
  assert.equal(overModel(r, 100 - HOVER_MARGIN - 1, 100), false);
  assert.equal(overModel(r, 300 + HOVER_MARGIN, 200 + HOVER_MARGIN), true);
  assert.equal(overModel(r, 300 + HOVER_MARGIN + 1, 150), false);
  assert.equal(overModel(r, 150, 100 - HOVER_MARGIN - 1), false);
  assert.equal(overModel(r, 100 - 5, 150, 0), false, 'a margin of nothing is the bounds');
  assert.equal(overModel(undefined, 150, 150), false);
});

test('a wheel click zooms by a gentle step, forward is in, and a huge delta cannot jump', () => {
  assert.equal(wheelFactor(0), 1);
  assert.equal(wheelFactor(Number.NaN), 1);
  assert.ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1);
  near([wheelFactor(-100) * wheelFactor(100)], [1]);
  assert.ok(wheelFactor(-100000) <= Math.exp(240 * 0.0016) + 1e-9);
  assert.ok(wheelFactor(100000) >= Math.exp(-240 * 0.0016) - 1e-9);
  assert.equal(wheelFactor(-3, 1), wheelFactor(-48, 0), 'a line is 16 px');
  assert.ok(wheelFactor(-1, 2) > wheelFactor(-1, 1), 'a page is more than a line');
});

test('the Explode button sits in the model\'s top-right corner and never leaves the screen', () => {
  const view = { width: 1000, height: 600 };
  const size = { w: 70, h: 26 };
  const corner = explodeButtonBox({ x: 100, y: 100, w: 300, h: 200 }, view, size);
  near([corner.x, corner.y], [400 - 70 - 6, 106]);
  const edge = explodeButtonBox({ x: 800, y: -50, w: 600, h: 200 }, view, size);
  assert.ok(edge.x + size.w <= view.width && edge.x >= 0 && edge.y >= 0, JSON.stringify(edge));
});

// ---- the player ---------------------------------------------------------------------------------------

function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const clock: Clock = {
    now: () => now,
    after: (ms, fn) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.fn();
    }
    now = target;
  };
  return { clock, advance };
}

const modelScene = (): Scene => ({
  steps: [{
    say: 'A cube.',
    actions: [
      { op: 'panel', x: 300, y: 200, w: 400, h: 400 },
      { op: 'add', shape: 'group', id: 'g' },
      { op: 'add', shape: 'box', id: 'a', parent: 'g', pos: [-1, 0, 0], size: [1, 1, 1] },
      { op: 'add', shape: 'box', id: 'b', parent: 'g', pos: [1, 0, 0], size: [1, 1, 1] },
    ],
  }],
}) as Scene;

function settledPlayer() {
  const { clock, advance } = fakeClock();
  const player = new Player({ voice: createSilentVoice(), clock });
  player.play(modelScene());
  for (let i = 0; i < 80; i++) { advance(100); player.update(); }
  player.stopIdle();
  return { player, advance };
}

test('a finished model can be zoomed within limits, and a double click puts the camera and the model back', () => {
  const { player, advance } = settledPlayer();
  assert.equal(player.settled, true);
  const home = player.update().camera; // the idle turn has already moved the azimuth a little
  player.zoomCamera(1.5);
  assert.ok(Math.abs(player.update().camera.zoom - home.zoom * 1.5) < 1e-9);
  for (let i = 0; i < 40; i++) player.zoomCamera(2);
  assert.equal(player.update().camera.zoom, ZOOM_MAX);
  for (let i = 0; i < 80; i++) player.zoomCamera(0.5);
  assert.equal(player.update().camera.zoom, ZOOM_MIN);
  player.zoomCamera(0);
  player.zoomCamera(Number.NaN);
  assert.equal(player.update().camera.zoom, ZOOM_MIN, 'nonsense factors change nothing');
  player.dragCamera(40, 15);
  player.setExplode(true);
  advance(EXPLODE_SECONDS * 1000 + 50);
  assert.ok((player.update().userExplode ?? 0) > 0.99);
  player.resetCamera();
  const back = player.update();
  // Back to where the scene left the camera (before the idle turn), not to wherever the idle turn had got to.
  assert.ok(Math.abs(back.camera.az) < 1e-6 && Math.abs(back.camera.el - home.el) < 1e-6 && Math.abs(back.camera.zoom - home.zoom) < 1e-6, JSON.stringify([home, back.camera]));
  assert.equal(player.exploded, false);
  advance(EXPLODE_SECONDS * 1000 + 50);
  assert.equal(player.update().userExplode, undefined, 'closed: the frame carries no spread at all');
});

test('the Explode control opens over time, reports where it is, and is only offered when the model is settled', () => {
  const { player, advance } = settledPlayer();
  assert.equal(player.update().userExplode, undefined);
  player.toggleExplode();
  assert.equal(player.exploded, true);
  advance(EXPLODE_SECONDS * 500);
  const mid = player.update().userExplode ?? 0;
  assert.ok(mid > 0.2 && mid < 0.8, `${mid}`);
  advance(EXPLODE_SECONDS * 600);
  assert.ok((player.update().userExplode ?? 0) > 0.999);
  player.toggleExplode();
  assert.equal(player.exploded, false);
  const { clock } = fakeClock();
  const fresh = new Player({ voice: createSilentVoice(), clock });
  assert.equal(fresh.settled, false, 'an empty player has nothing to open');
  fresh.play(modelScene());
  assert.equal(fresh.settled, false, 'nor does a step that is still playing');
});

test('a frame grab can show a turned, zoomed, opened view', () => {
  const { clock } = fakeClock();
  const player = new Player({ voice: createSilentVoice(), clock });
  player.seek(modelScene(), 0, 5, { az: 55, el: 22, zoom: 1.2, explode: 1 });
  const f = player.update();
  assert.equal(f.camera.az, 55);
  assert.equal(f.camera.el, 22);
  assert.equal(f.camera.zoom, 1.2);
  assert.equal(f.userExplode, 1);
  player.seek(modelScene(), 0, 5);
  assert.equal(player.update().userExplode, undefined);
});

// ---- the window is solid only while something is under the pointer -----------------------------------------

function holdRig() {
  const sent: boolean[] = [];
  return { hold: createHold((over) => sent.push(over)), sent };
}
const MODEL = { x: 100, y: 100, w: 200, h: 100 };

test('the window goes solid when the pointer reaches the model and lets go when it leaves, saying each only once', () => {
  const { hold, sent } = holdRig();
  hold.model(MODEL);
  hold.pointer(10, 10, false);
  assert.deepEqual(sent, []);
  hold.pointer(150, 150, false);
  hold.pointer(160, 150, false);
  assert.deepEqual(sent, [true]);
  hold.pointer(600, 400, false);
  assert.deepEqual(sent, [true, false]);
});

test('a model that fades or is cleared under a resting pointer lets the window go at once, and a later beat does not take it back', () => {
  const { hold, sent } = holdRig();
  hold.model(MODEL);
  hold.pointer(150, 150, false);
  assert.deepEqual(sent, [true]);
  hold.model(undefined); // the scene faded: draw() reports no model
  assert.deepEqual(sent, [true, false]);
  hold.beat();
  hold.beat();
  assert.deepEqual(sent, [true, false], 'the beat renews nothing that is no longer true');
});

test('the beat renews the claim while the pointer is still on the model, and notices when the model has gone even if nothing else said so', () => {
  const { hold, sent } = holdRig();
  hold.model(MODEL);
  hold.pointer(150, 150, false);
  hold.beat();
  hold.beat();
  assert.deepEqual(sent, [true, true, true]);
  // The model's rectangle moves away from under the pointer (the model was cleared and a smaller one drawn elsewhere).
  hold.model({ x: 500, y: 300, w: 50, h: 50 });
  hold.beat();
  assert.deepEqual(sent.slice(3), [false]);
});

test("one of the app's own buttons holds the window too, and lets go when it goes away under a resting pointer", () => {
  const { hold, sent } = holdRig();
  hold.pointer(900, 500, true);
  assert.deepEqual(sent, [true]);
  hold.onHud(false); // the notice faded
  assert.deepEqual(sent, [true, false]);
  hold.pointer(900, 500, true);
  hold.release(); // the button was used and went away
  assert.deepEqual(sent, [true, false, true, false]);
});

test('a drag keeps the window solid wherever the pointer goes, and lets go when it ends outside the model', () => {
  const { hold, sent } = holdRig();
  hold.model(MODEL);
  hold.pointer(150, 150, false);
  hold.drag(true);
  hold.pointer(900, 600, false);
  hold.beat();
  assert.equal(hold.over, true);
  assert.ok(!sent.includes(false));
  hold.drag(false);
  assert.deepEqual(sent.at(-1), false);
});

test("the first wheel step does not move a scene's own zoom to the person's limits", () => {
  const { clock, advance } = fakeClock();
  const player = new Player({ voice: createSilentVoice(), clock });
  const far = modelScene();
  (far.steps[0] as { actions: unknown[] }).actions.push({ op: 'zoom', to: 5 }, { op: 'zoom', to: 0.2, at: 0.5, dur: 0.1 });
  player.play(far);
  for (let i = 0; i < 80; i++) { advance(100); player.update(); }
  player.stopIdle();
  const before = player.update().camera.zoom;
  assert.ok(Math.abs(before - 0.2) < 1e-6, `${before}`);
  player.zoomCamera(1.0001);
  assert.ok(Math.abs(player.update().camera.zoom - before * 1.0001) < 1e-6, 'a scene zoom of 0.2 is left alone');
});
