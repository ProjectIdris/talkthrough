import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechSynthesisVoice } from '../src/adapters/speech-synthesis-voice.ts';
import type { SynthesisLike, UtteranceLike } from '../src/adapters/speech-synthesis-voice.ts';

function fakeSynth() {
  const spoken: UtteranceLike[] = [];
  let cancels = 0;
  const synth: SynthesisLike = {
    speak: (u) => void spoken.push(u),
    cancel: () => void cancels++,
  };
  const createUtterance = (text: string): UtteranceLike => ({
    text, rate: 1, pitch: 1, voice: null, onstart: null, onend: null, onerror: null, onboundary: null,
  });
  return { synth, createUtterance, spoken, cancels: () => cancels };
}

test('start, boundary and end reach the listener in order, and finished resolves', async () => {
  const f = fakeSynth();
  const voice = createSpeechSynthesisVoice({ synth: f.synth, createUtterance: f.createUtterance, rate: 2 });
  const events: string[] = [];
  const handle = voice.speak('Hello there, friend', {
    start: (e) => events.push(`start ${e.estimatedMs}`),
    boundary: (e) => events.push(`word ${e.charIndex}`),
    end: (e) => events.push(`end ${e.reason}`),
  });
  const u = f.spoken[0]!;
  assert.equal(u.rate, 2);
  u.onstart!({});
  u.onboundary!({ charIndex: 6 });
  u.onend!({});
  assert.deepEqual(await handle.finished, { reason: 'finished' });
  assert.deepEqual(events, ['start 633', 'word 6', 'end finished']);
});

test('cancel ends the utterance once as cancelled, even if the browser then reports an error', async () => {
  const f = fakeSynth();
  const voice = createSpeechSynthesisVoice({ synth: f.synth, createUtterance: f.createUtterance });
  let ends = 0;
  const handle = voice.speak('Stop me', { end: () => void ends++ });
  handle.cancel();
  f.spoken[0]!.onerror!({ error: 'canceled' });
  assert.deepEqual(await handle.finished, { reason: 'cancelled' });
  assert.equal(ends, 1);
  assert.equal(f.cancels(), 1);
});

test('a real synthesis error is reported as an error, not a cancel', async () => {
  const f = fakeSynth();
  const voice = createSpeechSynthesisVoice({ synth: f.synth, createUtterance: f.createUtterance });
  const handle = voice.speak('Oops');
  f.spoken[0]!.onerror!({ error: 'synthesis-failed' });
  assert.deepEqual(await handle.finished, { reason: 'error', error: 'synthesis-failed' });
});

test('voice.cancel() ends every live utterance', async () => {
  const f = fakeSynth();
  const voice = createSpeechSynthesisVoice({ synth: f.synth, createUtterance: f.createUtterance });
  const a = voice.speak('one');
  const b = voice.speak('two');
  voice.cancel();
  assert.deepEqual(await a.finished, { reason: 'cancelled' });
  assert.deepEqual(await b.finished, { reason: 'cancelled' });
});

test('with no speechSynthesis and no stand-in it says so', () => {
  assert.throws(() => createSpeechSynthesisVoice({}), /speechSynthesis is not available/);
});

test('a listener that throws still lets finished settle', async () => {
  const f = fakeSynth();
  const voice = createSpeechSynthesisVoice({ synth: f.synth, createUtterance: f.createUtterance });
  const handle = voice.speak('Boom', { end: () => { throw new Error('listener failed'); } });
  assert.throws(() => f.spoken[0]!.onend!({}), /listener failed/);
  assert.deepEqual(await handle.finished, { reason: 'finished' });
});
