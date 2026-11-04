// The renderer's side of a voice that is a server: it asks main for the audio of a step's words (which streams it from the
// server, see http-voice.ts and main/voice-bridge.ts), and plays it as it arrives. It speaks to the player exactly as the system
// voice does: `start` when the first sound is really heard, `end` once, a queue in order, cancel drops everything.
//
// An utterance's request goes out the moment speak() is called, even when another is still playing, so what is next is being made
// while the last is heard. Its audio waits (in memory) for its turn.

import { createSpokenClock } from '../shared/captions.ts';
import type { VoiceEvent } from './http-voice.ts';
import type { SpeechEnd, SpeechHandle, SpeechListener, Voice } from './voice.ts';

/** How audio reaches main and comes back: one request per utterance, its events tagged with the request's id. */
export type VoiceTransport = {
  request(id: number, text: string): void;
  cancel(id: number): void;
  onEvent(listener: (id: number, event: VoiceEvent) => void): void;
};

/** One utterance's audio being played. */
export interface AudioPlayback {
  /** Samples, interleaved by channel, in -1..1. */
  push(samples: Float32Array): void;
  /** No more samples will come: `ended` follows when what is queued has been heard. */
  finish(): void;
  /** Silences it now and drops what was queued. No callback follows. */
  stop(): void;
  /** How much of the sound has really been heard so far, in milliseconds (what has played, not what has arrived). Absent: the voice counts from when it started. */
  heardMs?(): number;
}

export type AudioSink = {
  /** Starts a stream of audio. `started` is called once, when the first sound is really heard; `ended` once, when the last is. */
  open(format: { sampleRate: number; channels: number }, callbacks: { started(): void; ended(): void }): AudioPlayback;
};

export type StreamedVoiceOptions = {
  transport: VoiceTransport;
  sink: AudioSink;
  /** A first guess at how fast the voice speaks, in characters a second, until some of its own speech has been measured. */
  charsPerSecond?: number;
  /** Runs `run` now and then while a step is being heard (for its words as captions); gives back the stop. Default: every 40 ms. */
  tick?(run: () => void): () => void;
  /** The time in milliseconds, for a sink that cannot say how much has been heard. Default: performance.now. */
  now?(): number;
};

type Utterance = {
  id: number;
  text: string;
  listener: SpeechListener;
  /** The events that came before it was its turn. */
  held: VoiceEvent[];
  playback?: AudioPlayback;
  estimatedMs?: number;
  rate?: number;
  samples: number;
  channels: number;
  started: boolean;
  ended: boolean;
  clock?: ReturnType<typeof createSpokenClock>;
  /** Stops the caption ticker (words of the step as it is heard). */
  stopTick?: () => void;
  settle(end: SpeechEnd): void;
};

export function createStreamedVoice(options: StreamedVoiceOptions): Voice {
  const { transport, sink } = options;
  let charsPerSecond = options.charsPerSecond ?? 15;
  let nextId = 1;
  const queue: Utterance[] = []; // in order; the first is the one being heard
  const byId = new Map<number, Utterance>();
  let cancelling = false;
  const tick = options.tick ?? ((run: () => void) => {
    const id = setInterval(run, 40);
    return () => clearInterval(id);
  });
  const now = options.now ?? (() => performance.now());

  function finish(u: Utterance, result: SpeechEnd): void {
    if (u.ended) return;
    u.ended = true;
    byId.delete(u.id);
    const at = queue.indexOf(u);
    if (at >= 0) queue.splice(at, 1);
    u.stopTick?.();
    u.playback?.stop();
    // Settle first so a throwing listener cannot leave `finished` pending.
    u.settle(result);
    u.listener.end?.(result);
    if (!cancelling && queue[0]) play(queue[0]);
  }

  function handle(u: Utterance, e: VoiceEvent): void {
    if (e.kind === 'format') {
      u.rate = e.sampleRate;
      u.channels = e.channels;
      if (e.estimatedMs !== undefined) u.estimatedMs = e.estimatedMs;
      u.playback = sink.open(e, {
        started: () => {
          if (u.started || u.ended) return;
          u.started = true;
          const guess = u.estimatedMs ?? Math.round((u.text.length / charsPerSecond) * 1000);
          u.listener.start?.({ estimatedMs: guess });
          if (u.listener.boundary) followWords(u, guess);
        },
        ended: () => {
          if (u.listener.boundary && u.clock) for (const w of u.clock.rest()) u.listener.boundary({ charIndex: w.charIndex });
          if (u.rate && u.samples > 0) {
            // What this voice really does: remembered, so the next guess is better.
            const seconds = u.samples / u.channels / u.rate;
            if (seconds > 0.4 && u.text.length >= 8) charsPerSecond = Math.max(4, Math.min(40, 0.5 * charsPerSecond + 0.5 * (u.text.length / seconds)));
          }
          finish(u, { reason: 'finished' });
        },
      });
    } else if (e.kind === 'pcm') {
      u.samples += e.samples.length;
      u.playback?.push(e.samples);
    } else if (e.kind === 'end') {
      if (u.playback) u.playback.finish();
      else finish(u, { reason: 'error', error: 'the voice server sent no audio' });
    } else {
      finish(u, { reason: 'error', error: e.message, ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}) });
    }
  }

  /**
   * The words of the step as it is heard, for captions: each is given to the listener when the sound that has really played has come to it
   * (never from what has merely arrived), measured against the length the voice said or, failing that, the length of the sound so far.
   */
  function followWords(u: Utterance, guessMs: number): void {
    const startedAt = now();
    const clock = createSpokenClock(u.text, guessMs);
    u.clock = clock;
    u.stopTick = tick(() => {
      if (u.ended) return;
      const heard = u.playback?.heardMs ? u.playback.heardMs() : now() - startedAt;
      // The length is at least the sound that has come so far (a guess that was too short must not show words early).
      const arrived = u.rate ? (u.samples / u.channels / u.rate) * 1000 : 0;
      clock.retime(Math.max(guessMs, arrived));
      for (const w of clock.due(heard)) u.listener.boundary?.({ charIndex: w.charIndex });
    });
  }

  /** The utterance's turn has come: what was held for it is let through. */
  function play(u: Utterance): void {
    const held = u.held.splice(0);
    for (const e of held) {
      if (u.ended) break;
      handle(u, e);
    }
  }

  transport.onEvent((id, e) => {
    const u = byId.get(id);
    if (!u || u.ended) return;
    if (queue[0] === u) handle(u, e);
    else u.held.push(e);
  });

  function cancelAll(): void {
    cancelling = true; // none of them gets its turn on the way out
    try {
      for (const u of [...queue]) {
        transport.cancel(u.id);
        finish(u, { reason: 'cancelled' });
      }
    } finally {
      cancelling = false;
    }
  }

  return {
    id: 'streamed',
    speak(text: string, listener: SpeechListener = {}): SpeechHandle {
      let settle!: (end: SpeechEnd) => void;
      const finished = new Promise<SpeechEnd>((resolve) => (settle = resolve));
      const u: Utterance = { id: nextId++, text, listener, held: [], samples: 0, channels: 1, started: false, ended: false, settle };
      byId.set(u.id, u);
      queue.push(u);
      transport.request(u.id, text);
      return {
        finished,
        cancel() {
          // One queue, like the browser's: stopping this one stops what is behind it too.
          cancelAll();
        },
      };
    },
    cancel() {
      cancelAll();
    },
  };
}
