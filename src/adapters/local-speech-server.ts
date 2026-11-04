import { SpeechToTextError } from './speech-to-text.ts';
import type { SpeechClip, SpeechToText, Transcript } from './speech-to-text.ts';

/**
 * A generic client for a speech recogniser that runs as a local HTTP server.
 *
 * Protocol:
 *   POST {url}/transcribe[?limit_ms=N]   body: raw 16 kHz mono float32 little-endian samples
 *     200 -> { "text": string, "engine"?: string, "seconds"?: number }
 *     other -> { "error": string }
 *   GET {url}/health -> 200 when ready (optional; used by warm())
 *   POST {url}/warm (no body) -> 202 at once, the server getting ready in the background (optional; used by wake(): any answer, or none, is fine)
 *
 * The URL always comes from the caller (the user's local settings); nothing is assumed about it.
 */
export type LocalSpeechServerOptions = {
  /** Base URL of the server, e.g. what the user typed in settings. Required. */
  url: string;
  /** Asked of the server as `limit_ms`, if it understands it: how long it may spend on its main engine. */
  limitMs?: number;
  /** Give up on the whole request after this long. Default 15000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** wake() asks the server at most this often, in milliseconds (a server that sleeps after a while needs it once per question, not once per key). Default 30000. */
  wakeEveryMs?: number;
  now?(): number;
};

const TARGET_RATE = 16000;

/** Mono float32 at 16 kHz, resampled by linear interpolation if the clip was recorded at another rate. */
export function toRate16k(clip: SpeechClip): Float32Array {
  if (clip.sampleRate === TARGET_RATE) return clip.samples;
  const ratio = clip.sampleRate / TARGET_RATE;
  const length = Math.floor(clip.samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, clip.samples.length - 1);
    const t = pos - lo;
    out[i] = clip.samples[lo]! * (1 - t) + clip.samples[hi]! * t;
  }
  return out;
}

export function createLocalSpeechServerRecogniser(options: LocalSpeechServerOptions): SpeechToText {
  if (!options.url) throw new Error('a local speech server needs a url from the settings');
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const wakeEveryMs = options.wakeEveryMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  let wokeAt = -Infinity;

  function signalFor(outer?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return outer ? AbortSignal.any([outer, timeout]) : timeout;
  }

  return {
    id: 'local-speech-server',
    async warm() {
      try {
        const response = await doFetch(`${base}/health`, { signal: signalFor() });
        if (!response.ok) throw new SpeechToTextError('unavailable', `speech server answered ${response.status}`);
      } catch (error) {
        if (error instanceof SpeechToTextError) throw error;
        throw new SpeechToTextError('unavailable', 'the local speech server is not reachable', { cause: error });
      }
    },
    async wake() {
      if (now() - wokeAt < wakeEveryMs) return;
      wokeAt = now();
      try {
        // The answer does not matter: a server without this route says 404 and is simply not asked again for a while.
        const response = await doFetch(`${base}/warm`, { method: 'POST', redirect: 'error', signal: signalFor() });
        await response.body?.cancel();
      } catch {
        // best effort: if the server is down the question will say so
      }
    },
    async transcribe(clip, call = {}) {
      const samples = toRate16k(clip);
      if (samples.length === 0) throw new SpeechToTextError('empty', 'the recording is empty');
      const query = options.limitMs !== undefined ? `?limit_ms=${Math.round(options.limitMs)}` : '';
      let response: Response;
      try {
        response = await doFetch(`${base}/transcribe${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob([new Uint8Array(samples.buffer as ArrayBuffer, samples.byteOffset, samples.byteLength)]),
          signal: signalFor(call.signal),
        });
      } catch (error) {
        if (call.signal?.aborted) throw new SpeechToTextError('aborted', 'recognition aborted', { cause: error });
        throw new SpeechToTextError('unavailable', 'the local speech server is not reachable', { cause: error });
      }
      let body: { text?: unknown; engine?: unknown; seconds?: unknown; error?: unknown };
      try {
        body = (await response.json()) as typeof body;
      } catch (error) {
        throw new SpeechToTextError('failed', `speech server sent an unreadable answer (${response.status})`, { cause: error });
      }
      if (!response.ok || typeof body.text !== 'string') {
        throw new SpeechToTextError('failed', typeof body.error === 'string' ? body.error : `speech server answered ${response.status}`);
      }
      const text = body.text.trim();
      if (text === '') throw new SpeechToTextError('empty', 'nothing was recognised');
      const result: Transcript = { text };
      if (typeof body.engine === 'string') result.engine = body.engine;
      if (typeof body.seconds === 'number') result.seconds = body.seconds;
      return result;
    },
  };
}
