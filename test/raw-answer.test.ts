import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOutputStream } from '../src/adapters/subscription-shared.ts';
import type { Model, ModelRequest } from '../src/adapters/model.ts';
import { createScriptedModel } from '../src/adapters/scripted-model.ts';
import { createSession } from '../src/main/session.ts';
import type { SessionDeps } from '../src/main/session.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scene = '{"steps":[{"say":"Hi.","actions":[{"op":"box","id":"b","x":1,"y":1,"w":10,"h":10,"color":"red"}]}]}';

test('the raw text of an answer is handed over once, whole, when it ends; nothing is kept when nobody asks', () => {
  const seen: string[] = [];
  const stream = createOutputStream(false, (t) => seen.push(t));
  stream.push(scene.slice(0, 20));
  assert.deepEqual(seen, []);
  stream.push(scene.slice(20));
  stream.end();
  stream.end();
  assert.deepEqual(seen, [scene]);
  const quiet = createOutputStream();
  quiet.push(scene);
  quiet.end();
});

test('a garbled answer still hands over its raw text, with the error, so it can be read afterwards', () => {
  const seen: string[] = [];
  const stream = createOutputStream(false, (t) => seen.push(t));
  const bad = '{"steps":[{"say":"x","actions":[{"op":"box"}}]}]}';
  assert.throws(() => stream.push(bad), /mismatched brackets/);
  assert.deepEqual(seen, [bad]);
});

test('the session asks the model for the raw text only when text logging is on, and logs it as one line', async () => {
  const asked: Array<ModelRequest['onRaw']> = [];
  const model = (): Model => ({
    id: 'probe',
    async *ask(req) {
      asked.push(req.onRaw);
      req.onRaw?.(scene);
      yield* createScriptedModel([{ say: 'One.', actions: [] }]).ask(req);
    },
  });
  const run = async (logText: boolean): Promise<string[]> => {
    const lines: string[] = [];
    const deps: SessionDeps = {
      pointerDisplayId: () => 7,
      media: {
        startMic: async () => undefined,
        stopMic: async () => ({ samples: new Float32Array(16), sampleRate: 16000, durationMs: 1500, startLatencyMs: 100 }),
        abortMic: () => undefined,
        capture: async () => ({ screenshot: { mime: 'image/png', base64: 'AAAA', width: 10, height: 10 }, ms: 5, grabId: 3 }),
      },
      setPen: () => undefined,
      speech: { id: 'fake', transcribe: async () => ({ text: 'what is this' }) },
      model,
      send: () => undefined,
      log: (l) => void lines.push(l),
      micWindowMs: 40,
      ...(logText ? { logText } : {}),
    };
    const session = createSession(deps);
    session.arm();
    session.start();
    session.stop();
    await wait(80);
    return lines;
  };
  const off = await run(false);
  assert.equal(asked.at(-1), undefined);
  assert.ok(!off.some((l) => l.startsWith('answer-raw')));
  const on = await run(true);
  assert.equal(typeof asked.at(-1), 'function');
  assert.ok(on.includes(`answer-raw ${JSON.stringify(scene)}`));
});
