import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, mock, test } from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { ModelError } from '../src/adapters/model.ts';
import type { Model, ModelRequest } from '../src/adapters/model.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

// A long day with the app open: hundreds of questions, some cancelled, some failing. What the session holds between answers (a thread, a scene, a pen,
// timers, abort listeners, the pictures kept for follow-ups) must not grow with their number. Time is the test's own (mocked clock), as in main-session.test.ts.
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'] }));
afterEach(() => mock.timers.reset());
async function wait(ms: number): Promise<void> {
  await drain();
  for (let left = ms; left > 0; left -= 5) {
    mock.timers.tick(Math.min(5, left));
    await drain();
  }
}
v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };

const IDLE_MS = 30_000; // longer than the window in which a question counts as a follow-up

function rig(model: () => Model) {
  const sent: SceneMessage[] = [];
  const counts = { startMic: 0, stopMic: 0, abortMic: 0, pen: 0 };
  const signals: number[] = [];
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => void counts.startMic++,
      stopMic: async () => { counts.stopMic++; return { samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }; },
      abortMic: () => void counts.abortMic++,
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'A'.repeat(4000), width: 10, height: 10 }, ms: 5, grabId: 3 }),
    },
    setPen: () => void counts.pen++,
    speech: { id: 'fake', transcribe: async () => ({ text: 'what is this' }) },
    model: () => {
      const inner = model();
      return {
        id: inner.id,
        async *ask(request: ModelRequest) {
          if (request.signal) signals.push(getEventListeners(request.signal, 'abort').length);
          yield* inner.ask(request);
        },
      };
    },
    send: (_id, m) => void sent.push(m),
    log: () => undefined,
    micWindowMs: 40,
  };
  return { session: createSession(deps), sent, counts, signals };
}

const scripted = () => createScriptedModel([
  { say: 'One.', actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] },
  { say: 'Two.', actions: [{ op: 'arrow', id: 'a', from: { x: 10, y: 10 }, to: { x: 90, y: 90 } }] },
]);

test('three hundred questions with idle time between: every answer sends the same messages, no listener or timer builds up, memory settles', async () => {
  const r = rig(scripted);
  const perAnswer: number[] = [];
  const marks: number[] = [];
  for (let i = 1; i <= 300; i++) {
    const from = r.sent.length;
    r.session.arm();
    r.session.start();
    r.session.stop();
    await wait(60);
    perAnswer.push(r.sent.length - from);
    await wait(IDLE_MS);
    if (i === 50 || i === 300) marks.push(heap());
    if (i % 50 === 0) r.sent.length = 0; // the test's own log is not what is measured
  }
  assert.equal(new Set(perAnswer).size, 1, `messages per answer drift: ${[...new Set(perAnswer)].join(', ')}`);
  assert.ok(perAnswer[0] > 5, 'each answer was really sent');
  assert.equal(r.counts.startMic, 300);
  assert.equal(r.counts.stopMic, 300);
  assert.equal(r.counts.abortMic, 0);
  assert.ok(r.signals.length >= 300, 'every answer asked the model');
  assert.ok(Math.max(...r.signals) <= 2, `abort listeners on a request grew to ${Math.max(...r.signals)}`);
  assert.equal(process.listenerCount('uncaughtException') + process.listenerCount('unhandledRejection') < 20, true);
  const growth = marks[1]! - marks[0]!;
  assert.ok(growth < 3 * 1024 * 1024, `heap grew ${(growth / 1048576).toFixed(1)} MB between the 50th and the 300th answer`);
});

test('two hundred questions that are cancelled, fail or are dismissed halfway leave nothing behind', async () => {
  let n = 0;
  const r = rig(() => {
    n++;
    if (n % 3 === 0) return { id: 'broken', async *ask() { throw new ModelError('unavailable', 'the claude command was not found'); } } as Model;
    return createScriptedModel([{ say: 'Slow.', actions: [{ op: 'box', id: 'b', x: 1, y: 1, w: 9, h: 9, color: 'red' }] }], { gapMs: 400, pieceGapMs: 50 });
  });
  const marks: number[] = [];
  for (let i = 1; i <= 200; i++) {
    r.session.arm();
    r.session.start();
    r.session.stop();
    await wait(i % 2 === 0 ? 120 : 60);
    if (i % 4 === 0) r.session.dismiss?.(); // the person dismisses it while the model is still working
    await wait(IDLE_MS);
    if (i === 40 || i === 200) marks.push(heap());
    if (i % 40 === 0) r.sent.length = 0;
  }
  await wait(5000);
  assert.ok(Math.max(...r.signals) <= 2, `abort listeners on a request grew to ${Math.max(...r.signals)}`);
  assert.equal(r.counts.abortMic, 0, 'no microphone was left open or aborted by a leak');
  const growth = marks[1]! - marks[0]!;
  assert.ok(growth < 3 * 1024 * 1024, `heap grew ${(growth / 1048576).toFixed(1)} MB over the failing and cancelled run`);
});
