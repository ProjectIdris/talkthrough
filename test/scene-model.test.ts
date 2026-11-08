import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, createSceneState, startTurn, validateScene, validateStep } from '../src/scene/index.ts';
import type { Action, Scene } from '../src/scene/index.ts';

const run = (actions: unknown[], state = createSceneState()) => {
  const r = validateStep({ say: 'x', actions }, state);
  return { step: r.step, issues: r.issues, state };
};
const only = (actions: unknown[]) => run(actions).step?.actions ?? [];
const box = { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] };

test('the new shapes are accepted with their own fields, and a colour is optional', () => {
  const a = only([
    box,
    { op: 'add', shape: 'extrude', id: 'wing', outline: [[0, 0], [4, 0], [2, 3]], depth: 0.3, bevel: 0.05, material: 'metal' },
    { op: 'add', shape: 'lathe', id: 'bottle', profile: [[0, 0], [1, 0], [1, 3], [0.4, 3.6]], sides: 12.4 },
    { op: 'add', shape: 'tube', id: 'cable', pts: [[0, 0, 0], [0, 1, 1], [1, 2, 1]], radius: 0.4, flat: 0.1, draw: 0 },
    { op: 'add', shape: 'part', id: 'chip', part: 'chip', variant: 'metal', size: [2, 0.3, 2] },
  ]);
  assert.equal(a.length, 5);
  const lathe = a[2] as { sides?: number };
  assert.equal(lathe.sides, 12, 'whole numbers where a count is meant');
  assert.equal((a[0] as { color?: string }).color, undefined, 'no colour: the surface decides');
});

test('a surface or part that is not in the vocabulary is dropped, not guessed at', () => {
  const r = run([
    { op: 'add', shape: 'box', id: 'a', size: [1, 1, 1], material: 'unobtainium' },
    { op: 'add', shape: 'part', id: 'p', part: 'nuke', size: [1, 1, 1] },
    { op: 'add', shape: 'part', id: 'q', part: 'port', variant: 'wormhole', size: [1, 1, 1] },
    { op: 'add', shape: 'extrude', id: 'e', outline: [[0, 0], [1, 1]], depth: 1 },
  ]);
  assert.deepEqual(r.step?.actions, [], 'nothing valid is left in the step');
  assert.equal(r.issues.filter((i) => i.kind === 'dropped').length, 4);
});

test('outlines and rows are clamped and capped like everything else', () => {
  const outline = Array.from({ length: LIMITS.maxOutline + 8 }, (_, i) => [i % 10, Math.floor(i / 10)]);
  const far = only([{ op: 'add', shape: 'extrude', id: 'big', outline: [[0, 0], [1e9, 0], [0, 5]], depth: 1 }]);
  assert.deepEqual((far[0] as { outline: number[][] }).outline[1], [100, 0], 'clamped to the world');
  const many = only([{ op: 'add', shape: 'extrude', id: 'many', outline, depth: 1 }]);
  assert.equal((many[0] as { outline: unknown[] }).outline.length, LIMITS.maxOutline);
  const card = only([{ op: 'card', id: 'c', x: 10, y: 10, title: 'T', rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', '', 'x'.repeat(200)] }]);
  const rows = (card[0] as { rows: string[] }).rows;
  assert.equal(rows.length, LIMITS.maxRows);
  assert.ok(rows.every((r) => r.length <= 60));
});

test('a card needs something to show; an image needs its region', () => {
  const bad = run([{ op: 'card', id: 'c', x: 1, y: 1 }, { op: 'card', id: 'd', x: 1, y: 1, rows: [] }, { op: 'image', id: 'i', sx: 1, sy: 1, sw: 10, sh: 10, dx: 5, dy: 5 }]);
  assert.deepEqual(bad.step?.actions, []);
  const ok = only([{ op: 'card', id: 'c', x: 1, y: 1, title: 'Hello', to: [500, 500] }, { op: 'image', id: 'i', sx: 1, sy: 1, sw: 10, sh: 10, dx: 5, dy: 5, dw: 200 }]);
  assert.equal(ok.length, 2);
});

test('a pin goes with its object, and only a 3D object can carry one', () => {
  const state = createSceneState();
  run([box, { op: 'label', id: 'tag', x: 1, y: 1, text: 'hi', color: 'red' }], state);
  const ok = run([{ op: 'pin', id: 'p', on: 'b', text: 'Part' }, { op: 'pin', id: 'q', on: 'tag', text: 'No' }, { op: 'pin', id: 'r', on: 'nothing', text: 'No' }], state);
  assert.equal(ok.step?.actions.length, 1, 'a mark or a missing id cannot carry a pin');
  assert.ok(state.ids.has('p'));
  run([{ op: 'clear', target: 'b' }], state);
  assert.ok(!state.ids.has('p'), 'clearing the object takes the pin with it');
  assert.ok(state.ids.has('tag'));

  const s2 = createSceneState();
  run([box, { op: 'pin', id: 'p', on: 'b', text: 'Part' }], s2);
  run([{ op: 'clear', target: 'marks' }], s2);
  assert.ok(!s2.ids.has('p') && s2.ids.has('b'), 'clear marks takes pins and keeps 3D objects');
  run([{ op: 'pin', id: 'p2', on: 'b', text: 'Again' }], s2);
  run([{ op: 'clear', target: 'panel' }], s2);
  assert.equal(s2.ids.size, 0, 'clear panel takes the objects and the pins on them');
});

test('a pin cannot be something an object attaches to, and a pin cannot be styled as 3D', () => {
  const state = createSceneState();
  run([box, { op: 'pin', id: 'p', on: 'b', text: 'Part' }], state);
  const r = run([{ op: 'add', shape: 'box', id: 'c', parent: 'p', size: [1, 1, 1] }, { op: 'move', id: 'p', to: [1, 1, 1] }, { op: 'style', id: 'p', color: 'red' }], state);
  assert.equal(r.step?.actions.length, 1, 'only the style of a mark works on a pin');
});

test('arrays make bounded copies', () => {
  const state = createSceneState();
  run([box], state);
  const ok = run([{ op: 'add', shape: 'array', id: 'row', of: 'b', count: 10, step: [2, 0, 0] }], state);
  assert.equal(ok.step?.actions.length, 1);
  const clamp = run([{ op: 'add', shape: 'array', id: 'row2', of: 'b', count: 5000 }], state);
  assert.equal((clamp.step?.actions[0] as { count: number }).count, LIMITS.maxArray);
  // Copies are counted over the whole scene, so a model cannot ask for millions with many arrays.
  let accepted = 0;
  for (let i = 0; i < 30; i++) {
    const r = run([{ op: 'add', shape: 'array', id: `many${i}`, of: 'b', count: LIMITS.maxArray }], state);
    accepted += r.step?.actions.length ? 1 : 0;
  }
  assert.ok(accepted * (LIMITS.maxArray - 1) <= LIMITS.maxCopies, `${accepted} arrays were let through`);
  assert.ok(accepted < 30);
  const noSuch = run([{ op: 'add', shape: 'array', id: 'z', of: 'ghost', count: 2 }]);
  assert.deepEqual(noSuch.step?.actions, []);
});

test('an array counts the whole subtree it copies', () => {
  const state = createSceneState();
  run([{ op: 'add', shape: 'group', id: 'g' }, ...Array.from({ length: 9 }, (_, i) => ({ op: 'add', shape: 'box', id: `k${i}`, parent: 'g', size: [1, 1, 1] }))], state);
  // Ten objects copied 30 more times is 300 copies; once more would pass the budget.
  const a = run([{ op: 'add', shape: 'array', id: 'a1', of: 'g', count: 31 }], state);
  assert.equal(a.step?.actions.length, 1);
  const b = run([{ op: 'add', shape: 'array', id: 'a2', of: 'g', count: 31 }], state);
  assert.deepEqual(b.step?.actions, []);
});

test('the motion actions work on 3D objects only, with numbers held to range', () => {
  const state = createSceneState();
  run([box, { op: 'label', id: 'tag', x: 1, y: 1, text: 'hi', color: 'red' }], state);
  const r = run([
    { op: 'along', id: 'b', pts: [[0, 0, 0], [5, 2, 1]] },
    { op: 'explode', id: 'b', to: 99 },
    { op: 'reveal', id: 'b', to: -4 },
    { op: 'explode', id: 'tag', to: 1 },
    { op: 'along', id: 'b', pts: [] },
  ], state);
  const a = r.step?.actions as Action[];
  assert.equal(a.length, 3);
  assert.equal((a[1] as { to: number }).to, 3);
  assert.equal((a[2] as { to: number }).to, 0);
});

test('the panel may ask for a frame, and the language still refuses what it does not know', () => {
  const a = only([{ op: 'panel', x: 10, y: 10, w: 500, h: 500, frame: true }, { op: 'panel', x: 10, y: 10, w: 500, h: 500, frame: 'yes' }]);
  assert.equal(a.length, 1);
  assert.equal((a[0] as { frame?: boolean }).frame, true);
});

test('a whole scene of the new kinds passes through the validator unchanged', () => {
  const scene = {
    steps: [
      {
        say: 'A board with a chip and a cable.',
        actions: [
          { op: 'panel', x: 100, y: 100, w: 600, h: 500, frame: false },
          { op: 'add', shape: 'group', id: 'board' },
          { op: 'add', shape: 'box', id: 'pcb', parent: 'board', size: [10, 0.2, 6], material: 'pcb', color: '#17803f', bevel: 0.3 },
          { op: 'add', shape: 'part', id: 'soc', parent: 'board', part: 'chip', variant: 'metal', size: [2, 0.3, 2], pos: [0, 0.25, 0] },
          { op: 'add', shape: 'tube', id: 'cable', pts: [[0, 1, 0], [2, 2, 1]], radius: 0.3, flat: 0.1, material: 'paper' },
          { op: 'pin', id: 'label1', on: 'soc', text: 'Processor', off: [-80, -120] },
          { op: 'explode', id: 'board', to: 0.5, dur: 1 },
          { op: 'reveal', id: 'cable', to: 1, dur: 2 },
          { op: 'card', id: 'note', x: 60, y: 60, w: 300, title: 'Board', rows: ['one', 'two'], layout: 'list' },
        ],
      },
    ],
    escalate: null,
  };
  const r = validateScene(scene, createSceneState());
  assert.deepEqual(r.issues, []);
  assert.deepEqual((r.scene as Scene).steps, scene.steps);
  startTurn(createSceneState());
});
