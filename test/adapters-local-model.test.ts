import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalModel, isLoopbackUrl, testLocalModel, tinyPng } from '../src/adapters/local-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput } from '../src/adapters/model.ts';
import { sceneSchemaLean } from '../src/scene/index.ts';
import { startFakeLocal } from './support/fake-local-model.ts';

const request = { question: 'what is this?', screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 4, height: 4 }, thread: [], schema: sceneSchemaLean };
const scene = JSON.stringify({ steps: [{ say: 'First.', actions: [{ op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' }] }, { say: 'Second.', actions: [] }], escalate: null });

async function collect(model: Model): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const item of model.ask(request)) out.push(item);
  return out;
}

test('a question goes to the local server as a picture and a question, with no key, and its steps come back as they finish', async () => {
  const server = await startFakeLocal({ reply: scene });
  try {
    const out = await collect(createLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' }));
    assert.deepEqual(out.filter((o) => o.type === 'step').map((o) => (o as { step: { say: string } }).step.say), ['First.', 'Second.']);
    assert.deepEqual(out.at(-1), { type: 'usage', usage: { input: 1200, cached: 0, output: 80 } });
    const call = server.sent.find((s) => s.url === '/v1/chat/completions')!;
    assert.equal(call.headers.authorization, undefined, 'no key is sent to a local server');
    assert.equal(call.body?.model, 'vision-model');
    assert.equal(call.body?.response_format.type, 'json_schema');
    const user = call.body?.messages[1].content as Array<{ type: string; image_url?: { url: string } }>;
    assert.equal(user[0]?.type, 'image_url');
    assert.match(user[0]?.image_url?.url ?? '', /^data:image\/png;base64,AAAA/);
  } finally {
    await server.close();
  }
});

test('a server that cannot hold the answer to a schema is asked again, in JSON mode with the schema in the prompt', async () => {
  const server = await startFakeLocal({ reply: scene, fail: (n, body) => (body?.response_format?.type === 'json_schema' && n === 1 ? { status: 400, message: "response_format of type 'json_schema' is not supported" } : undefined) });
  try {
    const out = await collect(createLocalModel({ baseUrl: server.baseUrl, model: 'm' }));
    assert.equal(out.filter((o) => o.type === 'step').length, 2);
    const calls = server.sent.filter((s) => s.url === '/v1/chat/completions');
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.body?.response_format.type, 'json_object');
    assert.match(JSON.stringify(calls[1]?.body?.messages), /JSON Schema/);
  } finally {
    await server.close();
  }
});

test('a model that takes no pictures is named as the problem, and a server that is not there is unavailable', async () => {
  const server = await startFakeLocal({ fail: () => ({ status: 400, message: 'this model does not support image input' }) });
  try {
    await assert.rejects(collect(createLocalModel({ baseUrl: server.baseUrl, model: 'texty' })), (e: unknown) => e instanceof ModelError && /does not take pictures/.test(e.message));
  } finally {
    await server.close();
  }
  await assert.rejects(collect(createLocalModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm' })), (e: unknown) => e instanceof ModelError && e.code === 'unavailable');
});

test('only an address on this computer is a local model', () => {
  for (const ok of ['http://127.0.0.1:11434/v1', 'http://localhost:1234/v1', 'https://127.0.0.1/v1', 'http://[::1]:8080/v1']) assert.equal(isLoopbackUrl(ok), true, ok);
  for (const bad of ['http://192.168.1.5:11434/v1', 'https://api.openai.com/v1', 'ftp://127.0.0.1', 'not a url', '']) assert.equal(isLoopbackUrl(bad), false, bad);
});

test('the generated test picture is a real PNG', () => {
  const bytes = Buffer.from(tinyPng(), 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(bytes.readUInt32BE(16), 64);
});

test('test connection says what is wrong in words: no server, no such model, no pictures; and what is right', async () => {
  const good = await startFakeLocal({ models: ['gemma-vision'], reply: scene });
  try {
    const ok = await testLocalModel({ baseUrl: good.baseUrl, model: 'gemma-vision' });
    assert.equal(ok.ok, true);
    assert.match(ok.message, /accepted.*generated picture.*valid scene/);
    const sentPicture = good.sent.find((s) => s.url === '/v1/chat/completions')!.body?.messages[1].content[0].type;
    assert.equal(sentPicture, 'image_url');
    const missing = await testLocalModel({ baseUrl: good.baseUrl, model: 'nope' });
    assert.equal(missing.ok, false);
    assert.match(missing.message, /no model called nope.*gemma-vision/);
  } finally {
    await good.close();
  }
  const texty = await startFakeLocal({ fail: () => ({ status: 400, message: 'image input is not supported by this model' }) });
  try {
    const r = await testLocalModel({ baseUrl: texty.baseUrl, model: 'vision-model' });
    assert.equal(r.ok, false);
    assert.match(r.message, /does not take pictures/);
  } finally {
    await texty.close();
  }
  assert.match((await testLocalModel({ baseUrl: 'http://127.0.0.1:1/v1', model: 'x', listTimeoutMs: 800 })).message, /Could not reach a server/);
  assert.match((await testLocalModel({ baseUrl: 'https://api.openai.com/v1', model: 'x' })).message, /on this computer/);
  assert.match((await testLocalModel({ baseUrl: 'http://127.0.0.1:1/v1', model: ' ' })).message, /name of the model/);
});


test('test connection needs a usable scene, not merely an HTTP success', async () => {
  for (const reply of ['', 'ok', '<html>Welcome</html>', '{"steps":[]}', '{"steps":[{"say":42,"actions":[]}]}', '{"steps":[{"say":"","actions":[]}]}', '{"steps":[{"say":"Ready","actions":[{"op":"run","code":"anything"}]}]}']) {
    const server = await startFakeLocal({ reply });
    try {
      const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
      assert.equal(result.ok, false, `must not pass ${JSON.stringify(reply)}`);
      assert.match(result.message, /scene|answer format/);
    } finally {
      await server.close();
    }
  }
});

test('test connection uses the real streamed image and scene request, with the real JSON fallback', async () => {
  const server = await startFakeLocal({
    models: null,
    reply: '{"steps":[{"say":"Ready.","actions":[]}],"escalate":null}',
    fail: (_call, body) => body?.response_format?.type === 'json_schema' ? { status: 400, message: 'json_schema is not supported' } : undefined,
  });
  try {
    const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
    assert.equal(result.ok, true, result.message);
    const calls = server.sent.filter((s) => s.url === '/v1/chat/completions');
    assert.equal(calls.length, 2, 'the production schema fallback ran');
    assert.equal(calls[0]?.body?.response_format.type, 'json_schema');
    assert.equal(calls[1]?.body?.response_format.type, 'json_object');
    for (const call of calls) {
      assert.equal(call.body?.stream, true);
      assert.equal(call.headers.authorization, undefined);
      assert.equal(call.body?.messages.length, 2, 'only the fixed prompt and test question, no history');
      const content = call.body?.messages[1].content;
      assert.equal(content.length, 2);
      const png = Buffer.from(content[0].image_url.url.split(',')[1], 'base64');
      assert.equal(png.readUInt32BE(16), 64, 'the generated image, never a screenshot');
      assert.match(content[1].text, /test|setup/i);
      assert.equal(call.body?.tools, undefined);
    }
  } finally {
    await server.close();
  }
});

test('test connection fails when a stream stops after yielding a valid step', async () => {
  const server = await startFakeLocal({ reply: scene, unfinished: true });
  try {
    const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
    assert.equal(result.ok, false);
    assert.match(result.message, /complete|connection|stream/);
  } finally {
    await server.close();
  }
});

test('test connection does not expose raw provider errors', async () => {
  for (const status of [401, 403, 429, 500]) {
    const server = await startFakeLocal({ fail: () => ({ status, message: 'private-token-from-server' }) });
    try {
      const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
      assert.equal(result.ok, false);
      assert.doesNotMatch(result.message, /private-token-from-server/);
      assert.match(result.message, status === 401 || status === 403 ? /access|authentication/ : status === 429 ? /busy|limit/ : /server|connection/);
    } finally {
      await server.close();
    }
  }
});


test('test connection rejects an HTTP 200 landing page or an empty HTTP body', async () => {
  for (const responseBody of ['<html>Welcome to the server</html>', '']) {
    const server = await startFakeLocal({ responseBody });
    try {
      assert.equal((await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' })).ok, false);
    } finally {
      await server.close();
    }
  }
});

test('test connection stops waiting for a server that never completes its answer', async () => {
  const server = await startFakeLocal({ stall: true });
  try {
    const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model', askTimeoutMs: 30 });
    assert.equal(result.ok, false);
    assert.match(result.message, /took too long/);
  } finally {
    await server.close();
  }
});

test('test connection refuses to redirect its generated image to a different destination', async () => {
  const other = await startFakeLocal({ reply: scene });
  const server = await startFakeLocal({ redirect: `${other.baseUrl}/chat/completions` });
  try {
    assert.equal((await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' })).ok, false);
    assert.equal(other.sent.length, 0, 'the redirect destination received nothing');
  } finally {
    await server.close();
    await other.close();
  }
});

test('test connection rejects a hosted destination before making any request', async () => {
  let requests = 0;
  const result = await testLocalModel({ baseUrl: 'https://provider.example/v1', model: 'm', fetch: async () => { requests++; throw new Error('must not run'); } });
  assert.equal(result.ok, false);
  assert.equal(requests, 0);
});

for (const [label, reply] of [
  ['a primitive mixed with a valid step', '{"steps":[{"say":"Ready","actions":[]},42],"escalate":null}'],
  ['an unsupported scene version', '{"v":2,"steps":[{"say":"Ready","actions":[]}],"escalate":null}'],
  ['a partial JSON document after a valid step', '{"steps":[{"say":"Ready","actions":[]}],"escalate":'],
  ['invalid root JSON after a valid step', '{"steps":[{"say":"Ready","actions":[]}],"extra":unquoted}'],
  ['an invalid escalation field', '{"steps":[{"say":"Ready","actions":[]}],"escalate":42}'],
  ['an oversized response whose captured prefix could look valid', '{"steps":[{"say":"Ready","actions":[]}],"escalate":null}' + ' '.repeat(200_000) + 'invalid'],
]) {
  test(`test connection rejects ${label}`, async () => {
    const server = await startFakeLocal({ reply });
    try {
      const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
      assert.equal(result.ok, false);
      assert.match(result.message, /scene|answer format/);
    } finally {
      await server.close();
    }
  });
}


test('test connection fails on a streamed provider error after a usable step without exposing it', async () => {
  const server = await startFakeLocal({ reply: scene, eventError: 'private-server-error' });
  try {
    const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /private-server-error/);
  } finally {
    await server.close();
  }
});

test('test connection fails when the provider reports a token limit after a usable step', async () => {
  const server = await startFakeLocal({ reply: scene, finishReason: 'length' });
  try {
    const result = await testLocalModel({ baseUrl: server.baseUrl, model: 'vision-model' });
    assert.equal(result.ok, false);
    assert.match(result.message, /incomplete|scene/);
  } finally {
    await server.close();
  }
});

test('test connection uses the configured default when the local address field is empty', async () => {
  const server = await startFakeLocal({ reply: scene });
  const urls: string[] = [];
  try {
    const result = await testLocalModel({
      baseUrl: ' ', model: 'vision-model',
      fetch: async (url, init) => {
        const target = String(url);
        urls.push(target);
        assert.match(target, /^http:\/\/127\.0\.0\.1:11434\/v1\//);
        return fetch(`${server.baseUrl}${new URL(target).pathname.slice('/v1'.length)}`, init);
      },
    });
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(urls, ['http://127.0.0.1:11434/v1/models', 'http://127.0.0.1:11434/v1/chat/completions']);
  } finally {
    await server.close();
  }
});

for (const reason of ['content_filter','tool_calls','function_call','unknown-private-marker']) {
  test(`local completion rejects non-success finish reason ${reason}`, async () => {
    const server = await startFakeLocal({reply:scene,finishReason:reason});
    try {
      const result=await testLocalModel({baseUrl:server.baseUrl,model:'vision-model'});
      assert.equal(result.ok,false);assert.doesNotMatch(result.message,/unknown-private-marker|content_filter|tool_calls/);
      await assert.rejects(collect(createLocalModel({baseUrl:server.baseUrl,model:'vision-model'})),(e:unknown)=>e instanceof ModelError && e.code==='bad-output' && !e.message.includes(reason));
    } finally { await server.close(); }
  });
}
for (const doneOnly of [false,true]) {
  test(`local completion accepts ${doneOnly?'DONE-only':'normal stop'}`, async () => {
    const server=await startFakeLocal({reply:scene,doneOnly});
    try {const result=await testLocalModel({baseUrl:server.baseUrl,model:'vision-model'});assert.equal(result.ok,true,result.message);assert.equal((await collect(createLocalModel({baseUrl:server.baseUrl,model:'vision-model'}))).filter(o=>o.type==='step').length,2);}
    finally {await server.close();}
  });
}
