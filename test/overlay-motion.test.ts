import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene, createSceneState } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, frameAt, planStep, settle, withMotion } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { crankThrow, pistonPinDrop, rodEnds } from '../src/overlay/mechanism-geometry.ts';
import { Player, createSilentVoice } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id);
const rotZ = (f: Frame, id: string) => (obj(f, id)?.pose?.rot ?? obj(f, id)?.rot)?.[2];
const posOf = (f: Frame, id: string) => (obj(f, id)?.pose?.pos ?? obj(f, id)?.pos) as [number, number, number];
const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;

const crank = { op: 'add', shape: 'part', part: 'crankshaft', id: 'crank', size: [4, 4, 2], pos: [0, -2, 0] };
const rod = { op: 'add', shape: 'part', part: 'connecting-rod', id: 'rod', size: [0.8, 4, 0.5], pos: [0, 0.5, 0] };
const piston = { op: 'add', shape: 'part', part: 'piston', id: 'piston', size: [2, 2, 2], pos: [0, 3, 0] };
const engine = [crank, rod, piston];

test('a spin turns a part without end, at the rate given, and the angle is the same whenever it is asked', () => {
  const s = step(...engine, { op: 'spin', id: 'crank', rpm: 60, dur: 0 });
  const plan = planStep(emptyFrame(), s);
  near(rotZ(evaluate(plan, 0), 'crank'), 0);
  near(rotZ(evaluate(plan, 1), 'crank'), 360);
  near(rotZ(evaluate(plan, 2.5), 'crank'), 900);
  // the part's own rot is left alone: the turning is a pose on top of it
  assert.deepEqual(obj(evaluate(plan, 2.5), 'crank')?.rot, [0, 0, 0]);
});

test('a spin picks up speed over dur, and stops again with rpm 0', () => {
  const plan = planStep(emptyFrame(), step(...engine,
    { op: 'spin', id: 'crank', rpm: 60, dur: 2 },
    { op: 'spin', id: 'crank', rpm: 0, at: 4, dur: 2 }));
  // two seconds of ramp to 360 deg/s cover 360 degrees
  near(rotZ(evaluate(plan, 2), 'crank'), 360);
  near(rotZ(evaluate(plan, 4), 'crank'), 360 + 720);
  const done = rotZ(evaluate(plan, 6), 'crank') as number;
  near(done, 360 + 720 + 360);
  near(rotZ(evaluate(plan, 60), 'crank'), done);
});

test('the angle carries into the next step, and a step that overran carries what it overran by', () => {
  const steps = [step(...engine, { op: 'spin', id: 'crank', rpm: 60, dur: 0 }), step({ op: 'highlight', id: 'rod' })];
  const first = planStep(emptyFrame(), steps[0] as Step);
  const end = first.duration;
  const on = frameAt(steps, 1, 0);
  near(rotZ(on, 'crank'), 360 * end);
  // the player passes how far the step really ran when it settles
  const late = settle(first, end + 1.5);
  near(rotZ(late, 'crank'), 360 * (end + 1.5));
  // and the next step goes on from there
  near(rotZ(evaluate(planStep(late, steps[1] as Step), 0), 'crank'), 360 * (end + 1.5));
});

test('a delayed speed ramp finishes before settling and carries its target speed into the next step', () => {
  const first = planStep(emptyFrame(), step(...engine,
    { op: 'spin', id: 'crank', rpm: 30, at: 2, dur: 2 },
    { op: 'spin', id: 'rod', by: 'crank', ratio: -0.5, phase: 90, at: 2 }));
  near(first.duration, 4);
  const before = evaluate(first, 3);
  near(rotZ(before, 'crank'), 45);
  const end = settle(first);
  near(rotZ(end, 'crank'), 180);
  near(rotZ(end, 'rod'), 0);
  const next = planStep(end, step());
  near(rotZ(evaluate(next, 1), 'crank'), 360);
  near(rotZ(evaluate(next, 1), 'rod'), -90);
  near(rotZ(settle(first, 5), 'crank'), 360);
  // Seeking after settlement does not consume or change the ramp.
  assert.deepEqual(evaluate(first, 3), before);
});

test('the default speed ramp reaches full speed even when nothing else extends the step', () => {
  const plan = planStep(emptyFrame(), step(crank, { op: 'spin', id: 'crank', rpm: 30 }));
  near(plan.duration, 0.8);
  near(rotZ(settle(plan), 'crank'), 72);
  near(rotZ(withMotion(settle(plan), 1), 'crank'), 252);
});

test('a stop ramp settles at rest rather than carrying an intermediate speed onward', () => {
  const base = settle(planStep(emptyFrame(), step(crank, { op: 'spin', id: 'crank', rpm: 60, dur: 0 })));
  const plan = planStep(base, step({ op: 'spin', id: 'crank', rpm: 0, dur: 2 }));
  near(plan.duration, 2);
  const stopped = settle(plan);
  near(rotZ(stopped, 'crank'), 252 + 360);
  near(rotZ(withMotion(stopped, 10), 'crank'), 252 + 360);
});

test('an instant explode still waits for the minimum braking ramp to stop the machine', () => {
  const base = settle(planStep(emptyFrame(), step(
    { op: 'add', shape: 'group', id: 'all' }, { ...crank, parent: 'all' },
    { op: 'spin', id: 'crank', rpm: 60, dur: 0 })));
  const plan = planStep(base, step({ op: 'explode', id: 'all', to: 1, dur: 0 }));
  near(plan.duration, 0.3);
  near(rotZ(settle(plan), 'crank'), 252 + 54);
  near(rotZ(withMotion(settle(plan), 10), 'crank'), 252 + 54);
});

test('a superseded speed ramp does not hold the next step after the replacement settles', () => {
  const stopped = planStep(emptyFrame(), step(crank,
    {op:'spin',id:'crank',rpm:60,dur:10}, {op:'spin',id:'crank',rpm:0,dur:0,at:1}));
  near(stopped.duration, 1.2);
  near(rotZ(settle(stopped),'crank'),18);
  near(rotZ(withMotion(settle(stopped),5),'crank'),18);
  const changed = planStep(emptyFrame(), step(crank,
    {op:'spin',id:'crank',rpm:60,dur:10}, {op:'spin',id:'crank',rpm:30,dur:2,at:1}));
  near(changed.duration,3);
  const end=settle(changed);
  near(rotZ(withMotion(end,1),'crank')!-rotZ(end,'crank')!,180);
});

test('another part or non-spin animation can still determine the step duration', () => {
  const other={op:'add',shape:'box',id:'other',size:[1,1,1]};
  const actions=[crank,other,
    {op:'spin',id:'crank',rpm:60,dur:10},{op:'spin',id:'crank',rpm:0,dur:0,at:1},
    {op:'spin',id:'other',rpm:30,dur:4}];
  near(planStep(emptyFrame(),step(...actions)).duration,4);
  const plan=planStep(emptyFrame(),step(...actions,{op:'move',id:'other',to:[1,0,0],dur:6}));
  near(plan.duration,6);
});

test('locking or exploding supersedes an earlier ramp without losing real braking', () => {
  const other={op:'add',shape:'box',id:'other',size:[1,1,1]};
  const locked=planStep(emptyFrame(),step(crank,other,
    {op:'spin',id:'other',rpm:30,dur:0}, {op:'spin',id:'crank',rpm:60,dur:10},
    {op:'spin',id:'crank',by:'other',at:1}));
  near(locked.duration,1.2);
  const exploded=planStep(emptyFrame(),step(crank,
    {op:'spin',id:'crank',rpm:60,dur:10},{op:'explode',id:'crank',to:1,dur:0,at:1}));
  near(exploded.duration,1.3);
  near(rotZ(withMotion(settle(exploded),5),'crank'),rotZ(settle(exploded),'crank')!);
});

test('a replacement preserves the spin reservation for a later stop or lock', () => {
  const other={op:'add',shape:'box',id:'other',size:[1,1,1]};
  const initial=[crank,other,{op:'spin',id:'crank',rpm:60,dur:10},
    {...crank,at:1}];
  near(planStep(emptyFrame(),step(...initial,{op:'spin',id:'crank',rpm:0,dur:0,at:2})).duration,2.2);
  near(planStep(emptyFrame(),step(...initial,{op:'spin',id:'crank',by:'other',at:2})).duration,2.2);
  near(planStep(emptyFrame(),step(...initial,{op:'spin',id:'other',rpm:30,dur:5},
    {op:'spin',id:'crank',rpm:0,dur:0,at:2})).duration,5);
});

test('a replaced parent does not disturb its child spin reservation', () => {
  const parent={op:'add',shape:'group',id:'holder'};
  const child={...crank,parent:'holder'};
  const plan=planStep(emptyFrame(),step(parent,child,{op:'spin',id:'crank',rpm:60,dur:10},
    {...parent,at:1},{op:'spin',id:'crank',rpm:0,dur:0,at:2}));
  near(plan.duration,2.2);
});

test('clearing a spinning object preserves the existing ramp duration policy', () => {
  const plan=planStep(emptyFrame(),step(crank,{op:'spin',id:'crank',rpm:60,dur:10},
    {op:'clear',target:'crank',at:1}));
  near(plan.duration,10);
});

test('a spin locked to another turns that many times as far, even while the other speeds up', () => {
  const cam = { op: 'add', shape: 'part', part: 'camshaft', id: 'cam', size: [4, 1, 1], pos: [3, 5, 0] };
  const plan = planStep(emptyFrame(), step(...engine, cam,
    { op: 'spin', id: 'crank', rpm: 60, dur: 3 },
    { op: 'spin', id: 'cam', by: 'crank', ratio: 0.5, phase: 90 }));
  for (const t of [0.5, 1.7, 3, 8]) {
    near(rotZ(evaluate(plan, t), 'cam'), (rotZ(evaluate(plan, t), 'crank') as number) * 0.5 + 90, 1e-6);
  }
});

test('a crank holds the piston on its stroke and the rod joins the crank pin to the piston pin at every angle', () => {
  const plan = planStep(emptyFrame(), step(...engine,
    { op: 'spin', id: 'crank', rpm: 10, dur: 0 },
    { op: 'crank', id: 'piston', shaft: 'crank', rod: 'rod' }));
  const r = crankThrow([4, 4, 2]);
  const ends = rodEnds([0.8, 4, 0.5]);
  const drop = pistonPinDrop([2, 2, 2]);
  const crownAt = (deg: number) => posOf(evaluate(plan, deg / 60), 'piston')[1];
  // top of the stroke at 0 degrees, bottom at 180: the stroke is twice the throw
  near(crownAt(0) - crownAt(180), 2 * r, 1e-9);
  assert.ok(crownAt(90) < crownAt(0) && crownAt(90) > crownAt(180));
  for (const deg of [0, 37, 90, 133, 180, 250, 311]) {
    const f = evaluate(plan, deg / 60); // 10 rpm is 60 degrees a second
    near(rotZ(f, 'crank'), deg);
    const a = (deg * Math.PI) / 180;
    const pin = [-Math.sin(a) * r, -2 + Math.cos(a) * r] as [number, number];
    const p = posOf(f, 'piston');
    const wrist = [p[0], p[1] + drop] as [number, number];
    const rp = posOf(f, 'rod');
    const tilt = ((obj(f, 'rod')?.pose?.rot?.[2] ?? 0) * Math.PI) / 180;
    // the rod's big end sits on the crank pin and its small end on the wrist pin
    near(rp[0] + ends.big * -Math.sin(tilt), pin[0], 1e-9);
    near(rp[1] + ends.big * Math.cos(tilt), pin[1], 1e-9);
    near(rp[0] + ends.small * -Math.sin(tilt), wrist[0], 1e-9);
    near(rp[1] + ends.small * Math.cos(tilt), wrist[1], 1e-9);
  }
});

test('a cam pushes its valve down while the nose points at it, and not otherwise', () => {
  const cam = { op: 'add', shape: 'part', part: 'camshaft', id: 'cam', size: [4, 1, 1], pos: [3, 5, 0] };
  const valve = { op: 'add', shape: 'part', part: 'valve', id: 'valve', size: [1, 5, 1], pos: [3, 2, 0] };
  const plan = planStep(emptyFrame(), step(cam, valve,
    { op: 'turn', id: 'cam', to: [0, 0, 0], dur: 0 },
    { op: 'spin', id: 'cam', rpm: 10, dur: 0 },
    { op: 'cam', id: 'valve', by: 'cam', lift: 0.8, open: 100 }));
  const lowering = (deg: number) => 2 - posOf(evaluate(plan, deg / 60), 'valve')[1];
  near(lowering(0), 0);
  near(lowering(180), 0.8, 1e-9);
  assert.ok(lowering(150) > 0 && lowering(150) < 0.8);
  near(lowering(100), 0);
  near(lowering(260), 0);
  near(lowering(360 + 180), 0.8, 1e-9);
});

test('a flash lights its object only in its window of the cycle, and dies away over the span', () => {
  const glow = { op: 'add', shape: 'sphere', id: 'burn', size: [1, 1, 1], opacity: 0.8, pos: [0, 5, 0] };
  const plan = planStep(emptyFrame(), step(...engine, glow,
    { op: 'spin', id: 'crank', rpm: 10, dur: 0 },
    { op: 'flash', id: 'burn', by: 'crank', angle: 360, span: 160 }));
  const lit = (deg: number) => (obj(evaluate(plan, deg / 60), 'burn')?.pose?.opacity ?? 1) as number;
  near(lit(10), 0);
  near(lit(340), 0);
  near(lit(360), 0);
  assert.ok(lit(376) > 0.7, `${lit(376)}`); // quick to light
  assert.ok(lit(440) < lit(376) && lit(440) > 0);
  assert.ok(lit(520) < lit(440));
  near(lit(540), 0);
  // the next cycle (720 degrees later) does it again
  assert.ok(lit(720 + 376) > 0.7);
});

test('pulling a machine apart stops it where it is', () => {
  const plan = planStep(emptyFrame(), step({ op: 'add', shape: 'group', id: 'all' }, ...engine.map((e) => ({ ...e, parent: 'all' })), { op: 'spin', id: 'crank', rpm: 60, dur: 0 },
    { op: 'explode', id: 'all', to: 1, at: 2, dur: 1 }));
  const a = rotZ(evaluate(plan, 3.5), 'crank') as number;
  near(rotZ(evaluate(plan, 30), 'crank'), a);
  assert.ok(a > 360 * 2 && a < 360 * 3.5);
});

test('the validator takes the four machine actions, and drops a spin with nothing to turn it', () => {
  const scene = { steps: [{ say: 'it runs', actions: [...engine,
    { op: 'spin', id: 'crank', rpm: 30 }, { op: 'spin', id: 'rod' }, { op: 'spin', id: 'piston', by: 'crank', ratio: 2 },
    { op: 'crank', id: 'piston', shaft: 'crank', rod: 'rod' },
    { op: 'cam', id: 'piston', by: 'crank' }, { op: 'flash', id: 'piston', by: 'crank', angle: 360, span: 90 }] }] };
  const result = validateScene(scene, createSceneState());
  assert.equal(result.ok, true);
  const ops = (result.scene as Scene).steps[0]?.actions.map((a) => a.op);
  assert.deepEqual(ops, ['add', 'add', 'add', 'spin', 'spin', 'crank', 'cam', 'flash']);
  assert.ok(result.issues.some((i) => /spin needs rpm or by/.test(i.message)));
});

test('a finished scene goes on running while idle, and stops where it is when the user takes hold', () => {
  let now = 0;
  const clock: Clock = { now: () => now, after: () => () => {} };
  const player = new Player({ voice: createSilentVoice(), clock });
  player.play({ steps: [{ say: '', actions: [...engine, { op: 'spin', id: 'crank', rpm: 60, dur: 0 }, { op: 'crank', id: 'piston', shaft: 'crank', rod: 'rod' }] }] } as Scene);
  now += 1000;
  player.update();
  now += 3000;
  const a = rotZ(player.update(), 'crank') as number;
  now += 1000;
  const b = rotZ(player.update(), 'crank') as number;
  near(b - a, 360, 1e-6);
  assert.equal(player.active, true);
  player.dragCamera(5, 0);
  const frozen = rotZ(player.update(), 'crank') as number;
  now += 5000;
  near(rotZ(player.update(), 'crank'), frozen);
});

test('withMotion runs a frame on at the rates it has', () => {
  const f = evaluate(planStep(emptyFrame(), step(...engine, { op: 'spin', id: 'crank', rpm: 60, dur: 0 })), 1);
  near(rotZ(withMotion(f, 2), 'crank'), 360 * 3);
});
