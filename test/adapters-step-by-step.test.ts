import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClaudeModel } from '../src/adapters/claude-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { questionText, SHORT_OPENER } from '../src/adapters/subscription-shared.ts';
import { createStepByStepModel } from '../src/adapters/step-by-step.ts';
import { sceneGuide, sceneSchemaChain, sceneSchemaLean } from '../src/scene/index.ts';

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
  assert.match(first, /the first planned step is its enlargement \(an image card, as the rule on naming says\)/);
  const next = questionText({ ...request, stage: { part: 'next', n: 3, shown: [{ say: 'One.', actions: [] }, { say: 'Two.', actions: [] }], plan: ['The third', 'The fourth'] } });
  assert.match(next, /Steps 1 to 2 of this answer are already drawn and spoken: \[\{"say":"One\."/);
  assert.match(next, /Write step 3 only \("The third"\)/);
  assert.match(next, /"done" to true when the plan has no step after this one/);
  assert.match(next, /about 30 words at most/);
  assert.match(next, /do not draw a second mark on something an earlier step marked and that is still on the page \(a different part inside it is a new mark\)/);
  assert.match(next, /every move has its own mark and wait, even where an earlier move's mark was/);
  assert.ok(!/how-do-I walk: one move a step/.test(next), 'an explanation is not told it is a walk');
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

const walkSteps = [{ say: 'Click A.', actions: [{ op: 'wait', for: 'click' }] }, { say: 'Click B.', actions: [{ op: 'wait', for: 'click' }] }];

test('a walk lifts the cap: one move a step with its own mark and wait, no word limit, and from step 3 the checklist is already drawn', () => {
  const second = questionText({ ...request, stage: { part: 'next', n: 2, shown: [walkSteps[0]], plan: ['B'] } });
  assert.match(second, /This is a how-do-I walk: one move a step/);
  assert.match(second, /Step 2 draws the checklist/);
  assert.ok(!/about 30 words at most/.test(second));
  const third = questionText({ ...request, stage: { part: 'next', n: 3, shown: walkSteps, plan: ['C'] } });
  assert.match(third, /This is a how-do-I walk: one move a step/);
  assert.match(third, /The checklist is already drawn: write the next move/);
  assert.ok(!/step 2 draws the checklist/i.test(third), 'the checklist is not drawn again');
  assert.ok(!/about 30 words at most/.test(third));
  assert.match(questionText({ ...request, stage: { part: 'first', plan: true } }), /in a how-do-I walk one title for each move still to do, up to 5/);
});

// A first call that writes no plan and no done (it has been seen to: the answer then stopped after step 1, silently).
function unplannedInner(stages: unknown[], raws: (n: number) => string, writes: (n: number) => boolean = () => true): Model {
  return {
    id: 'stub',
    async *ask(req) {
      stages.push(req.stage);
      const n = req.stage?.part === 'next' ? req.stage.n : 1;
      if (writes(n)) yield { type: 'step', step: { say: `S${n}.`, actions: [] } };
      req.onRaw?.(raws(n));
    },
  };
}

test('a first call with neither plan nor done is asked once more, for the next step and a plan, and the chain goes on from that plan', async () => {
  const stages: unknown[] = [];
  const lines: string[] = [];
  const inner = unplannedInner(stages, (n) => (n === 1 ? JSON.stringify({ steps: [] }) : n === 2 ? JSON.stringify({ steps: [], plan: ['Three'], done: false }) : JSON.stringify({ steps: [], plan: null, done: true })));
  assert.deepEqual(says(await collect(createStepByStepModel(inner, { log: (m) => lines.push(m) }))), ['S1.', 'S2.', 'S3.']);
  assert.equal(stages.length, 3);
  assert.deepEqual((stages[1] as { unplanned?: boolean; plan: string[] }).plan, []);
  assert.equal((stages[1] as { unplanned?: boolean }).unplanned, true);
  assert.equal((stages[2] as { unplanned?: boolean }).unplanned, undefined);
  assert.deepEqual((stages[2] as { plan: string[] }).plan, ['Three']);
  assert.ok(lines.some((l) => /no plan and no done: asking once more/.test(l)), lines.join('|'));
});

test('when the extra call has no plan and no done either the answer ends there, cleanly, and no third call is made', async () => {
  const stages: unknown[] = [];
  const lines: string[] = [];
  const inner = unplannedInner(stages, () => JSON.stringify({ steps: [] }));
  assert.deepEqual(says(await collect(createStepByStepModel(inner, { log: (m) => lines.push(m) }))), ['S1.', 'S2.']);
  assert.equal(stages.length, 2);
  assert.ok(lines.some((l) => /asked again, came with no plan and no done either: the answer ends after step 2/.test(l)), lines.join('|'));
});

test('when the extra call writes no step the answer was whole: it ends without error', async () => {
  const stages: unknown[] = [];
  const inner = unplannedInner(stages, (n) => (n === 1 ? JSON.stringify({ steps: [] }) : JSON.stringify({ steps: [], plan: null, done: true })), (n) => n === 1);
  assert.deepEqual(says(await collect(createStepByStepModel(inner))), ['S1.']);
  assert.equal(stages.length, 2);
});

test('a plan of null or a done of true is an answer, not a missing one: no extra call', async () => {
  for (const raw of [{ steps: [], plan: null, done: null }, { steps: [], done: true }, { steps: [], plan: [] }]) {
    const stages: unknown[] = [];
    assert.deepEqual(says(await collect(createStepByStepModel(unplannedInner(stages, () => JSON.stringify(raw))))), ['S1.']);
    assert.equal(stages.length, 1, JSON.stringify(raw));
  }
});

test('a scene the model closed right after its steps and then went on writing the plan after is read: the plan is not lost', async () => {
  const stages: unknown[] = [];
  const closed = '{"steps": [{"say":"S1.","actions":[]}]}, "plan": ["Two", "Three"], "done": false, "escalate": null}';
  const inner = unplannedInner(stages, (n) => (n === 1 ? closed : JSON.stringify({ steps: [], plan: null, done: n >= 3 })));
  assert.deepEqual(says(await collect(createStepByStepModel(inner))), ['S1.', 'S2.', 'S3.']);
  assert.equal((stages[1] as { unplanned?: boolean }).unplanned, undefined, 'the plan was read, so nothing was missing');
  assert.deepEqual((stages[1] as { plan: string[] }).plan, ['Two', 'Three']);
});

test('the extra call is told what it is for: whole answer = no step and done, otherwise one step and a plan', () => {
  const t = questionText({ ...request, stage: { part: 'next', n: 2, shown: [{ say: 'One.', actions: [] }], plan: [], unplanned: true } });
  assert.match(t, /Step 1 of this answer is already drawn/);
  assert.match(t, /The first call gave no plan\. If the answer is already whole, write no step/);
  assert.match(t, /Set "plan" to the titles/);
  assert.ok(!/The plan for the rest/.test(t));
});


/** A model that writes the next of a few scripted raw answers on each call and keeps the requests it was given. */
function scripted(raws: string[]): { inner: Model; asked: ModelRequest[] } {
  const asked: ModelRequest[] = [];
  let at = 0;
  const inner: Model = {
    id: 'scripted',
    async *ask(req: ModelRequest): AsyncGenerator<ModelOutput> {
      asked.push(req);
      const raw = raws[at++] ?? raws[raws.length - 1] as string;
      req.onRaw?.(raw);
      const scene = JSON.parse(raw) as { steps: unknown[] };
      yield { type: 'step', step: scene.steps[0] as never } as ModelOutput;
    },
  };
  return { inner, asked };
}

const enlargeStep = JSON.stringify({ steps: [{ say: 'Here is the map enlarged.', actions: [{ op: 'image', id: 'zoom', sx: 100, sy: 200, sw: 300, sh: 400, dx: 500, dy: 100, dw: 400, color: 'red' }] }], plan: ['Name the parts'], done: false, escalate: null });
const nextStep = JSON.stringify({ steps: [{ say: 'The north island.', actions: [] }], plan: null, done: true, escalate: null });

test('the step after an enlargement is given a full-resolution picture of what was enlarged, and only that step', async () => {
  const lines: string[] = [];
  const s = scripted([enlargeStep, nextStep]);
  const cuts: Array<{ x: number; y: number; w: number; h: number }> = [];
  const crop = { mime: 'image/png' as const, base64: 'SHARP', width: 600, height: 800 };
  const model = createStepByStepModel(s.inner, { log: (m) => lines.push(m) });
  await collect(model, { cropOf: async (box) => (cuts.push(box), crop) });
  assert.equal(s.asked.length, 2);
  assert.equal(s.asked[0]?.focus, undefined, 'the first call has no closer picture yet');
  assert.deepEqual(s.asked[1]?.focus, [{ crop, box: { x: 100, y: 200, w: 300, h: 400 }, card: { x: 500, y: 108, w: 400, h: (400 * 400) / 300 }, kind: 'picture' }]);
  assert.deepEqual(cuts, [{ x: 100, y: 200, w: 300, h: 400 }]);
  assert.ok(lines.some((l) => /given a full-resolution picture of what step 1 enlarged/.test(l)), lines.join('\n'));
});

test('a pen picture stays with the calls and the enlargement is added after it; a frame that is gone, or a step that enlarges nothing, adds nothing', async () => {
  const pen = { crop: { mime: 'image/png' as const, base64: 'PEN', width: 10, height: 10 }, box: { x: 0, y: 0, w: 100, h: 100 }, kind: 'circle' as const };
  const crop = { mime: 'image/png' as const, base64: 'SHARP', width: 600, height: 800 };
  const a = scripted([enlargeStep, nextStep]);
  await collect(createStepByStepModel(a.inner), { focus: [pen], cropOf: async () => crop });
  assert.deepEqual(a.asked[1]?.focus?.map((f) => f.kind), ['circle', 'picture']);
  const gone = scripted([enlargeStep, nextStep]);
  await collect(createStepByStepModel(gone.inner), { cropOf: async () => null });
  assert.equal(gone.asked[1]?.focus, undefined);
  const plainStep = JSON.stringify({ steps: [{ say: 'Just words.', actions: [] }], plan: ['More'], done: false, escalate: null });
  const none = scripted([plainStep, nextStep]);
  let cuts = 0;
  await collect(createStepByStepModel(none.inner), { cropOf: async () => (cuts++, crop) });
  assert.equal(cuts, 0);
  assert.equal(none.asked[1]?.focus, undefined);
  // a third call after the enlargement is not given it again
  const three = scripted([enlargeStep.replace('["Name the parts"]', '["Two", "Three"]'), JSON.stringify({ steps: [{ say: 'Two.', actions: [] }], plan: ['Three'], done: false, escalate: null }), nextStep]);
  await collect(createStepByStepModel(three.inner), { cropOf: async () => crop });
  assert.equal(three.asked.length, 3);
  assert.equal(three.asked[2]?.focus, undefined);
});

test('what the model is told about the closer picture: where it is on the screenshot and how to give points from it', () => {
  const text = questionText({ ...request, focus: [{ crop: { mime: 'image/png', base64: 'X', width: 600, height: 800 }, box: { x: 100, y: 200, w: 300, h: 400 }, kind: 'picture' }] });
  assert.match(text, /from x 100 to 400, y 200 to 600/);
  assert.match(text, /x = 100 \+ u \* 300, y = 200 \+ v \* 400/);
  assert.ok(!/red pen/.test(text), 'a picture is not a pen mark');
});

test('with the card where the enlargement is drawn, points are told to go on the card, from the closer picture', () => {
  const crop = { mime: 'image/png' as const, base64: 'X', width: 600, height: 800 };
  const text = questionText({ ...request, focus: [{ crop, box: { x: 100, y: 200, w: 300, h: 400 }, card: { x: 500, y: 108, w: 400, h: 400 }, kind: 'picture' }] });
  assert.match(text, /fills the card from x 500 to 900 and from y 108 to 508/);
  assert.ok(text.includes('x = 500 + u * 400, y = 108 + v * 400'), text);
  assert.match(text, /never beside it or on the sea/);
});

test('every spoken sentence is told to open short, in the guide (the one-call answer) and in each step prompt, and the 30-word cap stays', () => {
  const rule = sceneGuide.split('\n').find((l) => l.startsWith('- The say of every explanation step opens with a short first sentence'));
  assert.ok(rule, 'a rule of its own in the guide');
  assert.match(rule, /about 8 words or 50 characters at most/);
  assert.match(rule, /The cap on the whole say stays/);
  const opener = /short first sentence, about 8 words or 50 characters at most, and then the rest/;
  const steps = [
    { part: 'first', plan: true } as const,
    { part: 'first' } as const,
    { part: 'next', n: 2, shown: [{ say: 'One.', actions: [] }], plan: ['Two'] } as const,
    { part: 'rest' } as const,
  ];
  for (const stage of steps) {
    const text = questionText({ ...request, stage });
    assert.match(text, opener, `stage ${JSON.stringify(stage)}`);
    assert.match(text, /about 30 words/, 'the cap is still there');
  }
  assert.equal(SHORT_OPENER.length < 200 && opener.test(SHORT_OPENER), true);
  // said once in a call's own text, and the first-step sentence stays whole: the opener comes after it
  for (const stage of steps) assert.equal(questionText({ ...request, stage }).split(SHORT_OPENER).length - 1, 1, `once in ${JSON.stringify(stage)}`);
  assert.match(questionText({ ...request, stage: { part: 'first', plan: true } }), /: what the page is and what the question is about, not a label. Open the sentence with a short first sentence/);

});
