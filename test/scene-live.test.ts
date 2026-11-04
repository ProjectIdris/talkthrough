import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { beginLiveStep, createSceneState, LIMITS, startTurn, validateStep } from '../src/scene/index.ts';
import type { Action, Scene } from '../src/scene/index.ts';

const samplesDir = new URL('../samples/scenes/', import.meta.url);
const box = (id: string, extra: object = {}) => ({ op: 'box', id, x: 10, y: 10, w: 100, h: 50, color: 'red', ...extra });
const cube = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], color: 'blue', ...extra });

/** A live step with its events written down in order. */
function rig(state = createSceneState()) {
  const events: string[] = [];
  const live = beginLiveStep(state, {
    open: (say) => events.push(`open:${say}`),
    action: (a: Action) => events.push(`${a.op}:${(a as { id?: string }).id ?? ''}`),
  });
  return { live, events, state };
}

test('the words open the step, then each action is told as it arrives', () => {
  const { live, events } = rig();
  live.say('Hello there.');
  live.action(box('a'));
  assert.deepEqual(events, ['open:Hello there.', 'box:a']);
  live.action(box('b'));
  const done = live.finish();
  assert.deepEqual(events, ['open:Hello there.', 'box:a', 'box:b']);
  assert.equal(done.step?.actions.length, 2);
  assert.deepEqual(done.issues, []);
});

test('what streams is what validateStep keeps, for every step of every sample scene', () => {
  for (const name of readdirSync(samplesDir).filter((f) => f.endsWith('.json'))) {
    const scene = JSON.parse(readFileSync(new URL(name, samplesDir), 'utf8')) as Scene;
    const whole = createSceneState();
    const live = createSceneState();
    for (const raw of scene.steps) {
      const expected = validateStep(raw, whole);
      const streamed: Action[] = [];
      let opened = '';
      const l = beginLiveStep(live, { open: (s) => (opened = s), action: (a) => streamed.push(a) });
      l.say(raw.say);
      for (const a of raw.actions) l.action(a);
      const got = l.finish();
      assert.deepEqual(got.step, expected.step, name);
      assert.equal(opened, expected.step?.say ?? '', name);
      assert.deepEqual(streamed, expected.step?.actions ?? [], name);
    }
    assert.deepEqual([...live.ids], [...whole.ids], name);
  }
});

test('an action that names an object not yet seen is held, and told when the object arrives', () => {
  const { live, events } = rig();
  live.say('A row of blades.');
  live.action({ op: 'add', shape: 'array', of: 'blade', count: 3, turn: [0, 0, 40], id: 'blades' });
  assert.deepEqual(events, ['open:A row of blades.'], 'held: nothing is drawn yet');
  live.action(cube('blade'));
  assert.deepEqual(events, ['open:A row of blades.', 'add:blade', 'add:blades'], 'released after its source');
  const done = live.finish();
  assert.deepEqual(done.issues, []);
  assert.deepEqual(done.step?.actions.map((a) => (a as { id: string }).id), ['blade', 'blades']);
});

test('a held action whose object never comes is dropped with its reason, at the end of the step', () => {
  const { live, events, state } = rig();
  live.say('A tag.');
  live.action(cube('part'));
  live.action({ op: 'pin', id: 'tag', on: 'ghost', text: 'Ghost' });
  live.action(box('b'));
  const done = live.finish();
  assert.deepEqual(events, ['open:A tag.', 'add:part', 'box:b']);
  assert.ok(done.issues.some((i) => i.kind === 'dropped' && i.message.includes('unknown id "ghost"')));
  assert.ok(!state.ids.has('tag'), 'the dropped pin was never registered');
});

test('a held action is given up after a few more actions, not kept for the whole step', () => {
  const { live, events } = rig();
  live.say('Many.');
  live.action({ op: 'pin', id: 'tag', on: 'late', text: 'Late' });
  for (let i = 0; i < 8; i++) live.action(box(`m${i}`));
  live.action(cube('late'));
  const done = live.finish();
  assert.ok(!events.includes('pin:tag'), 'too late: it was already given up');
  assert.ok(done.issues.some((i) => i.message.includes('unknown id "late"')));
});

test('actions that arrive before the words wait for them; a step that never gets its words is dropped, as a whole one is', () => {
  const a = rig();
  a.live.action(box('a'));
  assert.deepEqual(a.events, []);
  a.live.say('Late words.');
  assert.deepEqual(a.events, ['open:Late words.', 'box:a']);

  const b = rig();
  b.live.action(box('x'));
  const done = b.live.finish();
  assert.deepEqual(b.events, [], 'nothing was drawn');
  assert.equal(done.step, null);
  assert.ok(done.issues.some((i) => i.message === 'say must be text'));
  assert.equal(validateStep({ actions: [box('x')] }, createSceneState()).step, null, 'the same as the whole step');
});

test('the per-step cap holds as actions arrive, and a repeated id is a collision as at the step boundary', () => {
  const { live, events } = rig();
  live.say('Lots.');
  for (let i = 0; i < LIMITS.maxActionsPerStep + 6; i++) live.action(box(`c${i}`));
  const done = live.finish();
  assert.equal(events.length, 1 + LIMITS.maxActionsPerStep);
  assert.ok(done.issues.some((i) => i.message.includes('actions cut to')));

  const dup = rig();
  dup.live.say('Twice.');
  dup.live.action(box('same'));
  dup.live.action(box('same'));
  const d = dup.live.finish();
  assert.equal(d.step?.actions.length, 1, 'the second use of an id is dropped, as validateStep would');
});

test('an action told early counts in the scene at once, so the next one can use it', () => {
  const { live, state } = rig();
  live.say('Parts.');
  live.action(cube('body'));
  assert.equal(state.ids.get('body'), 'solid');
  live.action({ op: 'move', id: 'body', to: [1, 0, 0] });
  assert.equal(live.finish().step?.actions.length, 2);
});

test('a step over the turn\'s limit is refused and tells nothing; words that are not text are noted', () => {
  const state = createSceneState();
  startTurn(state);
  for (let i = 0; i < LIMITS.maxSteps; i++) validateStep({ say: 's', actions: [] }, state);
  const { live, events } = rig(state);
  assert.equal(live.refused, true);
  live.say('Too many.');
  live.action(box('a'));
  assert.deepEqual(events, []);
  assert.equal(live.finish().step, null);

  const odd = rig();
  odd.live.say(42);
  odd.live.action(box('a'));
  const d = odd.live.finish();
  assert.ok(d.issues.some((i) => i.message === 'say must be text'));
  assert.deepEqual(odd.events, ['open:', 'box:a']);
});
