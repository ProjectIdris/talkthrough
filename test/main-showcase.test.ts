import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWavDecoder } from '../src/adapters/http-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import type { Model, ModelOutput, ModelRequest } from '../src/adapters/model.ts';
import { createRecorder, recordedVoice, replayModel, runDrive, tapeModel, wavFromPcm } from '../src/main/showcase.ts';
import type { DriveTarget } from '../src/main/showcase.ts';

const dir = mkdtempSync(join(tmpdir(), 'showcase-test-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const request = { question: 'q', signal: undefined } as unknown as ModelRequest;
const collect = async (model: Model): Promise<ModelOutput[]> => {
  const out: ModelOutput[] = [];
  for await (const o of model.ask(request)) out.push(o);
  return out;
};

test('wavFromPcm writes a WAV the server-side decoder reads back to the same samples', () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 0.25]);
  const decoder = createWavDecoder();
  const got = decoder.push(wavFromPcm([samples.subarray(0, 4), samples.subarray(4)], 24000, 1));
  assert.deepEqual(got.format && { sampleRate: got.format.sampleRate, channels: got.format.channels }, { sampleRate: 24000, channels: 1 });
  assert.equal(got.samples?.length, samples.length);
  samples.forEach((s, i) => assert.ok(Math.abs((got.samples?.[i] ?? 9) - s) < 0.001, `sample ${i}`));
});

test('a tape keeps each call\'s pieces with their timing, and a replay gives the same pieces, each no sooner than it came', async () => {
  const file = join(dir, 'tape.json');
  const say: ModelOutput = { type: 'say', say: 'Hello.' };
  const step: ModelOutput = { type: 'step', step: { say: 'Hello.', actions: [] } };
  const inner: Model = {
    id: 'inner',
    async *ask() {
      yield say;
      await new Promise((r) => setTimeout(r, 60));
      yield step;
    },
  };
  const lines: string[] = [];
  assert.deepEqual(await collect(tapeModel(inner, file, (l) => lines.push(l))), [say, step]);
  const tape = JSON.parse(readFileSync(file, 'utf8')) as { calls: Array<{ outputs: Array<{ at: number }> }> };
  assert.equal(tape.calls.length, 1);
  assert.ok((tape.calls[0]?.outputs[1]?.at ?? 0) >= 55, 'the second piece came about 60 ms after the call began');
  const replay = replayModel(file, (l) => lines.push(l));
  const t0 = Date.now();
  assert.deepEqual(await collect(replay), [say, step]);
  assert.ok(Date.now() - t0 >= 55, 'the replay waited as the live call did');
  assert.deepEqual(await collect(replay), [], 'a call past the end of the tape yields nothing');
  assert.ok(lines.some((l) => l.includes('no call 2')));
});

test('a recorded voice sends the format, the samples and the end for words it has, and an error for words it has not', async () => {
  writeFileSync(join(dir, 'a.wav'), wavFromPcm([new Float32Array(2400).fill(0.1)], 24000, 1));
  writeFileSync(join(dir, 'voice.json'), JSON.stringify([{ text: 'The  piston moves.', file: 'a.wav' }]));
  const voice = recordedVoice(dir, () => undefined);
  const seen: VoiceEvent[] = [];
  voice.speak('k1', 'The piston moves.', (e) => seen.push(e));
  const missing: VoiceEvent[] = [];
  voice.speak('k2', 'Something never recorded.', (e) => missing.push(e));
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(seen.map((e) => e.kind), ['format', 'pcm', 'end']);
  const format = seen[0];
  assert.ok(format?.kind === 'format' && format.sampleRate === 24000 && format.channels === 1);
  assert.deepEqual(missing.map((e) => e.kind), ['error']);
});

test('the drive waits for a button, presses buttons by the app\'s own route, and turns the model with a held drag', async () => {
  const events: string[] = [];
  let shows = 0;
  const target: DriveTarget = {
    input: (e) => events.push(e.type),
    press: (id) => events.push(`press ${id}`),
    rectOf: async (id) => (id === 'explode' && ++shows < 3 ? null : { x: 100, y: 100, w: 60, h: 20, text: id }),
  };
  const lines: string[] = [];
  await runDrive(target, [
    { until: 'explode', max: 3000 },
    { drag: { anchor: 'explode', from: [-10, 10], to: [10, 10], ms: 64 } },
    { click: 'cut' },
  ], (l) => lines.push(l));
  assert.ok(lines.some((l) => l.includes('explode is showing')));
  assert.ok(events.indexOf('mouseDown') >= 0 && events.lastIndexOf('mouseUp') > events.indexOf('mouseDown'));
  assert.ok(events.includes('mouseMove'));
  assert.equal(events[events.length - 1], 'press cut');
  assert.ok(lines.some((l) => l.includes('pressed cut')));
});

test('a tape played again under the step-by-step wrapper gives all the steps the live answer gave (the plan the wrapper reads comes from the tape)', async () => {
  const { createClaudeModel } = await import('../src/adapters/claude-model.ts');
  const { createStepByStepModel } = await import('../src/adapters/step-by-step.ts');
  const { sceneSchemaChain } = await import('../src/scene/index.ts');
  const fakeClaude = new URL('./support/fake-claude.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const full = { question: 'what is this?', screenshot: { mime: 'image/png' as const, base64: 'AAAA', width: 4, height: 4 }, thread: [], schema: sceneSchemaChain } as ModelRequest;
  const says = async (model: Model): Promise<string[]> => {
    const out: string[] = [];
    for await (const o of model.ask(full)) if (o.type === 'step') out.push(String((o.step as { say: string }).say));
    return out;
  };
  process.env.FAKE_CHAIN = '1';
  const real = createClaudeModel({ command: process.execPath, prefixArgs: [fakeClaude], schema: sceneSchemaChain });
  const file = join(dir, 'chain-tape.json');
  try {
    const live = await says(createStepByStepModel(tapeModel(real, file, () => undefined), {}));
    assert.deepEqual(live, ['S1.', 'S2.', 'S3.'], 'the fake answers three steps, one to a call');
    const again = await says(createStepByStepModel(replayModel(file, () => undefined), {}));
    assert.deepEqual(again, live, 'the replay carries on to the later steps');
  } finally {
    delete process.env.FAKE_CHAIN;
    await real.close?.();
  }
});

test('a recorder whose ffmpeg is missing, or ends at once, ends the recording instead of hanging or crashing', async () => {
  const frame = { bitmap: Buffer.alloc(512 * 512 * 4), width: 512, height: 512 };
  for (const ffmpeg of [join(dir, 'no-such-ffmpeg.exe'), process.execPath]) {
    const lines: string[] = [];
    const recorder = createRecorder({ source: async () => frame, width: 512, height: 512, fps: 30, file: join(dir, 'never.mp4'), ffmpeg, log: (l) => lines.push(l) });
    recorder.start();
    const stopped = await Promise.race([recorder.stop().then(() => 'stopped'), new Promise((r) => setTimeout(() => r('hung'), 8000))]);
    assert.equal(stopped, 'stopped', `${ffmpeg === process.execPath ? 'an ffmpeg that ends early' : 'a missing ffmpeg'} must not hang stop()`);
  }
});
