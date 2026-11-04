import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { claudeArgs, createClaudeModel, initProblem } from '../src/adapters/claude-model.ts';
import { codexLockdownArgs, createCodexModel } from '../src/adapters/codex-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput } from '../src/adapters/model.ts';
import { sceneSchema, sceneSchemaLean } from '../src/scene/index.ts';

const fakeCodex = fileURLToPath(new URL('./support/fake-codex.mjs', import.meta.url));
const fakeClaude = fileURLToPath(new URL('./support/fake-claude.mjs', import.meta.url));
const request = {
  question: 'what is this?',
  screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 4, height: 4 },
  thread: [],
  schema: sceneSchema,
};

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

test('codex: steps arrive one by one, an escalation follows, and Fast is on this process only', async () => {
  process.env.FAKE_MODE = 'ok';
  process.env.FAKE_ESCALATE = 'needs a deeper look';
  const lines: string[] = [];
  const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex], fast: true, log: (l) => lines.push(l) });
  try {
    const out = await collect(model);
    assert.equal(out.filter((o) => o.type === 'step').length, 2);
    assert.deepEqual(out.at(-1), { type: 'escalate', reason: 'needs a deeper look' });
    assert.equal(model.serviceTier, 'priority');
    assert.ok(lines.some((l) => l.includes('priority')));
    // the same process answers a second question
    assert.equal((await collect(model)).filter((o) => o.type === 'step').length, 2);
  } finally {
    delete process.env.FAKE_ESCALATE;
    await model.close?.();
  }
});

test('codex: the lock-down flags are the ones the note says, and Fast is added only when asked', () => {
  const plain = codexLockdownArgs(false).join(' ');
  assert.match(plain, /--disable shell_tool/);
  assert.match(plain, /web_search="disabled"/);
  assert.doesNotMatch(plain, /service_tier/);
  assert.match(codexLockdownArgs(true).join(' '), /service_tier="fast"/);
});

test('codex: a tool item in the event stream ends the question as refused', async () => {
  process.env.FAKE_MODE = 'tool';
  const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex], timeoutMs: 5000 });
  try {
    assert.equal((await failure(model)).code, 'refused');
  } finally {
    process.env.FAKE_MODE = 'ok';
    await model.close?.();
  }
});

test('codex: a request for approval is refused and ends the question', async () => {
  process.env.FAKE_MODE = 'approval';
  const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex], timeoutMs: 5000 });
  try {
    assert.equal((await failure(model)).code, 'refused');
  } finally {
    process.env.FAKE_MODE = 'ok';
    await model.close?.();
  }
});

test('codex: a missing command is unavailable, and an abort stops the stream', async () => {
  const missing = createCodexModel({ command: 'definitely-not-a-real-command-xyz' });
  assert.equal((await failure(missing)).code, 'unavailable');
  await missing.close?.();
  process.env.FAKE_MODE = 'ok';
  const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex] });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(collect(model, controller.signal), (e: unknown) => e instanceof ModelError && e.code === 'aborted');
  } finally {
    await model.close?.();
  }
});

test('claude: steps arrive one by one from the structured-output stream', async () => {
  process.env.FAKE_MODE = 'ok';
  process.env.FAKE_ESCALATE = 'too deep';
  const model = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude] });
  try {
    await model.warm?.();
    const out = await collect(model);
    assert.equal(out.filter((o) => o.type === 'step').length, 2);
    assert.deepEqual(out.at(-1), { type: 'escalate', reason: 'too deep' });
    // a second question gets a fresh process
    assert.equal((await collect(model)).filter((o) => o.type === 'step').length, 2);
  } finally {
    delete process.env.FAKE_ESCALATE;
    await model.close?.();
  }
});

test('claude: an init message that lists any tool but the structured-output channel is refused', async () => {
  assert.equal(initProblem({ tools: ['StructuredOutput'], mcp_servers: [], slash_commands: [] }), null);
  assert.match(initProblem({ tools: ['StructuredOutput', 'Bash'] }) ?? '', /Bash/);
  assert.match(initProblem({ tools: [], mcp_servers: [{ name: 'x' }] }) ?? '', /MCP/);
  process.env.FAKE_MODE = 'tools';
  const model = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude], timeoutMs: 5000 });
  try {
    assert.equal((await failure(model)).code, 'refused');
  } finally {
    process.env.FAKE_MODE = 'ok';
    await model.close?.();
  }
});

test('claude: a tool call from the model is refused', async () => {
  process.env.FAKE_MODE = 'tooluse';
  const model = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude], timeoutMs: 5000 });
  try {
    assert.equal((await failure(model)).code, 'refused');
  } finally {
    process.env.FAKE_MODE = 'ok';
    await model.close?.();
  }
});

test('closing a model ends its process and removes its working folder', async () => {
  const folders = () => readdirSync(tmpdir()).filter((f) => f.startsWith('talkthrough-model-'));
  const before = folders().length;
  process.env.FAKE_MODE = 'ok';
  const codex = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex] });
  await collect(codex);
  const claude = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude] });
  await claude.warm?.();
  assert.equal(folders().length, before + 2);
  await codex.close?.();
  await claude.close?.();
  assert.equal(folders().length, before);
});

test('codex: a process that is alive but silent cannot hang a question (timeout, abort, then a fresh process works)', async () => {
  for (const mode of ['silent-turn', 'silent-init']) {
    process.env.FAKE_MODE = mode;
    const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex], timeoutMs: 1200 });
    try {
      const started = Date.now();
      assert.equal((await failure(model)).code, 'failed');
      assert.ok(Date.now() - started < 4000, `${mode}: the timeout did not end the wait`);
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 150);
      const slow = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex], timeoutMs: 10_000 });
      const t = Date.now();
      await assert.rejects(collect(slow, controller.signal), (e: unknown) => e instanceof ModelError && e.code === 'aborted');
      assert.ok(Date.now() - t < 3000, `${mode}: the abort did not end the wait`);
      await slow.close?.();
      // the stuck process was dropped: the next question starts a new one
      process.env.FAKE_MODE = 'ok';
      assert.equal((await collect(model)).filter((o) => o.type === 'step').length, 2);
    } finally {
      process.env.FAKE_MODE = 'ok';
      await model.close?.();
    }
  }
});

test('claude: the default command line stays well under the Windows limit and carries no prompt text', () => {
  const args = claudeArgs('claude-haiku-5-5', 'low', sceneSchemaLean, 'C:/x/instructions.txt');
  const length = args.join(' ').length;
  assert.ok(length < 30_000, `command line is ${length} characters`);
  assert.ok(!args.join(' ').includes('You are Talkthrough'));
});

test('codex: tool servers in your own Codex setup are switched off by name, and a server that stays on refuses the question', async () => {
  process.env.FAKE_MODE = 'ok';
  process.env.FAKE_MCP = 'repl,odd-name';
  try {
    const model = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex] });
    try {
      // the fake reports a server as enabled unless this process was started with its switch-off argument
      assert.equal((await collect(model)).filter((o) => o.type === 'step').length, 2);
    } finally {
      await model.close?.();
    }
    process.env.FAKE_MCP_STUBBORN = '1';
    const stubborn = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex] });
    try {
      const error = await failure(stubborn);
      assert.equal(error.code, 'refused');
      assert.match(error.message, /repl/);
    } finally {
      await stubborn.close?.();
    }
  } finally {
    delete process.env.FAKE_MCP;
    delete process.env.FAKE_MCP_STUBBORN;
  }
});

test('the token usage the provider reports comes out last, with cached and written tokens kept apart', async () => {
  process.env.FAKE_MODE = 'ok';
  process.env.FAKE_USAGE = '1';
  const codex = createCodexModel({ command: process.execPath, prefixArgs: [fakeCodex] });
  const claude = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude] });
  try {
    assert.deepEqual((await collect(codex)).at(-1), { type: 'usage', usage: { input: 16000, cached: 15000, output: 90 } });
    assert.deepEqual((await collect(claude)).at(-1), { type: 'usage', usage: { input: 9312, cached: 9000, cacheWrite: 300, output: 80 } });
  } finally {
    delete process.env.FAKE_USAGE;
    await codex.close?.();
    await claude.close?.();
  }
});
