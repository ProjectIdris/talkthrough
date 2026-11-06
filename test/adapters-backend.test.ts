import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { backendBody, cleanBackendText, createHttpBackend } from '../src/adapters/backend.ts';
import type { BackendRequest } from '../src/adapters/backend.ts';
import { ModelError } from '../src/adapters/model.ts';

const request: BackendRequest = {
  question: 'why does this fail?',
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 4, height: 4 },
  thread: [{ question: 'what is this?', steps: [{ say: 'A form.', actions: [] }, { say: 'With a button.', actions: [] }] }],
  scene: { steps: [{ say: 'A form.', actions: [{ op: 'box', id: 'form', x: 1, y: 2, w: 3, h: 4, color: 'red' }] }], ids: { form: 'mark' } },
  reason: 'needs a deeper read',
  trigger: 'offer',
};

type Seen = { method?: string; headers: IncomingMessage['headers']; body: Record<string, unknown> | null };

async function withServer<T>(handler: (res: ServerResponse) => void, run: (url: string, seen: Seen[]) => Promise<T>): Promise<T> {
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
      seen.push({ method: req.method, headers: req.headers, body });
      handler(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ask`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

async function failure(url: string, req: BackendRequest = request, options: { timeoutMs?: number } = {}): Promise<ModelError> {
  try {
    await createHttpBackend({ url, ...options }).ask(req);
  } catch (error) {
    assert.ok(error instanceof ModelError, String(error));
    return error;
  }
  assert.fail('expected the request to fail');
}

test('the request is JSON with the question, the picture, what was said so far and the scene on screen; nothing else rides along', async () => {
  await withServer((res) => json(res, 200, { scene: { steps: [] } }), async (url, seen) => {
    await createHttpBackend({ url }).ask(request);
    const [r] = seen;
    assert.equal(r?.method, 'POST');
    assert.equal(r?.headers['content-type'], 'application/json');
    assert.equal(r?.headers.authorization, undefined);
    const body = r?.body as Record<string, any>;
    assert.equal(body.v, 1);
    assert.equal(body.trigger, 'offer');
    assert.equal(body.reason, 'needs a deeper read');
    assert.equal(body.question, 'why does this fail?');
    assert.deepEqual(body.screenshot, { mime: 'image/png', width: 4, height: 4, base64: 'AAAA' });
    assert.deepEqual(body.thread, [{ question: 'what is this?', said: ['A form.', 'With a button.'] }]);
    assert.deepEqual(body.scene.ids, { form: 'mark' });
    assert.equal(body.scene.steps.length, 1);
    assert.deepEqual(Object.keys(body).sort(), ['question', 'reason', 'scene', 'screenshot', 'thread', 'trigger', 'v']);
  });
  const { reason: _reason, ...withoutReason } = request;
  assert.equal('reason' in backendBody(withoutReason), false);
});

test('a scene comes back raw (the app validates it), a message comes back alone, and the text is cleaned', async () => {
  await withServer((res) => json(res, 200, { scene: { steps: [{ say: 'Here.', actions: [] }], escalate: null } }), async (url) => {
    const reply = await createHttpBackend({ url }).ask(request);
    assert.deepEqual(reply, { scene: { steps: [{ say: 'Here.', actions: [] }], escalate: null } });
  });
  await withServer((res) => json(res, 200, { message: 'Still\u0007 working\n\non it  ' }), async (url) => {
    assert.deepEqual(await createHttpBackend({ url }).ask(request), { message: 'Still working on it' });
  });
  assert.equal(cleanBackendText('x'.repeat(1000)).length, 300);
});

test('HTTP errors are sorted by status, with the other end\'s own words kept short and clean', async () => {
  for (const [status, code] of [[401, 'auth'], [403, 'auth'], [429, 'rate-limited'], [503, 'unavailable'], [400, 'failed']] as const) {
    await withServer((res) => json(res, status, { error: `no\u0000pe ${'x'.repeat(500)}` }), async (url) => {
      const error = await failure(url);
      assert.equal(error.code, code, String(status));
      assert.ok(error.message.length < 400);
      assert.ok(!error.message.includes('\u0000'));
    });
  }
});

test('garbled answers, answers with nothing in them, an error field, a redirect and an unreachable address are errors', async () => {
  await withServer((res) => json(res, 200, 'not json'), async (url) => assert.equal((await failure(url)).code, 'bad-output'));
  await withServer((res) => json(res, 200, { hello: 1 }), async (url) => assert.equal((await failure(url)).code, 'bad-output'));
  await withServer((res) => json(res, 200, [1, 2]), async (url) => assert.equal((await failure(url)).code, 'bad-output'));
  await withServer((res) => json(res, 200, { error: 'the agent is down' }), async (url) => {
    const e = await failure(url);
    assert.equal(e.code, 'failed');
    assert.equal(e.message, 'the agent is down');
  });
  await withServer((res) => {
    res.writeHead(307, { Location: 'http://127.0.0.1:1/elsewhere' });
    res.end();
  }, async (url) => assert.equal((await failure(url)).code, 'unavailable'));
  assert.equal((await failure('http://127.0.0.1:1/ask')).code, 'unavailable');
});

test('an abort and a timeout end a silent server at once', async () => {
  await withServer(() => undefined, async (url) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 120);
    const started = Date.now();
    assert.equal((await failure(url, { ...request, signal: controller.signal })).code, 'aborted');
    assert.ok(Date.now() - started < 2000);
    const t = Date.now();
    assert.equal((await failure(url, request, { timeoutMs: 250 })).code, 'failed');
    assert.ok(Date.now() - t < 2000);
  });
});

test('a reply over the size limit is refused', async () => {
  await withServer((res) => json(res, 200, { message: 'x'.repeat(5 * 1024 * 1024) }), async (url) => {
    assert.equal((await failure(url)).code, 'bad-output');
  });
});


test('backend history preserves incompleteness without forwarding internal failure details', () => {
  const body = backendBody({ ...request, thread: [{ question: 'Earlier question', steps: [{ say: 'First part.', actions: [] }], incomplete: true }] });
  assert.deepEqual(body.thread, [{ question: 'Earlier question', said: ['First part.'], incomplete: true }]);
});
