import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAudioSink } from '../src/overlay/web-audio-sink.ts';
import type { BufferLike, ContextLike, SourceLike } from '../src/overlay/web-audio-sink.ts';

/** A stand-in for the page's audio output: a clock the test turns, and sources that say when they were scheduled and can be finished. */
function rig(options: { prebufferMs?: number; latency?: number } = {}) {
  let now = 1;
  const sources: Array<SourceLike & { at: number; frames: number; channels: number; data: Float32Array[]; stopped: boolean; finish(): void }> = [];
  const timers: Array<{ at: number; run(): void; live: boolean }> = [];
  const ctx: ContextLike = {
    get currentTime() { return now; },
    state: 'suspended',
    ...(options.latency !== undefined ? { outputLatency: options.latency } : {}),
    destination: {},
    resume: () => { (ctx as { state: string }).state = 'running'; return Promise.resolve(); },
    createBuffer(channels, length, rate): BufferLike {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / rate, getChannelData: (c) => data[c]!, ...({ data, channels, length } as object) } as BufferLike;
    },
    createBufferSource() {
      const s = {
        buffer: null as unknown, onended: null as (() => void) | null, at: -1, frames: 0, channels: 0, data: [] as Float32Array[], stopped: false,
        connect() {}, disconnect() {},
        start(when: number) {
          s.at = when;
          const b = s.buffer as { data: Float32Array[]; length: number; channels: number };
          s.data = b.data; s.frames = b.length; s.channels = b.channels;
        },
        stop() { s.stopped = true; },
        finish() { s.onended?.(); },
      };
      sources.push(s);
      return s;
    },
  };
  const sink = createWebAudioSink({
    context: () => ctx, prebufferMs: options.prebufferMs ?? 100,
    after: (ms, run) => { const t = { at: now + ms / 1000, run, live: true }; timers.push(t); return () => void (t.live = false); },
  });
  return {
    sink, sources, ctx,
    turn(seconds: number) { now += seconds; for (const t of timers.filter((x) => x.live && x.at <= now)) { t.live = false; t.run(); } },
  };
}

const seconds = (s: number, rate = 24000, channels = 1) => new Float32Array(Math.round(s * rate) * channels).fill(0.25);

test('sound is held until there is a little of it, then scheduled end to end; started is called when it is heard, not when it is scheduled', () => {
  const r = rig({ latency: 0.02 });
  const log: string[] = [];
  const p = r.sink.open({ sampleRate: 24000, channels: 1 }, { started: () => log.push('started'), ended: () => log.push('ended') });
  p.push(seconds(0.05));
  assert.equal(r.sources.length, 0, 'under the prebuffer: nothing is scheduled yet');
  p.push(seconds(0.06));
  assert.equal(r.sources.length, 2, 'now both are');
  assert.ok(Math.abs(r.sources[1]!.at - (r.sources[0]!.at + 0.05)) < 1e-9, 'the second follows the first exactly');
  assert.equal(r.ctx.state, 'running', 'a suspended output is woken');
  assert.deepEqual(log, []);
  r.turn(0.04);
  assert.deepEqual(log, [], 'scheduled 30 ms ahead, plus the output delay of 20 ms: not yet');
  r.turn(0.02);
  assert.deepEqual(log, ['started']);
  p.push(seconds(0.2));
  assert.ok(Math.abs(r.sources[2]!.at - (r.sources[1]!.at + 0.06)) < 1e-9);
  p.finish();
  assert.deepEqual(log, ['started'], 'not ended while sound is still to be heard');
  r.sources[0]!.finish();
  r.sources[1]!.finish();
  assert.deepEqual(log, ['started']);
  r.sources[2]!.finish();
  assert.deepEqual(log, ['started', 'ended']);
});

test('a short utterance that never reaches the prebuffer is played when the audio ends; with no sound at all it ends at once', () => {
  const r = rig({ prebufferMs: 500 });
  const log: string[] = [];
  const p = r.sink.open({ sampleRate: 24000, channels: 1 }, { started: () => log.push('started'), ended: () => log.push('ended') });
  p.push(seconds(0.1));
  assert.equal(r.sources.length, 0);
  p.finish();
  assert.equal(r.sources.length, 1);
  r.turn(0.1);
  r.sources[0]!.finish();
  assert.deepEqual(log, ['started', 'ended']);
  const none: string[] = [];
  r.sink.open({ sampleRate: 24000, channels: 1 }, { started: () => none.push('started'), ended: () => none.push('ended') }).finish();
  assert.deepEqual(none, ['ended']);
});

test('stereo samples are split into their channels', () => {
  const r = rig({ prebufferMs: 10 });
  const p = r.sink.open({ sampleRate: 24000, channels: 2 }, { started() {}, ended() {} });
  const s = new Float32Array(480 * 2);
  for (let i = 0; i < 480; i++) { s[i * 2] = 0.5; s[i * 2 + 1] = -0.5; }
  p.push(s);
  assert.equal(r.sources[0]!.frames, 480);
  assert.equal(r.sources[0]!.data[0]![10], 0.5);
  assert.equal(r.sources[0]!.data[1]![10], -0.5);
});

test('a stream that arrives late (a slow server) is scheduled from now, not in the past', () => {
  const r = rig({ prebufferMs: 10 });
  const p = r.sink.open({ sampleRate: 24000, channels: 1 }, { started() {}, ended() {} });
  p.push(seconds(0.1));
  const first = r.sources[0]!.at;
  r.turn(1); // the sound ran out a long time ago
  p.push(seconds(0.1));
  assert.ok(r.sources[1]!.at > first + 0.1 + 0.5, `scheduled at ${r.sources[1]!.at}, now is ${r.ctx.currentTime}`);
  assert.ok(r.sources[1]!.at >= r.ctx.currentTime);
});

test('stop silences what is scheduled and calls nothing back', () => {
  const r = rig({ prebufferMs: 10 });
  const log: string[] = [];
  const p = r.sink.open({ sampleRate: 24000, channels: 1 }, { started: () => log.push('started'), ended: () => log.push('ended') });
  p.push(seconds(0.2));
  p.push(seconds(0.2));
  p.stop();
  assert.deepEqual(r.sources.map((s) => s.stopped), [true, true]);
  r.turn(1);
  r.sources[0]!.finish();
  p.finish();
  p.push(seconds(0.1));
  assert.deepEqual(log, []);
  assert.equal(r.sources.length, 2, 'nothing more is scheduled');
});

test('the speaker the person chose is the output the sound is made on; a speaker that has gone gives the default and says so once', () => {
  const made: Array<string | undefined> = [];
  const fakeContext = (id?: string): ContextLike => {
    made.push(id);
    if (id === 'gone') throw new Error('the device was not found');
    return rig().ctx;
  };
  const lost: string[] = [];
  const chosen = createWebAudioSink({ context: fakeContext, sinkId: 'headset', onSinkLost: (why) => lost.push(why) });
  chosen.open({ sampleRate: 24000, channels: 1 }, { started() {}, ended() {} }).push(seconds(0.2));
  assert.deepEqual(made, ['headset']);
  assert.equal(lost.length, 0);

  made.length = 0;
  const missing = createWebAudioSink({ context: fakeContext, sinkId: 'gone', onSinkLost: (why) => lost.push(why) });
  const p = missing.open({ sampleRate: 24000, channels: 1 }, { started() {}, ended() {} });
  p.push(seconds(0.2));
  missing.open({ sampleRate: 24000, channels: 1 }, { started() {}, ended() {} }).push(seconds(0.2));
  assert.deepEqual(made, ['gone', undefined], 'the default is made once, after the chosen one failed');
  assert.deepEqual(lost, ['the device was not found'], 'said once');

  made.length = 0;
  createWebAudioSink({ context: fakeContext }).open({ sampleRate: 24000, channels: 1 }, { started() {}, ended() {} }).push(seconds(0.2));
  assert.deepEqual(made, [undefined], 'no speaker chosen: the default, nothing asked for');
});
