import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// Intermittent motion: the `step` and `geneva` loop kinds (rows of the movement catalogue) advance in steps and stand between them.

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const rotZ = (f: Frame, id: string) => ((obj(f, id).pose?.rot ?? obj(f, id).rot) as number[])[2]!;
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues };
};
const bar = { op: 'add', shape: 'box', id: 'wheel', size: [2, 2, 0.4], pos: [0, 0, 0] };

test('step: a part advances its amount in the first quarter of each cycle and stands the rest of it', () => {
  const { plan, issues } = run(bar, { op: 'loop', id: 'wheel', kind: 'step', amount: 30, period: 2 });
  assert.deepEqual(issues, []);
  const z = (t: number) => rotZ(evaluate(plan, t), 'wheel');
  near(z(0), 0);
  near(z(0.25), 15);            // half way through the advance, eased
  near(z(0.5), 30);
  for (const t of [0.6, 1.0, 1.7, 1.99]) near(z(t), 30);   // it stands
  near(z(2.0), 30);
  near(z(2.25), 45);
  near(z(2.5), 60);             // and the next step, from where the last left it
  near(z(9.9), 30 * 5);         // five steps in nine seconds and a bit, standing
});

test('step: a negative amount steps the other way, and a step locked to a spinning part follows it', () => {
  const back = run(bar, { op: 'loop', id: 'wheel', kind: 'step', amount: -20, period: 2 });
  near(rotZ(evaluate(back.plan, 1.2), 'wheel'), -20);
  near(rotZ(evaluate(back.plan, 3.2), 'wheel'), -40);
  const driver = { op: 'add', shape: 'box', id: 'drv', size: [1, 1, 1], pos: [5, 0, 0] };
  const by = run(bar, driver, { op: 'spin', id: 'drv', axis: 'z', rpm: 30, dur: 0 }, { op: 'loop', id: 'wheel', kind: 'step', amount: 45, by: 'drv' });
  // one turn of the driver every two seconds: a step a turn
  near(rotZ(evaluate(by.plan, 0.8), 'wheel'), 45);
  near(rotZ(evaluate(by.plan, 2.8), 'wheel'), 90);
  near(rotZ(evaluate(by.plan, 3.6), 'wheel'), 90);
  const half = run(bar, driver, { op: 'spin', id: 'drv', axis: 'z', rpm: 30, dur: 0 }, { op: 'loop', id: 'wheel', kind: 'step', amount: 45, by: 'drv', ratio: 2 });
  near(rotZ(evaluate(half.plan, 1.8), 'wheel'), 90);   // two steps a driver turn
});

/** The wheel's turn at a time, and the driver pin's direction from the wheel's middle, for a Geneva drive of a driver pin on radius 1 and a wheel with slots of `amount` degrees. */
function geneva(amount: number, extra: object = {}) {
  const C = 1 / Math.sin((amount / 2) * Math.PI / 180);
  const { plan, issues } = run(
    { op: 'add', shape: 'box', id: 'drv', size: [1, 1, 1], pos: [0, 0, 0] },
    { op: 'add', shape: 'box', id: 'wheel', size: [2, 2, 0.4], pos: [C, 0, 0] },
    { op: 'spin', id: 'drv', axis: 'z', rpm: 15, dur: 0 },       // 90 degrees a second: the pin is on the line of centres at 4 s, 8 s...
    { op: 'loop', id: 'wheel', kind: 'geneva', amount, by: 'drv', ...extra },
  );
  assert.deepEqual(issues, []);
  const turn = (t: number) => rotZ(evaluate(plan, t), 'wheel');
  const pin = (t: number) => { const th = 90 * t * Math.PI / 180; return Math.atan2(Math.sin(th), Math.cos(th) - C) * 180 / Math.PI; };
  return { turn, pin, engage: (90 - amount / 2) / 90 };
}
const wrap = (d: number) => ((d % 360) + 540) % 360 - 180;

test('geneva: while the pin is in the slot the slot lies along the pin; otherwise the wheel is locked still', () => {
  for (const amount of [45, 60, 90, 120]) {
    const { turn, pin, engage } = geneva(amount);
    const at = turn(4);
    for (const f of [-0.95, -0.7, -0.3, 0, 0.3, 0.7, 0.95]) {
      const t = 4 + f * engage;
      // the slot that was along the line of centres at 4 s, turned by what the wheel has turned since
      assert.ok(Math.abs(wrap(pin(t) - (180 + turn(t) - at))) < 1e-6, `${amount} degrees at ${t}: the pin is ${pin(t)}, the slot ${180 + turn(t) - at}`);
    }
    const locked = turn(4 + engage + 0.02);
    for (const t of [4 + engage + 0.05, 5.5, 6, 7, 8 - engage - 0.05]) near(turn(t), locked);
    near(turn(4 + engage + 0.05) - turn(4 - engage - 0.05), -amount, 1e-6);
  }
});

test('geneva: it indexes one slot a turn of the driver, the opposite way; free, it begins at rest', () => {
  const { turn, engage } = geneva(90);
  near(turn(4 + engage + 0.1) - turn(4 - engage - 0.1), -90, 1e-6);
  near(turn(8 + engage + 0.1) - turn(4 + engage + 0.1), -90, 1e-6);
  // free (no driver), it begins at rest and indexes the same amount a period
  const free = run({ op: 'add', shape: 'box', id: 'wheel', size: [2, 2, 0.4] }, { op: 'loop', id: 'wheel', kind: 'geneva', amount: 60, period: 2 });
  near(rotZ(evaluate(free.plan, 0), 'wheel'), 0);
  near(rotZ(evaluate(free.plan, 2.0), 'wheel') - rotZ(evaluate(free.plan, 0.001), 'wheel'), -60, 0.5);
});

test('ratchet: the wheel follows a lever of half its amount through each push stroke, and stands while the lever comes back', () => {
  const { plan, issues } = run(
    bar, { op: 'add', shape: 'box', id: 'lever', size: [3, 0.3, 0.3], pos: [0, 0, 1] },
    { op: 'loop', id: 'lever', kind: 'swing', amount: 15, period: 2 },
    { op: 'loop', id: 'wheel', kind: 'ratchet', amount: 30, period: 2 },
  );
  assert.deepEqual(issues, []);
  const w = (t: number) => rotZ(evaluate(plan, t), 'wheel');
  const l = (t: number) => rotZ(evaluate(plan, t), 'lever');
  near(w(0), 0);
  // the lever pushes forward from its far end to its far end (a half cycle, 0.5 s either side of 0 here): the wheel is turned exactly as far as the lever
  for (const t of [0.1, 0.3, 0.5]) near(w(t) - l(t), 0, 1e-6);
  // and stands while the lever comes back (0.5 s to 1.5 s)
  for (const t of [0.6, 1.0, 1.4, 1.5]) near(w(t), 15);
  // the next push starts from the far end: one tooth on, the lever's travel and no more
  for (const t of [1.6, 2.0, 2.4, 2.5]) near(w(t) - l(t), 30, 1e-6);
  for (const t of [2.6, 3.0, 3.4]) near(w(t), 45);
});

test('coupled like the others: a part coupled to a stepped one steps by its ratio, a slide by its pitch, and a hinge limit holds', () => {
  const { plan, issues } = run(
    bar,
    { op: 'add', shape: 'box', id: 'b', size: [1, 1, 0.3], pos: [4, 0, 0] },
    { op: 'add', shape: 'box', id: 'slab', size: [1, 1, 1], pos: [0, 4, 0] },
    { op: 'add', shape: 'box', id: 'stop', size: [1, 1, 0.3], pos: [-4, 0, 0] },
    { op: 'loop', id: 'wheel', kind: 'step', amount: 90, period: 2 },
    { op: 'joint', id: 'b', kind: 'hinge', axis: 'z' }, { op: 'couple', id: 'b', by: 'wheel', ratio: -2 },
    { op: 'joint', id: 'slab', kind: 'slide', axis: 'x' }, { op: 'couple', id: 'slab', by: 'wheel', pitch: 8 },
    { op: 'joint', id: 'stop', kind: 'hinge', axis: 'z', max: 100 }, { op: 'couple', id: 'stop', by: 'wheel', ratio: 1 },
  );
  assert.deepEqual(issues, []);
  const f = (t: number) => evaluate(plan, t);
  near(rotZ(f(0.6), 'b'), -180);                 // one step of 90 degrees, twice, the other way
  near(rotZ(f(1.4), 'b'), -180);                 // and it stands while the wheel does
  near(rotZ(f(2.6), 'b'), -360);
  near(((obj(f(0.6), 'slab').pose?.pos ?? obj(f(0.6), 'slab').pos) as number[])[0]!, 2);  // a quarter turn of a pitch of 8
  near(((obj(f(1.4), 'slab').pose?.pos ?? obj(f(1.4), 'slab').pos) as number[])[0]!, 2);
  near(rotZ(f(0.6), 'stop'), 90);
  near(rotZ(f(2.6), 'stop'), 100);               // two steps would make 180: the limit holds it
});
