import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScriptedModel, ModelError } from '../src/adapters/index.ts';
import type { ModelRequest } from '../src/adapters/index.ts';

const request: ModelRequest = {
  question: 'what is this?',
  screenshot: { mime: 'image/png', base64: '', width: 10, height: 10 },
  thread: [],
  schema: {},
};

test('the scripted model yields its steps in order', async () => {
  const model = createScriptedModel([{ say: 'a', actions: [] }, { say: 'b', actions: [] }]);
  const got: unknown[] = [];
  for await (const step of model.ask(request)) got.push(step);
  assert.deepEqual(got, [
    { type: 'step', step: { say: 'a', actions: [] } },
    { type: 'step', step: { say: 'b', actions: [] } },
  ]);
});

test('aborting stops the stream with an aborted ModelError', async () => {
  const model = createScriptedModel([1, 2, 3]);
  const controller = new AbortController();
  const got: unknown[] = [];
  await assert.rejects(async () => {
    for await (const step of model.ask({ ...request, signal: controller.signal })) {
      got.push(step);
      controller.abort();
    }
  }, (error: unknown) => error instanceof ModelError && error.code === 'aborted');
  assert.deepEqual(got, [{ type: 'step', step: 1 }]);
});

test('aborting during the gap stops before the next step is yielded', async () => {
  const model = createScriptedModel([1, 2], { gapMs: 50 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const got: unknown[] = [];
  await assert.rejects(async () => {
    for await (const step of model.ask({ ...request, signal: controller.signal })) got.push(step);
  }, (error: unknown) => error instanceof ModelError && error.code === 'aborted');
  assert.deepEqual(got, []);
});

test('an escalation comes last, with or without steps', async () => {
  const both: unknown[] = [];
  for await (const out of createScriptedModel([1], { escalate: 'needs a bigger model' }).ask(request)) both.push(out);
  assert.deepEqual(both, [{ type: 'step', step: 1 }, { type: 'escalate', reason: 'needs a bigger model' }]);
  const only: unknown[] = [];
  for await (const out of createScriptedModel([], { escalate: 'too hard' }).ask(request)) only.push(out);
  assert.deepEqual(only, [{ type: 'escalate', reason: 'too hard' }]);
});
