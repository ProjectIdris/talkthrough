import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { SpeechToTextError } from '../src/adapters/speech-to-text.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createSession, STROKE_TAIL_MS, STROKE_TAIL_STEP_MS } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { createStepByStepModel } from '../src/adapters/step-by-step.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Backend, BackendReply, BackendRequest } from '../src/adapters/backend.ts';

const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });
// Time in this file is the test's own. Every timer (the session's, the guide's, the scripted model's) and Date run on a mocked clock that moves
// only when a test says (wait), so no assertion races the machine's speed; between the steps of the clock every promise chain is let run to where it waits.
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
const CLOCK_STEP_MS = 5;
beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
afterEach(() => mock.timers.reset());
/** Moves the clock on by `ms`, letting what is waiting on it run after each step. Called from a test, not from inside what the session is waiting for. */
async function wait(ms: number): Promise<void> {
  await drain();
  for (let left = ms; left > 0; left -= CLOCK_STEP_MS) {
    mock.timers.tick(Math.min(CLOCK_STEP_MS, left));
    await drain();
  }
}
/** A wait inside a fake (a microphone that takes time to close, a backend that is slow): a timer on the same clock. */
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

test('an answer streams as begin, steps opened and closed around their actions, end, with the working status before it', async () => {
  const r = rig();
  await question(r);
  assert.deepEqual(r.kinds(), ['pen', 'status:hush', 'pen', 'status:working', 'screenshot', 'begin', 'step-open', 'action', 'step-close', 'step-open', 'step-close', 'end']); // the second step reuses the first one's id, so its action is dropped
  const begin = r.sent.find((m) => m.kind === 'begin');
  assert.deepEqual(begin, { kind: 'begin', turn: 1 });
});

test('a hotkey of one key has no early step: start with no arm before it asks the same question, with the pen on and the mic opened by the start', async () => {
  const r = rig();
  r.session.start();
  r.session.stop();
  await wait(60);
  assert.deepEqual(r.kinds().slice(0, 4), ['pen', 'status:hush', 'pen', 'status:working']);
  assert.ok(r.sent.some((m) => m.kind === 'begin'), 'an answer came');
  assert.ok(r.calls.includes('startMic'), 'the microphone was opened by the start itself');
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
  assert.match(n?.kind === 'notice' ? n.text : '', /speech recogniser isn't available/);
  assert.ok(!a.kinds().includes('begin'));
  const short = rig({}, 100);
  await question(short);
  assert.ok(!short.kinds().includes('begin'));
  assert.ok(short.kinds().includes('notice:info'));
});

test('a model failure before any step is a notice and nothing else', async () => {
  const model = { id: 'm', ask: async function* (): AsyncGenerator<never> { throw new Error('boom'); } };
  const r = rig({ model: () => model });
  await question(r);
  assert.equal(r.kinds().at(-1), 'notice:error');
});

test('a failure after steps have played keeps what was drawn and ends the answer there, logged: no error, no wiped page', async () => {
  const model = { id: 'm', ask: async function* () { yield { type: 'step' as const, step: step('One.') }; yield { type: 'step' as const, step: step('Two.') }; throw new ModelError('bad-output', 'scene text has mismatched brackets'); } };
  const lines: string[] = [];
  const reports: Array<{ steps: number; error?: string; cutShort?: string; endMs?: number }> = [];
  const r = rig({ model: () => model, log: (l) => void lines.push(l), onReport: (rep) => void reports.push(rep) });
  await question(r);
  const k = r.kinds();
  assert.deepEqual(k.slice(k.indexOf('begin')), ['begin', 'step', 'step', 'end'], 'both steps shown, the answer ended, no notice');
  assert.ok(lines.some((l) => /answer cut short after 2 steps/.test(l) && /mismatched brackets/.test(l)), lines.join(' | '));
  const rep = reports.at(-1)!;
  assert.equal(rep.steps, 2);
  assert.equal(rep.error, undefined, 'not an error');
  assert.match(rep.cutShort ?? '', /mismatched brackets/);
  assert.ok(rep.endMs !== undefined, 'it counts as finished, so a follow-up (More detail) can still be asked');
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
        return { screenshot: shotOf('MARKED'), focus: [{ crop: shotOf('CROP', 40, 40), box: { x: 250, y: 250, w: 250, h: 250 }, kind: 'circle' }] };
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
  assert.equal(asked.focus?.[0]?.crop.base64, 'CROP');
  assert.deepEqual(asked.focus?.[0]?.box, { x: 250, y: 250, w: 250, h: 250 });
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
    compose: async () => (composes++, { screenshot: shotOf('MARKED'), focus: [{ crop: shotOf('CROP'), box: { x: 0, y: 0, w: 1, h: 1 } }] }),
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
      await pause(stopMs);
      return { samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 };
    },
    abortMic: () => undefined,
    capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 4 }),
    compose: async (_grab, strokes) => {
      log.composed.push(strokes);
      return { screenshot: shotOf('MARKED'), focus: [{ crop: shotOf('CROP'), box: { x: 0, y: 0, w: 500, h: 500 } }] };
    },
    release: (grabId) => void log.released.push(grabId),
  };
}

/** A clock of the test's own: waits resolve only when the test says, so nothing here races real time. */
function controlledWaits() {
  const pending: Array<{ ms: number; resolve: () => void }> = [];
  let asked = 0;
  const drain = () => new Promise<void>((resolve) => setImmediate(resolve)); // lets every promise chain run to where it waits
  return {
    sleep: (ms: number) => new Promise<void>((resolve) => { asked += ms; pending.push({ ms, resolve }); }),
    /** Lets the waits that are pending end (one step each), and the work that was waiting on them run. */
    async tick() {
      for (const w of pending.splice(0)) w.resolve();
      await drain();
    },
    drain,
    get asked() { return asked; },
    get waiting() { return pending.length; },
  };
}

/** The media of a pen question whose microphone closes when the test says. */
function gatedMedia(log: { composed: unknown[]; released: number[] }): { media: SessionDeps['media']; closeMic: () => void } {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const media = penMedia(0, log);
  return { media: { ...media, stopMic: async () => { await gate; return { samples: new Float32Array(16), sampleRate: 16000 as const, durationMs: 1500, startLatencyMs: 100 }; } }, closeMic: open };
}

test('the tail of a stroke still counts: a piece after release but before the microphone closes, and the last piece of an open stroke within the grace; later ones do not', async () => {
  // A piece after release, before the microphone has closed, and the last piece after it closed but within the grace.
  const log = { composed: [] as unknown[], released: [] as number[] };
  const waits = controlledWaits();
  const g = gatedMedia(log);
  const r = rig({ media: g.media, sleep: waits.sleep });
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: [[100, 100], [300, 120]], done: false });
  r.session.stop();
  r.session.stroke(7, { id: 1, points: [[400, 300]], done: false }); // after release, before the microphone has closed
  g.closeMic();
  await waits.drain();
  assert.equal(waits.waiting, 1, 'the microphone is closed and the stroke is still open: the snapshot waits for its last piece');
  assert.equal(log.composed.length, 0);
  r.session.stroke(7, { id: 1, points: [[500, 500]], done: true });
  await waits.tick();
  assert.deepEqual(log.composed[0], [[[100, 100], [300, 120], [400, 300], [500, 500]]]);

  // The grace is fifteen steps of ten milliseconds, 150 in all (a number that is changed on purpose, here too): a last piece in the last step still counts, one after it is dropped.
  assert.equal(STROKE_TAIL_MS, 150);
  assert.equal(STROKE_TAIL_STEP_MS, 10);
  const steps = 15;
  for (const [lateBy, counted] of [[steps - 1, true], [steps, false]] as const) {
    const log2 = { composed: [] as unknown[], released: [] as number[] };
    const w = controlledWaits();
    const m = gatedMedia(log2);
    const q = rig({ media: m.media, sleep: w.sleep });
    q.session.arm();
    q.session.start();
    q.session.stroke(7, { id: 1, points: [[100, 100], [400, 400]], done: false });
    q.session.stop();
    m.closeMic();
    await w.drain();
    for (let i = 0; i < lateBy; i++) {
      assert.equal(log2.composed.length, 0, `still waiting after ${i} steps`);
      await w.tick();
    }
    if (counted) {
      q.session.stroke(7, { id: 1, points: [[900, 900]], done: true }); // the last piece, in the last step
      await w.tick();
      assert.deepEqual(log2.composed[0], [[[100, 100], [400, 400], [900, 900]]], 'a last piece within the grace counts');
    } else {
      assert.deepEqual(log2.composed[0], [[[100, 100], [400, 400]]], 'the stroke is cut when the grace has run out');
      q.session.stroke(7, { id: 1, points: [[900, 900]], done: true });
      await w.drain();
      assert.equal(log2.composed.length, 1, 'and a piece after that is dropped');
      assert.equal(w.asked, 150, 'the grace is 150 ms of waiting, in all');
    }
  }
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
    await pause(20);
    return { scene: { steps: [{ say: 'Deeper.', actions: [{ op: 'box', id: 'deep', x: 5, y: 5, w: 10, h: 10, color: 'blue' }, { op: 'teleport', id: 'x' }] }] } };
  });
  const r = rig({ backend: b.backend, model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
  await question(r);
  r.sent.length = 0;
  const offered = r.session.offer(7);
  await wait(25); // the backend takes 20 ms on the test's clock
  await offered;
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

test('a pin keeps the picture of the answer it saves, not the picture of a later question that failed', async () => {
  const pinned: Array<{ question: string; picture?: string }> = [];
  const heard = ['first question', 'second question'];
  let i = 0;
  let grabs = 0;
  let models = 0;
  const failing = { id: 'm', ask: async function* (): AsyncGenerator<never> { throw new ModelError('unavailable', 'down'); } };
  const r = rig({
    media: {
      startMic: async () => undefined,
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => undefined,
      capture: async () => ({ screenshot: { mime: 'image/png', base64: `PICTURE${++grabs}`, width: 10, height: 10 }, ms: 5, grabId: grabs }),
    },
    // the first question is answered, the second fails
    // model() is also read when the chord starts, so count the asks, not the lookups
    model: () => ({ id: 'm', ask: (req: ModelRequest) => (++models === 1 ? createScriptedModel([step('One.')]).ask(req) : failing.ask()) }),
    speech: { id: 'fake', transcribe: async () => ({ text: heard[i++] ?? '' }) },
    pin: (input) => (pinned.push({ question: input.question, picture: input.screenshot?.base64 }), { file: 'x.json' }),
    pinScreenshot: () => true,
  });
  await question(r);
  await question(r);
  r.session.pin(7);
  assert.deepEqual(pinned, [{ question: 'first question', picture: 'PICTURE1' }]);
});

test('a new press clears "with the backend" (and "working") on the overlay before it hushes the speech', async () => {
  let release: (() => void) | undefined;
  const backend: Backend = { id: 'slow', ask: (req) => new Promise((_resolve, reject) => { release = () => reject(new ModelError('aborted', 'x')); req.signal?.addEventListener('abort', () => release?.()); }) };
  const r = rig({ backend, model: () => createScriptedModel([step('Partial.')], { escalate: 'needs research' }) });
  await question(r);
  const pending = r.session.offer(7);
  await wait(10);
  assert.equal(r.kinds().at(-1), 'status:backend');
  r.sent.length = 0;
  r.session.arm();
  r.session.start();
  await pending;
  const kinds = r.kinds();
  assert.ok(kinds.indexOf('status:idle') >= 0 && kinds.indexOf('status:idle') < kinds.indexOf('status:hush'), kinds.join(','));
  r.session.stop();
  await wait(60);
});

// ---- steps drawn as they are written -----------------------------------------------------------

const kindsOf = (sent: SceneMessage[]) => sent.map((m) => (m.kind === 'action' ? `action:${(m.action as { id?: string }).id ?? m.action.op}` : m.kind === 'step-open' ? `open:${m.say}` : m.kind));

test('words and actions go to the page as they arrive, and what the thread keeps is the validated step', async () => {
  const lock = { say: 'A lock.', actions: [
    { op: 'add', shape: 'array', id: 'pins', of: 'pin', count: 3, step: [2, 0, 0] },
    { op: 'add', shape: 'cylinder', id: 'pin', size: [1, 2, 1] },
    { op: 'box', id: 'b', x: 100, y: 100, w: 50, h: 50, color: 'gold' },
    { op: 'pin', id: 'tag', on: 'nowhere', text: 'Lost' },
  ] };
  const r = rig({ model: () => createScriptedModel([lock]) });
  await question(r);
  await question(r);
  const first = kindsOf(r.sent).slice(kindsOf(r.sent).indexOf('begin'), kindsOf(r.sent).indexOf('end') + 1);
  assert.deepEqual(first, ['begin', 'open:A lock.', 'action:pin', 'action:pins', 'action:b', 'step-close', 'end'], 'the array waited for its source; the pin to nowhere was dropped; the unknown colour was read');
  const gold = r.sent.find((m) => m.kind === 'action' && (m.action as { id?: string }).id === 'b');
  assert.equal((gold as { action: { color: string } }).action.color, 'yellow');
});

test('a stream that breaks in the middle of a step closes it on the page before the notice', async () => {
  const broken = { id: 'broken', async *ask() {
    yield { type: 'say' as const, say: 'Half.' };
    yield { type: 'action' as const, action: { op: 'box', id: 'a', x: 1, y: 1, w: 5, h: 5, color: 'red' } };
    throw new ModelError('failed', 'the connection dropped');
  } };
  const r = rig({ model: () => broken });
  await question(r);
  const k = kindsOf(r.sent);
  assert.deepEqual(k.slice(k.indexOf('begin')), ['begin', 'open:Half.', 'action:a', 'step-close', 'end', 'status', 'notice']);
});

test('a step that arrives whole (no pieces) is checked and sent in one go, as before', async () => {
  const whole = { id: 'whole', async *ask() {
    yield { type: 'step' as const, step: step('Whole.') };
    yield { type: 'escalate' as const, reason: 'deeper' };
  } };
  const r = rig({ model: () => whole });
  await question(r);
  assert.deepEqual(r.kinds().slice(r.kinds().indexOf('begin')), ['begin', 'step', 'end']);
  assert.deepEqual(r.sent.at(-1), { kind: 'end', escalate: 'deeper' });
});

test('a new press while an answer is still being written stops it: nothing more reaches the page for it', async () => {
  const slow = createScriptedModel([{ say: 'Slow.', actions: [1, 2, 3, 4, 5, 6].map((i) => ({ op: 'box', id: `s${i}`, x: i * 10, y: 10, w: 5, h: 5, color: 'red' })) }], { pieceGapMs: 25 });
  const r = rig({ model: () => slow });
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(70);
  const before = r.sent.filter((m) => m.kind === 'action').length;
  assert.ok(before > 0 && before < 6, `mid-step (${before} of 6)`);
  r.session.arm();
  r.session.start(); // a new press aborts the answer
  await wait(200);
  assert.equal(r.sent.filter((m) => m.kind === 'action').length, before, 'no action reached the page after the press');
  r.session.dispose();
});

test('the question report says how well the answer built in order', async () => {
  const reports: import('../src/main/session.ts').QuestionReport[] = [];
  const bad = { say: 'Backwards.', actions: [
    { op: 'pin', id: 'tag', on: 'part', text: 'Part' },
    { op: 'add', shape: 'cylinder', id: 'part', size: [1, 2, 1] },
  ] };
  const r = rig({ model: () => createScriptedModel([bad]), onReport: (x) => void reports.push(x) });
  await question(r);
  const done = reports.at(-1);
  assert.deepEqual(done?.order, { score: 0, refs: 1, early: 1, missing: 0, wrong: 0 });

  const good = { say: 'Forwards.', actions: [
    { op: 'add', shape: 'cylinder', id: 'part', size: [1, 2, 1] },
    { op: 'pin', id: 'tag', on: 'part', text: 'Part' },
  ] };
  const g = rig({ model: () => createScriptedModel([good]), onReport: (x) => void reports.push(x) });
  await question(g);
  assert.deepEqual(reports.at(-1)?.order, { score: 1, refs: 1, early: 0, missing: 0, wrong: 0 });
});

// ---- Guide mode: an answer whose steps ask for the person's click is a walk ---------------------------------------------

import { GRID_COLS, GRID_ROWS } from '../src/shared/screen-diff.ts';
import type { Frame, GuideListener, GuideNavigation } from '../src/main/guide.ts';
import { createNavConsent } from '../src/main/nav-consent.ts';

const flat = (v: number): Frame => ({ screenshot: { mime: 'image/png', base64: `f${v}`, width: 10, height: 10 }, grid: { cols: GRID_COLS, rows: GRID_ROWS, luma: new Uint8Array(GRID_COLS * GRID_ROWS).fill(v) } });
const TARGET = { x: 400, y: 100, w: 100, h: 40 };
const guided = (id: string, say: string, withWait = true) => ({
  say,
  actions: [{ op: 'box', id, x: 400, y: 100, w: 100, h: 40, color: 'red' }, ...(withWait ? [{ op: 'wait', for: 'click', ...TARGET }] : [])],
});

/** A session whose screen is `screen` (set it to change what a look at the display shows) and whose clicks the test makes. */
function walkRig(plans: unknown[][], navigation?: GuideNavigation, heard?: string[], modelSaw?: Frame, chain?: (req: ModelRequest, asked: number) => AsyncGenerator<ModelOutput>) {
  let said = 0;
  let screen = flat(235);
  let listener: GuideListener | undefined;
  let stopped = 0;
  let asks = 0;
  const requests: ModelRequest[] = [];
  const r = rig({
    // The session asks for its model more than once a question: the plan is picked when a question is asked of it.
    ...(heard ? { speech: { id: 'fake', transcribe: async () => ({ text: heard[said++] ?? '' }) } } : {}),
    model: () => ({ ...createScriptedModel([]), ask: (req: ModelRequest) => { requests.push(req); return chain ? chain(req, asks++) : createScriptedModel(plans[asks++] ?? []).ask(req); } }),
    guide: {
      options: { onTargetChecks: [30, 60], elsewhereChecks: [30, 60], settleMs: 5, navBeatMs: 10, navMsPerChar: 0, navFirstExtraMs: 0, navPollMs: 5 },
      ...(navigation ? { navigation } : {}),
      ...(modelSaw ? { gridOf: () => modelSaw.grid } : {}),
      capture: async () => screen,
      listen: (_id, l) => {
        listener = l;
        return () => void stopped++;
      },
    },
  });
  return {
    ...r,
    requests,
    look: (f: Frame) => { screen = f; },
    click: async (x: number, y: number, then: Frame) => {
      listener!.down({ x, y, displayId: 7 });
      screen = then;
      listener!.up({ x, y, displayId: 7 });
      await wait(400);
    },
    escape: () => listener!.escape(),
    stopped: () => stopped,
    listening: () => listener !== undefined,
  };
}

test('guide mode: a step that asks for a click holds the steps after it back until the screen has changed, then shows them and ends', async () => {
  const w = walkRig([[guided('t1', 'Click File.'), guided('t2', 'Now click Save.', false)]]);
  await question(w);
  assert.ok(w.kinds().includes('status:waiting'), w.kinds().join());
  assert.ok(!w.kinds().includes('end'), 'the answer is not over while it waits');
  assert.equal(w.sent.filter((m) => m.kind === 'step-open').length, 1, 'the second step is held, not drawn');
  await w.click(450, 120, flat(90));
  assert.ok(w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Now click Save.'), 'the next step is shown after the click');
  assert.equal(w.sent.at(-2)?.kind, 'end');
  assert.deepEqual(w.sent.at(-1), { kind: 'status', status: 'idle' });
  assert.ok(w.stopped() >= 1, 'the click watch is taken off when the walk ends');
});

test('guide mode: a click on the target that changes nothing is waited out, not taken as done', async () => {
  const w = walkRig([[guided('t1', 'Click File.'), guided('t2', 'Now click Save.', false)]]);
  await question(w);
  await w.click(450, 120, flat(235)); // the same screen
  assert.ok(!w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Now click Save.'));
  assert.equal(w.kinds().at(-1), 'notice:info');
});

test('guide mode: a click elsewhere that changes the screen asks the model again from the new screen, told what happened', async () => {
  const w = walkRig([[guided('t1', 'Click File.')], [guided('u1', 'Click Open.', false)]]);
  await question(w);
  await w.click(800, 800, flat(90));
  assert.equal(w.requests.length, 2, 'the model is asked a second time');
  const second = w.requests[1]!;
  assert.match(second.question, /partway through/);
  assert.match(second.question, /Click File\./);
  assert.equal(second.screenshot.base64, 'f90', 'it is shown the screen as it is now');
  assert.ok(w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Click Open.'), 'its step is shown');
});

const withPlan = (id: string, say: string, withWait = true) => ({
  say,
  actions: [
    ...guided(id, say, withWait).actions,
    { op: 'diagram', id: 'plan', kind: 'steps', x: 700, y: 100, w: 280, h: 260, title: 'Plan' },
    { op: 'node', id: 'n1', of: 'plan', text: 'First' },
    { op: 'node', id: 'n2', of: 'plan', text: 'Second' },
  ],
});

test('guide mode: a new plan after a click elsewhere may use the same ids for its marks and its checklist again', async () => {
  const w = walkRig([[withPlan('t1', 'Click File.')], [withPlan('t1', 'Click Open.', false)]]);
  await question(w);
  await w.click(800, 800, flat(90));
  const again = w.sent.filter((m): m is Extract<typeof m, { kind: 'step' }> => m.kind === 'step').find((m) => m.step.say === 'Click Open.');
  assert.ok(again, 'the new plan is shown, not dropped for ids in use');
  const ops = again.step.actions.map((a) => a.op);
  assert.ok(ops.includes('diagram') && ops.filter((o) => o === 'node').length === 2 && ops.includes('box'), `all of it kept: ${ops.join()}`);
  assert.ok(w.sent.some((m) => m.kind === 'status' && m.status === 'idle') || w.kinds().at(-1) !== 'notice:error', 'the walk was not ended by a failed plan');
});

test('guide mode: Escape ends the walk and clears the page, and the next question starts a new thread', async () => {
  const w = walkRig([[guided('t1', 'Click File.')]]);
  await question(w);
  w.escape();
  assert.deepEqual(w.sent.slice(-2), [{ kind: 'status', status: 'idle' }, { kind: 'clear' }]);
  assert.ok(w.stopped() >= 1);
  await question(w);
  assert.deepEqual(w.sent.filter((m) => m.kind === 'begin').at(-1), { kind: 'begin', turn: 1 });
});

test('guide mode: a new question ends the walk without clearing the page', async () => {
  const w = walkRig([[guided('t1', 'Click File.')], [step('Fresh.')]]);
  await question(w);
  const before = w.sent.length;
  await question(w);
  assert.ok(w.stopped() >= 1, 'the old walk is over');
  assert.ok(!w.sent.slice(before).some((m) => m.kind === 'clear'), 'the page was not cleared');
});

test('guide mode is only for a session that can watch clicks: without it a wait is ignored and every step plays', async () => {
  const r = rig({ model: () => createScriptedModel([guided('t1', 'Click File.'), guided('t2', 'Then Save.', false)]) });
  await question(r);
  assert.equal(r.kinds().at(-1), 'end');
  assert.equal(r.sent.filter((m) => m.kind === 'step-open').length, 2);
});

// ---- real controls (see main/uia.ts) ----------------------------------------------------------

const BOXES = [{ x: 100, y: 100, w: 60, h: 40, kind: 'button' }];
const controlsRead = (answer: (signal?: AbortSignal) => Promise<{ boxes: typeof BOXES; ms: number; why?: string }>, seen?: AbortSignal[]) => ({
  read: (_displayId: number, signal?: AbortSignal) => {
    if (signal) seen?.push(signal);
    return answer(signal);
  },
});

test('real controls: the read starts when the chord is complete, is never waited for, and its boxes reach the page after the screenshot they belong to', async () => {
  const plain = rig();
  await question(plain);
  const r = rig({ controls: controlsRead(async () => ({ boxes: BOXES, ms: 12 })) });
  await question(r);
  const without = r.kinds().filter((k) => k !== 'controls');
  assert.deepEqual(without, plain.kinds(), 'the answer is the same as without a reader');
  const kinds = r.kinds();
  assert.ok(kinds.indexOf('controls') > kinds.indexOf('screenshot'), 'after the screenshot');
  assert.deepEqual(r.sent.find((m) => m.kind === 'controls'), { kind: 'controls', boxes: BOXES });
});

test('real controls: a read that never finishes does not delay the answer, and nothing is sent for it', async () => {
  const r = rig({ controls: controlsRead(() => new Promise(() => undefined)) });
  await question(r);
  assert.equal(r.kinds().at(-1), 'end');
  assert.ok(!r.kinds().includes('controls'));
  assert.equal(r.sent.filter((m) => m.kind === 'step-open').length, 2);
});

test('real controls: a read that fails or finds nothing leaves the answer whole and sends nothing', async () => {
  for (const answer of [async () => { throw new Error('no accessibility tree'); }, async () => ({ boxes: [], ms: 5, why: 'failed' })]) {
    const r = rig({ controls: controlsRead(answer as never) });
    await question(r);
    assert.equal(r.kinds().at(-1), 'end');
    assert.ok(!r.kinds().includes('controls'));
  }
  const synchronous = rig({ controls: { read: () => { throw new Error('boom'); } } });
  await question(synchronous);
  assert.equal(synchronous.kinds().at(-1), 'end');
});

test('real controls: nothing is read for a lone Right Ctrl, and a read that comes after a newer question began is not sent', async () => {
  const seen: AbortSignal[] = [];
  const r = rig({ controls: controlsRead(() => new Promise(() => undefined), seen) });
  r.session.arm();
  assert.equal(seen.length, 0, 'the first key alone is no question: nothing is read');
  r.session.cancel();
  assert.equal(seen.length, 0);
  r.session.arm();
  r.session.start();
  assert.equal(seen.length, 1, 'the chord starts the read');
  assert.equal(seen[0]!.aborted, false);
  const late: Array<(v: { boxes: typeof BOXES; ms: number }) => void> = [];
  const slow = rig({ controls: controlsRead(() => new Promise((resolve) => { late.push(resolve); })) });
  await question(slow);
  slow.session.arm(); // a newer press supersedes the answer
  slow.session.start();
  late[0]!({ boxes: BOXES, ms: 900 });
  await wait(20);
  assert.ok(!slow.kinds().includes('controls'), 'what was read for the old screen is not given to the new one');
});

test('guide mode: a step with a go is done by the app when the session has hands and the guard allows it, and not otherwise', async () => {
  const goStep = { say: 'Open the tab.', actions: [{ op: 'box', id: 'g1', x: 400, y: 100, w: 100, h: 40, color: 'red' }, { op: 'go', kind: 'tab', x: 450, y: 120 }, { op: 'wait', for: 'click', ...TARGET }] };
  const acted: string[] = [];
  let w!: ReturnType<typeof walkRig>;
  const navigation: GuideNavigation = {
    plan: async () => ({ verdict: 'do', announce: "I'll open that tab for you.", handle: 1 }),
    act: async () => {
      acted.push('act');
      w.look(flat(90));
      return true;
    },
  };
  w = walkRig([[goStep, guided('t2', 'Now click Save.', false)]], navigation);
  await question(w);
  await wait(500);
  assert.deepEqual(acted, ['act']);
  const says = w.sent.filter((m) => m.kind === 'step').map((m) => (m.step as { say: string }).say);
  assert.deepEqual(says.slice(0, 2), ["I'll open that tab for you.", 'Now click Save.'], 'the announcement, then the next step');
  // the same plan with no hands: only points, and waits for the person
  const w2 = walkRig([[goStep, guided('t2', 'Now click Save.', false)]]);
  await question(w2);
  await wait(200);
  assert.deepEqual(w2.sent.filter((m) => m.kind === 'step').map((m) => (m.step as { say: string }).say), [], 'no hands: no announcement and no next step until the person clicks');
});

test('guide mode: while the app waits for a yes, a spoken yes is the answer and not a question; any other question ends the walk and is asked as usual', async () => {
  const goStep = { say: 'Open the tab.', actions: [{ op: 'box', id: 'g1', x: 400, y: 100, w: 100, h: 40, color: 'red' }, { op: 'go', kind: 'tab', x: 450, y: 120 }, { op: 'wait', for: 'click', ...TARGET }] };
  for (const reply of ['Yes.', 'what is a tab']) {
    const consent = createNavConsent({ after: () => () => undefined });
    const acted: string[] = [];
    let w!: ReturnType<typeof walkRig>;
    const navigation: GuideNavigation = {
      plan: async () => ({ verdict: 'do', announce: "I'll open that tab for you.", handle: 1 }),
      act: async () => {
        acted.push('act');
        w.look(flat(90));
        return true;
      },
      consent,
    };
    w = walkRig([[goStep, guided('t2', 'Now click Save.', false)], [guided('u1', 'A tab is a page.', false)]], navigation, ['how do I open it', reply]);
    await question(w);
    await wait(100);
    assert.equal(consent.pending(), true, 'the app is waiting for a yes');
    assert.deepEqual(acted, []);
    await question(w);
    await wait(500);
    if (reply === 'Yes.') {
      assert.equal(w.requests.length, 1, 'the yes was not sent to the model');
      assert.deepEqual(acted, ['act'], 'and the move was made');
      assert.equal(consent.given(), true);
    } else {
      assert.equal(w.requests.length, 2, 'another question is a question');
      assert.deepEqual(acted, [], 'and nothing was done');
      assert.equal(consent.pending(), false, 'the question to the person is closed');
    }
  }
});

test('guide mode: the move is compared with the picture the model was given, not with a screen looked at after it answered', async () => {
  const goStep = { say: 'Open the tab.', actions: [{ op: 'box', id: 'g1', x: 400, y: 100, w: 100, h: 40, color: 'red' }, { op: 'go', kind: 'tab', x: 450, y: 120 }, { op: 'wait', for: 'click', ...TARGET }] };
  for (const screenNow of [flat(235), flat(90)]) {
    const consent = createNavConsent({ after: () => () => undefined });
    void consent.ask();
    consent.answer(true);
    const acted: string[] = [];
    const navigation: GuideNavigation = {
      plan: async () => ({ verdict: 'do', announce: "I'll open that tab for you.", handle: 1 }),
      act: async () => {
        acted.push('act');
        return true;
      },
      consent,
    };
    const w = walkRig([[goStep]], navigation, undefined, flat(235));
    w.look(screenNow); // the screen the guide sees from the first moment: the model's picture said 235
    await question(w);
    await wait(500);
    assert.deepEqual(acted, screenNow.grid.luma[0] === 235 ? ['act'] : [], screenNow.grid.luma[0] === 235 ? 'the same screen: done' : 'another screen: not done');
  }
});

// ---- An answer written one step to a call: a step that waits for a click holds the next call until the click ------------------

test('guide mode, one step to a call: the next call is held until the click, then made from the screen as it is after it, and the page is given that screen', async () => {
  let got: unknown = 'not asked yet';
  const w = walkRig([], undefined, undefined, undefined, async function* (req) {
    yield { type: 'step', step: guided('t1', 'Click File.') };
    got = await req.afterStep!({ waits: 1, signal: req.signal! });
    if (typeof got === 'object') yield { type: 'step', step: guided('t2', 'Now click Save.', false) };
  });
  await question(w);
  assert.equal(got, 'not asked yet', 'the chain is held while the person has not clicked');
  assert.equal(w.sent.filter((m) => m.kind === 'step').length, 1);
  await w.click(450, 120, flat(90));
  assert.equal((got as unknown as { screenshot: { base64: string } }).screenshot.base64, 'f90', 'the next call gets the screen after the click');
  assert.ok(w.sent.some((m) => m.kind === 'screenshot' && m.url === 'data:image/png;base64,f90'), 'the page is given the new screen');
  assert.ok(w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Now click Save.'), 'the next step is shown');
  assert.equal(w.sent.filter((m) => m.kind === 'end').length, 1);
});

test('guide mode, one step to a call: a click elsewhere replaces the plan; the held call stops and does not end the walk, the new plan carries on', async () => {
  let first: unknown = 'not asked yet';
  const w = walkRig([], undefined, undefined, undefined, async function* (req, asked) {
    if (asked === 0) {
      yield { type: 'step', step: guided('t1', 'Click File.') };
      first = await req.afterStep!({ waits: 1, signal: req.signal! });
      return;
    }
    await pause(100); // the model takes its time: the walk is between plans meanwhile
    yield { type: 'step', step: guided('u1', 'Click Open.') }; // the new plan waits too, and holds its own next call: the wait given up with the old plan is not counted
    const after = await req.afterStep!({ waits: 1, signal: req.signal! });
    if (typeof after === 'object') yield { type: 'step', step: guided('u2', 'Then Save.', false) };
  });
  await question(w);
  await w.click(800, 800, flat(90)); // elsewhere, and the screen changed
  assert.equal(first, 'stop');
  assert.equal(w.requests.length, 2);
  assert.ok(w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Click Open.'), 'the new plan is shown');
  assert.ok(!w.sent.some((m) => m.kind === 'end'), 'the walk is not over: the new plan is still waiting for a click');
  await w.click(450, 120, flat(40));
  assert.ok(w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Then Save.'), 'the new plan goes on');
});

test('guide mode, one step to a call: Escape while the next call is held lets it go', async () => {
  let got: unknown = 'not asked yet';
  const w = walkRig([], undefined, undefined, undefined, async function* (req) {
    yield { type: 'step', step: guided('t1', 'Click File.') };
    got = await req.afterStep!({ waits: 1, signal: req.signal! });
  });
  await question(w);
  w.escape();
  await wait(20);
  assert.equal(got, 'stop');
});

test('guide mode, one step to a call: a wait the validator drops makes a plain step, and the chain goes on at once instead of holding for a click that cannot come', async () => {
  const inner: Model = {
    id: 'stub',
    async *ask(req) {
      const n = req.stage?.part === 'next' ? req.stage.n : 1;
      const step = n === 1 ? guided('t1', 'Click File.')
        : n === 2 ? { say: 'Then this.', actions: [{ op: 'box', id: 't2', x: 100, y: 300, w: 100, h: 40, color: 'red' }, { op: 'wait', for: 'tap' }] } // not a click: the validator drops the wait
          : { say: 'That is all.', actions: [] };
      yield { type: 'step', step };
      req.onRaw?.(JSON.stringify({ steps: [], plan: n === 1 ? ['B', 'C'] : null, done: n >= 3 }));
    },
  };
  const w = walkRig([], undefined, undefined, undefined, async function* (req) { yield* createStepByStepModel(inner).ask(req); });
  await question(w);
  assert.ok(!w.sent.some((m) => m.kind === 'step' && (m.step as { say: string }).say === 'Then this.'), 'step 2 is not asked for before the first click');
  await w.click(450, 120, flat(90));
  const says = w.sent.filter((m): m is Extract<typeof m, { kind: 'step' }> => m.kind === 'step').map((m) => m.step.say);
  assert.ok(says.includes('Then this.'), 'step 2 is shown after the first click');
  assert.ok(says.includes('That is all.'), `step 3 follows at once, with no second click: ${says.join(' | ')}`);
  assert.equal(w.sent.filter((m) => m.kind === 'end').length, 1, 'and the walk ends');
});


const noStrokeMedia = (compose: Array<unknown>): SessionDeps['media'] => ({
  startMic: async () => undefined,
  stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
  abortMic: () => undefined,
  capture: async () => ({ screenshot: shotOf('CLEAN'), ms: 5, grabId: 9 }),
  compose: async (_grab, strokes) => (compose.push(strokes), { screenshot: shotOf('MARKED'), focus: [{ crop: shotOf('CROP', 40, 40), box: { x: 250, y: 250, w: 250, h: 250 } }] }),
});

test('a circle taken back is not in the picture, the crop or the numbering: only the circles left are composed, and none left means the plain screenshot', async () => {
  const model = spy();
  let composed: unknown[] = [];
  const r = rig({ model: model.model, media: noStrokeMedia(composed) });
  const second: Array<[number, number]> = [[600, 600], [800, 600], [800, 800], [600, 800], [600, 600]];
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: circle, done: true });
  r.session.stroke(7, { id: 2, points: second.slice(0, 2), done: false });
  r.session.stroke(7, { id: 2, points: second.slice(2), done: true });
  r.session.stroke(7, { id: 2, points: [], done: true, removed: true });
  r.session.stop();
  await wait(60);
  assert.deepEqual(composed, [[circle]], 'the second circle was taken back');
  composed = [];
  const again = rig({ model: model.model, media: noStrokeMedia(composed) });
  again.session.arm();
  again.session.start();
  again.session.stroke(7, { id: 1, points: circle, done: true });
  again.session.stroke(7, { id: 1, points: [], done: true, removed: true });
  again.session.stroke(7, { id: 5, points: [], done: true, removed: true }); // one never sent: nothing to take back, nothing breaks
  again.session.stop();
  await wait(60);
  assert.equal(composed.length, 0, 'no circle left: nothing is drawn on the picture');
  assert.equal(model.asked.at(-1)?.screenshot.base64, 'CLEAN');
  assert.equal(model.asked.at(-1)?.focus, undefined);
});

test('a right click while the chord is held cancels the question: nothing is heard or asked, the page is told, and the mouse stays with the pen until the button is up', async () => {
  const model = spy();
  const lines: string[] = [];
  const r = rig({ model: model.model, log: (l) => void lines.push(l) });
  r.session.arm();
  r.session.start();
  r.session.stroke(7, { id: 1, points: circle, done: true });
  r.session.cancelQuestion(7, false);
  assert.ok(r.calls.includes('abortMic'), 'the microphone is let go');
  assert.deepEqual(r.sent.filter((m) => m.kind === 'notice'), [{ kind: 'notice', text: 'Cancelled.', level: 'info' }]);
  assert.deepEqual(r.pens, [7], 'the window still has the mouse: the release of the right button must not reach the app beneath');
  r.session.cancelQuestion(7, true);
  assert.deepEqual(r.pens, [7, null], 'the button is up: the mouse goes back');
  r.session.stop(); // the keys come up afterwards
  await wait(200);
  assert.equal(model.asked.length, 0, 'no question was asked');
  assert.equal(r.reports(), 0);
  assert.ok(lines.some((l) => l.includes('cancelled')));
});

test('after a right click the mouse is given back after a short while even if the button never comes up, and a new press in between keeps it', async () => {
  const r = rig({ media: noStrokeMedia([]) });
  r.session.arm();
  r.session.start();
  r.session.cancelQuestion(7, false);
  await wait(2100);
  assert.deepEqual(r.pens, [7, null]);
  const q = rig({ media: noStrokeMedia([]) });
  q.session.arm();
  q.session.start();
  q.session.cancelQuestion(7, false);
  q.session.stop();
  q.session.arm();
  q.session.start(); // a new press while the old hold is running
  await wait(2100);
  assert.deepEqual(q.pens, [7, 7], 'the new press has the pen; the old hold does not take the mouse away from it');
});

test('a right click on another display, with the chord not held, or its release with nothing cancelled: nothing happens', async () => {
  const r = rig({ media: noStrokeMedia([]) });
  r.session.cancelQuestion(7, false); // nothing is held
  r.session.cancelQuestion(7, true);
  r.session.arm();
  r.session.start();
  r.session.cancelQuestion(8, false); // another display
  assert.deepEqual(r.pens, [7]);
  assert.equal(r.sent.some((m) => m.kind === 'notice'), false);
  r.session.stop();
  await wait(60);
  assert.ok(r.sent.some((m) => m.kind === 'step' || m.kind === 'begin'), 'the question goes on as usual');
});

test('the recogniser is woken when the keys first go down, not when the question is asked', async () => {
  const woke: string[] = [];
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: 'what is this' }), wake: async () => void woke.push('wake') };
  const r = rig({ speech });
  r.session.arm();
  assert.deepEqual(woke, ['wake']);
  r.session.cancel();
  // A recogniser whose wake-up fails does not disturb the press.
  const failing = rig({ speech: { id: 'fake', transcribe: async () => ({ text: 'x' }), wake: async () => { throw new Error('down'); } } });
  failing.session.arm();
  await wait(5);
  assert.ok(true);
});

test('a recogniser whose wake-up throws at once, or answers with no promise, does not disturb the press', () => {
  const throwing = rig({ speech: { id: 'fake', transcribe: async () => ({ text: 'x' }), wake: (() => { throw new Error('down'); }) as never } });
  assert.doesNotThrow(() => throwing.session.arm());
  const plain = rig({ speech: { id: 'fake', transcribe: async () => ({ text: 'x' }), wake: (() => undefined) as never } });
  assert.doesNotThrow(() => plain.session.arm());

});

test('with the record of questions on, a question leaves a folder with what was heard, sent and drawn, and a failed one its error; with it off nothing is kept', async () => {
  const { createQuestionRecord } = await import('../src/main/record.ts');
  const { mkdtempSync, readFileSync, readdirSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tt-session-record-'));
  try {
    const record = createQuestionRecord({ dir });
    const r = rig({ record });
    await question(r);
    const [folder] = readdirSync(dir);
    assert.ok(folder);
    const at = (name: string) => readFileSync(join(dir, folder, name), 'utf8');
    assert.equal(at('transcript.txt').trim(), 'what is this');
    assert.equal(readFileSync(join(dir, folder, 'screenshot-sent.png')).toString('base64'), 'AAAA');
    const steps = JSON.parse(at('steps.json')) as Array<{ say: string }>;
    assert.deepEqual(steps.map((s) => s.say), ['One.', 'Two.']);
    const report = JSON.parse(at('report.json'));
    assert.equal(report.question, 'what is this', 'the record keeps the words the log does not');
    assert.equal(report.steps, 2);
    const broken = rig({ record, model: () => ({ id: 'm', ask: async function* () { throw new ModelError('unavailable', 'not signed in'); } }) });
    await wait(1000);
    await question(broken);
    const folders = readdirSync(dir).sort();
    assert.equal(folders.length, 2);
    assert.match(readFileSync(join(dir, folders[1]!, 'errors.txt'), 'utf8'), /unavailable: not signed in/);
    const off = rig();
    await question(off);
    assert.equal(readdirSync(dir).length, 2, 'a session without a record writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the voice server is woken when the keys first go down, and a wake-up that fails does not disturb the press', async () => {
  let woke = 0;
  const r = rig({ wakeVoice: async () => void woke++ });
  r.session.arm();
  assert.equal(woke, 1);
  r.session.cancel();
  const failing = rig({ wakeVoice: async () => { throw new Error('down'); } });
  assert.doesNotThrow(() => failing.session.arm());
  const throwing = rig({ wakeVoice: (() => { throw new Error('at once'); }) as never });
  assert.doesNotThrow(() => throwing.session.arm());
});
