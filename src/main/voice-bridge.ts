// The main process's part of a voice that is a server: the overlay page asks for the audio of some words, this streams it from
// the server (adapters/http-voice.ts) and sends it back piece by piece. The page never talks to the network: the one address it
// can reach is the one in the person's settings, and only this file does the reaching.

import { streamSpeech, VoiceServerError } from '../adapters/http-voice.ts';
import type { VoiceEvent } from '../adapters/http-voice.ts';

/** A step is a sentence or two; anything longer than this is cut, so a runaway answer is not sent in one piece. */
export const VOICE_TEXT_MAX = 1200;

export type VoiceBridgeOptions = {
  url: string;
  voice?: string;
  /** The whole request, start to the last sample. Default 30000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  log(line: string): void;
};

export type VoiceBridge = {
  /** Starts speaking `text` as request `key`; `send` is given each event until the audio has ended or failed. Never throws. */
  speak(key: string, text: string, send: (event: VoiceEvent) => void): void;
  /** Stops a request (the page cancelled, or went away). */
  cancel(key: string): void;
  /** Stops them all. */
  dispose(): void;
};

export function createVoiceBridge(options: VoiceBridgeOptions): VoiceBridge {
  const running = new Map<string, AbortController>();
  return {
    speak(key, text, send) {
      running.get(key)?.abort();
      const controller = new AbortController();
      running.set(key, controller);
      const spoken = text.length > VOICE_TEXT_MAX ? text.slice(0, VOICE_TEXT_MAX) : text;
      const started = Date.now();
      void (async () => {
        let first = true;
        try {
          for await (const event of streamSpeech({
            url: options.url,
            text: spoken,
            ...(options.voice ? { voice: options.voice } : {}),
            signal: controller.signal,
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          })) {
            if (controller.signal.aborted) return;
            if (first && event.kind === 'format') {
              first = false;
              options.log(`voice server: audio started ${Date.now() - started} ms after the request (${event.sampleRate} Hz, ${event.channels} channel${event.channels === 1 ? '' : 's'})`);
            }
            send(event);
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          const message = error instanceof VoiceServerError ? error.message : 'the voice server failed';
          options.log(`voice server: ${message}`);
          send({ kind: 'error', message });
        } finally {
          if (running.get(key) === controller) running.delete(key);
        }
      })();
    },
    cancel(key) {
      const c = running.get(key);
      if (!c) return;
      running.delete(key);
      c.abort();
    },
    dispose() {
      for (const c of running.values()) c.abort();
      running.clear();
    },
  };
}
