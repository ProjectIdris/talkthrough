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

import type { SkipVerdict } from '../src/main/skip-list.ts';

const listed: SkipVerdict = { kind: 'listed', entry: 'bank' };
const blind: SkipVerdict = { kind: 'blind', why: 'no answer' };
const noticeText = (r: ReturnType<typeof rig>): string => {
  const n = r.sent.find((m) => m.kind === 'notice');
  return n?.kind === 'notice' ? n.text : '';
};

test('a press while the window in front is on the skip list opens no microphone, grabs nothing, asks nothing, and says so', async () => {
  let asked = false;
  const r = rig({ skipped: async () => listed, model: () => ({ id: 'm', ask: async function* () { asked = true; } }) });
  await question(r);
  assert.deepEqual(r.calls, [], 'nothing was opened or taken');
  assert.equal(asked, false);
  assert.deepEqual(r.pens, [], 'the pen was not turned on');
  assert.match(noticeText(r), /on your list of windows to skip/);
  assert.ok(!r.kinds().includes('begin'));
});

test('a check that could not tell which window is in front forbids the press just the same, and the notice says that, not that it was listed', async () => {
  let asked = false;
  const r = rig({ skipped: async () => blind, model: () => ({ id: 'm', ask: async function* () { asked = true; } }) });
  await question(r);
  assert.deepEqual(r.calls, []);
  assert.equal(asked, false);
  assert.match(noticeText(r), /Could not tell which window is in front/);
  assert.ok(!/bank|no answer/.test(noticeText(r)), 'it says nothing about the window or the reason');
});

test('a check that throws, or never answers, is a refusal: the press waits for it no longer than the check does, and the app is not stuck', async () => {
  for (const skipped of [async (): Promise<SkipVerdict | null> => { throw new Error('boom'); }, (): Promise<SkipVerdict | null> => new Promise((r) => setTimeout(() => r(blind), 50))]) {
    let asked = false;
    const r = rig({ skipped, model: () => ({ id: 'm', ask: async function* () { asked = true; } }) });
    r.session.arm();
    r.session.start();
    r.session.stop();
    // Until the refusal has been said (not for a fixed time: a loaded machine is slow), then a moment more for anything that should not happen.
    for (let waited = 0; !/Could not tell which window/.test(noticeText(r)) && waited < 10_000; waited += 5) await wait(5);
    await wait(30);
    assert.equal(asked, false);
    assert.deepEqual(r.calls, []);
    assert.match(noticeText(r), /Could not tell which window is in front/);
  }
});

test('with a list the key events are handled in order after their checks: the early microphone opens once the window is known to be fine, and a quick press still gets its answer', async () => {
  let asked = false;
  const order: string[] = [];
  const r = rig({
    skipped: async () => {
      order.push('check');
      await wait(15);
      return null;
    },
    model: () => ({ id: 'm', ask: async function* () { asked = true; yield { type: 'step' as const, step: step('One.') }; } }),
  });
  r.session.arm();
  assert.equal(r.calls.length, 0, 'nothing opened before the answer of the check');
  r.session.start();
  r.session.stop();
  await wait(200);
  assert.ok(r.calls.includes('startMic') && r.calls.includes('capture'));
  assert.deepEqual(order, ['check', 'check', 'check'], 'each event is checked');
  assert.equal(asked, true);
  assert.ok(r.kinds().includes('begin'));
});

test('moving to a window that is refused while holding the keys throws away what was grabbed before, and nothing is asked', async () => {
  let skip: SkipVerdict | null = null;
  let asked = false;
  const r = rig({ skipped: async () => skip, model: () => ({ id: 'm', ask: async function* () { asked = true; yield { type: 'step' as const, step: step('One.') }; } }) });
  r.session.arm();
  r.session.start();
  await wait(30);
  skip = listed; // the person switched windows before letting go
  r.session.stop();
  await wait(60);
  assert.equal(asked, false);
  assert.ok(r.calls.includes('abortMic'), 'the recording was dropped');
  assert.deepEqual(r.pens.at(-1), null, 'the pen is off again');
  assert.ok(r.sent.some((m) => m.kind === 'notice'));
  skip = null; // and an ordinary press afterwards works
  await question(r);
  await wait(60);
  assert.equal(asked, true);
  assert.ok(r.kinds().includes('begin'));
});

test('a refused window is a warning, not a fault: no button, since the person put it on the list', async () => {
  const r = rig({ skipped: async () => listed });
  await question(r);
  const n = r.sent.find((m) => m.kind === 'notice');
  assert.ok(n?.kind === 'notice');
  assert.deepEqual([n.level, n.action], ['warning', undefined]);
});
