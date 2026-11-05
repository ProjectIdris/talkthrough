import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene, Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep, settle, withMotion } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { isMoving } from '../src/overlay/motion.ts';

// A loop is a repeating motion that is not a full turn (slide, swing, pulse) for any object, plain shape or kit part. Every pose is a function of
// the time since the step began, like spin and crank, so a frame, a clip and the live page agree.

const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id);
const posOf = (f: Frame, id: string) => (obj(f, id)?.pose?.pos ?? obj(f, id)?.pos) as [number, number, number];
const rotOf = (f: Frame, id: string) => (obj(f, id)?.pose?.rot ?? obj(f, id)?.rot) as [number, number, number];
const scaleOf = (f: Frame, id: string) => (obj(f, id)?.pose?.scale ?? obj(f, id)?.scale) as [number, number, number];
const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const box = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const run = (...actions: unknown[]) => planStep(emptyFrame(), step(...actions));
const part = (id: string, p: string, extra: object = {}) => ({ op: 'add', shape: 'part', part: p, id, size: [1, 1, 1], ...extra });

test('a slide goes back and forth along its axis by the amount, from where it rests, with no jump at the start', () => {
  const plan = run(box('b', { pos: [0, 1, 0] }), { op: 'loop', id: 'b', kind: 'slide', axis: 'y', amount: 2, period: 2 });
  near(posOf(evaluate(plan, 0), 'b')[1], 1);
  near(posOf(evaluate(plan, 0.5), 'b')[1], 2); // a quarter of the way round: half the amount up
  near(posOf(evaluate(plan, 1), 'b')[1], 1);
  near(posOf(evaluate(plan, 1.5), 'b')[1], 0);
  near(posOf(evaluate(plan, 2.5), 'b')[1], 2); // and again, a period later
  assert.deepEqual(posOf(evaluate(plan, 0.5), 'b').map((v) => Math.round(v * 1e6) / 1e6), [0, 2, 0]);
});

test('a swing rocks about the axis by the angle each side, and about a pivot point when one is given', () => {
  const plan = run(box('bob', { pos: [0, -2, 0] }), { op: 'loop', id: 'bob', kind: 'swing', axis: 'z', amount: 30, period: 2, pivot: [0, 2, 0] });
  const f = evaluate(plan, 0.5);
  near(rotOf(f, 'bob')[2], 30);
  // the bob hangs 2 below the pivot: turned 30 degrees about it, it is 1 to one side and 1.732 below
  near(posOf(f, 'bob')[0], 1);
  near(posOf(f, 'bob')[1], -2 * Math.cos(Math.PI / 6));
  near(rotOf(evaluate(plan, 1.5), 'bob')[2], -30);
  near(rotOf(evaluate(plan, 0), 'bob')[2], 0);
  // with no pivot it turns about its own middle and does not move
  const own = run(box('a', { pos: [3, 3, 0] }), { op: 'loop', id: 'a', kind: 'swing', amount: 20, period: 2 });
  near(posOf(evaluate(own, 0.5), 'a')[0], 3);
  near(rotOf(evaluate(own, 0.5), 'a')[2], 20);
});

test('a pulse swells to the factor and back, from its own size', () => {
  const plan = run(box('heart', { size: [2, 2, 2] }), { op: 'loop', id: 'heart', kind: 'pulse', amount: 1.3, period: 2 });
  near(scaleOf(evaluate(plan, 0), 'heart')[0], 1);
  near(scaleOf(evaluate(plan, 1), 'heart')[0], 1.3);
  near(scaleOf(evaluate(plan, 2), 'heart')[0], 1);
  const mid = scaleOf(evaluate(plan, 0.5), 'heart');
  assert.ok(mid[0] > 1 && mid[0] < 1.3);
  assert.deepEqual([mid[1], mid[2]], [mid[0], mid[0]]);
});

test('a loop locked to a spinning part stays in step with it: far end when the part is at 0, the other end half a turn on', () => {
  const plan = run(part('crank', 'crankshaft', { size: [2, 2, 1] }), box('pis', { pos: [0, 4, 0] }),
    { op: 'spin', id: 'crank', rpm: 30, dur: 0 }, { op: 'loop', id: 'pis', kind: 'slide', axis: 'y', amount: 2, by: 'crank' });
  // 30 rpm is 180 degrees a second
  near(posOf(evaluate(plan, 0), 'pis')[1], 5);
  near(posOf(evaluate(plan, 1), 'pis')[1], 3);
  near(posOf(evaluate(plan, 2), 'pis')[1], 5);
  // twice as fast, a quarter of a turn behind
  const fast = run(part('crank', 'crankshaft', { size: [2, 2, 1] }), box('v', { pos: [0, 4, 0] }),
    { op: 'spin', id: 'crank', rpm: 30, dur: 0 }, { op: 'loop', id: 'v', kind: 'slide', axis: 'y', amount: 2, by: 'crank', ratio: 2, phase: 90 });
  near(posOf(evaluate(fast, 0.25), 'v')[1], 4 + Math.cos(((180 * 0.25 * 2 + 90) * Math.PI) / 180));
});

test('motion carries on from step to step, a later loop replaces the earlier, and stop ends it', () => {
  const first = run(box('b', { pos: [0, 0, 0] }), { op: 'loop', id: 'b', kind: 'slide', axis: 'x', amount: 2, period: 2 });
  const rest = settle(first, first.duration + 0.5);
  assert.equal(isMoving(rest.motion), true);
  // nothing in the next step, and it is still going, from the angle the last one reached
  const second = planStep(rest, step({ op: 'highlight', id: 'b' }));
  near(posOf(evaluate(second, 0), 'b')[0], posOf(rest, 'b')[0]);
  near(posOf(evaluate(second, 0.5), 'b')[0], posOf(evaluate(first, first.duration + 1), 'b')[0]);
  // the page goes on running with no step at all: the same place as the plan itself would give
  near(posOf(withMotion(rest, 0.5), 'b')[0], posOf(evaluate(first, first.duration + 1), 'b')[0]);
  // a later loop on the same object takes over
  const third = planStep(rest, step({ op: 'loop', id: 'b', kind: 'slide', axis: 'y', amount: 4, period: 4 }));
  near(posOf(evaluate(third, 1), 'b')[0], 0); // not sliding along x any more
  assert.ok(Math.abs(posOf(evaluate(third, 1), 'b')[1]) > 1.9);
  // stop puts it back at rest
  const stopped = planStep(rest, step({ op: 'loop', id: 'b', kind: 'stop' }));
  assert.deepEqual(posOf(evaluate(stopped, 1), 'b'), [0, 0, 0]);
  assert.equal(isMoving(settle(stopped).motion), false);
});

test('a loop rides on top of what a machine does to the same part, and one on a group is the group\'s own pose', () => {
  const plan = run({ op: 'add', shape: 'group', id: 'g' }, box('b', { parent: 'g' }), { op: 'loop', id: 'g', kind: 'pulse', amount: 2, period: 2 });
  near(scaleOf(evaluate(plan, 1), 'g')[0], 2);
  near(scaleOf(evaluate(plan, 1), 'b')[0], 1, 1e-9); // the child keeps its own scale; the group's is applied by the scene graph
});

// ---- the validator ---------------------------------------------------------------------------------------------------------------

const validate = (...actions: unknown[]) => {
  const r = validateScene({ steps: [{ say: 'x', actions }] }, createSceneState());
  return { kept: ((r.scene as Scene | null)?.steps ?? []).flatMap((s) => s.actions) as unknown as Array<Record<string, unknown>>, issues: r.issues };
};

test('the validator takes a loop on a plain shape, needs an amount unless it is a stop, and keeps the range sensible', () => {
  const ok = validate(box('b'), { op: 'loop', id: 'b', kind: 'swing', amount: 20, period: 1.5 });
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.kept.filter((a) => a.op === 'loop').length, 1);
  const noAmount = validate(box('b'), { op: 'loop', id: 'b', kind: 'slide' });
  assert.equal(noAmount.kept.filter((a) => a.op === 'loop').length, 0);
  assert.ok(noAmount.issues.some((i) => /loop needs an amount/.test(i.message)));
  assert.equal(validate(box('b'), { op: 'loop', id: 'b', kind: 'stop' }).kept.filter((a) => a.op === 'loop').length, 1);
  assert.equal(validate({ op: 'loop', id: 'nope', kind: 'stop' }).kept.length, 0);
  const wide = validate(box('b'), { op: 'loop', id: 'b', kind: 'pulse', amount: 50 }, { op: 'loop', id: 'b', kind: 'swing', amount: 300 });
  assert.deepEqual(wide.kept.filter((a) => a.op === 'loop').map((a) => a.amount), [5, 180]);
  assert.ok(wide.issues.some((i) => i.kind === 'clamped'));
});

test('a loop locked to a part is bound at the same point as crank and cam: an unknown driver binds to the one crankshaft, the part itself is never its driver', () => {
  const eng = [part('cs', 'crankshaft'), box('p')];
  const bound = validate(...eng, { op: 'loop', id: 'p', kind: 'slide', amount: 2, by: 'the crank' });
  assert.equal(bound.kept.find((a) => a.op === 'loop')?.by, 'cs');
  assert.ok(bound.issues.some((i) => /bound to "cs"/.test(i.message)));
  const self = validate(box('p'), { op: 'loop', id: 'p', kind: 'slide', amount: 2, by: 'p' });
  assert.equal(self.kept.find((a) => a.op === 'loop')?.by, undefined);
});

test('a free loop with a phase starts that many degrees into its cycle, so two can beat half a cycle apart', () => {
  const plan = run(box('a'), box('b'), { op: 'loop', id: 'a', kind: 'pulse', amount: 1.5, period: 2 }, { op: 'loop', id: 'b', kind: 'pulse', amount: 1.5, period: 2, phase: 180 });
  const size = (t: number, id: string) => (obj(evaluate(plan, t), id)?.pose?.scale?.[0] ?? 1);
  near(size(0, 'a'), 1); near(size(0, 'b'), 1.5);
  near(size(1, 'a'), 1.5); near(size(1, 'b'), 1);
});
