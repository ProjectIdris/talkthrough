import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import type { Model, ModelRequest } from '../src/adapters/model.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cube = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], color: 'blue', ...extra });
const first = [{ say: 'A box.', actions: [{ op: 'panel', x: 300, y: 200, w: 400, h: 400 }, cube('body')] }];
const richer = [
  { say: 'The body again, better.', actions: [cube('body', { bevel: 0.2, material: 'metal' }), cube('lid', { pos: [0, 1, 0] })] },
  { say: 'A label.', actions: [{ op: 'pin', id: 'tag', on: 'lid', text: 'Lid' }] },
];

/** A model that records what it was asked and plays fixed steps. */
function recording(steps: readonly unknown[], id: string, options: { gapMs?: number; escalate?: string } = {}) {
  const requests: ModelRequest[] = [];
  const inner = createScriptedModel(steps, { id, ...options });
  const model: Model = { id, ask: (request) => { requests.push({ ...request, thread: [...request.thread] }); return inner.ask(request); } }; // the thread is copied: the session keeps adding to its own
  return { model, requests };
}

function rig(options: { detail?: ReturnType<typeof recording> | null; said?: string[]; main?: ReturnType<typeof recording> } = {}) {
  const sent: SceneMessage[] = [];
  const said = options.said ?? ['what is this'];
  let n = 0;
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: said[Math.min(n++, said.length - 1)] as string }) };
  const main = options.main ?? recording(first, 'main');
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => undefined,
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => undefined,
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 }),
    },
    setPen: () => undefined,
    speech,
    model: () => main.model,
    ...(options.detail ? { detailModel: () => options.detail!.model } : {}),
    send: (_id, m) => void sent.push(m),
    log: () => undefined,
    micWindowMs: 40,
  };
  const session = createSession(deps);
  const question = async () => {
    session.arm();
    session.start();
    session.stop();
    await wait(60);
  };
  const kinds = () => sent.map((m) => (m.kind === 'status' ? `status:${m.status}` : m.kind === 'notice' ? `notice:${m.level}` : m.kind));
  return { session, sent, question, kinds, main };
}

test('"More detail" asks the detail model for a richer version of the scene on screen, and draws it as a detail turn', async () => {
  const detail = recording(richer, 'detail');
  const r = rig({ detail });
  await r.question();
  r.sent.length = 0;
  await r.session.detail(7);
  assert.deepEqual(r.kinds(), ['status:detail', 'begin', 'step-open', 'action', 'action', 'step-close', 'step-open', 'action', 'step-close', 'end', 'status:idle']);
  const begin = r.sent.find((m) => m.kind === 'begin');
  assert.deepEqual(begin, { kind: 'begin', turn: 1, detail: true });
  // The same ids come back: the first answer's `body` is not "in use" for the detail pass, so it is not dropped.
  const adds = r.sent.filter((m) => m.kind === 'action').map((m) => (m as { action: { id?: string } }).action.id);
  assert.deepEqual(adds, ['body', 'lid', 'tag']);
  // The detail model was shown the scene on screen, the clean picture and the question, and no thread.
  assert.equal(detail.requests.length, 1);
  const asked = detail.requests[0] as ModelRequest;
  assert.deepEqual(asked.detail?.steps, first);
  assert.equal(asked.question, 'what is this');
  assert.deepEqual(asked.thread, []);
  assert.equal(asked.focus, undefined);
  assert.equal(asked.pieces, true);
  assert.equal(r.main.requests.length, 1, 'the quick model was not asked again');
});

test('after a detail pass the richer scene is the thread: a follow-up sees it, and its ids are known', async () => {
  const detail = recording(richer, 'detail');
  const move = [{ say: 'Move it.', actions: [{ op: 'move', id: 'lid', to: [0, 2, 0] }] }];
  let asked = 0;
  const requests: ModelRequest[] = [];
  const main: Model = { id: 'main', ask: (request) => { requests.push({ ...request, thread: [...request.thread] }); return createScriptedModel(asked++ === 0 ? first : move, { id: 'main' }).ask(request); } };
  const r = rig({ detail, main: { model: main, requests }, said: ['what is this', 'what is the lid'] });
  await r.question();
  await r.session.detail(7);
  r.sent.length = 0;
  await r.question();
  const followUp = requests[1] as ModelRequest;
  assert.equal(followUp.thread.length, 1, 'one turn: the detail scene replaced what was drawn');
  assert.deepEqual(followUp.thread[0]?.steps.map((step) => (step as { say: string }).say), ['The body again, better.', 'A label.']);
  // `lid` exists only in the detail scene: the follow-up's move reached it, so the id is known.
  assert.ok(r.sent.some((m) => m.kind === 'action' && (m as { action: { op: string } }).action.op === 'move'));
});

test('saying "show me in detail" asks the detail model, not the quick one, and never reaches for a new screenshot answer', async () => {
  const detail = recording(richer, 'detail');
  const r = rig({ detail, said: ['what is this', 'Show me in detail.'] });
  await r.question();
  r.sent.length = 0;
  await r.question();
  assert.equal(detail.requests.length, 1);
  assert.equal(r.main.requests.length, 1, 'the spoken request is not a question for the quick model');
  assert.ok(r.kinds().includes('status:detail'));
  assert.deepEqual(r.sent.find((m) => m.kind === 'begin'), { kind: 'begin', turn: 1, detail: true });
});

test('with no detail model set up it says so, asks nothing, and draws nothing', async () => {
  const r = rig({ detail: null });
  await r.question();
  r.sent.length = 0;
  await r.session.detail(7);
  assert.deepEqual(r.kinds(), ['status:idle', 'notice:error']);
  assert.equal(r.main.requests.length, 1);
});

test('with nothing on screen yet it asks the person to ask a question first', async () => {
  const detail = recording(richer, 'detail');
  const r = rig({ detail });
  await r.session.detail(7);
  assert.deepEqual(r.kinds(), ['status:idle', 'notice:info']);
  assert.equal(detail.requests.length, 0);
});

test('a detail pass never offers an escalation, and a model that fails gives a notice and leaves the scene as it was', async () => {
  const withEscalate = recording(richer, 'detail', { escalate: 'too deep' });
  const r = rig({ detail: withEscalate });
  await r.question();
  r.sent.length = 0;
  await r.session.detail(7);
  const end = r.sent.find((m) => m.kind === 'end') as { escalate?: string } | undefined;
  assert.equal(end?.escalate, undefined);

  const failing: Model = { id: 'detail', async *ask() { throw new Error('boom'); } };
  const r2 = rig({ detail: { model: failing, requests: [] } });
  await r2.question();
  r2.sent.length = 0;
  await r2.session.detail(7);
  assert.equal(r2.kinds().at(-1), 'notice:error');
  assert.ok(!r2.kinds().includes('end') || r2.kinds().indexOf('end') < r2.kinds().indexOf('notice:error'));
  // Asking again works: the scene on screen is what it was.
  await r2.session.detail(7);
  assert.equal(r2.kinds().filter((k) => k === 'status:detail').length, 2);
});

test('a new question cancels a detail pass still being written: the detail model is aborted and nothing more reaches the page for it', async () => {
  const slow = recording(richer, 'detail', { gapMs: 80 });
  const r = rig({ detail: slow, said: ['what is this', 'and the lid?'] });
  await r.question();
  r.sent.length = 0;
  const running = r.session.detail(7);
  await wait(30);
  assert.ok(r.kinds().includes('status:detail'));
  r.session.arm();
  r.session.start(); // a new press while the detail pass is still being written
  assert.equal((slow.requests[0] as ModelRequest).signal?.aborted, true);
  r.session.stop();
  await running;
  await wait(200);
  const afterAbort = r.kinds().slice(r.kinds().indexOf('status:hush'));
  assert.ok(!afterAbort.includes('step-open') || afterAbort.indexOf('status:working') >= 0, 'nothing of the detail pass after the new press');
  assert.ok(!r.kinds().includes('end') || r.kinds().lastIndexOf('end') > r.kinds().indexOf('status:hush'), 'the detail pass did not end after the press');
});

test('the button is ignored while an answer is still being written', async () => {
  const slowMain = recording(first, 'main', { gapMs: 80 });
  const detail = recording(richer, 'detail');
  const r = rig({ detail, main: slowMain });
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(30);
  await r.session.detail(7);
  assert.equal(detail.requests.length, 0);
  await wait(200);
});
