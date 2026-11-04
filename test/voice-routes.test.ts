// The shared voice and backend routes, as a program on this machine offers them, imitated by a fake server: the paths, the unknown-length
// WAV, the busy answer with Retry-After, the warm-up and the backend's replies. The addresses here are the fake's own; the app reads its
// real ones from the settings only.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createHttpBackend } from '../src/adapters/backend.ts';
import type { BackendRequest } from '../src/adapters/backend.ts';
import { ModelError } from '../src/adapters/model.ts';
import { createFallbackVoice } from '../src/adapters/fallback-voice.ts';
import type { FallbackClock } from '../src/adapters/fallback-voice.ts';
import { parseRetryAfter, streamSpeech, VoiceServerError } from '../src/adapters/http-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import { createLocalSpeechServerRecogniser } from '../src/adapters/local-speech-server.ts';
import { createStreamedVoice } from '../src/adapters/streamed-voice.ts';
import type { AudioSink, VoiceTransport } from '../src/adapters/streamed-voice.ts';
import type { SpeechEnd, Voice } from '../src/adapters/voice.ts';
import { createVoiceBridge } from '../src/main/voice-bridge.ts';
import { wavBytes } from './support/fake-voice-server.ts';

type Seen = { method?: string; url?: string; headers: IncomingMessage['headers']; body: string };
type Route = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function withRoutes<T>(routes: Record<string, Route>, run: (base: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const path = (req.url ?? '').split('?')[0] as string;
      const route = routes[`${req.method} ${path}`];
      if (route) route(req, res, body);
      else { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"no such route"}'); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** The speak route: audio/wav of unknown length (both sizes 0xFFFFFFFF), streamed. */
const speakOk: Route = (_req, res) => {
  const wav = wavBytes(0.2, { size: 'unknown' });
  res.writeHead(200, { 'Content-Type': 'audio/wav' });
  res.write(wav.subarray(0, 60));
  setTimeout(() => res.end(wav.subarray(60)), 5);
};
const speakBusy: Route = (_r, res) => json(res, 503, { error: 'voice busy' }, { 'Retry-After': '5' });

async function collect(gen: AsyncGenerator<VoiceEvent>): Promise<VoiceEvent[]> {
  const out: VoiceEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test('speak: the unknown-length WAV is read to the end of the body, the text is all that is sent, and no Origin goes with it', async () => {
  await withRoutes({ 'POST /api/voice-shared/speak': speakOk }, async (base, seen) => {
    const events = await collect(streamSpeech({ url: `${base}/api/voice-shared/speak`, text: 'Hello there.' }));
    const first = events[0];
    assert.equal(first?.kind, 'format');
    assert.deepEqual(first && first.kind === 'format' ? [first.sampleRate, first.channels] : null, [24000, 1]);
    assert.equal(events.at(-1)?.kind, 'end');
    assert.ok(events.filter((e) => e.kind === 'pcm').length >= 1);
    assert.deepEqual(JSON.parse(seen[0]?.body ?? '{}'), { text: 'Hello there.' });
    assert.equal(seen[0]?.headers.origin, undefined);
  });
});

test('speak: 400 and 502 are server errors with the reason; a 503 without Retry-After is one too', async () => {
  for (const status of [400, 502, 503]) {
    await withRoutes({ 'POST /s': (_r, res) => json(res, status, { error: 'because' }) }, async (base) => {
      await assert.rejects(collect(streamSpeech({ url: `${base}/s`, text: 'x' })), (e: unknown) => {
        assert.ok(e instanceof VoiceServerError);
        assert.equal(e.code, 'server');
        assert.equal(e.retryAfterMs, undefined);
        assert.match(e.message, new RegExp(`answered ${status}.*because`));
        return true;
      });
    });
  }
});

test('speak: a 503 with Retry-After is busy, and says how long it asked to be left alone', async () => {
  await withRoutes({ 'POST /s': speakBusy }, async (base) => {
    await assert.rejects(collect(streamSpeech({ url: `${base}/s`, text: 'x' })), (e: unknown) => e instanceof VoiceServerError && e.code === 'busy' && e.retryAfterMs === 5000);
  });
  // Only a busy answer is read this way: a 502 that carries the header is still a failure.
  await withRoutes({ 'POST /s': (_r, res) => json(res, 502, { error: 'x' }, { 'Retry-After': '5' }) }, async (base) => {
    await assert.rejects(collect(streamSpeech({ url: `${base}/s`, text: 'x' })), (e: unknown) => e instanceof VoiceServerError && e.code === 'server' && e.retryAfterMs === undefined);
  });
});

test('Retry-After: seconds, a date, nothing, nonsense, and a wait longer than a minute is cut to a minute', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter(' 0 '), 0);
  assert.equal(parseRetryAfter('3600'), 60_000);
  assert.equal(parseRetryAfter(new Date(10_000 + 7000).toUTCString(), 10_000), 7000);
  assert.equal(parseRetryAfter(new Date(0).toUTCString(), 10_000), 0);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

/** The whole chain the app uses: the bridge in main, the streamed voice in the page, the fallback over both, on a clock the test turns. */
function chain(base: string, log: string[]) {
  const bridge = createVoiceBridge({ url: `${base}/api/voice-shared/speak`, log: (l) => log.push(l) });
  const listeners: Array<(id: number, e: VoiceEvent) => void> = [];
  const transport: VoiceTransport = {
    request: (id, text) => bridge.speak(String(id), text, (e) => listeners.forEach((l) => l(id, e))),
    cancel: (id) => bridge.cancel(String(id)),
    onEvent: (l) => void listeners.push(l),
  };
  const sink: AudioSink = {
    open: (_f, cb) => {
      queueMicrotask(cb.started);
      return { push: () => undefined, finish: () => void setTimeout(cb.ended, 1), stop: () => undefined };
    },
  };
  const server = createStreamedVoice({ transport, sink });
  const spoken: string[] = [];
  const system: Voice = {
    id: 'system',
    speak(text, listener = {}) {
      spoken.push(text);
      queueMicrotask(() => listener.start?.({ estimatedMs: 10 }));
      const finished = new Promise<SpeechEnd>((resolve) => setTimeout(() => { listener.end?.({ reason: 'finished' }); resolve({ reason: 'finished' }); }, 1));
      return { finished, cancel: () => undefined };
    },
    cancel: () => undefined,
  };
  let t = 0;
  const clock: FallbackClock = { now: () => t, after: (ms, run) => { const h = setTimeout(run, ms); return () => clearTimeout(h); } };
  const voice = createFallbackVoice({ primary: server, fallback: system, firstAudioMs: 2000, cooldownMs: 20_000, clock, log: (l) => log.push(l) });
  return { voice, spoken, advance: (ms: number) => void (t += ms), bridge };
}

test('a busy voice: that step and the ones after it are spoken by the system voice, the server is not asked again until it said it would be free', async () => {
  let asked = 0;
  await withRoutes({ 'POST /api/voice-shared/speak': (req, res, body) => { asked++; speakBusy(req, res, body); } }, async (base) => {
    const log: string[] = [];
    const c = chain(base, log);
    assert.equal((await c.voice.speak('First step.').finished).reason, 'finished');
    assert.deepEqual(c.spoken, ['First step.']);
    assert.equal(asked, 1);
    // Four more steps in the next five seconds: none of them goes to the server.
    c.advance(4000);
    for (const text of ['Two.', 'Three.', 'Four.', 'Five.']) await c.voice.speak(text).finished;
    assert.equal(asked, 1, 'no storm of requests while the server asked for peace');
    assert.deepEqual(c.spoken, ['First step.', 'Two.', 'Three.', 'Four.', 'Five.']);
    // After the five seconds it is tried again.
    c.advance(1500);
    await c.voice.speak('Six.').finished;
    assert.equal(asked, 2);
    assert.equal(c.spoken.at(-1), 'Six.');
    assert.ok(log.some((l) => /is busy/.test(l) && /5 s/.test(l)), log.join('\n'));
  });
});

test('a busy voice, steps asked for at once (the page asks for each as it is written): each is spoken with the system voice, once', async () => {
  await withRoutes({ 'POST /api/voice-shared/speak': speakBusy }, async (base) => {
    const c = chain(base, []);
    const ends = await Promise.all(['A.', 'B.', 'C.'].map((t) => c.voice.speak(t).finished));
    assert.deepEqual(ends.map((e) => e.reason), ['finished', 'finished', 'finished']);
    assert.deepEqual([...c.spoken].sort(), ['A.', 'B.', 'C.']);
  });
});

test('the recogniser: transcribe and health read the shared base, and a plain fetch carries no Origin', async () => {
  await withRoutes({
    'POST /api/voice-shared/transcribe': (_r, res) => json(res, 200, { text: 'what is this', engine: 'fast', seconds: 0.3 }),
    'GET /api/voice-shared/health': (_r, res) => json(res, 200, { ok: true }),
  }, async (base, seen) => {
    const stt = createLocalSpeechServerRecogniser({ url: `${base}/api/voice-shared`, limitMs: 4000 });
    await stt.warm?.();
    const out = await stt.transcribe({ samples: new Float32Array([0.5, 0.25, 0, 0]), sampleRate: 16000 });
    assert.equal(out.text, 'what is this');
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ['GET /api/voice-shared/health', 'POST /api/voice-shared/transcribe?limit_ms=4000']);
    assert.ok(seen.every((s) => s.headers.origin === undefined));
  });
});

test('the recogniser: health 503 (cannot start) is an error; a 502 on transcribe says what the server said', async () => {
  await withRoutes({
    'GET /v/health': (_r, res) => json(res, 503, { error: 'cannot start' }),
    'POST /v/transcribe': (_r, res) => json(res, 502, { error: 'engine failed' }),
  }, async (base) => {
    const stt = createLocalSpeechServerRecogniser({ url: `${base}/v` });
    await assert.rejects(() => stt.warm!(), /503/);
    await assert.rejects(() => stt.transcribe({ samples: new Float32Array(4), sampleRate: 16000 }), /engine failed/);
  });
});

test('wake: a POST to /warm with no body, at most once in the wake period, and a server without the route is no trouble', async () => {
  let now = 0;
  await withRoutes({ 'POST /api/voice-shared/warm': (_r, res) => json(res, 202, { status: 'warming' }) }, async (base, seen) => {
    const stt = createLocalSpeechServerRecogniser({ url: `${base}/api/voice-shared`, now: () => now, wakeEveryMs: 30_000 });
    await stt.wake?.();
    await stt.wake?.(); // the second key press of the same question
    now = 29_000;
    await stt.wake?.();
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url} [${s.body}]`), ['POST /api/voice-shared/warm []']);
    assert.equal(seen[0]?.headers.origin, undefined);
    now = 31_000;
    await stt.wake?.();
    assert.equal(seen.length, 2);
  });
  await withRoutes({}, async (base) => {
    const stt = createLocalSpeechServerRecogniser({ url: base });
    await stt.wake?.(); // 404: nothing to say
  });
  const gone = createLocalSpeechServerRecogniser({ url: 'http://127.0.0.1:9', timeoutMs: 500 });
  await gone.wake?.(); // nothing listening: still no throw
});

const askBody: BackendRequest = { question: 'why is this red?', screenshot: { mime: 'image/png', base64: 'AAAA', width: 4, height: 4 }, trigger: 'spoken', thread: [], scene: { steps: [], ids: {} } };

test('the backend route: a scene comes back as a scene, plain words as spoken steps, an empty turn and a slow one as messages', async () => {
  const replies: Array<[unknown, (r: { scene?: unknown; message?: string }) => void]> = [
    [{ scene: { steps: [{ say: 'It is red because it failed.', actions: [] }] } }, (r) => assert.deepEqual(r.scene, { steps: [{ say: 'It is red because it failed.', actions: [] }] })],
    [{ scene: { steps: [{ say: 'One.', actions: [] }, { say: 'Two.', actions: [] }] } }, (r) => assert.equal((r.scene as { steps: unknown[] }).steps.length, 2)],
    [{ message: 'The coordinator had no answer.' }, (r) => assert.equal(r.message, 'The coordinator had no answer.')],
    [{ message: 'The coordinator is still working on it. Ask again in a moment.' }, (r) => assert.match(r.message ?? '', /still working/)],
  ];
  for (const [body, check] of replies) {
    await withRoutes({ 'POST /api/talkthrough/ask': (_r, res) => json(res, 200, body) }, async (base, seen) => {
      const out = await createHttpBackend({ url: `${base}/api/talkthrough/ask` }).ask({ ...askBody });
      check(out);
      const sent = JSON.parse(seen[0]?.body ?? '{}') as Record<string, unknown>;
      assert.equal(sent.v, 1);
      assert.equal(sent.trigger, 'spoken');
      assert.equal(sent.question, askBody.question);
      assert.equal(seen[0]?.headers.origin, undefined);
    });
  }
});

test('the backend route: 400, 403, 502 and 503 are failures with their reason, 403 as an auth one and 5xx as unavailable', async () => {
  const cases: Array<[number, ModelError['code']]> = [[400, 'failed'], [403, 'auth'], [502, 'unavailable'], [503, 'unavailable']];
  for (const [status, code] of cases) {
    await withRoutes({ 'POST /ask': (_r, res) => json(res, status, { error: 'because' }) }, async (base) => {
      await assert.rejects(createHttpBackend({ url: `${base}/ask` }).ask({ ...askBody }), (e: unknown) => e instanceof ModelError && e.code === code && /because/.test(e.message));
    });
  }
});

test('a step that starts sounding while another was told the server is busy does not end the wait', async () => {
  let asked = 0;
  // The first request is answered at once with a busy answer; the second is slow and then speaks; later ones would sound at once.
  await withRoutes({
    'POST /api/voice-shared/speak': (req, res, body) => {
      asked++;
      if (asked === 1) return speakBusy(req, res, body);
      speakOk(req, res, body);
    },
  }, async (base) => {
    const c = chain(base, []);
    const two = c.voice.speak('Two.');
    const one = c.voice.speak('One.');
    await Promise.all([two.finished, one.finished]);
    assert.equal(asked, 2);
    await c.voice.speak('Three.').finished;
    assert.equal(asked, 2, 'the server asked for five seconds; a step that sounded meanwhile does not end that');
    assert.equal(c.spoken.at(-1), 'Three.', 'so the third step is spoken by the system voice');
    c.advance(5500);
    await c.voice.speak('Four.').finished;
    assert.equal(asked, 3);
  });
});

test('Retry-After: a fraction or a negative number is not understood', () => {
  assert.equal(parseRetryAfter('1.5'), undefined);
  assert.equal(parseRetryAfter('-5'), undefined);
  assert.equal(parseRetryAfter('+3'), undefined);
});
