import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import { createTrayStatus } from '../src/main/tray-state.ts';
import type { TrayState } from '../src/main/tray-state.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

// An answer ends its turn: when it has been drawn the session is free for the next press, and the tray, which follows what the session tells the page,
// says "ready" again, not "thinking" for good. Time here is the test's own (the clock moves only when a test says).
const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });
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
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function rig(model: SessionDeps['model']) {
  const sent: SceneMessage[] = [];
  const tray: TrayState[] = [];
  const status = createTrayStatus((s) => tray.push(s), { setTimer: () => undefined, clearTimer: () => undefined });
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: 'what is this' }) };
  const session = createSession({
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => undefined,
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => undefined,
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 }),
    },
    setPen: () => undefined,
    speech,
    model,
    send: (_id, m) => {
      sent.push(m);
      status.feed(m); // what main does with everything the session sends
    },
    log: () => undefined,
    micWindowMs: 40,
  });
  return { session, sent, status };
}

const press = async (r: ReturnType<typeof rig>, settle = 60) => {
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(settle);
};

test('two answers in a row in one session: after each the session is free and the tray says ready, not thinking', async () => {
  const r = rig(() => createScriptedModel([step('One.'), step('Two.')]));
  for (const turn of [1, 2, 3]) {
    await press(r);
    assert.equal(r.sent.filter((m) => m.kind === 'end').length, turn, `answer ${turn} ended`);
    assert.equal(r.session.busy(), false, `the session is free after answer ${turn}`);
    assert.equal(r.status.state(), 'ready', `the tray says ready after answer ${turn}, not ${r.status.state()}`);
  }
});

test('a press that supersedes a slow answer, then an answer that ends: the session is free and the tray ready', async () => {
  let calls = 0;
  const slow: SessionDeps['model'] = () => ({
    id: 'slow',
    async *ask(request) {
      const mine = ++calls;
      await pause(mine === 1 ? 500 : 20);
      if (request.signal?.aborted) return;
      yield { type: 'step', step: step('Late.') };
    },
  });
  const r = rig(slow);
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(100); // the first question is being answered
  assert.equal(r.session.busy(), true);
  await press(r, 200); // a new press replaces it
  assert.equal(r.sent.filter((m) => m.kind === 'end').length, 1, 'only the second answer ended');
  assert.equal(r.session.busy(), false);
  assert.equal(r.status.state(), 'ready');
  await press(r); // and the one after still works
  assert.equal(r.sent.filter((m) => m.kind === 'end').length, 2);
  assert.equal(r.status.state(), 'ready');
});
