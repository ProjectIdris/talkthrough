import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createVisualTourModel } from '../src/main/visual-tour-model.ts';
import { validateScene } from '../src/scene/index.ts';
import type { Step } from '../src/scene/index.ts';

const samples = 'samples/scenes';

test('the tour opens the first bundled example with its first caption and a public catalog', () => {
  const tour = createVisualTourModel(samples);
  const state = tour.state();
  assert.deepEqual(state.examples.map((example) => example.id), ['web-request', 'recipe', 'supply-demand', 'timeline']);
  assert.ok(state.examples.every((example) => example.title && example.description));
  assert.ok(state.examples.every((example) => Object.keys(example).sort().join(',') === 'description,id,title'));
  assert.equal(state.selected, 'web-request');
  assert.equal(state.title, state.examples[0]!.title);
  assert.equal(state.step, 0);
  assert.equal(state.steps, 2);
  assert.equal(state.busy, false);
  assert.equal(state.error, null);
  assert.equal(state.say, "When you open a page, your browser first asks a directory for the server's address, then the server asks its database for what to show.");
  assert.equal(tour.scene()?.steps[0]?.actions[0]?.op, 'diagram');
});

test('every catalog entry loads its fixed validated diagram scene', () => {
  const tour = createVisualTourModel(samples);
  for (const [id, kind, count] of [
    ['web-request', 'flow', 2],
    ['recipe', 'steps', 2],
    ['supply-demand', 'chart', 1],
    ['timeline', 'timeline', 1],
  ] as const) {
    tour.command({ kind: 'select', id });
    const first = tour.scene()?.steps[0]?.actions[0];
    assert.equal(first?.op, 'diagram', id);
    assert.equal(first?.op === 'diagram' && first.kind, kind, id);
    assert.equal(tour.state().steps, count, id);
    assert.equal(tour.state().selected, id);
    assert.equal(tour.state().error, null, id);
  }
});

test('the four single-diagram examples fill the dedicated gallery without changing their content or timing', () => {
  const tour = createVisualTourModel(samples);
  for (const [id, file] of [
    ['web-request', 'diagram-flow.json'],
    ['recipe', 'diagram-steps.json'],
    ['supply-demand', 'diagram-chart.json'],
    ['timeline', 'diagram-timeline.json'],
  ] as const) {
    const originalFile = readFileSync(join(samples, file), 'utf8');
    const original = validateScene(JSON.parse(originalFile));
    assert.ok(original.scene);
    assert.deepEqual(original.issues, []);
    tour.command({ kind: 'select', id });
    const preview = tour.scene();
    assert.ok(preview, id);
    assert.equal(preview.steps.length, original.scene.steps.length, id);
    for (const [index, sourceStep] of original.scene.steps.entries()) {
      const previewStep: Step = preview.steps[index]!;
      assert.equal(previewStep.say, sourceStep.say, id);
      assert.equal(previewStep.actions.length, sourceStep.actions.length, id);
      for (const [actionIndex, sourceAction] of sourceStep.actions.entries()) {
        assert.deepEqual(previewStep.actions[actionIndex], sourceAction.op === 'diagram'
          ? { ...sourceAction, x: 80, y: 80, w: 840, h: 840 }
          : sourceAction, `${id}: step ${index}, action ${actionIndex}`);
      }
    }
    assert.equal(readFileSync(join(samples, file), 'utf8'), originalFile, `${id}: bundled file is unchanged`);
  }
});

test('gallery framing counts diagrams across the whole scene and preserves layouts with zero or multiple diagrams', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'talkthrough-tour-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const steps of [
    [{ say: 'A caption only.', actions: [] }],
    [
      { say: 'First diagram.', actions: [{ op: 'diagram', id: 'first', kind: 'flow', x: 100, y: 100, w: 300, h: 300, title: 'First', at: 0.5 }] },
      { say: 'Second diagram.', actions: [{ op: 'diagram', id: 'second', kind: 'timeline', x: 550, y: 550, w: 350, h: 350, title: 'Second', at: 1.5 }] },
    ],
  ]) {
    const raw = { v: 1, steps };
    const original = validateScene(raw);
    assert.ok(original.scene);
    assert.deepEqual(original.issues, []);
    writeFileSync(join(dir, 'diagram-flow.json'), JSON.stringify(raw));
    const tour = createVisualTourModel(dir);
    assert.equal(tour.state().error, null);
    assert.deepEqual(tour.scene(), original.scene);
  }
});

test('a sole diagram in a later step is framed while its timing and earlier actions stay intact', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'talkthrough-tour-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const raw = {
    v: 1,
    steps: [
      { say: 'Begin with a caption.', actions: [] },
      { say: 'Then show the diagram.', actions: [{ op: 'diagram', id: 'later', kind: 'flow', x: 100, y: 100, w: 300, h: 300, title: 'Later', at: 2.5 }] },
    ],
  };
  writeFileSync(join(dir, 'diagram-flow.json'), JSON.stringify(raw));
  const tour = createVisualTourModel(dir);
  assert.equal(tour.state().error, null);
  assert.deepEqual(tour.scene(), {
    v: 1,
    steps: [
      { say: 'Begin with a caption.', actions: [] },
      { say: 'Then show the diagram.', actions: [{ op: 'diagram', id: 'later', kind: 'flow', x: 80, y: 80, w: 840, h: 840, title: 'Later', at: 2.5 }] },
    ],
  });
});

test('Next and Back update the caption and never move outside the scene', () => {
  const tour = createVisualTourModel(samples);
  const first = tour.state();
  assert.equal(tour.command({ kind: 'back' }), false);
  assert.deepEqual(tour.state(), first);
  assert.equal(tour.command({ kind: 'next' }), true);
  assert.equal(tour.state().step, 1);
  assert.equal(tour.state().say, 'The answer then travels back the same way, and your browser draws the page.');
  const last = tour.state();
  assert.equal(tour.command({ kind: 'next' }), false);
  assert.deepEqual(tour.state(), last);
  assert.equal(tour.command({ kind: 'back' }), true);
  assert.deepEqual(tour.state(), first);
});

test('selecting an example resets the step while selecting an unchanged first step is a no-op', () => {
  const tour = createVisualTourModel(samples);
  assert.equal(tour.command({ kind: 'select', id: 'web-request' }), false);
  tour.command({ kind: 'next' });
  assert.equal(tour.command({ kind: 'select', id: 'web-request' }), true);
  assert.equal(tour.state().step, 0);
  tour.command({ kind: 'next' });
  assert.equal(tour.command({ kind: 'select', id: 'recipe' }), true);
  assert.equal(tour.state().step, 0);
  assert.equal(tour.state().say, 'Here is the method in four steps. I will tick them off as we go.');
});

test('Restart requests a fresh render even when already at the first step', () => {
  const tour = createVisualTourModel(samples);
  assert.equal(tour.command({ kind: 'restart' }), true);
  tour.command({ kind: 'next' });
  assert.equal(tour.command({ kind: 'restart' }), true);
  assert.equal(tour.state().step, 0);
  tour.command({ kind: 'select', id: 'supply-demand' });
  assert.equal(tour.command({ kind: 'next' }), false);
  assert.equal(tour.command({ kind: 'restart' }), true);
});

test('malformed commands, unlisted IDs and arbitrary paths never change the tour', () => {
  const tour = createVisualTourModel(samples);
  tour.command({ kind: 'next' });
  const before = tour.state();
  const scene = tour.scene();
  const invalid: unknown[] = [
    null, undefined, true, 0, 'next', [], {}, { kind: 'seek', step: 0 },
    { kind: 'select' }, { kind: 'select', id: 1 }, { kind: 'select', id: '' },
    { kind: 'select', id: 'unknown' }, { kind: 'select', id: '../diagram-flow.json' },
    { kind: 'select', id: 'diagram-flow.json' }, { kind: 'select', id: 'web-request', path: 'other.json' },
    { kind: 'next', step: -1 }, { kind: 'back', step: 100 }, { kind: 'restart', step: Number.NaN },
    { kind: 'next', id: 'recipe' }, Object.create({ kind: 'restart' }),
    Object.defineProperty({}, 'kind', { get: () => { throw new Error('must not read accessors'); } }),
    { kind: 'restart', [Symbol('path')]: 'other.json' },
  ];
  for (const command of invalid) {
    assert.equal(tour.command(command), false);
    assert.deepEqual(tour.state(), before);
    assert.equal(tour.scene(), scene);
  }
});

test('render status is visible, busy commands are rejected, and retry clears a rendering error', () => {
  const tour = createVisualTourModel(samples);
  tour.status(true);
  assert.equal(tour.state().busy, true);
  const before = tour.state();
  for (const command of [{ kind: 'next' }, { kind: 'restart' }, { kind: 'select', id: 'recipe' }]) {
    assert.equal(tour.command(command), false);
    assert.deepEqual(tour.state(), before);
  }
  tour.status(false, 'Renderer did not respond.');
  assert.equal(tour.state().busy, false);
  assert.equal(tour.state().error, 'Renderer did not respond.');
  assert.equal(tour.command({ kind: 'restart' }), true);
  assert.equal(tour.state().error, null);
  tour.status(false, 'Another rendering error.');
  tour.status(false);
  assert.equal(tour.state().error, null);
});

test('missing bundled samples produce a stable error and can recover by selecting an available sample', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'talkthrough-tour-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'diagram-steps.json'), readFileSync(join(samples, 'diagram-steps.json')));
  const tour = createVisualTourModel(dir);
  assert.equal(tour.scene(), null);
  assert.equal(tour.state().steps, 0);
  assert.equal(tour.state().step, 0);
  assert.equal(tour.state().say, '');
  assert.match(tour.state().error ?? '', /diagram-flow\.json/);
  const failure = tour.state();
  tour.status(false);
  assert.deepEqual(tour.state(), failure);
  assert.equal(tour.command({ kind: 'next' }), false);
  assert.equal(tour.command({ kind: 'back' }), false);
  assert.equal(tour.command({ kind: 'restart' }), false);
  assert.equal(tour.command({ kind: 'select', id: 'recipe' }), true);
  assert.equal(tour.state().error, null);
  assert.equal(tour.state().steps, 2);
  assert.ok(tour.scene());
  assert.equal(tour.command({ kind: 'select', id: 'timeline' }), true);
  assert.equal(tour.state().selected, 'timeline');
  assert.equal(tour.scene(), null);
  assert.match(tour.state().error ?? '', /diagram-timeline\.json/);
});

test('invalid JSON, invalid scenes, repaired actions and empty scenes are refused rather than rendered', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'talkthrough-tour-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const raw of [
    '{not json',
    JSON.stringify({ v: 2, steps: [{ say: 'Wrong version', actions: [] }] }),
    JSON.stringify({ steps: 'not a list' }),
    JSON.stringify({ steps: [] }),
    JSON.stringify({ steps: [{ say: 'Bad action', actions: [{ op: 'unknown' }] }] }),
    JSON.stringify({ steps: [{ say: 'An escalation is not an offline example', actions: [] }], escalate: 'Use a model' }),
  ]) {
    writeFileSync(join(dir, 'diagram-flow.json'), raw);
    const tour = createVisualTourModel(dir);
    assert.equal(tour.scene(), null, raw);
    assert.equal(tour.state().steps, 0, raw);
    assert.match(tour.state().error ?? '', /diagram-flow\.json/, raw);
  }
});

test('public state snapshots cannot alter the selected scene or the fixed catalog', () => {
  const tour = createVisualTourModel(samples);
  const state = tour.state();
  state.selected = 'arbitrary-file.json';
  state.step = 99;
  state.examples[0]!.id = '../arbitrary-file.json';
  state.examples.pop();
  assert.equal(tour.state().selected, 'web-request');
  assert.equal(tour.state().step, 0);
  assert.equal(tour.state().examples.length, 4);
  assert.equal(tour.state().examples[0]!.id, 'web-request');
  assert.equal(tour.command({ kind: 'select', id: '../arbitrary-file.json' }), false);
});
