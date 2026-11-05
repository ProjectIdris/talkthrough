import { SpeechToTextError } from './speech-to-text.ts';
import type { SpeechClip, SpeechToText, Transcript } from './speech-to-text.ts';

/**
 * Recognisers in the order the person would rather have them: the first that can answer does. One that is not there or that fails
 * (a server that is down, a program that was removed) hands the question to the next; nothing heard, or a question given up on, ends it.
 * Only the one that answered is told about the next question, so a recogniser that is not used stays asleep.
 */
export function createSpeechChain(engines: readonly SpeechToText[]): SpeechToText {
  if (engines.length === 0) throw new Error('a speech chain needs at least one recogniser');
  let lastGood = 0;
  return {
    id: engines.map((e) => e.id).join(' > '),
    async transcribe(clip: SpeechClip, options?: { signal?: AbortSignal }): Promise<Transcript> {
      let failure: unknown;
      const order = [...engines.keys()].sort((a, b) => (a === lastGood ? -1 : b === lastGood ? 1 : a - b));
      for (const i of order) {
        try {
          const heard = await (engines[i] as SpeechToText).transcribe(clip, options);
          lastGood = i;
          return heard;
        } catch (error) {
          if (!(error instanceof SpeechToTextError) || (error.code !== 'unavailable' && error.code !== 'failed')) throw error;
          failure = error;
        }
      }
      throw failure;
    },
    async warm() {
      let last: unknown;
      for (const e of engines) {
        try { await e.warm?.(); return; } catch (error) { last = error; }
      }
      throw last ?? new Error('no recogniser');
    },
    async wake() {
      await (engines[lastGood] as SpeechToText).wake?.().catch(() => undefined);
    },
    async close() {
      await Promise.all(engines.map((e) => e.close?.().catch(() => undefined)));
    },
  };
}
