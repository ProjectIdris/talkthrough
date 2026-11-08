import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { ASSEMBLY_ROWS } from '../src/scene/assembly-rows.ts';
import { partNames } from '../src/scene/part-library.ts';
import { MODELS } from '../src/scene/model-catalogue.ts';
import { realModelHint, worksAction } from '../src/scene/models.ts';
// @ts-expect-error plain script modules
import { worksProblems } from '../scripts/assets/manifest.mjs';

// How a real thing works, as data in its catalogue entry (works): the ready assemblies to build beside it, the kit parts for what has no assembly, and how its own
// named parts move. The how-does-it-work hint is made from it, so these tests hold the data to what the scene language really has.

const withWorks = MODELS.filter((m) => m.works);
const asked = (m: (typeof MODELS)[number]) => `How does a ${m.aliases[0]} work?`;

test('every model that is not an anatomy model says how it works', () => {
  assert.deepEqual(withWorks.map((m) => m.id).sort(), ['alarm-clock', 'bolt-cutters', 'camera', 'drill', 'electric-motor', 'measuring-tape', 'mousetrap', 'telegraph-key']);
});

test('what the data names exists: its assemblies are rows, its kit parts are kit parts, and the parts it moves are parts of that model', () => {
  const kit = partNames();
  for (const m of withWorks) {
    const w = m.works!;
    for (const a of w.assemblies ?? []) assert.ok(ASSEMBLY_ROWS[a.name], `${m.id}: assembly ${a.name}`);
    for (const k of w.kit ?? []) assert.ok(kit.includes(k.part), `${m.id}: kit part ${k.part}`);
    for (const mv of w.motion ?? []) {
      assert.ok(m.parts.some((p) => p.key === mv.part), `${m.id}: part ${mv.part}`);
      if (mv.action.by) assert.ok(m.parts.some((p) => p.key === mv.action.by), `${m.id}: driver ${mv.action.by}`);
    }
  }
});

test('the manifest check refuses a works that names nothing, a part that is not there, a driver that is the part itself, or an action that is not a spin or a loop', () => {
  const keys = ['body', 'hand'];
  const good = { how: 'It turns.', motion: [{ part: 'hand', what: 'turns', action: { op: 'spin', rpm: 1 } }] };
  assert.deepEqual(worksProblems(good, keys), []);
  assert.deepEqual(worksProblems(undefined, keys), []);
  for (const bad of [
    { how: 'It turns.' },
    { how: '', motion: good.motion },
    { how: 'x', motion: [{ part: 'wheel', what: 'turns', action: { op: 'spin' } }] },
    { how: 'x', motion: [{ part: 'hand', what: 'turns', action: { op: 'spin', by: 'hand' } }] },
    { how: 'x', motion: [{ part: 'hand', what: 'turns', action: { op: 'explode' } }] },
    { how: 'x', motion: [{ part: 'hand', what: 'turns', action: { op: 'spin', speed: 3 } }] },
    { how: 'x', assemblies: [{ name: 'Gear Train', role: 'r' }] },
  ]) assert.notDeepEqual(worksProblems(bad, keys), [], JSON.stringify(bad));
});

test('the action the hint tells the model to write for a part is a valid action of the scene language, as written', () => {
  for (const m of withWorks) {
    const motion = m.works!.motion ?? [];
    if (motion.length === 0) continue;
    const actions = motion.map((mv) => JSON.parse(JSON.stringify(worksAction(m, mv)).replaceAll('<id>', 'c')));
    const r = validateStep({ say: 'x', actions: [{ op: 'panel', x: 400, y: 80, w: 500, h: 700 }, { op: 'add', shape: 'model', id: 'c', model: m.id }, ...actions] }, createSceneState());
    assert.deepEqual(r.issues.map((i) => i.message), [], m.id);
    for (const mv of motion) assert.ok(JSON.stringify(r.step?.actions).includes(`"id":"c.${mv.part}"`), `${m.id}.${mv.part} is written as a part of the model`);
  }
});

test('a how-does-it-work question names the real model, its assemblies and kit parts, and how its own parts move', () => {
  const clock = realModelHint('How does an alarm clock work?') ?? '';
  assert.match(clock, /gear-train: add \{shape:part, part:"gear-train"/);
  assert.match(clock, /escapement: add \{shape:part, part:"escapement"/);
  assert.match(clock, /add \{shape:model, id:"<id>", model:"alarm-clock"\}/);
  assert.match(clock, /minute hand - \{[^}]*"id":"<id>\.minute-hand"[^}]*"by":"<id>\.second-hand"/);
  const drill = realModelHint('How does a drill work?') ?? '';
  assert.match(drill, /planetary: add \{shape:part, part:"planetary"/);
  assert.match(drill, /coil \(the winding of the motor\)/);
  assert.match(realModelHint('How does a mousetrap work?') ?? '', /spring-snap: add \{shape:part, part:"spring-snap"/);
  for (const m of withWorks) {
    const hint = realModelHint(asked(m)) ?? '';
    assert.ok(hint.includes(m.works!.how), `${m.id}: how it works`);
    assert.ok(!hint.includes('add {shape:model, model:'), `${m.id}: the real model is not the whole answer`);
  }
});

test('a question that does not ask how it works gets no such hint; a model with no works keeps the plain advice', () => {
  assert.equal(realModelHint('what does a mousetrap look like'), undefined);
  const clock = MODELS.find((m) => m.id === 'alarm-clock')!;
  const kept = clock.works;
  try {
    delete (clock as { works?: unknown }).works;
    const hint = realModelHint('How does an alarm clock work?') ?? '';
    assert.match(hint, /from shapes and kit parts/);
    assert.ok(!hint.includes('Ready assemblies'));
  } finally {
    clock.works = kept;
  }
});
