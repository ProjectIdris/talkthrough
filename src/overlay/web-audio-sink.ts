// Plays streamed samples through the page's audio output: each piece is scheduled to follow the one before it, so what is heard
// is continuous while the server is still making the rest. `started` is called when the first sound is really heard (the
// scheduled time, plus the output's own delay), `ended` when the last piece has finished.

import type { AudioPlayback, AudioSink } from '../adapters/streamed-voice.ts';

/** The part of the Web Audio API this uses, so tests can stand in for it. */
export type ContextLike = {
  readonly currentTime: number;
  readonly state: string;
  readonly outputLatency?: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): SourceLike;
};
export type BufferLike = { readonly duration: number; getChannelData(channel: number): Float32Array };
export type SourceLike = { buffer: unknown; onended: (() => void) | null; connect(to: unknown): void; start(when: number): void; stop(): void; disconnect(): void };

export type WebAudioSinkOptions = {
  context?: () => ContextLike;
  /** How much sound is gathered before the first of it is played, so a server a little slower than speech does not stutter. Default 120. */
  prebufferMs?: number;
  after?(ms: number, run: () => void): () => void;
};

/** Sound is scheduled this far ahead of now at least, so it does not begin in the past. */
const LEAD_S = 0.03;

export function createWebAudioSink(options: WebAudioSinkOptions = {}): AudioSink {
  let context: ContextLike | undefined;
  const ctx = (): ContextLike => (context ??= options.context ? options.context() : (new AudioContext({ latencyHint: 'interactive' }) as unknown as ContextLike));
  const prebufferMs = options.prebufferMs ?? 120;
  const after = options.after ?? ((ms, run) => {
    const t = setTimeout(run, ms);
    return () => clearTimeout(t);
  });

  return {
    open(format, callbacks): AudioPlayback {
      const { sampleRate, channels } = format;
      let pending: Float32Array[] = [];
      let pendingFrames = 0;
      let started = false;
      let finished = false;
      let stopped = false;
      let ended = false;
      let nextTime = 0;
      let open = 0; // pieces scheduled and not yet done
      const sources = new Set<SourceLike>();
      let stopStart: (() => void) | undefined;

      const conclude = (): void => {
        if (ended || stopped) return;
        if (finished && started && open === 0) {
          ended = true;
          callbacks.ended();
        }
      };

      function schedule(samples: Float32Array): void {
        const c = ctx();
        const frames = Math.floor(samples.length / channels);
        if (frames === 0) return;
        const buffer = c.createBuffer(channels, frames, sampleRate);
        for (let ch = 0; ch < channels; ch++) {
          const data = buffer.getChannelData(ch);
          for (let i = 0; i < frames; i++) data[i] = samples[i * channels + ch]!;
        }
        const source = c.createBufferSource();
        source.buffer = buffer;
        source.connect(c.destination);
        const at = Math.max(nextTime, c.currentTime + LEAD_S);
        if (!started) {
          started = true;
          const heardIn = Math.max(0, (at - c.currentTime + (c.outputLatency ?? 0)) * 1000);
          stopStart = after(heardIn, () => {
            stopStart = undefined;
            if (!stopped) callbacks.started();
          });
        }
        nextTime = at + buffer.duration;
        sources.add(source);
        open++;
        source.onended = () => {
          sources.delete(source);
          open--;
          conclude();
        };
        source.start(at);
      }

      function begin(): void {
        const c = ctx();
        if (c.state === 'suspended') void c.resume().catch(() => undefined);
        const held = pending;
        pending = [];
        for (const piece of held) schedule(piece);
      }

      return {
        push(samples) {
          if (stopped || finished || samples.length === 0) return;
          if (started) {
            schedule(samples);
            return;
          }
          pending.push(samples);
          pendingFrames += Math.floor(samples.length / channels);
          if ((pendingFrames / sampleRate) * 1000 >= prebufferMs) begin();
        },
        finish() {
          if (stopped || finished) return;
          finished = true;
          if (!started) begin(); // a short utterance never reaches the prebuffer
          if (!started) {
            ended = true; // no sound at all
            callbacks.ended();
            return;
          }
          conclude();
        },
        stop() {
          if (stopped) return;
          stopped = true;
          stopStart?.();
          pending = [];
          for (const s of sources) {
            s.onended = null;
            try {
              s.stop();
              s.disconnect();
            } catch {
              // already finished
            }
          }
          sources.clear();
        },
      };
    },
  };
}
