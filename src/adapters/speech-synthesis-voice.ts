import type { SpeechEnd, SpeechHandle, SpeechListener, Voice } from './voice.ts';

/** The part of the Web Speech API this voice uses, so tests can stand in for it. */
export type SynthesisLike = {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
};
export type UtteranceLike = {
  text: string;
  rate: number;
  pitch: number;
  voice: unknown;
  onstart: ((event: unknown) => void) | null;
  onend: ((event: unknown) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onboundary: ((event: { charIndex: number }) => void) | null;
};

export type SpeechSynthesisVoiceOptions = {
  synth?: SynthesisLike;
  createUtterance?: (text: string) => UtteranceLike;
  rate?: number;
  pitch?: number;
  /** Picks a system voice, e.g. by language. Called as each utterance is made. */
  pickVoice?: () => unknown;
};

/** Rough speaking speed for the length guess: characters per second at rate 1. */
const CHARS_PER_SECOND = 15;

/** The public default voice: the system voices through the Web Speech API (local, free). */
export function createSpeechSynthesisVoice(options: SpeechSynthesisVoiceOptions = {}): Voice {
  const synth = options.synth ?? (globalThis.speechSynthesis as unknown as SynthesisLike | undefined);
  if (!synth) throw new Error('speechSynthesis is not available here');
  const makeUtterance =
    options.createUtterance ?? ((text: string) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike);
  const rate = options.rate ?? 1;
  const pitch = options.pitch ?? 1;
  const live = new Set<() => void>();

  return {
    id: 'speech-synthesis',
    speak(text: string, listener: SpeechListener = {}): SpeechHandle {
      const utterance = makeUtterance(text);
      utterance.rate = rate;
      utterance.pitch = pitch;
      const picked = options.pickVoice?.();
      if (picked) utterance.voice = picked;

      let ended = false;
      let settle!: (end: SpeechEnd) => void;
      const finished = new Promise<SpeechEnd>((resolve) => (settle = resolve));
      const end = (result: SpeechEnd) => {
        if (ended) return;
        ended = true;
        live.delete(markCancelled);
        // Settle first so a throwing listener cannot leave `finished` pending.
        settle(result);
        listener.end?.(result);
      };
      const markCancelled = () => end({ reason: 'cancelled' });
      live.add(markCancelled);

      utterance.onstart = () =>
        listener.start?.({ estimatedMs: Math.round((text.length / (CHARS_PER_SECOND * rate)) * 1000) });
      utterance.onboundary = (event) => listener.boundary?.({ charIndex: event.charIndex });
      utterance.onend = () => end({ reason: 'finished' });
      utterance.onerror = (event) => {
        // 'canceled' and 'interrupted' arrive after a cancel; they are not failures.
        const code = event.error ?? 'unknown';
        end(code === 'canceled' || code === 'interrupted' ? { reason: 'cancelled' } : { reason: 'error', error: code });
      };
      synth.speak(utterance);
      return {
        finished,
        cancel() {
          markCancelled();
          // The browser has one queue; cancelling it stops the audio and anything queued behind.
          synth.cancel();
        },
      };
    },
    cancel() {
      for (const markCancelled of [...live]) markCancelled();
      synth.cancel();
    },
  };
}
