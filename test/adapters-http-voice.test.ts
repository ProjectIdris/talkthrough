import test from 'node:test';
import assert from 'node:assert/strict';
import { createWavDecoder, parsePcmType, streamSpeech, VoiceServerError } from '../src/adapters/http-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import { startFakeVoice, toneSamples, wavBytes } from './support/fake-voice-server.ts';

async function collect(gen: AsyncGenerator<VoiceEvent>): Promise<VoiceEvent[]> {
  const out: VoiceEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function pcmOf(events: VoiceEvent[]): Float32Array {
  const parts = events.flatMap((e) => (e.kind === 'pcm' ? [e.samples] : []));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

test('a WAV stream is read whatever way it is cut: every split point of the header and the data gives the same samples', () => {
  const wav = wavBytes(0.05, { extra: true });
  const want = toneSamples(0.05);
  for (const cut of [1, 2, 3, 5, 7, 11, 13, 44, 45, 50, 97]) {
    const d = createWavDecoder();
    const parts: Float32Array[] = [];
    let format: { sampleRate: number; channels: number } | undefined;
    for (let i = 0; i < wav.length; i += cut) {
      const got = d.push(wav.subarray(i, i + cut));
      if (got.format) format = got.format;
      if (got.samples) parts.push(got.samples);
    }
    assert.deepEqual(format && { sampleRate: format.sampleRate, channels: format.channels }, { sampleRate: 24000, channels: 1 }, `cut ${cut}`);
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    assert.equal(all.length, want.length, `cut ${cut}`);
    assert.deepEqual(all.subarray(0, 50), want.subarray(0, 50), `cut ${cut}`);
  }
});

test('a header that does not know the length yet (0 or 0xFFFFFFFF) is read to the end; one that does is trusted, and gives the length', () => {
  for (const size of ['zero', 'unknown'] as const) {
    const d = createWavDecoder();
    const got = d.push(wavBytes(0.1, { size }));
    assert.equal(got.samples?.length, 2400, size);
    assert.equal(got.format?.estimatedMs, undefined, size);
  }
  const d = createWavDecoder();
  const known = d.push(wavBytes(0.25));
  assert.equal(known.format?.estimatedMs, 250);
  assert.equal(d.declaredBytes, 12000);
});

test('floats, two channels and other rates come through as interleaved samples at their own rate', () => {
  const d = createWavDecoder();
  const got = d.push(wavBytes(0.02, { float: true, channels: 2, rate: 44100 }));
  assert.deepEqual({ r: got.format?.sampleRate, c: got.format?.channels }, { r: 44100, c: 2 });
  assert.equal(got.samples?.length, Math.round(0.02 * 44100) * 2);
  assert.ok(Math.abs(got.samples![1000]! - Math.sin((2 * Math.PI * 440 * 500) / 44100) * 0.5) < 1e-6, 'frame 500, left channel');
});

test('what is not a WAV stream, or not a format the app plays, is an error with a plain reason', () => {
  assert.throws(() => createWavDecoder().push(new TextEncoder().encode('this is some text and not audio')), (e: unknown) => e instanceof VoiceServerError && e.code === 'format');
  const bad = Buffer.from(wavBytes(0.01));
  bad.writeUInt16LE(2, 20); // ADPCM
  assert.throws(() => createWavDecoder().push(bad), /not supported/);
});

test('a raw PCM type carries its rate; anything without one is not read as PCM', () => {
  assert.deepEqual(parsePcmType('audio/pcm; rate=22050; channels=2'), { sampleRate: 22050, channels: 2 });
  assert.deepEqual(parsePcmType('audio/L16;rate=16000'), { sampleRate: 16000, channels: 1 });
  assert.equal(parsePcmType('audio/pcm'), null);
  assert.equal(parsePcmType('audio/mpeg'), null);
  assert.equal(parsePcmType('audio/pcm; rate=3'), null);
});

test('a server streams a WAV: the request is JSON with the words and the voice, and the events are a format, samples, an end', async () => {
  const server = await startFakeVoice({ seconds: 0.4, pieces: 5, pieceMs: 5 });
  try {
    const events = await collect(streamSpeech({ url: server.url, text: 'Click the search box.', voice: 'warm' }));
    assert.equal(events[0]!.kind, 'format');
    assert.equal(events.at(-1)!.kind, 'end');
    assert.equal(events.filter((e) => e.kind === 'pcm').length >= 2, true, 'the samples arrive in pieces');
    assert.deepEqual(pcmOf(events), toneSamples(0.4));
    assert.deepEqual(server.requests[0], { text: 'Click the search box.', voice: 'warm', contentType: 'application/json', accept: 'audio/wav, audio/pcm' });
  } finally {
    await server.close();
  }
});

test('raw PCM works too, and no voice field is sent when none is set', async () => {
  const server = await startFakeVoice({ mode: 'pcm', seconds: 0.3, pieces: 3 });
  try {
    const events = await collect(streamSpeech({ url: server.url, text: 'Hello.' }));
    assert.deepEqual(events[0], { kind: 'format', sampleRate: 24000, channels: 1 });
    assert.deepEqual(pcmOf(events), toneSamples(0.3));
    assert.equal('voice' in server.requests[0]!, false);
  } finally {
    await server.close();
  }
});

test('a server that is down, answers an error, sends text, sends nothing or drops half-way is a plain error each time', async () => {
  const server = await startFakeVoice();
  const url = server.url;
  try {
    server.set({ mode: 'error' });
    await assert.rejects(collect(streamSpeech({ url, text: 'a' })), (e: unknown) => e instanceof VoiceServerError && e.code === 'server' && /503: the model is not loaded/.test(e.message));
    server.set({ mode: 'text' });
    await assert.rejects(collect(streamSpeech({ url, text: 'a' })), (e: unknown) => e instanceof VoiceServerError && e.code === 'format');
    server.set({ mode: 'empty' });
    await assert.rejects(collect(streamSpeech({ url, text: 'a' })), /sent no audio/);
    server.set({ mode: 'dropped', seconds: 1, pieces: 6, pieceMs: 5 });
    await assert.rejects(collect(streamSpeech({ url, text: 'a' })), (e: unknown) => e instanceof VoiceServerError && e.code === 'unavailable');
  } finally {
    await server.close();
  }
  await assert.rejects(collect(streamSpeech({ url, text: 'a', timeoutMs: 2000 })), (e: unknown) => e instanceof VoiceServerError && e.code === 'unavailable', 'a closed port');
});

test('a server that never answers is given up on at the time limit, and one that is stopped by the caller ends quietly', async () => {
  const server = await startFakeVoice({ mode: 'hang' });
  try {
    const started = Date.now();
    await assert.rejects(collect(streamSpeech({ url: server.url, text: 'a', timeoutMs: 150 })), (e: unknown) => e instanceof VoiceServerError && e.code === 'timeout');
    assert.ok(Date.now() - started < 1500);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 60);
    const events = await collect(streamSpeech({ url: server.url, text: 'a', signal: controller.signal }));
    assert.deepEqual(events, [], 'an abort is not an error');
  } finally {
    await server.close();
  }
});

test('stopping while the audio is arriving stops the request on the server too', async () => {
  const server = await startFakeVoice({ seconds: 3, pieces: 30, pieceMs: 40 });
  try {
    const controller = new AbortController();
    const seen: string[] = [];
    for await (const e of streamSpeech({ url: server.url, text: 'a long one', signal: controller.signal })) {
      seen.push(e.kind);
      if (seen.length === 3) controller.abort();
    }
    assert.ok(seen.length >= 3 && !seen.includes('end'));
    for (let i = 0; i < 40 && server.active() > 0; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(server.active(), 0, 'the server stopped sending');
  } finally {
    await server.close();
  }
});
