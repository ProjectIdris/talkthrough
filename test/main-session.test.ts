import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { SpeechToTextError } from '../src/adapters/speech-to-text.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';

const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rig(overrides: Partial<SessionDeps> = {}, clipMs = 1500) {
  const sent: SceneMessage[] = [];
  const calls: string[] = [];
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: 'what is this' }) };
  let reports = 0;
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => void calls.push('startMic'),
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: clipMs, startLatencyMs: 100 }),
      abortMic: () => void calls.push('abortMic'),
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5 }),
    },
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
  return { session, sent, calls, kinds, reports: () => reports };
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
  assert.deepEqual(r.kinds(), ['status:hush', 'status:working', 'begin', 'step', 'step', 'end']);
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
