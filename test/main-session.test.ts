import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { SpeechToTextError } from '../src/adapters/speech-to-text.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import type { ModelRequest } from '../src/adapters/model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Backend, BackendReply, BackendRequest } from '../src/adapters/backend.ts';

const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(overrides: Partial<SessionDeps> = {}, clipMs = 1500) {
  const sent: SceneMessage[] = [];
  const calls: string[] = [];
  const pens: Array<number | null> = [];
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: 'what is this' }) };
  let reports = 0;
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => void calls.push('startMic'),
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: clipMs, startLatencyMs: 100 }),
      abortMic: () => void calls.push('abortMic'),
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 }),
    },
    setPen: (id) => void pens.push(id),
    speech,
    model: () => createScriptedModel([step('One.'), step('Two.')]),
    send: (_id, m) => void sent.push(m),
    log: () => undefined,
    micWindowMs: 40,
    onReport: () => void reports++,
    ...overrides,
  };
  const session = createSession(deps);
  const kinds = () => sent.map((m) => (m.kind === 'status' ? `status:${m.status}` : m.kind === 'notice' ? `notice:${m.level}` : m.kind));
  return { session, sent, calls, pens, kinds, reports: () => reports };
}

async function question(r: ReturnType<typeof rig>) {
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(60);
}

test('an answer streams as begin, steps, end, with the working status before it', async () => {
  const r = rig();
  await question(r);
  assert.deepEqual(r.kinds(), ['pen', 'status:hush', 'pen', 'status:working', 'screenshot', 'begin', 'step', 'step', 'end']);
  const begin = r.sent.find((m) => m.kind === 'begin');
  assert.deepEqual(begin, { kind: 'begin', turn: 1 });
});

test('a second question soon after continues the thread (turn 2); a reset starts again', async () => {
  const r = rig();
  await question(r);
  await question(r);
  assert.deepEqual(r.sent.filter((m) => m.kind === 'begin'), [{ kind: 'begin', turn: 1 }, { kind: 'begin', turn: 2 }]);
  r.session.reset();
  await question(r);
  assert.deepEqual(r.sent.filter((m) => m.kind === 'begin').at(-1), { kind: 'begin', turn: 1 });
});

test('Right Ctrl alone drops the early microphone after the window, and releasing it alone cancels at once', async () => {
  const r = rig();
  r.session.arm();
  await wait(80);
  assert.ok(r.calls.includes('abortMic'));
  const q = rig();
  q.session.arm();
  q.session.cancel();
  assert.ok(q.calls.includes('abortMic'));
});

test('escalation is offered after the steps; the offer answers with a notice while the backend is a stub', async () => {
  const r = rig({ model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
  await question(r);
  assert.deepEqual(r.sent.at(-1), { kind: 'end', escalate: 'needs research' });
  await r.session.offer(7);
  const last = r.sent.at(-1);
  assert.equal(last?.kind, 'notice');
});

test('no speech server set: a clear notice, no model call', async () => {
  let asked = false;
  const r = rig({ speech: null, model: () => ({ id: 'm', ask: async function* () { asked = true; } }) });
  await question(r);
  assert.equal(asked, false);
  assert.deepEqual(r.kinds().slice(-2), ['status:idle', 'notice:error']);
});

test('speech server down, nothing heard, and a too-short clip each give a notice and no answer', async () => {
  const down: SpeechToText = { id: 'down', transcribe: async () => { throw new SpeechToTextError('unavailable', 'x'); } };
  const a = rig({ speech: down });
  await question(a);
  const n = a.sent.find((m) => m.kind === 'notice');
  assert.match(n?.kind === 'notice' ? n.text : '', /isn't running/);
  assert.ok(!a.kinds().includes('begin'));
  const short = rig({}, 100);
  await question(short);
  assert.ok(!short.kinds().includes('begin'));
  assert.ok(short.kinds().includes('notice:info'));
});

test('a model failure is a notice; steps already drawn are closed with end', async () => {
  const model = { id: 'm', ask: async function* () { yield { type: 'step' as const, step: step('One.') }; throw new Error('boom'); } };
  const r = rig({ model: () => model });
  await question(r);
  assert.deepEqual(r.kinds().slice(-3), ['end', 'status:idle', 'notice:error']);
});

test('a new chord while an answer is still arriving stops it', async () => {
  const slow = createScriptedModel([step('One.'), step('Two.'), step('Three.')], { gapMs: 30 });
  const r = rig({ model: () => slow });
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(45);
  r.session.arm();
  r.session.start(); // aborts the first answer
  await wait(150);
  assert.ok(r.kinds().filter((k) => k === 'step').length < 3);
});

const shotOf = (base64: string, width = 10, height = 10) => ({ mime: 'image/png' as const, base64, width, height });
const circle: Array<[number, number]> = [[300, 300], [450, 300], [450, 450], [300, 450], [300, 300]];

/** A model that remembers what it was asked. */
function spy(): { model: () => ReturnType<typeof createScriptedModel>; asked: ModelRequest[] } {
  const asked: ModelRequest[] = [];
  const inner = createScriptedModel([step('One.')]);
  return { asked, model: () => ({ ...inner, ask: (req: ModelRequest) => (asked.push(req), inner.ask(req)) }) };
}

test('the pen is on while the chord is held and off on release; the page is told both times', async () => {
  const r = rig();
  r.session.arm();
  assert.deepEqual(r.pens, []);
  r.session.start();
  assert.deepEqual(r.pens, [7]);
  assert.ok(r.sent.some((m) => m.kind === 'pen' && m.on));
  r.session.stop();
  assert.deepEqual(r.pens, [7, null]);
  assert.deepEqual(r.sent.filter((m) => m.kind === 'pen'), [{ kind: 'pen', on: true }, { kind: 'pen', on: false }]);
  await wait(60);
});

test('click-through comes back on release even when telling the page throws, or giving the mouse back throws once', async () => {
  const lines: string[] = [];
  const sent: SceneMessage[] = [];
  const pens: Array<number | null> = [];
  const r = rig({
    log: (l) => void lines.push(l),
    send: (_id, m) => {
      if (m.kind === 'pen' && !m.on) throw new Error('the page is gone');
      sent.push(m);
    },
    setPen: (id) => void pens.push(id),
  });
  await question(r);
  assert.deepEqual(pens, [7, null], 'setPen(null) must still run');
  assert.ok(sent.some((m) => m.kind === 'begin'), 'and the question is still answered');

  // and when giving the mouse back fails, the question carries on and the failure is logged
  const failing = rig({ log: (l) => void lines.push(l), setPen: (id) => { if (id === null) throw new Error('window destroyed'); } });
  await question(failing);
  assert.ok(failing.sent.some((m) => m.kind === 'begin'));
  assert.ok(lines.some((l) => l.includes('could not give the mouse back')));
});

test('disposing while the chord is held gives the mouse back', () => {
  const r = rig();
  r.session.arm();
  r.session.start();
  r.session.dispose();
  assert.deepEqual(r.pens, [7, null]);
});

test('a stroke: the model gets the composite screenshot plus the crop; the page keeps the clean frame; marks stay whole-screen', async () => {
  const model = spy();
  const composed: Array<{ grabId: number; strokes: unknown }> = [];
  const r = rig({
    model: model.model,
    media: {
      startMic: async () => undefined,
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => undefined,
      capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 9 }),
      compose: async (grabId, strokes) => {
        composed.push({ grabId, strokes });
        return { screenshot: shotOf('MARKED'), crop: shotOf('CROP', 40, 40), box: { x: 250, y: 250, w: 250, h: 250 } };
      },
    },
  });
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: circle.slice(0, 3), done: false });
  r.session.stroke(7, { id: 1, points: circle.slice(3), done: true });
  r.session.stop();
  await wait(60);
  assert.equal(composed.length, 1);
  assert.equal(composed[0]?.grabId, 9);
  assert.deepEqual(composed[0]?.strokes, [circle]);
  const asked = model.asked[0]!;
  assert.equal(asked.screenshot.base64, 'MARKED');
  assert.equal(asked.focus?.crop.base64, 'CROP');
  assert.deepEqual(asked.focus?.box, { x: 250, y: 250, w: 250, h: 250 });
  const page = r.sent.find((m) => m.kind === 'screenshot');
  assert.equal(page?.kind === 'screenshot' && page.url.includes('CLEAN'), true);
});

test('no stroke, a tap, a stroke on another display or one made when the pen is off: nothing changes', async () => {
  const model = spy();
  let composes = 0;
  const media = (): SessionDeps['media'] => ({
    startMic: async () => undefined,
    stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
    abortMic: () => undefined,
    capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 1 }),
    compose: async () => (composes++, { screenshot: shotOf('MARKED'), crop: shotOf('CROP'), box: { x: 0, y: 0, w: 1, h: 1 } }),
  });
  const r = rig({ model: model.model, media: media() });
  r.session.stroke(7, { id: 1, points: circle, done: true }); // before any press: ignored
  r.session.arm();
  r.session.start();
  r.session.stroke(8, { id: 2, points: circle, done: true }); // another display
  r.session.stroke(7, { id: 3, points: [[500, 500], [503, 502]], done: true }); // a tap
  r.session.stop();
  await wait(60);
  assert.equal(composes, 0);
  assert.equal(model.asked[0]?.screenshot.base64, 'CLEAN');
  assert.equal(model.asked[0]?.focus, undefined);
});

test('a stroke that cannot be drawn falls back to the plain screenshot and the question is still answered', async () => {
  const model = spy();
  const lines: string[] = [];
  const r = rig({
    model: model.model,
    log: (l) => void lines.push(l),
    media: {
      startMic: async () => undefined,
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => undefined,
      capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 1 }),
      compose: async () => { throw new Error('frame no longer held'); },
    },
  });
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: circle, done: true });
  r.session.stop();
  await wait(60);
  assert.equal(model.asked[0]?.screenshot.base64, 'CLEAN');
  assert.equal(model.asked[0]?.focus, undefined);
  assert.ok(r.sent.some((m) => m.kind === 'end'));
  assert.ok(lines.some((l) => l.includes('could not be drawn')));
});

/** Media for the pen timing tests: stopMic takes `stopMs`, and what compose is given and what is released is recorded. */
function penMedia(stopMs: number, log: { composed: unknown[]; released: number[] }): SessionDeps['media'] {
  return {
    startMic: async () => undefined,
    stopMic: async () => {
      await wait(stopMs);
      return { samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 };
    },
    abortMic: () => undefined,
    capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 4 }),
    compose: async (_grab, strokes) => {
      log.composed.push(strokes);
      return { screenshot: shotOf('MARKED'), crop: shotOf('CROP'), box: { x: 0, y: 0, w: 500, h: 500 } };
    },
    release: (grabId) => void log.released.push(grabId),
  };
}

test('the tail of a stroke still counts: a piece after release but before the microphone closes, and the last piece of an open stroke within a short grace; later ones do not', async () => {
  const log = { composed: [] as unknown[], released: [] as number[] };
  const r = rig({ media: penMedia(40, log) });
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: [[100, 100], [300, 120]], done: false });
  r.session.stop();
  r.session.stroke(7, { id: 1, points: [[400, 300]], done: false }); // after release, before stopMic resolves
  await wait(50); // stopMic is done: the stroke is still open, so the snapshot waits for its last piece
  r.session.stroke(7, { id: 1, points: [[500, 500]], done: true });
  await wait(100);
  assert.deepEqual(log.composed[0], [[[100, 100], [300, 120], [400, 300], [500, 500]]]);

  // an open stroke whose last piece never comes is cut after the grace, and a piece after that is dropped
  const log2 = { composed: [] as unknown[], released: [] as number[] };
  const q = rig({ media: penMedia(0, log2) });
  q.session.arm();
  q.session.start();
  q.session.stroke(7, { id: 1, points: [[100, 100], [400, 400]], done: false });
  q.session.stop();
  await wait(300);
  q.session.stroke(7, { id: 1, points: [[900, 900]], done: true });
  assert.deepEqual(log2.composed[0], [[[100, 100], [400, 400]]]);
});

test('the full-resolution frame is released when the question ends, however it ends', async () => {
  const log = { composed: [] as unknown[], released: [] as number[] };
  await question(rig({ media: penMedia(0, log) })); // a normal answer, no stroke
  assert.deepEqual(log.released, [4]);
  const failed = { composed: [] as unknown[], released: [] as number[] };
  const media = penMedia(0, failed);
  const r = rig({ media: { ...media, stopMic: async () => { throw new Error('no device'); } } });
  await question(r);
  assert.deepEqual(failed.released, [4], 'also when the microphone failed');
  const dropped = { composed: [] as unknown[], released: [] as number[] };
  const d = rig({ media: penMedia(0, dropped) });
  d.session.arm();
  d.session.cancel();
  await wait(20);
  assert.deepEqual(dropped.released, [4], 'and when the press was dropped');
});

test('the model is primed when the chord completes (not on Right Ctrl alone), not for a follow-up, and let go when no question follows', async () => {
  const events: string[] = [];
  const inner = createScriptedModel([step('One.')]);
  const model = { ...inner, prime: () => void events.push('prime'), unprime: () => void events.push('unprime') };
  const r = rig({ model: () => model });
  r.session.arm();
  assert.deepEqual(events, [], 'Right Ctrl alone does not prime');
  r.session.start();
  assert.deepEqual(events, ['prime']);
  r.session.stop();
  await wait(60);
  assert.deepEqual(events, ['prime'], 'a question was asked: nothing to let go');
  // a follow-up inside the thread window continues the open thread, so no primer
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(60);
  assert.deepEqual(events, ['prime']);
  // a chord that never became a question (too short) lets the spare go
  const q = rig({ model: () => model }, 100);
  events.length = 0;
  q.session.arm();
  q.session.start();
  q.session.stop();
  await wait(60);
  assert.deepEqual(events, ['prime', 'unprime']);
});

/** A backend that answers as the test says and remembers what it was asked. */
function fakeBackend(reply: () => Promise<BackendReply> | BackendReply) {
  const asked: BackendRequest[] = [];
  const backend: Backend = { id: 'fake', ask: async (req) => (asked.push(req), reply()) };
  return { backend, asked };
}
const scene = (...says: string[]) => ({ steps: says.map((s) => step(s)) });

test('clicking the offer sends the question, the thread and the scene on screen to the backend, shows "with the backend" while it waits, and draws what it sends back like any answer', async () => {
  const b = fakeBackend(async () => {
    await wait(20);
    return { scene: { steps: [{ say: 'Deeper.', actions: [{ op: 'box', id: 'deep', x: 5, y: 5, w: 10, h: 10, color: 'blue' }, { op: 'teleport', id: 'x' }] }] } };
  });
  const r = rig({ backend: b.backend, model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
  await question(r);
  r.sent.length = 0;
  await r.session.offer(7);
  const kinds = r.kinds();
  assert.deepEqual(kinds.slice(0, 2), ['status:backend', 'begin'], 'it says it is with the backend first');
  assert.ok(kinds.includes('step') && kinds.at(-1) === 'end');
  assert.equal(b.asked.length, 1);
  const asked = b.asked[0]!;
  assert.equal(asked.trigger, 'offer');
  assert.equal(asked.reason, 'needs research');
  assert.equal(asked.question, 'what is this');
  assert.equal(asked.thread.length, 1);
  assert.deepEqual(asked.scene.ids, { b: 'mark' });
  assert.equal(asked.scene.steps.length, 1);
  // validated like any model's: the unknown action was dropped, the box kept
  const stepMsg = r.sent.find((m) => m.kind === 'step');
  assert.ok(stepMsg?.kind === 'step' && stepMsg.step.actions.length === 1);
});

test('"ask the backend" by voice goes to the backend instead of the model; with nothing after it the last question goes again', async () => {
  const b = fakeBackend(() => ({ scene: scene('From the backend.') }));
  let modelCalls = 0;
  const base = createScriptedModel([step('Model.')]);
  const heard = ['what is this', 'ask the backend', 'ask the backend why is it slow'];
  let i = 0;
  const r = rig({
    backend: b.backend,
    model: () => ({ ...base, ask: (req: ModelRequest) => (modelCalls++, base.ask(req)) }),
    speech: { id: 'fake', transcribe: async () => ({ text: heard[i++] ?? '' }) },
  });
  await question(r);
  assert.equal(modelCalls, 1);
  await question(r);
  assert.equal(modelCalls, 1, 'not the model');
  assert.equal(b.asked[0]?.question, 'what is this', 'the last question again');
  assert.equal(b.asked[0]?.trigger, 'spoken');
  assert.equal(b.asked[0]?.thread.length, 1);
  await question(r);
  assert.equal(b.asked[1]?.question, 'why is it slow');
  assert.equal(b.asked[1]?.thread.length, 2, 'the thread carries on');
});

test('no backend set up: the offer and the spoken request each say so, and nothing is asked of the model for the spoken one', async () => {
  let modelCalls = 0;
  const base = createScriptedModel([step('Model.')]);
  const r = rig({
    model: () => ({ ...base, ask: (req: ModelRequest) => (modelCalls++, base.ask(req)) }),
    speech: { id: 'fake', transcribe: async () => ({ text: 'ask the backend' }) },
  });
  await question(r);
  assert.equal(modelCalls, 0);
  const notice = r.sent.find((m) => m.kind === 'notice');
  assert.ok(notice?.kind === 'notice' && notice.level === 'error' && notice.text.includes('No backend'));
  const q = rig({ model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
  await question(q);
  q.sent.length = 0;
  await q.session.offer(7);
  assert.ok(q.sent.some((m) => m.kind === 'notice' && m.text.includes('No backend')));
});

test('a backend that fails, or answers with only text, is a clear notice and never a silent screen', async () => {
  for (const [reply, expect] of [
    [() => { throw new ModelError('unavailable', 'down'); }, "couldn't reach the backend"],
    [() => ({ message: 'Still working on it.' }), 'Still working on it.'],
    [() => ({ scene: { nope: 1 } }), 'garbled'],
  ] as const) {
    const b = fakeBackend(reply);
    const r = rig({ backend: b.backend, model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
    await question(r);
    r.sent.length = 0;
    await r.session.offer(7);
    const n = r.sent.find((m) => m.kind === 'notice');
    assert.ok(n?.kind === 'notice' && n.text.includes(expect), JSON.stringify(n));
    assert.equal(r.sent.at(-1)?.kind, 'notice');
  }
});

test('"pin this" by voice keeps the answer and asks nothing of the model or the backend; with nothing on screen it says so', async () => {
  const pinned: Array<{ question: string; thread: number; steps: number; screenshot: boolean }> = [];
  let modelCalls = 0;
  const base = createScriptedModel([step('One.'), step('Two.')]);
  const heard = ['what is this', 'pin this'];
  let i = 0;
  let keepPicture = false;
  const r = rig({
    model: () => ({ ...base, ask: (req: ModelRequest) => (modelCalls++, base.ask(req)) }),
    speech: { id: 'fake', transcribe: async () => ({ text: heard[i++] ?? '' }) },
    pin: (input) => (pinned.push({ question: input.question, thread: input.thread.length, steps: input.steps.length, screenshot: input.screenshot !== undefined }), { file: 'x.json' }),
    pinScreenshot: () => keepPicture,
  });
  await question(r);
  assert.equal(modelCalls, 1);
  r.sent.length = 0;
  await question(r);
  assert.equal(modelCalls, 1, 'pinning is not a question');
  assert.deepEqual(pinned, [{ question: 'what is this', thread: 1, steps: 2, screenshot: false }]);
  assert.ok(r.sent.some((m) => m.kind === 'notice' && m.level === 'info' && m.text === 'Pinned.'));
  // with the choice ticked the clean screenshot goes with it; the tray does the same
  keepPicture = true;
  r.session.pin(7);
  assert.equal(pinned[1]?.screenshot, true);
  assert.ok(r.sent.some((m) => m.kind === 'notice' && m.text === 'Pinned, with the screenshot.'));

  const empty = rig({ pin: () => { throw new Error('should not be called'); } });
  empty.session.pin(7);
  assert.ok(empty.sent.some((m) => m.kind === 'notice' && m.text.includes('nothing to pin')));
  const failing = rig({ pin: () => { throw new Error('disk full'); } });
  await question(failing);
  failing.sent.length = 0;
  failing.session.pin(7);
  assert.ok(failing.sent.some((m) => m.kind === 'notice' && m.level === 'error' && m.text.includes("couldn't save")));
});
