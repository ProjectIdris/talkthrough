import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServerVoice, SYSTEM_ID_BASE, voiceTransport } from '../src/overlay/server-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import type { AudioSink } from '../src/adapters/streamed-voice.ts';
import type { Voice } from '../src/adapters/voice.ts';
import type { TalkthroughApi } from '../src/shared/ipc.ts';

/** The page's way to main, recorded; `reply` sends events back as main would. */
function fakeApi() {
  const asked: Array<{ id: number; text: string; via: string | undefined }> = [];
  const cancelled: number[] = [];
  const listeners: Array<(id: number, event: VoiceEvent) => void> = [];
  const api: TalkthroughApi['voice'] = {
    speak: (id, text, via) => void asked.push({ id, text, via }),
    cancel: (id) => void cancelled.push(id),
    onEvent: (l) => void listeners.push(l),
  };
  return { api, asked, cancelled, reply: (id: number, event: VoiceEvent) => { for (const l of listeners) l(id, event); } };
}

/** A sink that records what it is given and plays instantly. */
function fakeSink() {
  const opened: Array<{ samples: number }> = [];
  const sink: AudioSink = {
    open(_format, callbacks) {
      const entry = { samples: 0 };
      opened.push(entry);
      return { push: (s) => { entry.samples += s.length; }, finish: () => { callbacks.started(); callbacks.ended(); }, stop() {} };
    },
  };
  return { sink, opened };
}

const spare: Voice = { id: 'page-speech', speak: () => { throw new Error('the page speech must not be used here'); }, cancel() {} } as unknown as Voice;

test('the system voice made by main has its own numbers on the one channel, so its audio never reaches the server voice', () => {
  const f = fakeApi();
  const server = voiceTransport(f.api);
  const system = voiceTransport(f.api, 'system');
  const s2: number[] = [], y2: number[] = [];
  server.onEvent((id) => s2.push(id));
  system.onEvent((id) => y2.push(id));
  f.reply(4, { kind: 'end' });
  f.reply(SYSTEM_ID_BASE + 4, { kind: 'end' });
  assert.deepEqual(s2, [4]);
  assert.deepEqual(y2, [4]);
  system.request(7, 'hello');
  system.cancel(7);
  server.request(7, 'hello');
  assert.deepEqual(f.asked, [{ id: SYSTEM_ID_BASE + 7, text: 'hello', via: 'system' }, { id: 7, text: 'hello', via: undefined }]);
  assert.deepEqual(f.cancelled, [SYSTEM_ID_BASE + 7]);
});

test('with only the system voice made by main, that voice speaks first (through the sink) and the page speech is the spare', async () => {
  const f = fakeApi();
  const s = fakeSink();
  const voice = createServerVoice(f.api, { firstAudioMs: 3000, cooldownMs: 1000, server: false, system: true }, spare, () => undefined, { sink: s.sink });
  const done = new Promise<string>((resolve) => voice.speak('say this', { end: (e) => resolve(e.reason) }));
  assert.deepEqual(f.asked, [{ id: SYSTEM_ID_BASE + 1, text: 'say this', via: 'system' }], 'asked of main as the system voice, never of a server');
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'format', sampleRate: 22050, channels: 1 });
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'pcm', samples: new Float32Array(500) });
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'end' });
  assert.equal(await done, 'finished');
  assert.equal(s.opened[0]?.samples, 500, 'the audio went to the chosen output');
});

test('a server is the first choice, the system voice made by main the second, and the page speech the last', async () => {
  const f = fakeApi();
  const s = fakeSink();
  const log: string[] = [];
  const voice = createServerVoice(f.api, { firstAudioMs: 3000, cooldownMs: 1000, system: true }, spare, (l) => log.push(l), { sink: s.sink });
  const done = new Promise<string>((resolve) => voice.speak('words', { end: (e) => resolve(e.reason) }));
  assert.deepEqual(f.asked.map((a) => a.via), [undefined], 'the server is asked first');
  f.reply(1, { kind: 'error', message: 'the voice server failed' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(f.asked.map((a) => a.via), [undefined, 'system'], 'then the system voice made by main');
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'format', sampleRate: 22050, channels: 1 });
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'pcm', samples: new Float32Array(100) });
  f.reply(SYSTEM_ID_BASE + 1, { kind: 'end' });
  assert.equal(await done, 'finished');
});

test('with no voice made by main the page speech is the voice, as before', () => {
  const f = fakeApi();
  const voice = createServerVoice(f.api, { firstAudioMs: 3000, cooldownMs: 1000, server: false }, { id: 'page-speech', speak: () => ({ finished: Promise.resolve({ reason: 'finished' as const }), cancel() {} }), cancel() {} } as unknown as Voice, () => undefined, { sink: fakeSink().sink });
  voice.speak('hello');
  assert.deepEqual(f.asked, []);
});
