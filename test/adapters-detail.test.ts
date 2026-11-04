import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelRequest } from '../src/adapters/model.ts';
import { detailText, questionText } from '../src/adapters/subscription-shared.ts';

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  question: 'how does this work',
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 1280, height: 720 },
  thread: [],
  schema: {},
  ...extra,
});

test('an ordinary question carries no detail instructions', () => {
  assert.ok(!questionText(request()).includes('DETAIL PASS'));
});

test('a detail request shows the scene on screen and asks for a richer version with the same ids, spoken nothing', () => {
  const steps = [{ say: 'A box.', actions: [{ op: 'add', shape: 'box', id: 'body', size: [1, 1, 1] }] }];
  const text = questionText(request({ detail: { steps } }));
  assert.ok(text.includes('DETAIL PASS'));
  assert.ok(text.includes(JSON.stringify({ steps })), 'the scene on screen is in the prompt');
  assert.ok(text.includes('same ids') || text.includes('Keep every id'));
  assert.ok(text.includes('is spoken in this pass'), 'the words are not spoken');
  assert.ok(text.includes('how does this work'), 'and the question it was about');
  assert.ok(text.includes('at the end of the scene'), 'objects are written where they end up, so the swap does not jump back');
});

test('a scene too long for the prompt is cut at a step and says so', () => {
  const big = Array.from({ length: 40 }, (_, i) => ({ say: `Step ${i}`, actions: [{ op: 'note', text: 'x'.repeat(1500) }] }));
  const text = detailText(big);
  assert.match(text, /the first (\d+) of 40 steps/);
  const kept = Number(/the first (\d+) of 40 steps/.exec(text)?.[1]);
  assert.ok(kept >= 1 && kept < 40);
  assert.ok(text.length < 40000);
});
