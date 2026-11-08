import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createOutputStream } from '../src/adapters/subscription-shared.ts';

// A live Sonnet answer once came through the StructuredOutput tool as {"inputs": "<the steps as a JSON string>"} instead of the answer's own shape.
// The stream read no step from it and the answer ended one step short with no error. The fixture is that answer, as the log kept it.
const wrapped = readFileSync(new URL('./fixtures/wrapped-inputs-answer.json', import.meta.url), 'utf8').trim();
const inner = JSON.parse(wrapped).inputs as string;

function run(text: string, chunk = text.length, pieces = false) {
  const stream = createOutputStream(pieces);
  const got: Array<{ type: string }> = [];
  for (let i = 0; i < text.length; i += chunk) got.push(...stream.push(text.slice(i, i + chunk)));
  stream.end();
  return { got, stream };
}

test('an answer wrapped as {"inputs": "<json string>"} gives its step, whole or in small chunks', () => {
  for (const chunk of [wrapped.length, 37, 1]) {
    const { got, stream } = run(wrapped, chunk);
    assert.equal(got.length, 1, `chunk ${chunk}`);
    const step = (got[0] as unknown as { type: string; step: { say: string; actions: Array<{ op: string; part?: string }> } });
    assert.equal(step.type, 'step');
    assert.match(step.step.say, /^Next, the gears/);
    assert.ok(step.step.actions.some((a) => a.op === 'add' && a.part === 'planetary'));
    assert.equal(stream.complete, true);
  }
});

test('the wrapped answer also gives its says and actions as pieces when they are asked for, and its closing words (done, escalate)', () => {
  const { got } = run(wrapped, 50, true);
  assert.deepEqual(got.map((p) => p.type).filter((t, i, a) => t !== a[i - 1]), ['say', 'action', 'step']);
  const escalated = JSON.stringify({ inputs: JSON.stringify({ steps: [], plan: null, done: true, escalate: 'needs the detail model' }) });
  assert.equal(run(escalated).stream.escalate, 'needs the detail model');
});

test('the value may also be an object, and an answer that has its steps is never unwrapped', () => {
  const asObject = JSON.stringify({ inputs: JSON.parse(inner) });
  assert.equal(run(asObject).got.length, 1);
  const own = JSON.stringify({ steps: [{ say: 'Own.', actions: [] }], inputs: inner });
  const { got } = run(own);
  assert.equal(got.length, 1);
  assert.equal((got[0] as unknown as { step: { say: string } }).step.say, 'Own.');
});

test('a lone inputs value that is not an answer changes nothing', () => {
  assert.equal(run('{"inputs": "no steps here"}').got.length, 0);
  assert.equal(run('{"inputs": 7}').got.length, 0);
});
