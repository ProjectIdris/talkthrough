import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamedVoice } from '../src/adapters/streamed-voice.ts';
import type { AudioPlayback, AudioSink, VoiceTransport } from '../src/adapters/streamed-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';

/** A streamed voice whose sink says how much has been heard (the test moves it), and a ticker the test runs by hand. */
function rig() {
  let listener: ((id: number, e: VoiceEvent) => void) | undefined;
  const transport: VoiceTransport = { request: () => undefined, cancel: () => undefined, onEvent: (l) => void (listener = l) };
  const state = { heard: 0, started: () => undefined as void, ended: () => undefined as void };
  let run: (() => void) | undefined;
  const sink: AudioSink = {
    open(_format, cb) {
      state.started = cb.started;
      state.ended = cb.ended;
      const playback: AudioPlayback = { push: () => undefined, finish: () => undefined, stop: () => undefined, heardMs: () => state.heard };
      return playback;
    },
  };
  const voice = createStreamedVoice({ transport, sink, tick: (r) => { run = r; return () => { run = undefined; }; } });
  return {
    voice, state,
    emit: (e: VoiceEvent) => listener!(1, e),
    tick: () => run?.(),
    ticking: () => run !== undefined,
  };
}
const TEXT = 'One two three four five six';

test('the words of a step are given as the sound is heard, not as it arrives', () => {
  const r = rig();
  const words: number[] = [];
  r.voice.speak(TEXT, { boundary: (e) => words.push(e.charIndex) });
  r.emit({ kind: 'format', sampleRate: 24000, channels: 1, estimatedMs: 3000 });
  r.emit({ kind: 'pcm', samples: new Float32Array(24000 * 3) }); // all three seconds have arrived
  r.state.started();
  r.state.heard = 0;
  r.tick();
  assert.deepEqual(words, [], 'nothing heard yet, so no word is shown although all the sound is here');
  r.state.heard = 1200;
  r.tick();
  assert.deepEqual(words, [0, 4, 8]);
  r.tick();
  assert.deepEqual(words, [0, 4, 8], 'a word is given once');
  r.state.heard = 2900;
  r.tick();
  assert.deepEqual(words, [0, 4, 8, 14, 19, 24]);
});

test('the words not yet shown are all given when the sound ends, and the ticker stops', () => {
  const r = rig();
  const words: number[] = [];
  r.voice.speak(TEXT, { boundary: (e) => words.push(e.charIndex) });
  r.emit({ kind: 'format', sampleRate: 24000, channels: 1, estimatedMs: 3000 });
  r.emit({ kind: 'pcm', samples: new Float32Array(24000 * 3) });
  r.emit({ kind: 'end' });
  r.state.started();
  assert.ok(r.ticking());
  r.state.ended();
  assert.deepEqual(words, [0, 4, 8, 14, 19, 24]);
  assert.ok(!r.ticking());
});

test('a length guessed too short does not show words early: the sound that has arrived is at least that long', () => {
  const r = rig();
  const words: number[] = [];
  r.voice.speak(TEXT, { boundary: (e) => words.push(e.charIndex) });
  r.emit({ kind: 'format', sampleRate: 24000, channels: 1, estimatedMs: 1000 }); // said 1 s ...
  r.emit({ kind: 'pcm', samples: new Float32Array(24000 * 6) }); // ... but 6 s are here
  r.state.started();
  r.state.heard = 800;
  r.tick();
  assert.deepEqual(words, [0], 'at 0.8 s of 6 only the first word has begun (by the 1 s guess it would be four)');
});

test('with no listener for words nothing is ticked', () => {
  const r = rig();
  r.voice.speak(TEXT, {});
  r.emit({ kind: 'format', sampleRate: 24000, channels: 1 });
  r.emit({ kind: 'pcm', samples: new Float32Array(24000) });
  r.state.started();
  assert.ok(!r.ticking());
});
