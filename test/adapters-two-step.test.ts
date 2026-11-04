import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClaudeModel } from '../src/adapters/claude-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import { createTwoStepModel } from '../src/adapters/two-step.ts';
import { sceneSchemaLean } from '../src/scene/index.ts';

const fakeClaude = fileURLToPath(new URL('./support/fake-claude.mjs', import.meta.url));
const request: ModelRequest = {
  question: 'what is this?',
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 4, height: 4 },
  thread: [],
  schema: sceneSchemaLean,
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const says = (out: ModelOutput[]) => out.flatMap((o) => (o.type === 'step' ? [String((o.step as { say: string }).say)] : []));

async function collect(model: Model, extra: Partial<ModelRequest> = {}): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const item of model.ask({ ...request, ...extra })) out.push(item);
  return out;
}

function onFake(env: Record<string, string>, log: (m: string) => void = () => undefined) {
  Object.assign(process.env, env);
  const inner = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude] });
  return { model: createTwoStepModel(inner, { log }), done: async () => { for (const k of Object.keys(env)) delete process.env[k]; await inner.close?.(); } };
}

test('what each half is told: the first asks for step 1 alone (about 30 words), the second is given step 1 and asks for the rest', () => {
  const first = questionText({ ...request, stage: { part: 'first' } });
  assert.match(first, /Write only step 1 now/);
  assert.match(first, /about 30 words/);
  assert.match(first, /the checklist is drawn in step 2/);
  const rest = questionText({ ...request, stage: { part: 'rest', first: { say: 'Hello.', actions: [] } } });
  assert.match(rest, /Step 1 of this answer is already drawn and spoken: \{"say":"Hello\.","actions":\[\]\}/);
  assert.match(rest, /from step 2 onward/);
  assert.match(rest, /Otherwise write at most three more steps, each about 30 words/);
  assert.match(rest, /If step 1 asks for a click, this is a how-do-I walk: .*one move each, in one short sentence with its own mark and wait, as many as the task needs \(up to five more steps, six in all\)/);
  assert.match(rest, /every move has its own mark and wait, even where an earlier move's mark was/);
  assert.match(rest, /when in doubt draw none, except that when the parts or places of a picture are the point of the question/);
  assert.match(rest, /a point well inside each part and a label of one to three words beside it, inside the frame of the picture so it never covers its caption/);
  assert.match(rest, /never over its text or its settings and controls/);
  assert.ok(!/Write only step 1/.test(rest) && !/Step 1 of this answer/.test(questionText(request)), 'a plain question carries neither');
});

test('on the claude command: step 1 first, then the steps after it, one answer, with both calls\' figures added up', async () => {
  const t = onFake({ FAKE_SPLIT: '1', FAKE_USAGE: '1' });
  try {
    const out = await collect(t.model);
    assert.deepEqual(says(out), ['First.', 'Third.', 'Fourth.']);
    assert.equal(out.filter((o) => o.type === 'usage').length, 1);
    assert.deepEqual(out.at(-1), { type: 'usage', usage: { input: 2 * 9312, cached: 2 * 9000, cacheWrite: 2 * 300, output: 2 * 80 } });
  } finally {
    await t.done();
  }
});

test('a second call that fails ends the answer after step 1, with no error and a line in the log', async () => {
  for (const mode of ['fail', 'die']) {
    const lines: string[] = [];
    const t = onFake({ FAKE_SPLIT: '1', FAKE_REST: mode }, (m) => lines.push(m));
    try {
      const out = await collect(t.model);
      assert.deepEqual(says(out), ['First.'], mode);
      assert.ok(lines.some((l) => /second call failed/.test(l)), `${mode}: ${lines.join('|')}`);
    } finally {
      await t.done();
    }
  }
});

test('a first call that fails fails the question, as without the wrapper', async () => {
  const t = onFake({ FAKE_MODE: 'tooluse' });
  try {
    await assert.rejects(collect(t.model), (e: unknown) => e instanceof ModelError && e.code === 'refused');
  } finally {
    await t.done();
  }
});

function stub(log: string[], rest: (req: ModelRequest) => AsyncGenerator<ModelOutput>): Model {
  return {
    id: 'stub',
    async *ask(req) {
      log.push(req.stage ? req.stage.part : 'whole');
      if (!req.stage || req.stage.part === 'first') {
        if (req.stage) yield { type: 'step', step: { say: 'One.', actions: [] } };
        else yield { type: 'step', step: { say: 'Whole.', actions: [] } };
        return;
      }
      yield* rest(req);
    },
  };
}

test('the second call starts as step 1 arrives, not when the first call has ended', async () => {
  const log: string[] = [];
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      log.push(`${req.stage?.part ?? 'whole'}:start`);
      if (req.stage?.part === 'first') {
        yield { type: 'step', step: { say: 'One.', actions: [] } };
        await wait(80); // the first call goes on a while after its step
        log.push('first:end');
        return;
      }
      log.push('rest:body');
      yield { type: 'step', step: { say: 'Two.', actions: [] } };
    },
  };
  const out = await collect(createTwoStepModel(inner));
  assert.deepEqual(says(out), ['One.', 'Two.']);
  assert.ok(log.indexOf('rest:start') >= 0 && log.indexOf('rest:start') < log.indexOf('first:end'), log.join(','));
});

test('a first call that writes more than step 1 has the extra dropped, words, marks and steps alike: the second call writes them, so nothing plays twice', async () => {
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      if (req.stage?.part === 'first') {
        yield { type: 'say', say: 'One.' };
        yield { type: 'action', action: { op: 'box', id: 'a' } };
        yield { type: 'step', step: { say: 'One.', actions: [{ op: 'box', id: 'a' }] } };
        yield { type: 'say', say: 'Two (early).' };
        yield { type: 'action', action: { op: 'box', id: 'b' } };
        yield { type: 'step', step: { say: 'Two (early).', actions: [] } };
        yield { type: 'escalate', reason: 'deeper' };
        yield { type: 'usage', usage: { input: 10, cached: 5, output: 3 } };
        return;
      }
      yield { type: 'say', say: 'Two.' };
      yield { type: 'step', step: { say: 'Two.', actions: [] } };
      yield { type: 'usage', usage: { input: 20, cached: 5, output: 4 } };
    },
  };
  const out = await collect(createTwoStepModel(inner), { pieces: true });
  assert.deepEqual(out.map((o) => (o.type === 'say' ? `say:${o.say}` : o.type === 'step' ? `step:${(o.step as { say: string }).say}` : o.type)), ['say:One.', 'action', 'step:One.', 'escalate', 'say:Two.', 'step:Two.', 'usage']);
  assert.deepEqual(out.at(-1), { type: 'usage', usage: { input: 30, cached: 10, output: 7 } });
});

test("early: the second call starts with the first, told that step 1 is being written separately, and its steps still come after the first one's", async () => {
  const log: string[] = [];
  const asked: Array<string | undefined> = [];
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      log.push(`${req.stage?.part}:start`);
      asked.push(req.stage && req.stage.part === 'rest' ? questionText(req) : undefined);
      if (req.stage?.part === 'first') {
        await wait(60); // the first call is slower than the second to start writing
        yield { type: 'step', step: { say: 'One.', actions: [] } };
        return;
      }
      yield { type: 'step', step: { say: 'Two.', actions: [] } };
    },
  };
  const out = await collect(createTwoStepModel(inner, { early: true }));
  assert.deepEqual(says(out), ['One.', 'Two.'], 'the first call step stays first even though the second was ready earlier');
  assert.ok(log.indexOf('rest:start') >= 0 && log.indexOf('rest:start') <= log.indexOf('first:start') + 1, log.join(','));
  assert.match(asked.find((a) => a !== undefined)!, /being written separately, at the same time/);
  assert.ok(!/already drawn and spoken/.test(asked.find((a) => a !== undefined)!));
});

test('early: a first call that gives no step (it escalates) ends the question without the steps of the second call, and the second call is aborted', async () => {
  let restSignal: AbortSignal | undefined;
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      if (req.stage?.part === 'first') {
        yield { type: 'escalate', reason: 'too hard' };
        return;
      }
      restSignal = req.signal;
      await wait(500);
      yield { type: 'step', step: { say: 'Never shown.', actions: [] } };
    },
  };
  const out = await collect(createTwoStepModel(inner, { early: true }));
  assert.deepEqual(out.map((o) => o.type), ['escalate']);
  assert.ok(restSignal?.aborted, 'the second call was let go');
});

test('early: a first call that fails fails the question and aborts the second', async () => {
  let restSignal: AbortSignal | undefined;
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      if (req.stage?.part === 'first') throw new ModelError('failed', 'down');
      restSignal = req.signal;
      await wait(500);
    },
  };
  await assert.rejects(collect(createTwoStepModel(inner, { early: true })), (e: unknown) => e instanceof ModelError && e.code === 'failed');
  assert.ok(restSignal?.aborted);
});

test('a detail pass, or a request that already names its part, is passed through untouched', async () => {
  const log: string[] = [];
  const model = createTwoStepModel(stub(log, async function* () { yield { type: 'step', step: { say: 'Two.', actions: [] } }; }));
  assert.deepEqual(says(await collect(model, { detail: { steps: [] } })), ['Whole.']);
  assert.deepEqual(log, ['whole']);
});

test('a new question cancels both calls: aborting the request, or leaving the stream, aborts the first and the second', async () => {
  for (const how of ['abort', 'leave'] as const) {
    const seen: Record<string, AbortSignal | undefined> = {};
    const inner: Model = {
      id: 'stub',
      async *ask(req) {
        const part = req.stage?.part ?? 'whole';
        seen[part] = req.signal;
        if (part === 'first') {
          yield { type: 'step', step: { say: 'One.', actions: [] } };
          await wait(300);
          return;
        }
        await wait(5000);
      },
    };
    const controller = new AbortController();
    const iterator = createTwoStepModel(inner).ask({ ...request, signal: controller.signal })[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.done, false);
    await wait(20); // the second call is under way
    assert.ok(seen.rest && !seen.rest.aborted && seen.first && !seen.first.aborted);
    if (how === 'abort') {
      controller.abort();
      assert.ok(seen.first!.aborted && seen.rest!.aborted, 'both aborted by the request');
    } else {
      await iterator.return?.(undefined);
      assert.ok(seen.first!.aborted && seen.rest!.aborted, 'both aborted by leaving the stream');
    }
  }
});

test('on the claude command a question abandoned while the second call is starting leaves no process behind', async () => {
  const t = onFake({ FAKE_SPLIT: '1', FAKE_REST: 'slow' });
  try {
    const iterator = t.model.ask(request)[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    await iterator.return?.(undefined);
  } finally {
    await t.done();
  }
});

test('the raw text of both calls is reported once, in order', async () => {
  const t = onFake({ FAKE_SPLIT: '1' });
  try {
    const raws: string[] = [];
    await collect(t.model, { onRaw: (text) => raws.push(text) });
    assert.equal(raws.length, 1);
    const [a, b] = raws[0]!.split('--- second call ---');
    assert.match(a!, /First\./);
    assert.match(b!, /Third\./);
  } finally {
    await t.done();
  }
});

test('the later calls are reminded that a figure adds what the page lacks and follows what the page shows (the second call of two, and each next step)', () => {
  const rest = questionText({ ...request, stage: { part: 'rest', first: { say: 'Hello.', actions: [] } } });
  const next = questionText({ ...request, stage: { part: 'next', n: 2, shown: [{ say: 'Hello.', actions: [] }], plan: ['x'] } });
  for (const text of [rest, next]) {
    assert.match(text, /A figure adds what the page lacks and follows what the page shows: never draw again what the page already has/);
    assert.match(text, /where the page has none say that it is general knowledge/);
  }
});
