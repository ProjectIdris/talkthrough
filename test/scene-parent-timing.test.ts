import test from 'node:test';
import assert from 'node:assert/strict';
import { beginLiveStep, createDetailState, createSceneState, validateStep } from '../src/scene/index.ts';
import type { Action, Step } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep, settle } from '../src/overlay/timeline.ts';

const group = (id: string, extra = {}) => ({ op: 'add', shape: 'group', id, ...extra });
const cube = (id: string, extra = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const step = (...actions: unknown[]) => ({ say: 'Parts.', actions });

test('a child scheduled before its new parent is diagnosed and never registered', () => {
  const state = createSceneState();
  const result = validateStep(step(group('holder', { at: 2 }), cube('child', { parent: 'holder' })), state);
  assert.deepEqual(result.step?.actions.map((a) => 'id' in a ? a.id : a.op), ['holder']);
  assert.ok(result.issues.some((i) => i.kind === 'dropped' && i.path.endsWith('.parent') && i.message.includes('starts after')));
  assert.equal(state.ids.has('child'), false);
  assert.equal(state.parents.has('child'), false);
  assert.equal(state.bodies.has('child'), false);
  assert.equal(state.depth.has('child'), false);
});

test('equal, omitted and later child start times retain their parent', () => {
  for (const [parentAt, childAt] of [[undefined, undefined], [0, 2], [2, 2], [2, 3]]) {
    const result = validateStep(step(group('holder', { at: parentAt }), cube('child', { parent: 'holder', at: childAt })), createSceneState());
    assert.deepEqual(result.issues, []);
    const plan = planStep(emptyFrame(), result.step!);
    const frame = settle(plan);
    assert.equal(frame.objects.find((o) => o.id === 'child')?.parentKey, frame.objects.find((o) => o.id === 'holder')?.key);
    if (childAt && childAt > 0) assert.equal(evaluate(plan, childAt - 0.01).objects.some((o) => o.id === 'child'), false);
  }
});

test('a prior-step parent is already available at zero in the next step', () => {
  const state = createSceneState();
  const first = validateStep(step(group('holder', { at: 60 })), state);
  const next = validateStep(step(cube('child', { parent: 'holder' })), state);
  assert.deepEqual(next.issues, []);
  const frame = settle(planStep(settle(planStep(emptyFrame(), first.step!)), next.step!));
  assert.equal(frame.objects[1]?.parentKey, frame.objects[0]?.key);
});

test('an existing parent remains available before its scheduled detail replacement', () => {
  const state = createSceneState();
  const first = validateStep(step(group('holder')), state);
  const next = validateStep(step(group('holder', { at: 2 }), cube('child', { parent: 'holder' })), createDetailState(state));
  assert.deepEqual(next.issues, []);
  const frame = settle(planStep(settle(planStep(emptyFrame(), first.step!)), next.step!));
  assert.equal(frame.objects.find((o) => o.id === 'child')?.parentKey, frame.objects.find((o) => o.id === 'holder')?.key);
});

test('a rejected early group cannot leave phantom child registrations', () => {
  const state = createSceneState();
  const result = validateStep(step(
    group('root', { at: 2 }), group('middle', { parent: 'root' }), cube('leaf', { parent: 'middle' }),
  ), state);
  assert.deepEqual(result.step?.actions.map((a) => 'id' in a ? a.id : a.op), ['root']);
  assert.deepEqual([...state.ids.keys()], ['root']);
});

test('held forward references obey the same parent timing rule when their exact parent arrives', () => {
  const state = createSceneState();
  const result = validateStep(step(cube('child', { parent: 'holder' }), group('holder', { at: 2 })), state);
  assert.deepEqual(result.step?.actions.map((a) => 'id' in a ? a.id : a.op), ['holder']);
  assert.equal(state.ids.has('child'), false);
  assert.ok(result.issues.some((i) => i.path === 'steps[0].actions[0].parent' && i.message.includes('starts after')));
});

test('streamed and complete validation refuse the same early child before player timing can mask it', () => {
  const actions = [group('holder', { at: 2 }), cube('early', { parent: 'holder' }), cube('valid', { parent: 'holder', at: 2 })];
  const wholeState = createSceneState();
  const whole = validateStep(step(...actions), wholeState);
  const liveState = createSceneState();
  const emitted: Action[] = [];
  const live = beginLiveStep(liveState, { open() {}, action: (a) => emitted.push(a) });
  live.say('Parts.');
  for (const action of actions) live.action(action);
  const streamed = live.finish();
  assert.deepEqual(emitted.map((a) => 'id' in a ? a.id : a.op), ['holder', 'valid']);
  assert.deepEqual(streamed, whole);
  assert.deepEqual(emitted, whole.step?.actions);
  assert.deepEqual(liveState, wholeState);
});

test('clear gaps stay a timeline safeguard rather than a chronological validator promise', () => {
  const state = createSceneState();
  const result = validateStep(step(
    group('holder'), { op: 'clear', target: 'holder' }, group('holder', { at: 2 }),
    cube('early', { parent: 'holder', at: 1 }), cube('valid', { parent: 'holder', at: 2 }),
  ), state);
  assert.deepEqual(result.issues, []);
  assert.equal(state.ids.has('early'), true, 'structural validation retains known ids; it does not reconstruct clear lifetimes');
  assert.equal(state.ids.has('valid'), true);
  const frame = settle(planStep(emptyFrame(), result.step!));
  assert.equal(frame.objects.some((o) => o.id === 'early'), false, 'the missing-parent timeline guard prevents orphan creation');
  assert.equal(frame.objects.find((o) => o.id === 'valid')?.parentKey, frame.objects.find((o) => o.id === 'holder')?.key);
});

test('a later-authored child may attach before a scheduled clear and re-add of its parent', () => {
  const state = createSceneState();
  const first = validateStep(step(group('holder')), state);
  const base = settle(planStep(emptyFrame(), first.step!));
  const result = validateStep(step(
    { op: 'clear', target: 'holder', at: 10 }, group('holder', { at: 20 }),
    cube('child', { parent: 'holder', at: 5 }),
  ), state);
  assert.deepEqual(result.issues, []);
  assert.equal(result.step?.actions.length, 3);
  const plan = planStep(base, result.step!);
  const before = evaluate(plan, 6);
  assert.equal(before.objects.find((o) => o.id === 'child')?.parentKey, base.objects[0]?.key);
  assert.equal(evaluate(plan, 11).objects.some((o) => o.id === 'child'), false);
  assert.equal(settle(plan).objects.some((o) => o.id === 'child'), false);
});

test('clearing an ancestor preserves earlier children while the timeline omits children in the gap', () => {
  const state = createSceneState();
  const first = validateStep(step(group('root'), group('holder', { parent: 'root' })), state);
  const base = settle(planStep(emptyFrame(), first.step!));
  const result = validateStep(step(
    { op: 'clear', target: 'root', at: 10 }, group('holder', { at: 20 }),
    cube('before', { parent: 'holder', at: 5 }),
    cube('gap', { parent: 'holder', at: 15 }),
    cube('after', { parent: 'holder', at: 20 }),
  ), state);
  assert.deepEqual(result.step?.actions.flatMap((a) => 'id' in a ? [a.id] : []), ['holder', 'before', 'gap', 'after']);
  assert.deepEqual(result.issues, []);
  const plan = planStep(base, result.step!);
  const before = evaluate(plan, 6);
  assert.equal(before.objects.find((o) => o.id === 'before')?.parentKey, base.objects.find((o) => o.id === 'holder')?.key);
  assert.equal(evaluate(plan, 16).objects.some((o) => o.id === 'gap'), false);
  const after = settle(plan);
  assert.deepEqual(after.objects.map((o) => o.id), ['holder', 'after']);
  assert.equal(after.objects[1]?.parentKey, after.objects[0]?.key);
});

test('multiple parent lifetimes preserve valid children and the timeline omits clear-boundary and gap children', () => {
  const state = createSceneState();
  const result = validateStep(step(
    group('holder'), { op: 'clear', target: 'holder', at: 10 },
    group('holder', { at: 20 }), { op: 'clear', target: 'holder', at: 30 }, group('holder', { at: 40 }),
    cube('first', { parent: 'holder', at: 5 }), cube('cleared', { parent: 'holder', at: 10 }),
    cube('second', { parent: 'holder', at: 25 }), cube('gap', { parent: 'holder', at: 35 }),
    cube('third', { parent: 'holder', at: 40 }),
  ), state);
  assert.deepEqual(result.step?.actions.flatMap((a) => a.op === 'add' && a.shape === 'box' ? [a.id] : []), ['first', 'cleared', 'second', 'gap', 'third']);
  assert.deepEqual(result.issues, []);
  const plan = planStep(emptyFrame(), result.step!);
  for (const time of [10, 15, 35, Infinity]) {
    assert.equal(evaluate(plan, time).objects.some((o) => o.id === 'cleared' || o.id === 'gap'), false);
  }
  for (const [time, id] of [[6, 'first'], [26, 'second'], [41, 'third']] as const) {
    const frame = evaluate(plan, time);
    const parent = frame.objects.find((o) => o.id === 'holder');
    assert.ok(parent);
    assert.equal(frame.objects.find((o) => o.id === id)?.parentKey, parent.key);
  }
});

for (const [readdedAt, childAt] of [[40, 25], [15, 17]]) {
  test(`a clear authored out of time order preserves the parent's lifetime for a child at ${childAt}`, () => {
    const state = createSceneState();
    const first = validateStep(step(group('holder')), state);
    const base = settle(planStep(emptyFrame(), first.step!));
    const result = validateStep(step(
      { op: 'clear', target: 'holder', at: 10 }, group('holder', { at: 20 }),
      { op: 'clear', target: 'holder', at: 5 }, group('holder', { at: readdedAt }),
      cube('child', { parent: 'holder', at: childAt }),
    ), state);
    assert.deepEqual(result.issues, []);
    assert.equal(result.step?.actions.length, 5);
    const plan = planStep(base, result.step!);
    assert.equal(evaluate(plan, childAt! + 0.5).objects.some((o) => o.id === 'child'), true);
    const frame = settle(plan);
    assert.equal(frame.objects.find((o) => o.id === 'child')?.parentKey, frame.objects.find((o) => o.id === 'holder')?.key);
  });
}

test('a scheduled detail replacement restores parent availability after a later-authored earlier clear', () => {
  const original = createSceneState();
  const first = validateStep(step(group('holder')), original);
  const base = settle(planStep(emptyFrame(), first.step!));
  const state = createDetailState(original);
  const result = validateStep(step(
    group('holder', { at: 20 }), { op: 'clear', target: 'holder', at: 10 }, group('holder', { at: 40 }),
    cube('child', { parent: 'holder', at: 25 }),
  ), state);
  assert.deepEqual(result.issues, []);
  assert.equal(result.step?.actions.length, 4);
  const plan = planStep(base, result.step!);
  assert.equal(evaluate(plan, 26).objects.some((o) => o.id === 'child'), true);
  const frame = settle(plan);
  assert.equal(frame.objects.find((o) => o.id === 'child')?.parentKey, frame.objects.find((o) => o.id === 'holder')?.key);
});

test('a future reparent cannot make an earlier ancestor clear erase the old parent relationship', () => {
  const original = createSceneState();
  const first = validateStep(step(group('roota'), group('rootb'), group('holder', { parent: 'rootb' })), original);
  const base = settle(planStep(emptyFrame(), first.step!));
  const result = validateStep(step(
    group('holder', { parent: 'roota', at: 20 }), { op: 'clear', target: 'roota', at: 10 },
    group('holder', { parent: 'rootb', at: 40 }), cube('child', { parent: 'holder', at: 15 }),
  ), createDetailState(original));
  assert.deepEqual(result.issues, []);
  const plan = planStep(base, result.step!);
  assert.equal(evaluate(plan, 16).objects.some((o) => o.id === 'child'), true);
});

test('an unrelated clear cannot erase a historically available parent', () => {
  const state = createSceneState();
  const first = validateStep(step(group('holder')), state);
  const base = settle(planStep(emptyFrame(), first.step!));
  const result = validateStep(step(
    { op: 'clear', target: 'holder', at: 10 }, group('holder', { at: 20 }),
    { op: 'clear', target: 'holder', at: 5 }, { op: 'clear', target: 'marks', at: 30 },
    group('holder', { at: 40 }), cube('child', { parent: 'holder', at: 35 }),
  ), state);
  assert.deepEqual(result.issues, []);
  const plan = planStep(base, result.step!);
  assert.equal(evaluate(plan, 36).objects.some((o) => o.id === 'child'), true);
});

test('streamed and complete validation preserve the same historical parent references', () => {
  const wholeState = createSceneState(), liveState = createSceneState();
  for (const state of [wholeState, liveState]) validateStep(step(group('holder')), state);
  const actions = [
    { op: 'clear', target: 'holder', at: 10 }, group('holder', { at: 20 }),
    cube('child', { parent: 'holder', at: 5 }), cube('gap', { parent: 'holder', at: 15 }),
  ];
  const whole = validateStep(step(...actions), wholeState);
  const emitted: Action[] = [];
  const live = beginLiveStep(liveState, { open() {}, action: (a) => emitted.push(a) });
  live.say('Parts.');
  for (const action of actions) live.action(action);
  const streamed = live.finish();
  assert.equal(emitted.some((a) => 'id' in a && a.id === 'child'), true);
  assert.equal(emitted.some((a) => 'id' in a && a.id === 'gap'), true, 'neither validator path claims complete lifetime validation');
  assert.deepEqual(streamed, whole);
  assert.deepEqual(emitted, whole.step?.actions);
  assert.deepEqual(liveState, wholeState);
});

test('rejecting an early detail replacement does not consume the existing object or its replacement allowance', () => {
  const original = createSceneState();
  validateStep(step(cube('child')), original);
  const state = createDetailState(original);
  const result = validateStep(step(
    group('holder', { at: 2 }), cube('child', { parent: 'holder' }), cube('child', { parent: 'holder', at: 2 }),
  ), state);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(result.step?.actions.flatMap((a) => 'id' in a ? [a.id] : []), ['holder', 'child']);
  assert.equal(state.parents.get('child'), 'holder');
  assert.equal(state.replaceable?.has('child'), false);
});

test('the timeline does not turn an unavailable explicit parent into a root object', () => {
  for (const actions of [
    [group('holder', { at: 2 }), cube('child', { parent: 'holder' })],
    [group('holder'), { op: 'clear', target: 'holder', at: 1 }, cube('child', { parent: 'holder', at: 2 })],
  ]) {
    const plan = planStep(emptyFrame(), step(...actions) as Step);
    for (const time of [0, 1, 2, Infinity]) assert.equal(evaluate(plan, time).objects.some((o) => o.id === 'child'), false);
  }
});
