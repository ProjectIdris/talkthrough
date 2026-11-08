import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelRequest } from '../src/adapters/model.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import { realModelHint } from '../src/scene/models.ts';
import { MODELS } from '../src/scene/model-catalogue.ts';

const request = (question: string): ModelRequest => ({
  question,
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 1280, height: 720 },
  thread: [],
  schema: {},
});

test('a question that names a rich real model (by name or alias, whole words) is told the model exists and what its parts are called', () => {
  const heart = realModelHint('How does the human heart pump blood?') ?? '';
  assert.match(heart, /model:"heart"/);
  assert.match(heart, /18 parts include/);
  assert.match(realModelHint('what does the cerebellum do?') ?? '', /model:"brain"/, 'an alias counts');
});

test('a question that does not name one is told nothing: no substring matches, no model with a handful of parts or one piece', () => {
  for (const q of ['what is a hearth', 'how do gears work', 'what does a mousetrap look like', '']) {
    assert.equal(realModelHint(q), undefined, q);
  }
});

test('the hint goes into the text beside the question, ahead of it, and only then', () => {
  const text = questionText(request('explain the heart'));
  assert.ok(text.indexOf('real, detailed model') >= 0 && text.indexOf('real, detailed model') < text.indexOf('transcribed from speech'));
  assert.ok(!questionText(request('explain gears')).includes('real, detailed model'));
});

test('a how-does-it-work question about a model that holds no mechanism is told how it works, to open on the real one at stage size and build the mechanism large beside it (see real-model-works.test.ts for the data)', () => {
  for (const [q, id] of [['How does a mousetrap work?', 'mousetrap'], ['How does a drill work?', 'drill'], ['How does a camera work?', 'camera'], ['How does an alarm clock work?', 'alarm-clock']] as const) {
    const hint = realModelHint(q) ?? '';
    assert.match(hint, new RegExp('(' + id + ')'), q);
    assert.match(hint, /How it works: /);
    assert.match(hint, /step 1 opens on the real model at stage size/);
    assert.match(hint, /build the working mechanism large and animated beside it/);
    assert.match(hint, /Each assembly gets a new id of its own/);
    assert.match(hint, /Clear nothing: the real model and every assembly already built stay on stage/);
    assert.ok(hint.includes('add {shape:model, id:"<id>", model:"' + id + '", size:10, pos:[-6,0,0]}'), 'the real model comes first, sized to the stage, to the left');
    assert.ok(hint.includes('pos about [6,0,0]'), 'the mechanism goes to the right');
    assert.ok(hint.indexOf('step 1 opens on the real model') < hint.indexOf('next steps build the working mechanism'), 'in that order');
  }
  assert.ok(MODELS.every((m) => m.mechanism === false), 'no model holds a working mechanism yet: the flag is generated, and the hint keys on it');
});
