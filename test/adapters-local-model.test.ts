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
  const good = await startFakeLocal({ models: ['gemma-vision'] });
  try {
    const ok = await testLocalModel({ baseUrl: good.baseUrl, model: 'gemma-vision' });
    assert.equal(ok.ok, true);
    assert.match(ok.message, /took a picture/);
    const sentPicture = good.sent.find((s) => s.url === '/v1/chat/completions')!.body?.messages[0].content[0].type;
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
