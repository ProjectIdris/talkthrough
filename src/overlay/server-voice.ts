// The voice the page speaks with when a voice server is set up: the server's audio (through main), played as it arrives, with the
// system voice as the spare for when the server is down or slow.

import { createFallbackVoice } from '../adapters/fallback-voice.ts';
import { createStreamedVoice } from '../adapters/streamed-voice.ts';
import { timedVoice } from '../adapters/timed-voice.ts';
import type { VoiceTransport } from '../adapters/streamed-voice.ts';
import type { Voice } from '../adapters/voice.ts';
import type { DisplayInfo, TalkthroughApi } from '../shared/ipc.ts';
import { createWebAudioSink } from './web-audio-sink.ts';

export function createServerVoice(api: TalkthroughApi['voice'], config: NonNullable<DisplayInfo['voice']>, fallback: Voice, log: (line: string) => void = () => undefined): Voice {
  const transport: VoiceTransport = {
    request: (id, text) => api.speak(id, text),
    cancel: (id) => api.cancel(id),
    onEvent: (listener) => api.onEvent(listener),
  };
  return createFallbackVoice({
    primary: timedVoice(createStreamedVoice({ transport, sink: createWebAudioSink() }), log),
    fallback,
    firstAudioMs: config.firstAudioMs,
    cooldownMs: config.cooldownMs,
    log,
  });
}
