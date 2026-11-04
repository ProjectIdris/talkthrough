import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceBridge, VOICE_TEXT_MAX } from '../src/main/voice-bridge.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import { startFakeVoice } from './support/fake-voice-server.ts';

const until = async (test: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!test() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
};

test('a request streams the server\'s audio back as events, in order, and logs how long the first sound took (never the words)', async () => {
  const server = await startFakeVoice({ seconds: 0.3, pieces: 4, pieceMs: 5, firstByteMs: 30 });
  const logs: string[] = [];
  const bridge = createVoiceBridge({ url: server.url, voice: 'warm', log: (l) => logs.push(l) });
  try {
    const events: VoiceEvent[] = [];
    bridge.speak('1:1', 'A private sentence about my bank.', (e) => events.push(e));
    await until(() => events.at(-1)?.kind === 'end');
    assert.equal(events[0]!.kind, 'format');
    assert.equal(events.at(-1)!.kind, 'end');
    assert.ok(events.filter((e) => e.kind === 'pcm').length >= 2);
    assert.deepEqual({ text: server.requests[0]!.text, voice: server.requests[0]!.voice }, { text: 'A private sentence about my bank.', voice: 'warm' });
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /audio started \d+ ms after the request \(24000 Hz, 1 channel\)/);
    assert.ok(!logs.join('\n').includes('bank'), 'the words are not logged');
  } finally {
    bridge.dispose();
    await server.close();
  }
});

test('a server that is down or answers an error gives one error event with a plain reason, and logs it', async () => {
  const server = await startFakeVoice({ mode: 'error' });
  const logs: string[] = [];
  const bridge = createVoiceBridge({ url: server.url, log: (l) => logs.push(l) });
  try {
    const events: VoiceEvent[] = [];
    bridge.speak('1:1', 'Hello.', (e) => events.push(e));
    await until(() => events.length > 0);
    assert.deepEqual(events, [{ kind: 'error', message: 'the voice server answered 503: the model is not loaded' }]);
    assert.match(logs[0]!, /voice server: the voice server answered 503/);
    await server.close();
    const down: VoiceEvent[] = [];
    bridge.speak('1:2', 'Hello.', (e) => down.push(e));
    await until(() => down.length > 0);
    assert.deepEqual(down, [{ kind: 'error', message: 'the voice server is not reachable' }]);
  } finally {
    bridge.dispose();
  }
});

test('cancel stops the request on the server and sends nothing more; the same key can be used again', async () => {
  const server = await startFakeVoice({ seconds: 3, pieces: 30, pieceMs: 30 });
  const bridge = createVoiceBridge({ url: server.url, log: () => undefined });
  try {
    const a: VoiceEvent[] = [];
    bridge.speak('1:1', 'long', (e) => a.push(e));
    await until(() => a.length >= 3);
    bridge.cancel('1:1');
    const seen = a.length;
    await until(() => server.active() === 0);
    assert.equal(server.active(), 0, 'the server stopped');
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(a.length <= seen + 1, 'nothing after the cancel');
    assert.ok(!a.some((e) => e.kind === 'error' || e.kind === 'end'), 'a cancel is neither an error nor an end');
    server.set({ seconds: 0.1 });
    const b: VoiceEvent[] = [];
    bridge.speak('1:1', 'again', (e) => b.push(e));
    await until(() => b.at(-1)?.kind === 'end');
    assert.equal(b.at(-1)!.kind, 'end');
  } finally {
    bridge.dispose();
    await server.close();
  }
});

test('a request with a key already running replaces it; two keys at once are two streams; dispose stops them all', async () => {
  const server = await startFakeVoice({ seconds: 3, pieces: 30, pieceMs: 30 });
  const bridge = createVoiceBridge({ url: server.url, log: () => undefined });
  try {
    const first: VoiceEvent[] = [], second: VoiceEvent[] = [], other: VoiceEvent[] = [];
    bridge.speak('1:1', 'one', (e) => first.push(e));
    bridge.speak('1:1', 'one again', (e) => second.push(e));
    bridge.speak('2:1', 'elsewhere', (e) => other.push(e));
    await until(() => second.length >= 2 && other.length >= 2);
    assert.ok(second.length >= 2 && other.length >= 2, 'both streams run');
    assert.ok(first.length <= 1, 'the replaced one stopped');
    bridge.dispose();
    await until(() => server.active() === 0);
    assert.equal(server.active(), 0);
  } finally {
    await server.close();
  }
});

test('a very long text is cut before it is sent', async () => {
  const server = await startFakeVoice({ seconds: 0.1 });
  const bridge = createVoiceBridge({ url: server.url, log: () => undefined });
  try {
    const events: VoiceEvent[] = [];
    bridge.speak('1:1', 'x'.repeat(VOICE_TEXT_MAX * 3), (e) => events.push(e));
    await until(() => events.at(-1)?.kind === 'end');
    assert.equal(server.requests[0]!.text!.length, VOICE_TEXT_MAX);
  } finally {
    bridge.dispose();
    await server.close();
  }
});
