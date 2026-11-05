import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpokenClock, isCaptionMode, readingSeconds, spokenTimes, speechWeight, wordSpans } from '../src/shared/captions.ts';

test('words are found with their first character and the end of the word', () => {
  assert.deepEqual(wordSpans('  Hello, big   world.'), [{ start: 2, end: 8 }, { start: 9, end: 12 }, { start: 15, end: 21 }]);
  assert.deepEqual(wordSpans(''), []);
});

test('a word before a pause weighs more than one before none, and a full stop more than a comma', () => {
  assert.ok(speechWeight('piston.') > speechWeight('piston,'));
  assert.ok(speechWeight('piston,') > speechWeight('piston'));
  assert.ok(speechWeight('a') >= 1);
  assert.equal(speechWeight('—'), 1 + 3);
});

test('spoken times rise through the text, none is before the start or after the end', () => {
  const text = 'The piston moves up, then down. Next the valve opens.';
  const times = spokenTimes(text, 4000);
  assert.equal(times.length, 10);
  times.forEach((t, i) => {
    assert.ok(t.atMs > 0 && t.atMs < 4000, `word ${i}`);
    if (i > 0) assert.ok(t.atMs > (times[i - 1] as { atMs: number }).atMs);
  });
});

test('the clock gives each word once, in order, only when enough has been heard, and the rest when the sound ends', () => {
  const clock = createSpokenClock('One two three four', 4000);
  assert.deepEqual(clock.due(0), []);
  const first = clock.due(700);
  assert.deepEqual(first.map((w) => w.charIndex), [0]);
  assert.deepEqual(clock.due(700), [], 'a word is not given twice');
  assert.deepEqual(clock.due(2300).map((w) => w.charIndex), [4, 8]);
  assert.deepEqual(clock.rest().map((w) => w.charIndex), [14]);
  assert.deepEqual(clock.rest(), []);
  assert.equal(clock.shown, 4);
});

test('a longer total than guessed moves the words not yet shown later', () => {
  const clock = createSpokenClock('One two three four five six', 3000);
  assert.deepEqual(clock.due(1200).map((w) => w.charIndex), [0, 4, 8]);
  clock.retime(9000);
  assert.deepEqual(clock.due(2000), [], 'what would have been due at the old pace is not');
});

test('a step that is only read takes its words at a reading pace, never under the least', () => {
  assert.equal(readingSeconds('Hi.'), 3.5);
  const long = 'This page explains the four-stroke engine and the numbered list gives its four strokes in order, so I will build a model to show them.';
  assert.ok(readingSeconds(long) > 3.5 && readingSeconds(long) < 12);
});

test('only voice, text and both are caption settings', () => {
  assert.ok(isCaptionMode('voice') && isCaptionMode('text') && isCaptionMode('both'));
  assert.ok(!isCaptionMode('off') && !isCaptionMode(undefined) && !isCaptionMode(3));
});
