import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelRequest } from '../src/adapters/model.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import { sceneGuide } from '../src/scene/guide.ts';
import { livingHint, namesLiving } from '../src/scene/living.ts';
import { realModelHint } from '../src/scene/models.ts';

const request = (question: string): ModelRequest => ({
  question,
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 1280, height: 720 },
  thread: [],
  schema: {},
});

test('a question that names a living thing (whole words, singular or plural, any case) is told how to write its parts', () => {
  for (const q of ['How does the hand grip?', 'what are the parts of a fish', 'How do LUNGS work?', 'Why are leaves green?', 'what is inside a peach', 'explain the plant cell', 'how do kidneys filter blood', 'How does the eye focus?', 'what do cherries grow from']) {
    const hint = livingHint(q) ?? '';
    assert.match(hint, /^If you build a living thing from shapes/, q);
    assert.match(hint, /a living material \(skin, muscle, organ/, q);
    assert.match(hint, /overlap what it grows from/, q);
    assert.match(hint, /never a ball/, q);
  }
});

test('a question that names none is told nothing: no substring matches, and words that mostly mean something else are not in the list', () => {
  for (const q of ['how do gears work', 'what is a planet', 'where is the door handle', 'open the catalogue', 'what is a leaflet', 'my mouse is not working', 'how do I change the body text', 'what is a root directory', 'how does a nut and bolt hold', 'is this a virus', '']) {
    assert.equal(namesLiving(q), false, q);
    assert.equal(livingHint(q), undefined, q);
  }
});

test('the hint goes beside the question, ahead of it; never when a real model of the thing is offered, and never into the guide', () => {
  const text = questionText(request('how does the hand grip?'));
  const at = text.indexOf('If you build a living thing from shapes');
  assert.ok(at >= 0 && at < text.indexOf('transcribed from speech'));
  assert.ok(!questionText(request('explain gears')).includes('living thing from shapes'));
  assert.ok(realModelHint('explain the heart') !== undefined && namesLiving('explain the heart'), 'the heart is living and has a real model');
  assert.ok(!questionText(request('explain the heart')).includes('living thing from shapes'), 'the real model is the better answer: one hint, not two');
  assert.ok(!sceneGuide.includes('living thing from shapes'));
});
