import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(overrides: Partial<SessionDeps> = {}) {
  const sent: SceneMessage[] = [];
  const calls: string[] = [];
  const pens: Array<number | null> = [];
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => void calls.push('startMic'),
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => void calls.push('abortMic'),
      capture: async () => {
        calls.push('capture');
        return { screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 };
      },
    },
    setPen: (id) => void pens.push(id),
    speech: { id: 'fake', transcribe: async () => ({ text: 'what is this' }) },
    model: () => createScriptedModel([step('One.'), step('Two.')]),
    send: (_id, m) => void sent.push(m),
    log: () => undefined,
    micWindowMs: 40,
    ...overrides,
  };
  return { session: createSession(deps), sent, calls, pens, kinds: () => sent.map((m) => m.kind) };
}

async function question(r: ReturnType<typeof rig>) {
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(60);
}

test('a press while the window in front is on the skip list opens no microphone, grabs nothing, asks nothing, and says so', async () => {
  let asked = false;
  const r = rig({ skipped: () => 'bank', model: () => ({ id: 'm', ask: async function* () { asked = true; } }) });
  await question(r);
  assert.deepEqual(r.calls, [], 'nothing was opened or taken');
  assert.equal(asked, false);
  assert.deepEqual(r.pens, [], 'the pen was not turned on');
  const n = r.sent.find((m) => m.kind === 'notice');
  assert.match(n?.kind === 'notice' ? n.text : '', /on your list of windows to skip/);
  assert.ok(!r.kinds().includes('begin'));
});

test('moving to a window on the list while holding the keys throws away what was grabbed before, and nothing is asked', async () => {
  let skip: string | null = null;
  let asked = false;
  const r = rig({ skipped: () => skip, model: () => ({ id: 'm', ask: async function* () { asked = true; yield { type: 'step' as const, step: step('One.') }; } }) });
  r.session.arm();
  r.session.start();
  skip = 'bank'; // the person switched windows before letting go
  r.session.stop();
  await wait(60);
  assert.equal(asked, false);
  assert.ok(r.calls.includes('abortMic'), 'the recording was dropped');
  assert.deepEqual(r.pens.at(-1), null, 'the pen is off again');
  assert.ok(r.sent.some((m) => m.kind === 'notice'));
  skip = null; // and an ordinary press afterwards works
  await question(r);
  assert.equal(asked, true);
  assert.ok(r.kinds().includes('begin'));
});
