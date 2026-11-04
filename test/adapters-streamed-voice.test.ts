import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamedVoice } from '../src/adapters/streamed-voice.ts';
import type { AudioPlayback, AudioSink, VoiceTransport } from '../src/adapters/streamed-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';

/** A transport that records what was asked and lets the test answer; and a sink that records what is played and lets the test say when it is heard. */
function rig() {
  const requests: Array<{ id: number; text: string }> = [];
  const cancelled: number[] = [];
  let listener: ((id: number, e: VoiceEvent) => void) | undefined;
  const transport: VoiceTransport = {
    request: (id, text) => void requests.push({ id, text }),
    cancel: (id) => void cancelled.push(id),
    onEvent: (l) => void (listener = l),
  };
  type Played = { format: { sampleRate: number; channels: number }; samples: number; finished: boolean; stopped: boolean; started(): void; ended(): void };
  const played: Played[] = [];
  const sink: AudioSink = {
    open(format, cb) {
      const p: Played = { format, samples: 0, finished: false, stopped: false, started: cb.started, ended: cb.ended };
      played.push(p);
      const playback: AudioPlayback = {
        push: (s) => void (p.samples += s.length),
        finish: () => void (p.finished = true),
        stop: () => void (p.stopped = true),
      };
      return playback;
    },
  };
  return {
    requests, cancelled, played, voice: createStreamedVoice({ transport, sink }),
    emit: (id: number, e: VoiceEvent) => listener!(id, e),
    audio: (id: number, frames: number, rate = 24000) => {
      listener!(id, { kind: 'format', sampleRate: rate, channels: 1 });
      listener!(id, { kind: 'pcm', samples: new Float32Array(frames) });
    },
  };
}

test('the words go to the server at once; speech starts when the first sound is heard, with a guess at its length, and ends once when the last is', async () => {
  const r = rig();
  const events: string[] = [];
  const handle = r.voice.speak('Click the search box.', { start: (e) => events.push(`start ${e.estimatedMs}`), end: (e) => events.push(`end ${e.reason}`) });
  assert.deepEqual(r.requests, [{ id: 1, text: 'Click the search box.' }]);
  r.audio(1, 4800);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [], 'audio that has arrived is not audio that is heard');
  r.played[0]!.started();
  assert.deepEqual(events, [`start ${Math.round((21 / 15) * 1000)}`], 'with no length from the server, a guess from the characters');
  r.played[0]!.started();
  r.emit(1, { kind: 'end' });
  assert.equal(r.played[0]!.finished, true);
  assert.deepEqual(events.length, 1, 'not ended until it has been heard');
  r.played[0]!.ended();
  r.played[0]!.ended();
  assert.deepEqual(events.slice(1), ['end finished']);
  assert.deepEqual(await handle.finished, { reason: 'finished' });
});

test('the length the server gave is the length told to the player; what the voice really did sets the guess for the next', () => {
  const r = rig();
  const told: Array<number | undefined> = [];
  r.voice.speak('A sentence of exactly forty characters, yes.', { start: (e) => told.push(e.estimatedMs) });
  r.emit(1, { kind: 'format', sampleRate: 24000, channels: 1, estimatedMs: 3300 });
  r.emit(1, { kind: 'pcm', samples: new Float32Array(24000 * 3) });
  r.played[0]!.started();
  r.emit(1, { kind: 'end' });
  r.played[0]!.ended();
  assert.deepEqual([...told], [3300]);
  // 43 characters took 3 s (14.3 a second) and the guess had been 15, so it is 14.7 now. 48 characters in 2 s (24 a second) moves it on to 19.3.
  r.voice.speak('Another sentence that is long enough to measure.', { start: (e) => told.push(e.estimatedMs) });
  r.emit(2, { kind: 'format', sampleRate: 24000, channels: 1 });
  r.emit(2, { kind: 'pcm', samples: new Float32Array(48000) });
  r.played[1]!.started();
  r.emit(2, { kind: 'end' });
  r.played[1]!.ended();
  r.voice.speak('One more sentence, to hear the guess.', { start: (e) => told.push(e.estimatedMs) });
  r.emit(3, { kind: 'format', sampleRate: 24000, channels: 1 });
  r.emit(3, { kind: 'pcm', samples: new Float32Array(2400) });
  r.played[2]!.started();
  assert.ok(told[2]! > 1800 && told[2]! < 2150, `38 characters at about 19 a second, not the first guess of 15 (2500): ${told[2]}`);
});

test('a second utterance is asked for at once but waits for its turn: its sound is held until the first has been heard, in order', () => {
  const r = rig();
  const order: string[] = [];
  r.voice.speak('first words here', { start: () => order.push('start 1'), end: (e) => order.push(`end 1 ${e.reason}`) });
  r.voice.speak('second words here', { start: () => order.push('start 2'), end: (e) => order.push(`end 2 ${e.reason}`) });
  assert.deepEqual(r.requests.map((q) => q.id), [1, 2], 'both are being made');
  r.audio(2, 1000);
  assert.equal(r.played.length, 0, 'the second one is not played yet');
  r.audio(1, 1000);
  r.played[0]!.started();
  r.emit(1, { kind: 'end' });
  r.played[0]!.ended();
  assert.equal(r.played.length, 2, 'its turn: what was held is played');
  r.played[1]!.started();
  r.emit(2, { kind: 'end' });
  r.played[1]!.ended();
  assert.deepEqual(order, ['start 1', 'end 1 finished', 'start 2', 'end 2 finished']);
});

test('cancel stops the sound, tells the server, ends every utterance once as cancelled, and lets nothing that comes later through', async () => {
  const r = rig();
  const ends: string[] = [];
  const a = r.voice.speak('one', { end: (e) => ends.push(`a ${e.reason}`) });
  r.voice.speak('two', { end: (e) => ends.push(`b ${e.reason}`) });
  r.audio(1, 500);
  r.voice.cancel();
  assert.deepEqual(ends, ['a cancelled', 'b cancelled']);
  assert.deepEqual(r.cancelled, [1, 2]);
  assert.equal(r.played[0]!.stopped, true);
  assert.equal(r.played.length, 1, 'the second never got its turn on the way out');
  r.audio(1, 500);
  r.audio(2, 500);
  r.played[0]!.started();
  r.played[0]!.ended();
  assert.deepEqual(ends, ['a cancelled', 'b cancelled'], 'late audio and late callbacks change nothing');
  assert.deepEqual(await a.finished, { reason: 'cancelled' });
  // and it speaks again afterwards
  r.voice.speak('three', { end: (e) => ends.push(`c ${e.reason}`) });
  assert.deepEqual(r.requests.at(-1), { id: 3, text: 'three' });
});

test('a handle cancels the whole queue, as the browser voice does', () => {
  const r = rig();
  const ends: string[] = [];
  const a = r.voice.speak('one', { end: (e) => ends.push(`a ${e.reason}`) });
  r.voice.speak('two', { end: (e) => ends.push(`b ${e.reason}`) });
  a.cancel();
  assert.deepEqual(ends, ['a cancelled', 'b cancelled']);
});

test('an error before any sound ends the utterance as an error with the reason; an end with no audio is an error; an error after the sound began ends it too', async () => {
  const r = rig();
  const ends: Array<{ reason: string; error?: string | undefined }> = [];
  r.voice.speak('one', { end: (e) => ends.push(e) });
  r.emit(1, { kind: 'error', message: 'the voice server is not reachable' });
  r.voice.speak('two', { end: (e) => ends.push(e) });
  r.emit(2, { kind: 'end' });
  const c = r.voice.speak('three', { end: (e) => ends.push(e) });
  r.audio(3, 1000);
  r.played[0]!.started();
  r.emit(3, { kind: 'error', message: 'the voice server stopped sending' });
  assert.deepEqual(ends, [
    { reason: 'error', error: 'the voice server is not reachable' },
    { reason: 'error', error: 'the voice server sent no audio' },
    { reason: 'error', error: 'the voice server stopped sending' },
  ]);
  assert.equal((await c.finished).reason, 'error');
  assert.equal(r.played[0]!.stopped, true, 'what was playing is silenced');
});

test('a listener that throws cannot leave the utterance unsettled', async () => {
  const r = rig();
  const h = r.voice.speak('boom', { end: () => { throw new Error('listener'); } });
  assert.throws(() => r.emit(1, { kind: 'error', message: 'x' }), /listener/);
  assert.equal((await h.finished).reason, 'error');
});
