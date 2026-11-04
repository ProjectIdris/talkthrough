// The main process's part of a voice that is a server: the overlay page asks for the audio of some words, this streams it from
// the server (adapters/http-voice.ts) and sends it back piece by piece. The page never talks to the network: the one address it
// can reach is the one in the person's settings, and only this file does the reaching.

import { streamSpeech, VoiceServerError } from '../adapters/http-voice.ts';
import type { VoiceEvent } from '../adapters/http-voice.ts';

/** A step is a sentence or two; anything longer than this is cut, so a runaway answer is not sent in one piece. */
export const VOICE_TEXT_MAX = 1200;

/** How many requests one page may have running at once; a page that asks for more is told no, and speaks with the system voice. */
export const VOICE_IN_FLIGHT_MAX = 6;

export type VoiceBridgeOptions = {
  url: string;
  voice?: string;
  /** The whole request, start to the last sample. Default 30000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  log(line: string): void;
};

export type VoiceBridge = {
  /**
   * Starts speaking `text` as request `key`; `send` is given each event until the audio has ended or failed. Never throws.
   * `group` names the page it is for (default: the key alone), so its requests can be counted and stopped together.
   */
  speak(key: string, text: string, send: (event: VoiceEvent) => void, group?: string): void;
  /** Stops a request (the page cancelled, or went away). */
  cancel(key: string): void;
  /** Stops every request of a group (its page went away). */
  cancelGroup(group: string): void;
  /** Stops them all. */
  dispose(): void;
};

export function createVoiceBridge(options: VoiceBridgeOptions): VoiceBridge {
  const running = new Map<string, { controller: AbortController; group: string }>();
  const inGroup = (group: string): number => [...running.values()].filter((r) => r.group === group).length;
  return {
    speak(key, text, send, group = key) {
      running.get(key)?.controller.abort();
      running.delete(key);
      if (inGroup(group) >= VOICE_IN_FLIGHT_MAX) {
        options.log('voice server: too many requests at once from one page; this one was refused');
        send({ kind: 'error', message: 'too many voice requests at once' });
        return;
      }
      const controller = new AbortController();
      running.set(key, { controller, group });
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
          if (running.get(key)?.controller === controller) running.delete(key);
        }
      })();
    },
    cancel(key) {
      const r = running.get(key);
      if (!r) return;
      running.delete(key);
      r.controller.abort();
    },
    cancelGroup(group) {
      for (const [key, r] of [...running]) {
        if (r.group !== group) continue;
        running.delete(key);
        r.controller.abort();
      }
    },
    dispose() {
      for (const r of running.values()) r.controller.abort();
      running.clear();
    },
  };
}
