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
