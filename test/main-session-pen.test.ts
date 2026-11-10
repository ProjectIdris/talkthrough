import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/main/session.ts';

// The pen after a click on the background: a stale dismissal never ends a question whose keys are held, and the log says when the pen was
// turned on and when a stroke was turned away.

const circle: Array<[number, number]> = [[300, 300], [450, 300], [450, 450], [300, 450], [300, 300]];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function rig() {
  const logs: string[] = [], recorded: number[][] = [], pens: Array<number | null> = [];
  let releaseSpeech: (() => void) | undefined;
  const mic = { samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 0 };
  const media = {
    startMic: async () => {}, stopMic: () => Promise.resolve(mic), abortMic: () => {},
    capture: async () => ({ screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 10, height: 10 }, ms: 0, grabId: 3 }),
    compose: async () => ({ screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 10, height: 10 }, focus: [] }), release: () => {},
  };
  const record = new Proxy({ strokes: (v: Array<Array<[number, number]>>) => recorded.push(v.map((x) => x.length)) }, { get: (o, k) => (k in o ? o[k as 'strokes'] : () => {}) });
  const session = createSession({
    pointerDisplayId: () => 7, media, setPen: (d: number | null) => pens.push(d),
    speech: { id: 'fake', transcribe: () => new Promise((r) => { releaseSpeech = () => r({ text: 'test' }); }) },
    model: () => ({ id: 'stub', ask: async function* () {} }), send: () => {}, log: (l: string) => logs.push(l), record: record as never, micWindowMs: 40, penFlush: true,
  } as never);
  return { session, logs, recorded, pens, releaseSpeech: () => releaseSpeech?.() };
}

test('a click on the background while the keys are held does not end the question: the pen stays on and the strokes count', async () => {
  const r = rig();
  r.session.arm(); r.session.start();
  r.session.dismiss(); // a press left over from before the keys went down
  assert.deepEqual(r.pens, [7], 'the pen was not turned off');
  r.session.stroke(7, { id: 1, points: circle, done: true, attemptId: 1 });
  r.session.stop(); r.session.penFlushed(7, 1);
  await tick();
  assert.deepEqual(r.recorded, [[5]], 'the stroke is part of the question');
  assert.ok(r.logs.some((l) => l.startsWith('dismissal ignored')), 'and the log says the dismissal was ignored');
  r.releaseSpeech(); r.session.dispose();
});

test('the log says when the pen is turned on, and once when strokes are turned away and why', () => {
  const r = rig();
  r.session.arm(); r.session.start();
  assert.ok(r.logs.some((l) => /^pen: on for display 7 \(press 1\)/.test(l)), r.logs.join('\n'));
  r.session.stroke(8, { id: 1, points: circle, done: true, attemptId: 1 });
  r.session.stroke(8, { id: 2, points: circle, done: true, attemptId: 1 });
  r.session.stroke(7, { id: 3, points: circle, done: true, attemptId: 9 });
  const refused = r.logs.filter((l) => l.startsWith('pen: a stroke was refused'));
  assert.equal(refused.length, 2, `one per reason, not one per piece: ${refused.join(' | ')}`);
  assert.match(refused[0]!, /display 8/);
  assert.match(refused[1]!, /press 9/);
  r.session.stroke(7, { id: 4, points: circle, done: true, attemptId: 1 });
  assert.equal(r.logs.filter((l) => l.startsWith('pen: a stroke was refused')).length, 2, 'an accepted stroke is not logged');
  r.session.dispose();
});
