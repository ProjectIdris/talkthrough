// The voices the page speaks with when the audio is made by main: a voice server (its audio, played as it arrives) and the system voice made by
// main (see main/system-voice.ts), so that it too plays through the speaker the person chose. Each has the next as its spare for when it is down or
// slow: the server, then the system voice made by main, then the page's own speech synthesis (which can only use the default output).

import { createFallbackVoice } from '../adapters/fallback-voice.ts';
import { createStreamedVoice } from '../adapters/streamed-voice.ts';
import { timedVoice } from '../adapters/timed-voice.ts';
import type { AudioSink, VoiceTransport } from '../adapters/streamed-voice.ts';
import type { Voice } from '../adapters/voice.ts';
import type { DisplayInfo, TalkthroughApi } from '../shared/ipc.ts';
import { createWebAudioSink } from './web-audio-sink.ts';

/** The system voice's requests are numbered from here, so they never meet the server voice's on the one channel to main. */
export const SYSTEM_ID_BASE = 1_000_000_000;

/** A voice's way to main: one request per utterance, its audio coming back tagged with the request's id (the system voice's ids are offset). */
export function voiceTransport(api: TalkthroughApi['voice'], via?: 'system'): VoiceTransport {
  const base = via === 'system' ? SYSTEM_ID_BASE : 0;
  return {
    request: (id, text) => api.speak(id + base, text, via),
    cancel: (id) => api.cancel(id + base),
    onEvent: (listener) => api.onEvent((id, event) => {
      if (via === 'system' ? id >= SYSTEM_ID_BASE : id < SYSTEM_ID_BASE) listener(id - base, event);
    }),
  };
}

export type RoutedVoiceOptions = {
  /** The speaker the person chose (a Web Audio sink id); every voice made by main plays through it. */
  speaker?: string;
  /** Told once if that speaker could not be used and the default plays. */
  onSinkLost?(why: string): void;
  /** Told when the voice server did not answer and the system voice spoke instead (each time; the caller says it once). */
  onServerDown?(why: string): void;
  /** For tests. */
  sink?: AudioSink;
};

/** How long the system voice made by main is given for its first sound when a server is the first choice: it is local, but its engine may need to start. */
export const SYSTEM_FIRST_AUDIO_MS = 4000;

export function createServerVoice(api: TalkthroughApi['voice'], config: NonNullable<DisplayInfo['voice']>, fallback: Voice, log: (line: string) => void = () => undefined, options: RoutedVoiceOptions = {}): Voice {
  const sink = options.sink ?? createWebAudioSink({ ...(options.speaker ? { sinkId: options.speaker } : {}), ...(options.onSinkLost ? { onSinkLost: options.onSinkLost } : {}) });
  const cooldownMs = config.cooldownMs;
  let voice = fallback;
  if (config.system) {
    voice = createFallbackVoice({ primary: timedVoice(createStreamedVoice({ transport: voiceTransport(api, 'system'), sink }), log), fallback: voice, firstAudioMs: config.server === false ? config.firstAudioMs : Math.max(SYSTEM_FIRST_AUDIO_MS, config.firstAudioMs), cooldownMs, log });
  }
  if (config.server !== false) {
    voice = createFallbackVoice({ primary: timedVoice(createStreamedVoice({ transport: voiceTransport(api), sink }), log), fallback: voice, firstAudioMs: config.firstAudioMs, cooldownMs, log, ...(options.onServerDown ? { onGiveUp: options.onServerDown } : {}) });
  }
  return voice;
}
