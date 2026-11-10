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
  for (const q of ['How does the hand grip?', 'what are the parts of a fish', 'How do LUNGS work?', 'Why are leaves green?', 'what is inside a peach', 'explain the plant cell', 'how do kidneys filter blood', 'How does the eye focus?', 'what do cherries grow from', 'how does a tree grow', 'what is inside a leaf', 'show me the bones of the hand']) {
    const hint = livingHint(q) ?? '';
    assert.match(hint, /^If you build a living thing from shapes/, q);
    assert.match(hint, /a living material \(skin, muscle, organ/, q);
    assert.match(hint, /overlap what it grows from/, q);
    assert.match(hint, /never a ball/, q);
    assert.match(hint, /get its outline right first/, q);
    assert.match(hint, /never costs the outside a part/, q);
    assert.match(hint, /a point at each joint/, q);
    assert.match(hint, /A human palm or sole is a box with a bevel/, q);
    assert.match(hint, /fur, feathers and the shell of an insect are skin/, q);
  }
});

test('a question that names none is told nothing: no substring matches, and words that mostly mean something else are not in the list', () => {
  for (const q of ['how do gears work', 'what is a planet', 'where is the door handle', 'open the catalogue', 'what is a leaflet', 'my mouse is not working', 'how do I change the body text', 'what is a root directory', 'how does a nut and bolt hold', 'is this a virus', '']) {
    assert.equal(namesLiving(q), false, q);
    assert.equal(livingHint(q), undefined, q);
  }
});

test('a living word used of something else (a tree of decisions, a leaf node, the other hand), or beside a word of software, draws no hint', () => {
  for (const q of ['how does a decision tree split', 'what is a leaf node in a binary tree', 'show the file tree', 'what is a kubernetes pod', 'on the other hand, why is this slow', 'what does the cat command do', 'skin this app theme', 'what is the hand tool in photoshop', 'how does a spider crawler index pages', 'what is a random seed', 'how does a power plant make electricity', 'what is this heart icon for', 'how does a pipe organ work', 'what is hip hop', 'what does the ant build tool do', 'explain the family tree']) {
    assert.equal(namesLiving(q), false, q);
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
