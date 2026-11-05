// Development tools for recording a live run as a viewer would see it (never used by the app itself, and only when asked for on the
// command line): the overlay window's picture piped to ffmpeg while the run goes on, the voice server's audio saved as it was sent, a small
// script of mouse moves and button presses run after the answer (turn the model, press Explode and Cut), a tape of what the model said with its
// timing (to play the same answer again with the same delays, no model asked), and a voice that plays audio made beforehand.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWavDecoder } from '../adapters/http-voice.ts';
import type { VoiceEvent } from '../adapters/http-voice.ts';
import type { Model, ModelOutput } from '../adapters/model.ts';
import type { VoiceBridge } from './voice-bridge.ts';

/** What the recorder needs of a window: a picture of it now, as raw BGRA bytes at the stated size. */
export type FrameSource = () => Promise<{ bitmap: Buffer; width: number; height: number } | null>;

export type Recorder = {
  /** Starts the video: frames go to ffmpeg from now on. Returns when the first frame was written (the epoch the audio is placed against). */
  start(): void;
  /** Ends the video and waits for the file to be finished. Resolves with the wall-clock time (ms since the epoch) of the first frame. */
  stop(): Promise<number | undefined>;
};

/** Records the window to `file` (H.264, no sound) at `fps`, by timing each frame by when it arrived. `ffmpeg` is the executable to run. */
export function createRecorder(options: { source: FrameSource; width: number; height: number; fps: number; file: string; ffmpeg: string; log: (line: string) => void }): Recorder {
  const { width, height, fps } = options;
  let child: ReturnType<typeof spawn> | undefined;
  let running = false;
  let first: number | undefined;
  let loop: Promise<void> = Promise.resolve();
  let frames = 0;
  let closed = false;
  let closedWait: Promise<void> = Promise.resolve();
  const minGap = 1000 / (fps * 1.5);
  return {
    start() {
      if (running) return;
      running = true;
      child = spawn(options.ffmpeg, [
        '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-video_size', `${width}x${height}`, '-use_wallclock_as_timestamps', '1', '-i', '-',
        '-vf', `fps=${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', options.file,
      ], { stdio: ['pipe', 'ignore', 'pipe'] });
      const c = child;
      // ffmpeg that cannot start, or that ends early, ends the recording (the loop below stops, and so does stop()) instead of waiting on it.
      closedWait = new Promise<void>((resolve) => {
        c.once('error', (error) => {
          options.log(`record: ffmpeg could not run: ${error.message}`);
          closed = true;
          running = false;
          resolve();
        });
        c.once('close', () => {
          if (running) options.log('record: ffmpeg ended before the recording did');
          closed = true;
          running = false;
          resolve();
        });
      });
      child.stderr?.on('data', (d: Buffer) => options.log(`ffmpeg: ${d.toString().trim()}`));
      child.stdin?.on('error', () => undefined);
      loop = (async () => {
        while (running) {
          const t0 = Date.now();
          const frame = await options.source().catch(() => null);
          if (!running || !frame || !child?.stdin) break;
          if (frame.width !== width || frame.height !== height) {
            options.log(`record: the window is ${frame.width}x${frame.height}, not ${width}x${height}`);
            break;
          }
          if (first === undefined) first = Date.now();
          if (!child.stdin.write(frame.bitmap)) await Promise.race([new Promise<void>((resolve) => child?.stdin?.once('drain', () => resolve())), closedWait]);
          frames++;
          const wait = minGap - (Date.now() - t0);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
      })();
    },
    async stop() {
      const wasRunning = running;
      running = false;
      if (!wasRunning && !child) return first;
      await loop;
      const c = child;
      if (c && !closed) {
        c.stdin?.end();
        await closedWait;
      }
      options.log(`record: ${frames} frames written to the video`);
      return first;
    },
  };
}

/** A WAV file (16-bit PCM) of interleaved samples in -1..1. */
export function wavFromPcm(chunks: ReadonlyArray<Float32Array>, sampleRate: number, channels: number): Buffer {
  let count = 0;
  for (const c of chunks) count += c.length;
  const out = Buffer.alloc(44 + count * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + count * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(count * 2, 40);
  let at = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i] as number)) * 32767), at);
      at += 2;
    }
  }
  return out;
}

export type SavedVoice = { n: number; text: string; /** When the first audio arrived, ms since the epoch. */ at: number; ms: number; file: string };

/**
 * Wraps a voice bridge so each utterance's audio is also written to `dir` as `<n>.wav`, and `voice.json` lists them with the text and the
 * time the audio began to arrive (the page starts playing about a tenth of a second of sound later). The page still gets every event.
 */
export function saveVoice(bridge: VoiceBridge, dir: string, log: (line: string) => void, now: () => number = () => Date.now()): VoiceBridge & { saved(): SavedVoice[] } {
  mkdirSync(dir, { recursive: true });
  const saved: SavedVoice[] = [];
  let n = 0;
  return {
    speak(key, text, send, group) {
      const index = ++n;
      let format: { sampleRate: number; channels: number } | undefined;
      let at = 0;
      const chunks: Float32Array[] = [];
      bridge.speak(key, text, (event: VoiceEvent) => {
        if (event.kind === 'format') {
          format = { sampleRate: event.sampleRate, channels: event.channels };
          at = now();
        } else if (event.kind === 'pcm') chunks.push(event.samples.slice());
        else if (event.kind === 'end' && format) {
          const file = `${String(index).padStart(2, '0')}.wav`;
          writeFileSync(join(dir, file), wavFromPcm(chunks, format.sampleRate, format.channels));
          let samples = 0;
          for (const c of chunks) samples += c.length;
          saved.push({ n: index, text, at, ms: Math.round((samples / format.channels / format.sampleRate) * 1000), file });
          writeFileSync(join(dir, 'voice.json'), JSON.stringify(saved, null, 1));
          log(`voice saved: ${file} (${text.length} characters, ${saved[saved.length - 1]?.ms} ms of sound)`);
        }
        send(event);
      }, group);
    },
    cancel: (key) => bridge.cancel(key),
    cancelGroup: (group) => bridge.cancelGroup(group),
    dispose: () => bridge.dispose(),
    saved: () => saved,
  };
}

/** One thing to do on the overlay's window. Positions are in the page's pixels; `anchor` names a button whose top-left corner they are measured from. */
export type DriveStep =
  | { wait: number }
  | { click: string }
  | { until: string; max: number }
  | { gone: string; max: number }
  | { drag: { anchor: string; from: [number, number]; to: [number, number]; ms: number } };

/** What the driver may do to a window: send a mouse event, and ask the page where an element is. */
export type DriveTarget = {
  input(event: { type: 'mouseMove' | 'mouseDown' | 'mouseUp'; x: number; y: number; button?: 'left'; clickCount?: number; modifiers?: 'leftbuttondown'[] }): void;
  /** Presses a button by the route a click on it takes in the app (a click on the page itself is taken by the model it lies over). */
  press(id: string): void;
  rectOf(id: string): Promise<{ x: number; y: number; w: number; h: number; text: string } | null>;
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the steps on the window with ordinary mouse events (the page cannot tell them from a person's). Resolves when they are done. */
export async function runDrive(target: DriveTarget, steps: ReadonlyArray<DriveStep>, log: (line: string) => void): Promise<void> {
  for (const step of steps) {
    if ('wait' in step) {
      await pause(step.wait);
    } else if ('gone' in step) {
      // Waits for a button to go (a long job has begun), for at most `max` ms.
      const end = Date.now() + step.max;
      while (Date.now() < end && (await target.rectOf(step.gone))) await pause(300);
      log(`drive: ${step.gone} ${(await target.rectOf(step.gone)) ? 'did not go' : 'is gone'}`);
    } else if ('until' in step) {
      // Waits for a button to show (the model has settled), for at most `max` ms.
      const end = Date.now() + step.max;
      while (Date.now() < end && !(await target.rectOf(step.until))) await pause(300);
      log(`drive: ${step.until} ${(await target.rectOf(step.until)) ? 'is showing' : 'did not show'}`);
    } else if ('click' in step) {
      const r = await target.rectOf(step.click);
      if (!r) {
        log(`drive: no ${step.click} to press`);
        continue;
      }
      const x = Math.round(r.x + r.w / 2), y = Math.round(r.y + r.h / 2);
      target.input({ type: 'mouseMove', x: x - 6, y });
      await pause(150);
      target.input({ type: 'mouseMove', x, y });
      await pause(250);
      target.press(step.click);
      await pause(500);
      log(`drive: pressed ${step.click} (read "${r.text}", now reads "${(await target.rectOf(step.click))?.text ?? ''}")`);
    } else {
      const { anchor, from, to, ms } = step.drag;
      const a = await target.rectOf(anchor);
      if (!a) {
        log(`drive: no ${anchor} to measure from`);
        continue;
      }
      const at = (u: number): { x: number; y: number } => {
        const e = u * u * (3 - 2 * u);
        return { x: Math.round(a.x + from[0] + (to[0] - from[0]) * e), y: Math.round(a.y + from[1] + (to[1] - from[1]) * e) };
      };
      const start = at(0);
      target.input({ type: 'mouseMove', x: start.x, y: start.y });
      await pause(300);
      target.input({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 });
      const frames = Math.max(2, Math.round(ms / 16));
      for (let i = 1; i <= frames; i++) {
        const p = at(i / frames);
        target.input({ type: 'mouseMove', x: p.x, y: p.y, button: 'left', modifiers: ['leftbuttondown'] });
        await pause(16);
      }
      const end = at(1);
      target.input({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1 });
      log('drive: turned the model');
    }
  }
}

/** One call to the model as it was: what it yielded, and how long after the call began each piece came. */
export type TapeCall = {
  /** The model's whole raw text of the call (where the caller asked for it), which the step-by-step wrapper reads its plan from. */
  raw?: string;
  outputs: Array<{ at: number; output: ModelOutput }>;
};

/** Wraps a model so every call's output is written to `file` (as a tape of calls) as the answer comes; the wrapped model answers as always. */
export function tapeModel(inner: Model, file: string, log: (line: string) => void): Model {
  const calls: TapeCall[] = [];
  return {
    id: inner.id,
    ...(inner.warm ? { warm: () => inner.warm!() } : {}),
    ...(inner.prime ? { prime: () => inner.prime!() } : {}),
    ...(inner.unprime ? { unprime: () => inner.unprime!() } : {}),
    ...(inner.close ? { close: () => inner.close!() } : {}),
    async *ask(request) {
      const call: TapeCall = { outputs: [] };
      calls.push(call);
      const t0 = Date.now();
      try {
        for await (const output of inner.ask({ ...request, onRaw: (text: string) => { call.raw = text; request.onRaw?.(text); } })) {
          call.outputs.push({ at: Date.now() - t0, output });
          yield output;
        }
      } finally {
        writeFileSync(file, JSON.stringify({ calls }, null, 1));
        log(`tape: ${calls.length} call(s) written`);
      }
    },
  };
}

/** A model that answers from a tape written by `tapeModel`: the same pieces, each after the same time from the start of its call. No network, no process. */
export function replayModel(file: string, log: (line: string) => void): Model {
  const tape = JSON.parse(readFileSync(file, 'utf8')) as { calls: TapeCall[] };
  let next = 0;
  return {
    id: 'replay',
    async *ask(request) {
      const call = tape.calls[next++];
      if (!call) {
        log(`tape: no call ${next} on the tape`);
        return;
      }
      const t0 = Date.now();
      for (const { at, output } of call.outputs) {
        const wait = t0 + at - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        if (request.signal?.aborted) return;
        yield output;
      }
      if (call.raw !== undefined) request.onRaw?.(call.raw);
    },
  };
}

/** A voice bridge that answers from audio made beforehand: `dir/voice.json` lists `{ text, file }` and the files are the server's own WAV answers. */
export function recordedVoice(dir: string, log: (line: string) => void): VoiceBridge {
  const entries = JSON.parse(readFileSync(join(dir, 'voice.json'), 'utf8')) as Array<{ text: string; file: string }>;
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const used = new Set<number>();
  return {
    speak(_key, text, send) {
      let at = entries.findIndex((e, i) => !used.has(i) && squash(e.text) === squash(text));
      if (at < 0) at = entries.findIndex((e, i) => !used.has(i) && squash(text).startsWith(squash(e.text)));
      const entry = entries[at];
      if (!entry) {
        log(`voice: no recording for "${text.slice(0, 60)}"`);
        send({ kind: 'error', message: 'no recording for these words' });
        return;
      }
      used.add(at);
      setTimeout(() => {
        const decoder = createWavDecoder();
        const got = decoder.push(readFileSync(join(dir, entry.file)));
        if (!got.format) {
          send({ kind: 'error', message: 'the recording is not a WAV' });
          return;
        }
        log(`voice: playing ${entry.file} for "${text.slice(0, 40)}"`);
        send({ kind: 'format', sampleRate: got.format.sampleRate, channels: got.format.channels, ...(got.format.estimatedMs !== undefined ? { estimatedMs: got.format.estimatedMs } : {}) });
        if (got.samples) send({ kind: 'pcm', samples: got.samples });
        send({ kind: 'end' });
      }, 0);
    },
    cancel: () => undefined,
    cancelGroup: () => undefined,
    dispose: () => undefined,
  };
}
