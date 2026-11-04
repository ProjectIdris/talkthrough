import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createOpenAIModel, NO_KEY_MESSAGE, redactKeys } from '../src/adapters/openai-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput } from '../src/adapters/model.ts';
import { sceneSchemaLean } from '../src/scene/index.ts';

const KEY = 'sk-test-0123456789abcdef';
const request = {
  question: 'what is this?',
  screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 4, height: 4 },
  thread: [],
  schema: sceneSchemaLean,
};

const scene = JSON.stringify({
  steps: [
    { say: 'First.', actions: [{ op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' }] },
    { say: 'Second.', actions: [] },
  ],
  escalate: 'needs research',
});

const sse = (type: string, extra: object = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`;

type Seen = { headers: IncomingMessage['headers']; body: Record<string, unknown> | null; url: string | undefined };

/** A stand-in for the API: records what it was sent and answers as the test says. */
async function withServer<T>(handler: (req: Seen, res: ServerResponse) => void, run: (baseUrl: string, seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const record: Seen = { headers: req.headers, body, url: req.url };
      seen.push(record);
      handler(record, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function collect(model: Model, signal?: AbortSignal): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const item of model.ask({ ...request, ...(signal ? { signal } : {}) })) out.push(item);
  return out;
}

async function failure(model: Model): Promise<ModelError> {
  try {
    await collect(model);
  } catch (error) {
    assert.ok(error instanceof ModelError, String(error));
    return error;
  }
  assert.fail('expected the question to fail');
}

test('steps stream in as they complete, split anywhere in the event stream, then the escalation', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const events = sse('response.created') + [...scene.matchAll(/.{1,23}/g)].map((m) => sse('response.output_text.delta', { delta: m[0] })).join('') + sse('response.completed');
    // cut the stream at arbitrary byte positions, including inside an event
    for (let i = 0; i < events.length; i += 37) res.write(events.slice(i, i + 37));
    res.end();
  }, async (baseUrl) => {
    const out = await collect(createOpenAIModel({ apiKey: () => KEY, baseUrl }));
    assert.equal(out.filter((o) => o.type === 'step').length, 2);
    assert.deepEqual(out.at(-1), { type: 'escalate', reason: 'needs research' });
  });
});

test('the request is strict structured output on the given schema, streamed, not stored, with the key only in the header', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse('response.output_text.delta', { delta: '{"steps":[],"escalate":null}' }) + sse('response.completed', { response: { usage: { input_tokens: 7000, output_tokens: 60, input_tokens_details: { cached_tokens: 6500 } } } }));
  }, async (baseUrl, seen) => {
    const got = await collect(createOpenAIModel({ apiKey: () => KEY, baseUrl }));
    assert.deepEqual(got.at(-1), { type: 'usage', usage: { input: 7000, cached: 6500, output: 60 } });
    await collect(createOpenAIModel({ apiKey: () => KEY, baseUrl, model: 'gpt-6-luna', serviceTier: 'fast' }));
    const r = seen[1];
    assert.equal(r?.url, '/v1/responses');
    assert.equal(r?.headers.authorization, `Bearer ${KEY}`);
    const body = r?.body as Record<string, any>;
    assert.equal(body.stream, true);
    assert.equal(body.store, false);
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.service_tier, 'fast');
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, sceneSchemaLean);
    assert.equal(body.tools, undefined);
    assert.ok(String(body.input[0].content[0].image_url).startsWith('data:image/png;base64,'));
    assert.ok(!JSON.stringify(body).includes(KEY), 'the key must not be in the body');
  });
});

test('no key is an auth error and no request is made', async () => {
  await withServer((_req, res) => res.end(), async (baseUrl, seen) => {
    const error = await failure(createOpenAIModel({ apiKey: () => undefined, baseUrl }));
    assert.equal(error.code, 'auth');
    assert.equal(seen.length, 0);
  });
});

test('HTTP errors are sorted, and a key echoed back by the server never reaches the message', async () => {
  for (const [status, code] of [[401, 'auth'], [429, 'rate-limited'], [500, 'unavailable'], [400, 'failed']] as const) {
    await withServer((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}. Also sk-live-ABCDEFGH1234.` } }));
    }, async (baseUrl) => {
      const error = await failure(createOpenAIModel({ apiKey: () => KEY, baseUrl }));
      assert.equal(error.code, code);
      assert.ok(!error.message.includes(KEY), error.message);
      assert.ok(!error.message.includes('sk-live'), error.message);
    });
  }
  assert.equal(redactKeys(`a ${KEY} b sk-abcdefghij`, KEY), 'a [key] b [key]');
});

test('a refusal, a failed response and a cut-off answer are errors', async () => {
  const cases: Array<[string, string]> = [
    [sse('response.refusal.delta', { delta: 'no' }), 'refused'],
    [sse('response.failed', { response: { error: { message: 'boom' } } }), 'failed'],
    [sse('response.output_text.delta', { delta: '{"steps":[' }) + sse('response.incomplete', { response: { incomplete_details: { reason: 'max_output_tokens' } } }), 'bad-output'],
    [sse('response.output_text.delta', { delta: '{"steps":[' }), 'unavailable'],
    [sse('response.output_text.delta', { delta: '{"steps":[' }) + sse('response.completed'), 'bad-output'],
  ];
  for (const [events, code] of cases) {
    await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(events);
    }, async (baseUrl) => {
      assert.equal((await failure(createOpenAIModel({ apiKey: () => KEY, baseUrl }))).code, code, events.slice(0, 60));
    });
  }
});

test('an abort and a timeout end a silent server at once; an unreachable address is unavailable', async () => {
  await withServer(() => undefined, async (baseUrl) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const started = Date.now();
    await assert.rejects(collect(createOpenAIModel({ apiKey: () => KEY, baseUrl }), controller.signal), (e: unknown) => e instanceof ModelError && e.code === 'aborted');
    assert.ok(Date.now() - started < 2000);
    const t = Date.now();
    assert.equal((await failure(createOpenAIModel({ apiKey: () => KEY, baseUrl, timeoutMs: 300 }))).code, 'failed');
    assert.ok(Date.now() - t < 2000);
  });
  assert.equal((await failure(createOpenAIModel({ apiKey: () => KEY, baseUrl: 'http://127.0.0.1:1/v1' }))).code, 'unavailable');
});

test('a redirect is an error (the key never follows it), and a missing key has its own exact message', async () => {
  await withServer((_req, res) => {
    res.writeHead(307, { Location: 'http://127.0.0.1:1/elsewhere' });
    res.end();
  }, async (baseUrl) => {
    assert.equal((await failure(createOpenAIModel({ apiKey: () => KEY, baseUrl }))).code, 'unavailable');
  });
  const missing = await failure(createOpenAIModel({ apiKey: () => undefined }));
  assert.equal(missing.message, NO_KEY_MESSAGE);
});

test('a circled area adds a second, closer picture and says what it is; without one there is a single picture', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sse('response.output_text.delta', { delta: '{"steps":[],"escalate":null}' }) + sse('response.completed'));
  }, async (baseUrl, seen) => {
    const model = createOpenAIModel({ apiKey: () => KEY, baseUrl });
    const focus = [{ crop: { mime: 'image/png' as const, base64: 'CROPPED', width: 40, height: 30 }, box: { x: 100, y: 200, w: 300, h: 150 } }];
    for await (const _ of model.ask({ ...request, focus })) void _;
    for await (const _ of model.ask(request)) void _;
    const content = (i: number) => ((seen[i]?.body as Record<string, any>).input[0].content as Array<Record<string, string>>);
    const withPen = content(0);
    assert.equal(withPen.filter((c) => c.type === 'input_image').length, 2);
    assert.ok(withPen[1]?.image_url?.endsWith('CROPPED'));
    const text = withPen.find((c) => c.type === 'input_text')?.text ?? '';
    assert.ok(text.includes('red pen circle') && text.includes('x 100 to 400') && text.includes('y 200 to 350'), text);
    assert.equal(content(1).filter((c) => c.type === 'input_image').length, 1);
    assert.ok(!(content(1).find((c) => c.type === 'input_text')?.text ?? '').includes('red pen'));
  });
});

test('with pieces asked for, each say and action comes before its step; without, only the steps (as before)', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end([...scene.matchAll(/.{1,11}/g)].map((m) => sse('response.output_text.delta', { delta: m[0] })).join('') + sse('response.completed'));
  }, async (baseUrl) => {
    const model = createOpenAIModel({ apiKey: () => KEY, baseUrl });
    const plain: ModelOutput[] = [];
    for await (const o of model.ask(request)) plain.push(o);
    assert.deepEqual(plain.map((o) => o.type), ['step', 'step', 'escalate']);
    const out: ModelOutput[] = [];
    for await (const o of model.ask({ ...request, pieces: true })) out.push(o);
    assert.deepEqual(out.map((o) => o.type), ['say', 'action', 'step', 'say', 'step', 'escalate']);
    assert.equal((out[0] as { say: string }).say, 'First.');
    assert.deepEqual((out[1] as { action: unknown }).action, { op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' });
    assert.deepEqual((out[2] as { step: unknown }).step, (plain[0] as { step: unknown }).step);
  });
});
