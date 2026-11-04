import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLocalSpeechServerRecogniser, SpeechToTextError, toRate16k } from '../src/adapters/index.ts';

async function withServer(handler: (req: IncomingMessage, res: ServerResponse, body: Buffer) => void, run: (url: string) => Promise<void>) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => handler(req, res, Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const reply = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

test('posts raw 16 kHz float32 to /transcribe and returns the text', async () => {
  let seen: { path?: string; bytes?: number; first?: number } = {};
  await withServer((req, res, body) => {
    seen = { path: req.url, bytes: body.length, first: body.readFloatLE(0) };
    reply(res, 200, { text: ' what is this ', engine: 'x', seconds: 0.4 });
  }, async (url) => {
    const stt = createLocalSpeechServerRecogniser({ url: `${url}/`, limitMs: 2500 });
    const result = await stt.transcribe({ samples: new Float32Array([0.5, 0.25, 0, 0]), sampleRate: 16000 });
    assert.deepEqual(result, { text: 'what is this', engine: 'x', seconds: 0.4 });
  });
  assert.deepEqual(seen, { path: '/transcribe?limit_ms=2500', bytes: 16, first: 0.5 });
});

test('a clip at another rate is resampled to 16 kHz first', () => {
  const out = toRate16k({ samples: new Float32Array(48000).fill(0.1), sampleRate: 48000 });
  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[100]! - 0.1) < 1e-6);
});

test('server errors, empty text and an unreachable server map to typed errors', async () => {
  const clip = { samples: new Float32Array(160), sampleRate: 16000 };
  await withServer((_req, res) => reply(res, 500, { error: 'model crashed' }), async (url) => {
    await assert.rejects(createLocalSpeechServerRecogniser({ url }).transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'failed' && /model crashed/.test(e.message));
  });
  await withServer((_req, res) => reply(res, 200, { text: '  ' }), async (url) => {
    await assert.rejects(createLocalSpeechServerRecogniser({ url }).transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'empty');
  });
  await assert.rejects(
    createLocalSpeechServerRecogniser({ url: 'http://127.0.0.1:1', timeoutMs: 2000 }).transcribe(clip),
    (e: unknown) => e instanceof SpeechToTextError && e.code === 'unavailable',
  );
});

test('an aborted call is reported as aborted, and a url is required', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    createLocalSpeechServerRecogniser({ url: 'http://127.0.0.1:1' }).transcribe({ samples: new Float32Array(160), sampleRate: 16000 }, { signal: controller.signal }),
    (e: unknown) => e instanceof SpeechToTextError && e.code === 'aborted',
  );
  assert.throws(() => createLocalSpeechServerRecogniser({ url: '' }), /needs a url/);
});
