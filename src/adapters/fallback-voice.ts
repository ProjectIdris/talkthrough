// A voice with a spare: the primary is tried first; if it fails, or has not made a sound within `firstAudioMs`, the same words are
// spoken by the fallback instead, and the primary is left alone for a while (`cooldownMs`) so a server that is down or slow costs
// the person one wait and not one for every step. After the cooldown the next utterance tries the primary again.
//
// Once the primary has started speaking it is never switched away from: a stream that breaks half-way ends that utterance.

import type { SpeechEnd, SpeechHandle, SpeechListener, Voice } from './voice.ts';

export type FallbackClock = { now(): number; after(ms: number, run: () => void): () => void };

const realClock: FallbackClock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const t = setTimeout(run, ms);
    return () => clearTimeout(t);
  },
};

export type FallbackVoiceOptions = {
  primary: Voice;
  fallback: Voice;
  /** How long the primary has to make its first sound before the fallback speaks instead. */
  firstAudioMs: number;
  /** How long the primary is left alone after it failed. Default 20000. */
  cooldownMs?: number;
  clock?: FallbackClock;
  /** Told when the primary is given up on, and when it is back (for the log). */
  log?(line: string): void;
};

export function createFallbackVoice(options: FallbackVoiceOptions): Voice {
  const { primary, fallback } = options;
  const clock = options.clock ?? realClock;
  const cooldownMs = options.cooldownMs ?? 20_000;
  const log = options.log ?? (() => undefined);
  let downUntil = 0;
  const live = new Set<() => void>();

  function giveUp(why: string): void {
    downUntil = clock.now() + cooldownMs;
    log(`voice: ${primary.id} gave no sound (${why}); speaking with ${fallback.id} for ${Math.round(cooldownMs / 1000)} s`);
  }

  return {
    id: `${primary.id}+${fallback.id}`,
    speak(text: string, listener: SpeechListener = {}): SpeechHandle {
      let settle!: (end: SpeechEnd) => void;
      const finished = new Promise<SpeechEnd>((resolve) => (settle = resolve));
      let over = false;
      let started = false;
      let switched = false;
      let current: SpeechHandle | undefined;
      let stopTimer: (() => void) | undefined;

      const end = (result: SpeechEnd): void => {
        if (over) return;
        over = true;
        stopTimer?.();
        live.delete(cancel);
        settle(result);
        listener.end?.(result);
      };
      const cancel = (): void => {
        if (over) return;
        const h = current;
        over = true; // so what the voice says on its way out is not passed on as its own end
        stopTimer?.();
        live.delete(cancel);
        h?.cancel();
        settle({ reason: 'cancelled' });
        listener.end?.({ reason: 'cancelled' });
      };
      live.add(cancel);

      const speakWithFallback = (): void => {
        switched = true;
        current = fallback.speak(text, {
          ...(listener.start ? { start: listener.start } : {}),
          ...(listener.boundary ? { boundary: listener.boundary } : {}),
          end,
        });
      };

      if (clock.now() < downUntil) {
        speakWithFallback();
      } else {
        current = primary.speak(text, {
          start: (e) => {
            if (over || switched || started) return;
            started = true;
            stopTimer?.();
            if (downUntil !== 0) log(`voice: ${primary.id} is speaking again`);
            downUntil = 0;
            listener.start?.(e);
          },
          ...(listener.boundary ? { boundary: (e: { charIndex: number }) => { if (!switched) listener.boundary?.(e); } } : {}),
          end: (result) => {
            if (over || switched) return;
            if (!started && result.reason === 'error') {
              stopTimer?.();
              giveUp(result.error ?? 'error');
              speakWithFallback();
              return;
            }
            if (started && result.reason === 'error') giveUp(result.error ?? 'error');
            end(result);
          },
        });
        stopTimer = clock.after(options.firstAudioMs, () => {
          if (over || started || switched) return;
          giveUp(`not within ${options.firstAudioMs} ms`);
          const slow = current;
          switched = true; // the primary's own end, when it is cancelled, is not the utterance's
          slow?.cancel();
          speakWithFallback();
        });
      }
      return {
        finished,
        cancel,
      };
    },
    cancel() {
      for (const c of [...live]) c();
      primary.cancel();
      fallback.cancel();
    },
  };
}
