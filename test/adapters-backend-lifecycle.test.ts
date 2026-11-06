import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHttpBackend } from '../src/adapters/backend.ts';
import type { BackendRequest } from '../src/adapters/backend.ts';
import { ModelError } from '../src/adapters/model.ts';

const request: BackendRequest = { question: 'Synthetic fixture', screenshot: { mime: 'image/png', base64: 'AAAA', width: 1, height: 1 }, thread: [], scene: { steps: [], ids: {} }, trigger: 'spoken' };
const LIMIT = 4 * 1024 * 1024;
const encode = (text: string) => new TextEncoder().encode(text);
const fetchBody = (body: ReadableStream<Uint8Array> | null): typeof fetch => async () => new Response(body);
const outcome = async (promise: Promise<unknown>): Promise<unknown> => promise.catch(error => error);

/** Watchdog only: the backend's own deadline/cancellation must settle first. Always release it on failure. */
async function within(promise: Promise<unknown>, release: () => void, ms = 150): Promise<unknown> {
  const expired = Symbol('watchdog');
  let timer: NodeJS.Timeout | undefined;
  const result = await Promise.race([promise, new Promise<symbol>(resolve => { timer = setTimeout(resolve, ms, expired); })]);
  clearTimeout(timer);
  if (result === expired) { release(); await promise; assert.fail('backend did not settle before the watchdog'); }
  return result;
}

function expectCode(value: unknown, code: string): asserts value is ModelError {
  assert.ok(value instanceof ModelError, String(value));
  assert.equal(value.code, code);
}

test('a reply is refused and cancelled at the byte limit without waiting for EOF', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; controller.enqueue(new Uint8Array(LIMIT)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled++; },
  });
  const result = await within(outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(body) }).ask(request)), () => source.close());
  expectCode(result, 'bad-output');
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('a user abort during a silent body settles and cancels reading without requiring fetch to implement abort', async () => {
  const controller = new AbortController();
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(c) { source = c; c.enqueue(encode('{')); }, cancel() { cancelled++; } });
  const pending = outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(body) }).ask({ ...request, signal: controller.signal }));
  setTimeout(() => controller.abort(), 10);
  const result = await within(pending, () => source.close());
  expectCode(result, 'aborted');
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('a timeout during the body has the same failed/deadline classification as a timeout before headers', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await outcome(createHttpBackend({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`, timeoutMs: 60 }).ask(request));
    expectCode(result, 'failed');
    assert.match(result.message, /no answer within/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('late success after caller abort is refused even when the supplied fetch ignores its signal', async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encode('{"message":"Late"}')); c.close(); }, cancel() { cancelled++; } });
  const fetch: typeof globalThis.fetch = async () => { controller.abort(); return new Response(body); };
  const result = await outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch }).ask({ ...request, signal: controller.signal }));
  expectCode(result, 'aborted');
  assert.equal(cancelled, 1);
});

test('cancellation cleanup does not hold an over-limit failure open', async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(c) { source = c; c.enqueue(new Uint8Array(LIMIT + 1)); },
    cancel() { cancelled++; return new Promise<void>(() => undefined); },
  });
  const result = await within(outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(body) }).ask(request)), () => source.close());
  expectCode(result, 'bad-output');
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('a valid exact-limit reply and split UTF-8 are accepted without changing v1 output', async () => {
  const text = JSON.stringify({ message: 'ok', ignored: '' });
  const exact = text.replace('"ignored":""', `"ignored":"${'x'.repeat(LIMIT - encode(text).length)}"`);
  assert.equal(encode(exact).length, LIMIT);
  const bytes = encode(exact);
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.subarray(0, 65535)); c.enqueue(bytes.subarray(65535)); c.close(); } });
  assert.deepEqual(await createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(body) }).ask(request), { message: 'ok' });
  const utf8 = encode('{"message":"héllo 🌍"}');
  const split = new ReadableStream<Uint8Array>({ start(c) { for (const byte of utf8) c.enqueue(new Uint8Array([byte])); c.close(); } });
  assert.deepEqual(await createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(split) }).ask(request), { message: 'héllo 🌍' });
  assert.equal(body.locked, false);
  assert.equal(split.locked, false);
});

test('a broken body remains unavailable and a missing body remains bad output', async () => {
  const broken = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('synthetic disconnect')); } });
  expectCode(await outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(broken) }).ask(request)), 'unavailable');
  expectCode(await outcome(createHttpBackend({ url: 'http://127.0.0.1/synthetic', fetch: fetchBody(null) }).ask(request)), 'bad-output');
  assert.equal(broken.locked, false);
});

test('a real loopback backend that streams beyond the limit is disconnected before it ends its reply', async () => {
  let closed!: () => void;
  const didClose = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_req, res) => {
    res.on('close', closed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const bytes = Buffer.alloc(64 * 1024, 120);
    for (let i = 0; i < 65; i++) res.write(bytes);
    // No res.end(): the reader must enforce its byte limit, not wait for EOF or the deadline.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await outcome(createHttpBackend({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`, timeoutMs: 2000 }).ask(request));
    expectCode(result, 'bad-output');
    await within(didClose, () => server.closeAllConnections(), 1000);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
