import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import type { Model, ModelOutput } from '../src/adapters/model.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createEscape, escapeWanted, SHOWING_LEASE_MS } from '../src/main/escape.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';
import type { SceneMessage } from '../src/shared/ipc.ts';
import { AutoFade, DISMISS_FADE_MS, FADE_MS } from '../src/overlay/fade.ts';

// ---- when Escape is ours: only while an answer is being asked for, written or shown, and always given back -----------------------------

/** Timers the test runs by hand, so a three-second lease takes no time. */
function manualTimers() {
  let next = 1;
  const live = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void): unknown => { const id = next++; live.set(id, fn); return id; },
    clearTimer: (id: unknown): void => { live.delete(id as number); },
    fire: (): void => { const fns = [...live.values()]; live.clear(); for (const fn of fns) fn(); },
    count: (): number => live.size,
  };
}

function rig(options: { enabled?: boolean; owned?: boolean } = {}) {
  const t = manualTimers();
  const calls: string[] = [];
  let busy = false;
  let owned = options.owned ?? true;
  const escape = createEscape({
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    register: (a) => { calls.push(`register ${a}`); return owned; },
    unregister: (a) => { calls.push(`unregister ${a}`); },
    onKey: () => undefined,
    busy: () => busy,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  return { escape, calls, t, busy: (v: boolean) => { busy = v; }, other: (v: boolean) => { owned = v; } };
}

test('Escape is ours only while a question is being asked, answered or walked through, or a drawing is up, on a window that is there', () => {
  const win = (showing: boolean, alive = true) => ({ showing, alive });
  assert.equal(escapeWanted({ busy: false, windows: [win(false)] }), false, 'nothing going on: it belongs to the program in front');
  assert.equal(escapeWanted({ busy: false, windows: [] }), false);
  assert.equal(escapeWanted({ busy: true, windows: [win(false)] }), true, 'an answer is being asked for or written');
  assert.equal(escapeWanted({ busy: false, windows: [win(true)] }), true, 'a drawing is up');
  assert.equal(escapeWanted({ busy: true, windows: [] }), false, 'no window to show it on');
  assert.equal(escapeWanted({ busy: true, windows: [win(true, false), win(false, false)] }), false, 'only dead windows');
  assert.equal(escapeWanted({ busy: false, windows: [win(true, false), win(false, true), win(true, true)] }), true, 'one live window with a drawing is enough');
});

test('it is not taken before an answer, is taken when one begins, and is given back when the answer is over', () => {
  const r = rig();
  r.escape.open(1);
  assert.deepEqual(r.calls, [], 'a window with nothing on it does not take Escape');
  r.busy(true);
  r.escape.refresh();
  assert.deepEqual(r.calls, ['register Escape']);
  assert.equal(r.escape.held, true);
  r.escape.refresh();
  assert.deepEqual(r.calls, ['register Escape'], 'taken once, not again');
  r.busy(false);
  r.escape.refresh();
  assert.deepEqual(r.calls, ['register Escape', 'unregister Escape']);
  assert.equal(r.escape.held, false);
});

test('a drawing that is up holds it, and the page saying it is gone gives it back', () => {
  const r = rig();
  r.escape.open(1);
  r.escape.showing(1, true);
  assert.equal(r.escape.held, true);
  r.escape.showing(1, false);
  assert.equal(r.escape.held, false);
  assert.deepEqual(r.calls, ['register Escape', 'unregister Escape']);
});

test(`a page that goes quiet (dies, hangs) gives it back when its lease of ${SHOWING_LEASE_MS} ms runs out, and saying it again keeps it`, () => {
  const r = rig();
  r.escape.open(1);
  r.escape.showing(1, true);
  r.escape.showing(1, true); // said again: the lease starts over, no second registration
  assert.equal(r.t.count(), 1);
  assert.deepEqual(r.calls, ['register Escape']);
  r.t.fire(); // silence
  assert.equal(r.escape.held, false);
  assert.deepEqual(r.calls, ['register Escape', 'unregister Escape']);
});

test('the window closing, every window closing, and the manager going away each give it back, even while an answer is being written', () => {
  const closing = rig();
  closing.escape.open(1);
  closing.escape.open(2);
  closing.busy(true);
  closing.escape.refresh();
  assert.equal(closing.escape.held, true);
  closing.escape.close(1);
  assert.equal(closing.escape.held, true, 'the other window is still there');
  closing.escape.close(2);
  assert.equal(closing.escape.held, false, 'no window left to show the answer on');

  const drawing = rig();
  drawing.escape.open(1);
  drawing.escape.showing(1, true);
  drawing.escape.close(1);
  assert.equal(drawing.escape.held, false, 'the window with the drawing closed');
  assert.equal(drawing.t.count(), 0, 'and its lease timer went with it');

  const going = rig();
  going.escape.open(1);
  going.busy(true);
  going.escape.refresh();
  going.escape.showing(1, true);
  going.escape.dispose();
  assert.equal(going.escape.held, false);
  going.escape.open(1);
  going.escape.refresh();
  assert.equal(going.escape.held, false, 'once disposed it is never taken again');
});

test('nothing is ever taken when keys are off (a check run), and a key another program owns is tried again next time', () => {
  const check = rig({ enabled: false });
  check.escape.open(1);
  check.busy(true);
  check.escape.refresh();
  check.escape.showing(1, true);
  assert.deepEqual(check.calls, []);
  assert.equal(check.escape.held, false);

  const other = rig({ owned: false });
  other.escape.open(1);
  other.busy(true);
  other.escape.refresh();
  assert.equal(other.escape.held, false);
  other.other(true);
  other.escape.refresh();
  assert.equal(other.escape.held, true);
  assert.equal(other.calls.filter((c) => c === 'register Escape').length, 2);
});

// ---- what Escape does to the session ----------------------------------------------------------------------------------------------------

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
const step = (say: string) => ({ say, actions: [{ op: 'box', id: 'b', x: 100, y: 100, w: 200, h: 100, color: 'red' }] });

function sessionRig(model: () => Model) {
  const sent: SceneMessage[] = [];
  const calls: string[] = [];
  const pens: Array<number | null> = [];
  const lines: string[] = [];
  const speech: SpeechToText = { id: 'fake', transcribe: async () => ({ text: 'what is this' }) };
  const deps: SessionDeps = {
    pointerDisplayId: () => 7,
    media: {
      startMic: async () => void calls.push('startMic'),
      stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
      abortMic: () => void calls.push('abortMic'),
      capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 }),
    },
    setPen: (id) => void pens.push(id),
    speech,
    model,
    send: (_id, m) => void sent.push(m),
    log: (l) => void lines.push(l),
    micWindowMs: 40,
  };
  return { session: createSession(deps), sent, calls, pens, lines };
}

/** A model that writes one step and then goes on writing (waiting on its abort signal) until it is stopped. */
function endlessModel(seen: { aborted: boolean; asked: number }): Model {
  return {
    id: 'endless',
    async *ask(req): AsyncGenerator<ModelOutput> {
      seen.asked++;
      yield { type: 'step', step: step('One.') };
      await new Promise<void>((resolve) => {
        if (req.signal?.aborted) return resolve();
        req.signal?.addEventListener('abort', () => resolve());
      });
      seen.aborted = req.signal?.aborted === true;
      if (!seen.aborted) yield { type: 'step', step: step('Two, that should never be written.') };
    },
  };
}

test('Escape while the keys are held cancels the question as a right click does: the microphone is let go, the pen is given back, nothing is asked', async () => {
  const seen = { aborted: false, asked: 0 };
  const r = sessionRig(() => endlessModel(seen));
  assert.equal(r.session.busy(), false);
  r.session.arm();
  r.session.start();
  assert.equal(r.session.busy(), true, 'the keys are held: Escape is ours');
  assert.equal(r.session.escape(), 'cancelled');
  assert.ok(r.calls.includes('abortMic'));
  assert.deepEqual(r.pens, [7, null], 'the pen window is given back at once');
  assert.deepEqual(r.sent.filter((m) => m.kind === 'notice'), [{ kind: 'notice', text: 'Cancelled.', level: 'info' }]);
  assert.equal(r.session.busy(), false, 'and Escape is given back');
  r.session.stop(); // the keys come up afterwards
  await wait(200);
  assert.equal(seen.asked, 0, 'no question was asked');
  assert.equal(r.session.escape(), 'nothing');
});

test('Escape while an answer is being written stops the model call, so no more steps are written, and the session is no longer busy', async () => {
  const seen = { aborted: false, asked: 0 };
  const r = sessionRig(() => endlessModel(seen));
  r.session.arm();
  r.session.start();
  r.session.stop();
  await wait(100);
  assert.equal(seen.asked, 1);
  assert.equal(r.session.busy(), true, 'the model is still writing');
  assert.equal(r.session.escape(), 'stopped');
  await wait(100);
  assert.equal(seen.aborted, true, 'the model call was aborted');
  assert.equal(r.session.busy(), false);
  const said = r.sent.filter((m) => m.kind === 'step-open' || m.kind === 'step').length;
  assert.equal(said, 1, 'only the first step was ever sent');
  assert.equal(r.sent.some((m) => m.kind === 'notice' && m.level === 'error'), false, 'a stop is not an error');
  assert.ok(r.lines.some((l) => l.includes('stopped with Escape')));
  assert.equal(r.session.escape(), 'nothing', 'a second press finds nothing to stop');
});

test('Escape with nothing going on does nothing', () => {
  const r = sessionRig(() => createScriptedModel([step('One.')]));
  assert.equal(r.session.escape(), 'nothing');
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.pens, []);
});

// ---- what Escape does to the drawing -------------------------------------------------------------------------------------------------

test('Escape fades the drawing out quickly, not at the pace of an answer that has finished', () => {
  const normal = new AutoFade(12_000);
  normal.arm(0);
  assert.equal(normal.alpha(1000), 1, 'an answer that finished is still up');
  const hit = new AutoFade(12_000);
  hit.arm(0);
  hit.dismiss(1000);
  assert.equal(hit.dismissed, true);
  assert.equal(hit.alpha(1000), 1);
  const half = hit.alpha(1000 + DISMISS_FADE_MS / 2);
  assert.ok(half < 1 && half > 0, 'part way through the quick fade');
  assert.equal(hit.alpha(1000 + DISMISS_FADE_MS), 0);
  assert.ok(DISMISS_FADE_MS < FADE_MS);
  assert.equal(hit.untilChange(1000 + DISMISS_FADE_MS + 1), undefined, 'and it is gone');
  hit.disarm();
  assert.equal(hit.dismissed, false);
  assert.equal(hit.alpha(5000), 1, 'new content shows in full again');
});

test('the pointer moving over the scene does not bring back a drawing Escape has dismissed', () => {
  const fade = new AutoFade(12_000);
  fade.arm(0);
  fade.dismiss(1000);
  fade.touch(1100); // the page touches the fade on every mouse move over the model
  assert.equal(fade.dismissed, true);
  assert.ok(fade.alpha(1100) < 1, 'the touch did not start the count again: it is already fading');
  assert.equal(fade.alpha(1000 + DISMISS_FADE_MS), 0, 'and it goes on to nothing');
  assert.equal(fade.alpha(4100), 0);
  const normal = new AutoFade(4000);
  normal.arm(0);
  normal.touch(3000);
  assert.equal(normal.alpha(6000), 1, 'an ordinary scene still starts its count again when touched');
});
