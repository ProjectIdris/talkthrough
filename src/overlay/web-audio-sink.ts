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
  /** Makes the output; given the device the person chose (a sink id) when there is one. It may throw when that device is not there. */
  context?: (sinkId?: string) => ContextLike;
  /** The speaker the person chose (a Web Audio sink id); empty or absent: the system's default. */
  sinkId?: string;
  /** Told once if the chosen speaker could not be used and the system's default plays instead. */
  onSinkLost?(why: string): void;
  /** How much sound is gathered before the first of it is played, so a server a little slower than speech does not stutter. Default 120. */
  prebufferMs?: number;
  after?(ms: number, run: () => void): () => void;
};

/** Sound is scheduled this far ahead of now at least, so it does not begin in the past. */
const LEAD_S = 0.03;

export function createWebAudioSink(options: WebAudioSinkOptions = {}): AudioSink {
  let context: ContextLike | undefined;
  const make = options.context ?? ((id?: string) => new AudioContext({ latencyHint: 'interactive', ...(id ? { sinkId: id } : {}) }) as unknown as ContextLike);
  /** The output on the speaker the person chose; when that cannot be made (the device has gone) on the default, and the caller is told once. */
  function create(): ContextLike {
    if (options.sinkId) {
      try {
        return make(options.sinkId);
      } catch (error) {
        options.onSinkLost?.(error instanceof Error ? error.message : String(error));
      }
    }
    return make(undefined);
  }
  const ctx = (): ContextLike => (context ??= create());
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
      let firstAt: number | undefined;
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
          firstAt = at;
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
        heardMs() {
          if (firstAt === undefined) return 0;
          const c = ctx();
          const played = Math.max(0, c.currentTime - firstAt - (c.outputLatency ?? 0));
          return Math.min(played, nextTime - firstAt) * 1000;
        },
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
