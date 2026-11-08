import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { fallCurve, fallSeconds } from '../src/overlay/fall.ts';

// Gravity and its kin, illustrated: a pendulum, a weight on a spring, a boat on water, a drop with a bounce, a pump behind one-way valves,
// and the last simple machines (a load on a slope, a wedge, a screw). Each is a few existing movements written in one op.

const near = (a: number | undefined, b: number, eps = 1e-3) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const posOf = (f: Frame, id: string) => (obj(f, id).pose?.pos ?? obj(f, id).pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id).pose?.rot ?? obj(f, id).rot) as [number, number, number];
const scaleOf = (f: Frame, id: string) => (obj(f, id).pose?.scale ?? [1, 1, 1]) as [number, number, number];
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues, step: checked.step };
};
const at = (r: ReturnType<typeof run>, t: number) => evaluate(r.plan, t);

const support = { op: 'add', shape: 'box', id: 'support', size: [4, 0.4, 1], pos: [0, 0, 0] };
const bob = { op: 'add', shape: 'sphere', id: 'bob', size: [0.8, 0.8, 0.8], pos: [0, -4, 0] };

test('a pendulum swings about the part it hangs from, let go at the far end, and keeps its string length', () => {
  const r = run(support, bob, { op: 'pendulum', id: 'bob', from: 'support', swing: 25 });
  const a = (25 * Math.PI) / 180;
  const start = posOf(at(r, 0), 'bob');
  near(start[0], 4 * Math.sin(a));
  near(start[1], -4 * Math.cos(a));
  for (const t of [0, 0.7, 1.9, 2.6, 3.9]) {
    const p = posOf(at(r, t), 'bob');
    near(Math.hypot(p[0], p[1]), 4, 1e-3);
  }
  // 1.6 x sqrt(4) = 3.2 seconds a swing there and back: the far end on the other side at half of it
  near(posOf(at(r, 1.6), 'bob')[0], -4 * Math.sin(a));
  near(posOf(at(r, 3.2), 'bob')[0], 4 * Math.sin(a));
});

test('a pendulum hangs from the part its weight is attached to (the way a model writes it), and swings about that part, not nothing', () => {
  const hung = { op: 'add', shape: 'sphere', id: 'bob', parent: 'support', parentAnchor: 'bottom', selfAnchor: 'top', pos: [0, -4, 0], size: [1.2, 1.2, 1.2] };
  const r = run(support, hung, { op: 'pendulum', id: 'bob', from: 'support', swing: 30, period: 2.5 });
  assert.deepEqual(r.issues, []);
  // the bob rides in the support (which stays at the origin), so its own place is its place in the scene; at rest it hangs 4.8 below the middle
  // of the support (the support's bottom is 0.2 down, the bob's top is 0.6 above its middle, and it is written 4 further down)
  const world = (t: number) => posOf(at(r, t), 'bob');
  const lengths = [0, 0.4, 1.1, 2, 3].map((t) => Math.hypot(world(t)[0], world(t)[1]));
  assert.ok(lengths.every((l) => Math.abs(l - 4.8) < 1e-6), `lengths ${lengths}`);
  const a = (30 * Math.PI) / 180;
  near(Math.atan2(world(0)[0], -world(0)[1]), a, 1e-6);
  near(Math.atan2(world(1.25)[0], -world(1.25)[1]), -a, 0.02);
});

test('a longer string swings more slowly, and damp lets it run down to hanging still', () => {
  const short = run(support, { ...bob, pos: [0, -1, 0] }, { op: 'pendulum', id: 'bob', from: 'support', swing: 30 });
  const long = run(support, { ...bob, pos: [0, -9, 0] }, { op: 'pendulum', id: 'bob', from: 'support', swing: 30 });
  const crossing = (r: ReturnType<typeof run>) => {
    let t = 0.05;
    while (posOf(at(r, t), 'bob')[0] > 0 && t < 20) t += 0.05;
    return t;
  };
  assert.ok(crossing(long) > 2 * crossing(short), `${crossing(long)} vs ${crossing(short)}`);
  const damped = run(support, bob, { op: 'pendulum', id: 'bob', from: 'support', swing: 25, damp: 1 });
  const x0 = Math.abs(posOf(at(damped, 0), 'bob')[0]);
  // the far end of the fourth swing: three cycles on, a third of a third of a third as big
  const x3 = Math.abs(posOf(at(damped, 3.2 * 3), 'bob')[0]);
  assert.ok(x3 < x0 * 0.06 && x3 > x0 * 0.04, `${x3} of ${x0}`);
  assert.ok(Math.abs(posOf(at(damped, 40), 'bob')[0]) < 0.01, 'it hangs still in the end');
});

test('a pendulum with nothing to hang from is dropped with a note', () => {
  const checked = validateStep({ say: 'x', actions: [bob, { op: 'pendulum', id: 'bob' }] }, createSceneState());
  assert.ok(checked.issues.some((i) => /hang/.test(i.message)), JSON.stringify(checked.issues));
});

test('a weight on a spring starts pulled low, bobs the amount each way and settles when damped', () => {
  const r = run({ op: 'add', shape: 'sphere', id: 'weight', size: [1, 1, 1], pos: [0, 2, 0] }, { op: 'oscillate', id: 'weight', amount: 0.8, period: 2, damp: 1.5 });
  near(posOf(at(r, 0), 'weight')[1], 2 - 0.8);
  near(posOf(at(r, 1), 'weight')[1], 2 + 0.8 * Math.exp(-0.5 / 1.5));
  assert.ok(Math.abs(posOf(at(r, 60), 'weight')[1] - 2) < 0.01, 'at rest in the end');
  const free = run({ op: 'add', shape: 'sphere', id: 'weight', size: [1, 1, 1], pos: [0, 2, 0] }, { op: 'oscillate', id: 'weight', amount: 0.8, period: 2 });
  near(posOf(at(free, 61), 'weight')[1], 2 + 0.8, 1e-3);
});

test('a floating part begins at rest, bobs and rocks within its bounds, and settles when damped', () => {
  const boat = { op: 'add', shape: 'box', id: 'boat', size: [3, 0.6, 1], pos: [0, 0, 0], rot: [0, 0, 0] };
  const r = run(boat, { op: 'float', id: 'boat', bob: 0.2, tilt: 6, period: 3 });
  near(posOf(at(r, 0), 'boat')[1], 0, 1e-6);
  near(rotOf(at(r, 0), 'boat')[2], 0, 1e-6);
  let peak = 0, lean = 0;
  for (let t = 0; t <= 12; t += 0.1) {
    peak = Math.max(peak, Math.abs(posOf(at(r, t), 'boat')[1]));
    lean = Math.max(lean, Math.abs(rotOf(at(r, t), 'boat')[2]));
  }
  assert.ok(peak > 0.18 && peak <= 0.2 + 1e-6, `bob ${peak}`);
  assert.ok(lean > 5 && lean <= 6 + 1e-6, `rock ${lean}`);
  const calm = run(boat, { op: 'float', id: 'boat', bob: 0.2, tilt: 6, period: 3, damp: 1 });
  assert.ok(Math.abs(posOf(at(calm, 60), 'boat')[1]) < 0.001 && Math.abs(rotOf(at(calm, 60), 'boat')[2]) < 0.01);
});

test('the fall curve is a square of the time, lands at 1, and bounces back up a smaller height each time', () => {
  near(fallCurve(0, 0.5), 0);
  near(fallCurve(1, 0.5), 1);
  // dead landing: a plain square and no rise after it
  const dead = [0.1, 0.3, 0.5, 0.7, 0.9, 1].map((u) => fallCurve(u, 0));
  dead.forEach((p, i) => near(p, [0.1, 0.3, 0.5, 0.7, 0.9, 1][i]! ** 2));
  // springy: it lands, comes back off the floor and lands again, never above the start and each rise lower than the one before
  const samples = Array.from({ length: 400 }, (_, i) => fallCurve(i / 399, 0.6));
  assert.ok(samples.every((p) => p >= -1e-9 && p <= 1 + 1e-9));
  // the top of each bounce is a low point of the curve: there are at least three, and each is lower than the one before
  const rises: number[] = [];
  for (let i = 1; i < samples.length - 1; i++) if ((samples[i] as number) < (samples[i - 1] as number) && (samples[i] as number) <= (samples[i + 1] as number)) rises.push(1 - (samples[i] as number));
  assert.ok(rises.length >= 3, `bounces ${rises.length}`);
  rises.forEach((h, i) => i > 0 && assert.ok(h < (rises[i - 1] as number) + 1e-9, `${rises}`));
  near(rises[0], 0.36, 0.01);
  assert.ok(fallSeconds(16, 0.3) > fallSeconds(4, 0.3), 'a greater fall takes longer');
  assert.ok(fallSeconds(4, 0.6) > fallSeconds(4, 0), 'and bouncing takes longer than landing dead');
});

test('a drop falls to the height, speeding up, and ends there; it never goes below it', () => {
  const r = run({ op: 'add', shape: 'sphere', id: 'ball', size: [1, 1, 1], pos: [1, 6, 0] }, { op: 'drop', id: 'ball', to: 0.5, bounce: 0.5 });
  near(posOf(at(r, 0), 'ball')[1], 6);
  near(posOf(at(r, 0), 'ball')[0], 1);
  const end = r.plan.duration;
  near(posOf(at(r, end + 1), 'ball')[1], 0.5);
  let lowest = 99;
  for (let t = 0; t <= end; t += end / 200) lowest = Math.min(lowest, posOf(at(r, t), 'ball')[1]);
  assert.ok(lowest >= 0.5 - 1e-9, `lowest ${lowest}`);
  const first = fallSeconds(5.5, 0.5);
  assert.ok(Math.abs(end - first) < 0.01, 'the drop takes as long as the fall says');
  // a constant pull: a quarter of the way down the first fall has gone a sixteenth of the way
  const total = 1 / (1 + 2 * (0.5 + 0.25 + 0.125 + 0.0625 + 0.03125));
  near(posOf(at(r, end * total * 0.25), 'ball')[1], 6 - 5.5 / 16, 0.02);
});

test('a pump squeezes its chamber, opens the outlet while it does and the inlet while it refills', () => {
  const parts = [
    { op: 'add', shape: 'sphere', id: 'chamber', size: [2, 2, 2], pos: [0, 0, 0] },
    { op: 'add', shape: 'box', id: 'inlet', size: [1, 0.1, 1], pos: [-2, 0, 0] },
    { op: 'add', shape: 'box', id: 'outlet', size: [1, 0.1, 1], pos: [2, 0, 0] },
  ];
  const r = run(...parts, { op: 'pump', id: 'chamber', inlet: 'inlet', outlet: 'outlet', squeeze: 0.6, open: 60, period: 2 });
  assert.deepEqual(r.issues, []);
  const shut = (id: string, t: number) => Math.abs(rotOf(at(r, t), id)[2]);
  // a 2 second cycle: 0 to 1 it squeezes (the outlet opens, fullest at 0.5), 1 to 2 it refills (the inlet opens, fullest at 1.5), smallest at 1 and relaxed at 0 and 2
  near(scaleOf(at(r, 0), 'chamber')[0], 1);
  near(scaleOf(at(r, 1), 'chamber')[0], 0.6);
  near(scaleOf(at(r, 3), 'chamber')[0], 0.6);
  near(shut('outlet', 0), 0, 1e-6);
  near(shut('outlet', 0.5), 60, 0.05);
  near(shut('outlet', 0.25), 60 * Math.cos(Math.PI / 4), 0.05);
  assert.ok(shut('inlet', 0.5) < 1e-6, 'the inlet is shut while it squeezes');
  assert.ok(shut('outlet', 1.5) < 1e-6, 'the outlet is shut while it refills');
  near(shut('inlet', 1.5), 60, 0.05);
  assert.ok(shut('inlet', 1) < 1e-6 && shut('outlet', 1) < 1e-6, 'both are shut when it is smallest');
  // a flap is never open the other way
  for (let t = 0; t < 4; t += 0.1) assert.ok(rotOf(at(r, t), 'inlet')[2] >= -1e-9 && rotOf(at(r, t), 'outlet')[2] >= -1e-9);
});

test('a pump without a valve, or a valve that is its own chamber, is dropped with a note', () => {
  const chamber = { op: 'add', shape: 'sphere', id: 'chamber', size: [2, 2, 2] };
  const none = validateStep({ say: 'x', actions: [chamber, { op: 'pump', id: 'chamber' }] }, createSceneState());
  assert.ok(none.issues.some((i) => /inlet or an outlet/.test(i.message)), JSON.stringify(none.issues));
  const same = validateStep({ say: 'x', actions: [chamber, { op: 'pump', id: 'chamber', inlet: 'chamber' }] }, createSceneState());
  assert.ok(same.issues.some((i) => /different part/.test(i.message)), JSON.stringify(same.issues));
});

test('a load on an incline slides along the slope of its ramp, or along an angle', () => {
  const load = { op: 'add', shape: 'box', id: 'crate', size: [1, 1, 1], pos: [0, 0, 0] };
  const ramp = { op: 'add', shape: 'box', id: 'ramp', size: [8, 0.4, 2], pos: [0, -1, 0], rot: [0, 0, 30] };
  const r = run(ramp, load, { op: 'incline', id: 'crate', ramp: 'ramp', travel: 4, period: 4 });
  const a = at(r, 1), b = at(r, 3);
  const dx = posOf(b, 'crate')[0] - posOf(a, 'crate')[0], dy = posOf(b, 'crate')[1] - posOf(a, 'crate')[1];
  assert.ok(Math.hypot(dx, dy) > 3, 'it moves along the slope');
  near(Math.abs(Math.atan2(dy, dx) * (180 / Math.PI)), 150, 0.5);
  const byAngle = run(load, { op: 'incline', id: 'crate', angle: 30, travel: 4, period: 4 });
  const p = posOf(at(byAngle, 1), 'crate'), q = posOf(at(byAngle, 3), 'crate');
  near(Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0]) * (180 / Math.PI)), 150, 0.5);
  const none = validateStep({ say: 'x', actions: [load, { op: 'incline', id: 'crate' }] }, createSceneState());
  assert.ok(none.issues.some((i) => /slope|ramp/.test(i.message)), JSON.stringify(none.issues));
});

test('a wedge driven in pushes the part beside it aside by tan of its angle, each to its own side', () => {
  const wedge = { op: 'add', shape: 'cone', id: 'wedge', size: [2, 3, 2], pos: [0, 2, 0], rot: [0, 0, 180] };
  const left = { op: 'add', shape: 'box', id: 'left', size: [1, 2, 1], pos: [-1.5, 0, 0] };
  const right = { op: 'add', shape: 'box', id: 'right', size: [1, 2, 1], pos: [1.5, 0, 0] };
  const r = run(wedge, left, right, { op: 'wedge', id: 'wedge', drives: 'left', angle: 30, travel: 2, period: 4 }, { op: 'wedge', id: 'wedge', drives: 'right', angle: 30, travel: 2, period: 4 });
  assert.deepEqual(r.issues, []);
  const spread = (t: number) => posOf(at(r, t), 'right')[0] - posOf(at(r, t), 'left')[0];
  const wedgeY = (t: number) => posOf(at(r, t), 'wedge')[1];
  // in: while the wedge is lower than at rest, the two are further apart than at rest by 2 tan(angle) of how far it has gone down; and it is symmetric
  for (const t of [0.4, 1.3, 2.2, 3.1]) {
    const down = 2 - wedgeY(t);
    near(spread(t), 3 + 2 * Math.tan((30 * Math.PI) / 180) * down, 1e-6);
    near(posOf(at(r, t), 'left')[0] + posOf(at(r, t), 'right')[0], 0, 1e-6);
  }
  assert.ok(Math.abs(wedgeY(1) - 2) > 0.5, 'the wedge really moves');
});

test('a screw turns about its length and its nut travels the pitch for each turn', () => {
  const screw = { op: 'add', shape: 'cylinder', id: 'screw', size: [0.6, 6, 0.6], pos: [0, 0, 0] };
  const nut = { op: 'add', shape: 'box', id: 'nut', size: [1.4, 0.5, 1.4], pos: [0, -1, 0] };
  const r = run(screw, nut, { op: 'screw', id: 'nut', screw: 'screw', pitch: 0.5, rpm: 60 });
  assert.deepEqual(r.issues, []);
  // three seconds at 60 rpm is three turns once it is up to speed: the angle it has turned and the travel agree
  const turned = (t: number) => rotOf(at(r, t), 'screw')[1];
  const moved = (t: number) => posOf(at(r, t), 'nut')[1] + 1;
  for (const t of [1, 2.5, 4]) near(moved(t), (0.5 * turned(t)) / 360, 1e-6);
  assert.ok(Math.abs(moved(4)) > 1, 'the nut really travels');
  const lying = run({ ...screw, rot: [0, 0, 90] }, { ...nut, pos: [-1, 0, 0] }, { op: 'screw', id: 'nut', screw: 'screw', pitch: 0.5, rpm: 60 });
  assert.ok(Math.abs(posOf(at(lying, 4), 'nut')[0] + 1) > 1, 'a screw lying on its side carries the nut along x');
  near(posOf(at(lying, 4), 'nut')[1], 0, 1e-6);
});
