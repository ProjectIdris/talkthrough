import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClaudeModel } from '../src/adapters/claude-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { questionText } from '../src/adapters/subscription-shared.ts';
import { createStepByStepModel } from '../src/adapters/step-by-step.ts';
import { sceneSchemaChain, sceneSchemaLean } from '../src/scene/index.ts';

const fakeClaude = fileURLToPath(new URL('./support/fake-claude.mjs', import.meta.url));
const request: ModelRequest = {
  question: 'what is this?',
  screenshot: { mime: 'image/png', base64: 'AAAA', width: 4, height: 4 },
  thread: [],
  schema: sceneSchemaChain,
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const says = (out: ModelOutput[]) => out.flatMap((o) => (o.type === 'step' ? [String((o.step as { say: string }).say)] : []));

async function collect(model: Model, extra: Partial<ModelRequest> = {}): Promise<ModelOutput[]> {
  const out: ModelOutput[] = [];
  for await (const item of model.ask({ ...request, ...extra })) out.push(item);
  return out;
}

function onFake(env: Record<string, string>, log: (m: string) => void = () => undefined, max?: number) {
  Object.assign(process.env, env);
  const inner = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude], schema: sceneSchemaChain });
  return { model: createStepByStepModel(inner, { log, ...(max ? { maxSteps: max } : {}) }), done: async () => { for (const k of Object.keys(env)) delete process.env[k]; await inner.close?.(); } };
}

test('the chain schema is the lean one with plan and done added, all required', () => {
  const s = sceneSchemaChain as { properties: Record<string, unknown>; required: string[]; $defs: unknown };
  assert.deepEqual(Object.keys(s.properties), ['steps', 'plan', 'done', 'escalate']);
  assert.deepEqual(s.required, ['steps', 'plan', 'done', 'escalate']);
  assert.deepEqual(s.$defs, (sceneSchemaLean as { $defs: unknown }).$defs);
});

test('what each call is told: the first asks for step 1 and a plan, the next ones for one step each, given the steps so far and the plan', () => {
  const first = questionText({ ...request, stage: { part: 'first', plan: true } });
  assert.match(first, /Write only step 1 now/);
  assert.match(first, /Also set "plan" to the titles/);
  assert.match(first, /about 30 words/);
  const next = questionText({ ...request, stage: { part: 'next', n: 3, shown: [{ say: 'One.', actions: [] }, { say: 'Two.', actions: [] }], plan: ['The third', 'The fourth'] } });
  assert.match(next, /Steps 1 to 2 of this answer are already drawn and spoken: \[\{"say":"One\."/);
  assert.match(next, /Write step 3 only \("The third"\)/);
  assert.match(next, /"done" to true when the plan has no step after this one/);
  assert.match(questionText({ ...request, stage: { part: 'next', n: 2, shown: [{ say: 'One.', actions: [] }], plan: ['x'] } }), /Step 1 of this answer is already drawn/);
});

test('on the claude command: one call a step, the plan and done fields steer it, the steps come in order, and the figures of all calls are added up', async () => {
  const lines: string[] = [];
  const t = onFake({ FAKE_CHAIN: '1', FAKE_USAGE: '1' }, (m) => lines.push(m));
  try {
    const out = await collect(t.model);
    assert.deepEqual(says(out), ['S1.', 'S2.', 'S3.'], 'three calls: step 1 with a plan of two, then each of those');
    assert.deepEqual(out.at(-1), { type: 'usage', usage: { input: 3 * 9312, cached: 3 * 9000, cacheWrite: 3 * 300, output: 3 * 80 } });
    assert.equal(out.filter((o) => o.type === 'usage').length, 1);
    assert.ok(lines.some((l) => /3 calls, tokens/.test(l)), lines.join('|'));
    assert.ok(lines.some((l) => /step 2: first output after/.test(l)));
  } finally {
    await t.done();
  }
});

test('a first call that says done, or gives no plan, is the whole answer: no second call', async () => {
  const lines: string[] = [];
  const t = onFake({ FAKE_CHAIN: 'short' }, (m) => lines.push(m));
  try {
    const out = await collect(t.model);
    assert.deepEqual(says(out), ['S1.']);
    assert.ok(!lines.some((l) => /step 2/.test(l)));
  } finally {
    await t.done();
  }
});

test('a call that writes more than its one step has the extra dropped', async () => {
  const t = onFake({ FAKE_CHAIN: 'extra' });
  try {
    assert.deepEqual(says(await collect(t.model)), ['S1.', 'S2.', 'S3.']);
  } finally {
    await t.done();
  }
});

test('a call after the first that fails ends the answer there, with a line in the log and no error; the first failing fails the question', async () => {
  const lines: string[] = [];
  const t = onFake({ FAKE_CHAIN: 'fail3' }, (m) => lines.push(m));
  try {
    assert.deepEqual(says(await collect(t.model)), ['S1.', 'S2.']);
    assert.ok(lines.some((l) => /step 3 failed, the answer ends after step 2/.test(l)), lines.join('|'));
  } finally {
    await t.done();
  }
  const u = onFake({ FAKE_MODE: 'tooluse', FAKE_CHAIN: '1' });
  try {
    await assert.rejects(collect(u.model), (e: unknown) => e instanceof ModelError && e.code === 'refused');
  } finally {
    await u.done();
  }
});

test('the plan is cut to the most steps allowed', async () => {
  const t = onFake({ FAKE_CHAIN: '1' }, () => undefined, 2);
  try {
    assert.deepEqual(says(await collect(t.model)), ['S1.', 'S2.']);
  } finally {
    await t.done();
  }
});

test('each call starts after the one before it has ended (the next step is asked for as soon as one has finished, not before), and the stage it gets carries the steps so far', async () => {
  const log: string[] = [];
  const stages: Array<NonNullable<ModelRequest['stage']>> = [];
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      const stage = req.stage!;
      stages.push(stage);
      const n = stage.part === 'next' ? stage.n : 1;
      log.push(`start${n}`);
      yield { type: 'step', step: { say: `S${n}.`, actions: [] } };
      await wait(30);
      req.onRaw?.(JSON.stringify({ steps: [], plan: n === 1 ? ['b', 'c'] : null, done: n >= 3 }));
      log.push(`end${n}`);
    },
  };
  const out = await collect(createStepByStepModel(inner));
  assert.deepEqual(says(out), ['S1.', 'S2.', 'S3.']);
  assert.deepEqual(log, ['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  assert.deepEqual(stages[0], { part: 'first', plan: true });
  assert.deepEqual(stages[2], { part: 'next', n: 3, shown: [{ say: 'S1.', actions: [] }, { say: 'S2.', actions: [] }], plan: ['c'] });
});

test('a new question cancels the call in progress and no further call is made', async () => {
  for (const how of ['abort', 'leave'] as const) {
    let calls = 0;
    let signal: AbortSignal | undefined;
    const inner: Model = {
      id: 'stub',
      async *ask(req) {
        calls++;
        signal = req.signal;
        yield { type: 'step', step: { say: 'One.', actions: [] } };
        await wait(300);
        req.onRaw?.(JSON.stringify({ steps: [], plan: ['b'], done: false }));
      },
    };
    const controller = new AbortController();
    const iterator = createStepByStepModel(inner).ask({ ...request, signal: controller.signal })[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    if (how === 'abort') controller.abort();
    else await iterator.return?.(undefined);
    assert.ok(signal?.aborted, how);
    await wait(350);
    assert.equal(calls, 1, `${how}: no second call after the question was cancelled`);
  }
});

test('a detail pass, or a request that already names its stage, is passed through untouched', async () => {
  let stage: unknown = 'unset';
  const inner: Model = { id: 'stub', async *ask(req) { stage = req.stage; yield { type: 'step', step: { say: 'Whole.', actions: [] } }; } };
  assert.deepEqual(says(await collect(createStepByStepModel(inner), { detail: { steps: [] } })), ['Whole.']);
  assert.equal(stage, undefined);
});

test('a call that says done ends the answer even when the plan still has titles left', async () => {
  let calls = 0;
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      calls++;
      const n = req.stage?.part === 'next' ? req.stage.n : 1;
      yield { type: 'step', step: { say: `S${n}.`, actions: [] } };
      req.onRaw?.(JSON.stringify({ steps: [], plan: n === 1 ? ['b', 'c', 'd'] : null, done: n === 2 }));
    },
  };
  assert.deepEqual(says(await collect(createStepByStepModel(inner))), ['S1.', 'S2.']);
  assert.equal(calls, 2);
});

// A walk: steps that end on a wait for the person's click hold the chain until the click, and the next call is made from the screen as it is then.
const waitStep = (say: string) => ({ say, actions: [{ op: 'wait', for: 'click' }] });
const fresh = { mime: 'image/png' as const, base64: 'NEW', width: 4, height: 4 };

function walkInner(log: string[], seen: Array<{ shot: string; stage: unknown }>, waiting: (n: number) => boolean): Model {
  return {
    id: 'stub',
    async *ask(req) {
      const n = req.stage?.part === 'next' ? req.stage.n : 1;
      log.push(`start${n}`);
      seen.push({ shot: req.screenshot.base64, stage: req.stage });
      yield { type: 'step', step: waiting(n) ? waitStep(`S${n}.`) : { say: `S${n}.`, actions: [] } };
      req.onRaw?.(JSON.stringify({ steps: [], plan: n === 1 ? ['b', 'c'] : null, done: n >= 3 }));
    },
  };
}

test('a step that ends on a wait holds the next call until the click, which is then asked from the screen as it is after it', async () => {
  const log: string[] = [];
  const seen: Array<{ shot: string; stage: unknown }> = [];
  const asked: number[] = [];
  const afterStep: ModelRequest['afterStep'] = async ({ waits }) => {
    asked.push(waits);
    log.push('hold');
    await wait(60);
    log.push('click');
    return { screenshot: fresh };
  };
  const out = await collect(createStepByStepModel(walkInner(log, seen, (n) => n <= 2)), { afterStep });
  assert.deepEqual(says(out), ['S1.', 'S2.', 'S3.']);
  assert.deepEqual(log, ['start1', 'hold', 'click', 'start2', 'hold', 'click', 'start3'], 'each call after a waiting step starts only after the click');
  assert.deepEqual(asked, [1, 2], 'the number of waiting steps so far');
  assert.deepEqual(seen.map((s) => s.shot), ['AAAA', 'NEW', 'NEW']);
  assert.equal((seen[1]!.stage as { fresh?: boolean }).fresh, true);
  assert.equal((seen[0]!.stage as { fresh?: boolean }).fresh, undefined);
  assert.match(questionText({ ...request, stage: seen[1]!.stage as NonNullable<ModelRequest['stage']> }), /the screen as it is now, after the person followed the last step/);
});

test('a step that does not wait is followed at once, even with a hold set up; "go" carries on with the picture it had', async () => {
  const log: string[] = [];
  const seen: Array<{ shot: string; stage: unknown }> = [];
  let held = 0;
  const afterStep: ModelRequest['afterStep'] = async () => {
    held++;
    return 'go';
  };
  const out = await collect(createStepByStepModel(walkInner(log, seen, (n) => n === 2)), { afterStep });
  assert.deepEqual(says(out), ['S1.', 'S2.', 'S3.']);
  assert.equal(held, 1, 'only the step that waits holds');
  assert.deepEqual(seen.map((s) => s.shot), ['AAAA', 'AAAA', 'AAAA']);
  assert.equal((seen[2]!.stage as { fresh?: boolean }).fresh, undefined);
});

test('the walk is over or replaced while the chain is held: no more calls, and no error', async () => {
  const log: string[] = [];
  const lines: string[] = [];
  const out = await collect(createStepByStepModel(walkInner(log, [], () => true), { log: (m) => lines.push(m) }), { afterStep: async () => 'stop' });
  assert.deepEqual(says(out), ['S1.']);
  assert.deepEqual(log, ['start1']);
  assert.ok(lines.some((l) => /then the walk was over or replaced/.test(l)));
});

test('aborting the question while the chain is held lets go of the hold, ends the stream and makes no further call', async () => {
  const log: string[] = [];
  let heldSignal: AbortSignal | undefined;
  const controller = new AbortController();
  const afterStep: ModelRequest['afterStep'] = ({ signal }) => {
    heldSignal = signal;
    return new Promise(() => undefined); // never answers
  };
  const iterator = createStepByStepModel(walkInner(log, [], () => true)).ask({ ...request, afterStep, signal: controller.signal })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  const pending = iterator.next(); // the chain is now held
  await wait(30);
  assert.ok(heldSignal && !heldSignal.aborted);
  controller.abort();
  assert.equal((await pending).done, true, 'the stream ends');
  assert.ok(heldSignal.aborted);
  await wait(30);
  assert.deepEqual(log, ['start1'], 'no second call');
});
