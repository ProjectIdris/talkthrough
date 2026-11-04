import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStepStream } from '../src/scene/index.ts';

const sample = readFileSync(new URL('../samples/scenes/bar-chart.json', import.meta.url), 'utf8');
const expected = (JSON.parse(sample) as { steps: unknown[] }).steps;

function run(text: string, size: number): unknown[] {
  const s = createStepStream();
  const got: unknown[] = [];
  for (let i = 0; i < text.length; i += size) got.push(...s.push(text.slice(i, i + size)));
  s.end();
  return got;
}

test('steps come out whole, whatever size the chunks are', () => {
  for (const size of [1, 2, 3, 7, 64, 1000, sample.length]) assert.deepEqual(run(sample, size), expected, `chunks of ${size}`);
});

test('a step is released as soon as it closes, not at the end', () => {
  const s = createStepStream();
  const cut = sample.indexOf('"say"', sample.indexOf('"say"') + 1); // inside the second step
  const first = s.push(sample.slice(0, cut));
  assert.deepEqual(first, [expected[0]]);
  assert.equal(s.complete, false);
  assert.throws(() => s.end(), /before the scene was complete/);
});

test('braces, brackets and quotes inside text do not confuse it', () => {
  const tricky = { steps: [{ say: 'a } ] { [ \\ " end', actions: [{ op: 'label', id: 'x', x: 1, y: 1, text: '"}]', color: 'red' }] }, { say: 'two', actions: [] }] };
  assert.deepEqual(run(JSON.stringify(tricky), 1), tricky.steps);
  assert.deepEqual(run(JSON.stringify(tricky, null, 2), 5), tricky.steps);
});

test('only the root list called steps counts', () => {
  const text = JSON.stringify({ other: { steps: [{ say: 'no', actions: [] }] }, notes: [{ say: 'no', actions: [] }], steps: [{ say: 'yes', actions: [] }] });
  assert.deepEqual(run(text, 3), [{ say: 'yes', actions: [] }]);
});

test('text around the scene is ignored', () => {
  const text = '```json\n' + sample + '\n```\nHope that helps!';
  assert.deepEqual(run(text, 11), expected);
});

test('a stray quote or brace before the scene does not swallow it', () => {
  assert.deepEqual(run('Here is "the scene: ] ' + sample, 4), expected);
});

test('escalate is read from the top level, in any chunking, with escapes', () => {
  const reason = 'needs "deep" work\nand a \\ slash \u00e9';
  const text = JSON.stringify({ steps: [{ say: 'a', actions: [] }], escalate: reason });
  for (const size of [1, 3, 11, text.length]) {
    const s = createStepStream();
    for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
    assert.equal(s.escalate, reason, 'size ' + size);
  }
  const first = createStepStream();
  first.push('{"escalate":"early","steps":[]}');
  assert.equal(first.escalate, 'early');
});

test('escalate inside a step, as a key name or as null is not the scene escalate', () => {
  const inStep = createStepStream();
  inStep.push(JSON.stringify({ steps: [{ say: 'x', actions: [], escalate: 'nested' }], other: 'escalate' }));
  assert.equal(inStep.escalate, undefined);
  const nul = createStepStream();
  nul.push('{"steps":[],"escalate":null}');
  assert.equal(nul.escalate, undefined);
  const sample = createStepStream();
  sample.push(readFileSync(new URL('../samples/scenes/escalate.json', import.meta.url), 'utf8'));
  assert.match(sample.escalate ?? '', /build failure/);
});

test('broken text throws instead of guessing', () => {
  assert.throws(() => run('{"steps":[{"say":"x","actions":]}', 4), /mismatched/);
  assert.throws(() => run('{"steps":[{"say":"x" "actions":[]}]}', 100), /not valid JSON/);
  assert.throws(() => run('{"steps":[{"say":"x","actions":[]}', 100), /before the scene was complete/);
  assert.throws(() => run('{"steps":[{"say":"' + 'a'.repeat(300_000) + '","actions":[]}]}', 5000), /too large/);
});

// ---- pieces: a step's say and each action, before the step is whole ----------------------------

const PIECE_TEXT = JSON.stringify({
  steps: [
    { say: 'Here is "a lock", \ done.', actions: [
      { op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4 },
      { op: 'add', shape: 'tube', id: 't', pts: [[0, 0, 0], [1, 1, 1]], radius: 0.1 },
      { op: 'card', title: 'List', rows: ['one', 'two {braces} ]'] },
    ] },
    { say: 'Second.', actions: [] },
    { say: 'Third.', actions: [{ op: 'clear', target: 'all' }] },
  ],
  escalate: null,
});

function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

test('pieces: each say and action arrives whole, then its step, in order, at any chunk size', () => {
  const expected = JSON.parse(PIECE_TEXT).steps;
  for (const size of [1, 2, 3, 5, 7, 13, 50, PIECE_TEXT.length]) {
    const log: string[] = [];
    const stream = createStepStream({ onPiece: (p) => log.push(p.type === 'say' ? `say:${p.say}` : p.type === 'action' ? `action:${JSON.stringify(p.action)}` : `step:${(p.step as { say: string }).say}`) });
    const steps: unknown[] = [];
    for (const c of chunked(PIECE_TEXT, size)) steps.push(...stream.push(c));
    stream.end();
    assert.deepEqual(steps, expected, `size ${size}`);
    assert.deepEqual(log, [
      'say:Here is "a lock", \ done.',
      `action:${JSON.stringify(expected[0].actions[0])}`,
      `action:${JSON.stringify(expected[0].actions[1])}`,
      `action:${JSON.stringify(expected[0].actions[2])}`,
      'step:Here is "a lock", \ done.',
      'say:Second.',
      'step:Second.',
      'say:Third.',
      `action:${JSON.stringify(expected[2].actions[0])}`,
      'step:Third.',
    ], `size ${size}`);
  }
});

test('pieces: a step written with its actions first still gives every piece, and without onPiece nothing changes', () => {
  const text = '{"steps":[{"actions":[{"op":"clear","target":"all"}],"say":"Late words."}]}';
  const log: string[] = [];
  const stream = createStepStream({ onPiece: (p) => log.push(p.type) });
  assert.equal(stream.push(text).length, 1);
  assert.deepEqual(log, ['action', 'say', 'step']);
  const plain = createStepStream();
  assert.deepEqual(plain.push(text), [{ actions: [{ op: 'clear', target: 'all' }], say: 'Late words.' }]);
});

test('pieces: a stream cut off mid-action gives the actions that were whole, then end() throws', () => {
  const text = '{"steps":[{"say":"Hi","actions":[{"op":"clear","target":"all"},{"op":"box","id":"b","x":1';
  const pieces: unknown[] = [];
  const stream = createStepStream({ onPiece: (p) => pieces.push(p) });
  for (const c of chunked(text, 4)) assert.deepEqual(stream.push(c), []);
  assert.deepEqual(pieces, [{ type: 'say', say: 'Hi' }, { type: 'action', action: { op: 'clear', target: 'all' } }]);
  assert.throws(() => stream.end());
});

test('pieces: an action that is not valid JSON is an error, like a step that is not', () => {
  const stream = createStepStream({ onPiece: () => undefined });
  assert.throws(() => stream.push('{"steps":[{"say":"a","actions":[{"op":"box",,}]}]}'));
});

test('pieces: a step that repeats its say or actions key streams the first of each, so no extra part is drawn', () => {
  const text = '{"steps":[{"say":"a","actions":[{"op":"clear","target":"all"}],"actions":[{"op":"box","id":"b","x":1,"y":1,"w":5,"h":5}],"say":"b"}]}';
  const log: string[] = [];
  const stream = createStepStream({ onPiece: (p) => log.push(p.type) });
  stream.push(text);
  assert.deepEqual(log, ['say', 'action', 'step']);
});
