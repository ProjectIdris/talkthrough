// Says in the log how long a voice took to make its first sound, from the moment it was given the words: the figure that decides how
// a spoken step feels (the drawing waits for it). Numbers only; the words are never logged.

import type { SpeechHandle, SpeechListener, Voice } from './voice.ts';

export function timedVoice(inner: Voice, log: (line: string) => void, now: () => number = () => performance.now()): Voice {
  return {
    id: inner.id,
    speak(text: string, listener: SpeechListener = {}): SpeechHandle {
      const asked = now();
      let reported = false;
      return inner.speak(text, {
        ...listener,
        start: (e) => {
          if (!reported) {
            reported = true;
            log(`voice ${inner.id}: first sound ${Math.round(now() - asked)} ms after the words (${text.length} characters)`);
          }
          listener.start?.(e);
        },
      });
    },
    cancel: () => inner.cancel(),
  };
}
