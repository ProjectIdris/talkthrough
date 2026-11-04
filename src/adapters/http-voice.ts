// A voice that is a text-to-speech server reached by a URL: this is the client side, run by the main process.
//
// Protocol (generic: nothing is assumed about the server but this):
//   POST {url}   Content-Type: application/json   body: { "text": string, "voice"?: string }
//     200 -> the audio, streamed as it is made, in one of two forms:
//              WAV (audio/wav, audio/x-wav ...): a RIFF header, then PCM samples (16, 24 or 32 bit integers, or 32 bit floats,
//                any rate, one or two channels). A header written before the length is known (a data size of 0 or 0xFFFFFFFF) is
//                read to the end of the body.
//              raw PCM (audio/pcm): signed 16 bit little-endian samples, the rate in the type's parameters
//                (`audio/pcm; rate=24000; channels=1`; channels default 1).
//     other -> an error; the body, if it is text, says why.
// The URL always comes from the person's settings, and the text sent is what the app is about to say, nothing else.

export type PcmFormat = { sampleRate: number; channels: number };

export type VoiceEvent =
  /** The audio's format is known: the first thing sent. `estimatedMs` is the length of the whole utterance when the server said. */
  | { kind: 'format'; sampleRate: number; channels: number; estimatedMs?: number }
  /** Samples, interleaved by channel, in -1..1. */
  | { kind: 'pcm'; samples: Float32Array }
  /** The audio is complete. */
  | { kind: 'end' }
  | { kind: 'error'; message: string };

export class VoiceServerError extends Error {
  readonly code: 'unavailable' | 'server' | 'format' | 'timeout' | 'aborted';
  constructor(code: VoiceServerError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VoiceServerError';
    this.code = code;
  }
}

/** The most audio one utterance may carry: a runaway stream is cut off here (ten minutes at 48 kHz stereo is far past any sentence). */
const MAX_SAMPLES = 48_000 * 2 * 600;

type Wav = { audioFormat: number; channels: number; sampleRate: number; bits: number; blockAlign: number };

/**
 * Reads a WAV stream piece by piece, whatever way it is cut: the header may arrive a byte at a time. `push` gives back the format
 * when it first becomes known and the samples that are now whole.
 */
export function createWavDecoder() {
  let buf: Uint8Array = new Uint8Array(0);
  let stage: 'riff' | 'chunk' | 'fmt' | 'skip' | 'data' | 'done' = 'riff';
  let want = 0; // for fmt: its size; for skip: bytes still to skip
  let wav: Wav | undefined;
  let remaining = Infinity; // data bytes still to come
  let announced = false;
  let produced = 0;
  let declaredBytes: number | undefined;

  const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
  const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
  const tag = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

  function convert(bytes: Uint8Array, w: Wav): Float32Array {
    const bps = w.bits / 8;
    const n = Math.floor(bytes.length / bps);
    const out = new Float32Array(n);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) {
      const o = i * bps;
      if (w.audioFormat === 3) out[i] = view.getFloat32(o, true);
      else if (w.bits === 16) out[i] = view.getInt16(o, true) / 32768;
      else if (w.bits === 24) out[i] = (((bytes[o + 2]! << 24) | (bytes[o + 1]! << 16) | (bytes[o]! << 8)) >> 8) / 8388608;
      else if (w.bits === 32) out[i] = view.getInt32(o, true) / 2147483648;
      else out[i] = (bytes[o]! - 128) / 128;
    }
    return out;
  }

  return {
    /** The length the header declared for the audio, in bytes, once known and finite. */
    get declaredBytes(): number | undefined {
      return declaredBytes;
    },
    push(chunk: Uint8Array): { format?: PcmFormat & { estimatedMs?: number }; samples?: Float32Array } {
      if (stage === 'done') return {};
      if (buf.length === 0) buf = chunk;
      else {
        const joined = new Uint8Array(buf.length + chunk.length);
        joined.set(buf, 0);
        joined.set(chunk, buf.length);
        buf = joined;
      }
      let format: (PcmFormat & { estimatedMs?: number }) | undefined;
      let samples: Float32Array | undefined;
      for (;;) {
        if (stage === 'riff') {
          if (buf.length < 12) break;
          if (tag(buf, 0) !== 'RIFF' || tag(buf, 8) !== 'WAVE') throw new VoiceServerError('format', 'the audio is not a WAV stream');
          buf = buf.subarray(12);
          stage = 'chunk';
        } else if (stage === 'chunk') {
          if (buf.length < 8) break;
          const id = tag(buf, 0), size = u32(buf, 4);
          buf = buf.subarray(8);
          if (id === 'fmt ') {
            if (size < 16 || size > 1024) throw new VoiceServerError('format', 'the WAV header is not understood');
            want = size;
            stage = 'fmt';
          } else if (id === 'data') {
            if (!wav) throw new VoiceServerError('format', 'the WAV data came before its format');
            remaining = size === 0 || size >= 0xfffffff0 ? Infinity : size;
            if (Number.isFinite(remaining)) declaredBytes = remaining;
            stage = 'data';
          } else {
            want = size + (size % 2);
            stage = 'skip';
          }
        } else if (stage === 'fmt') {
          if (buf.length < want) break;
          let audioFormat = u16(buf, 0);
          const channels = u16(buf, 2), sampleRate = u32(buf, 4), blockAlign = u16(buf, 12), bits = u16(buf, 14);
          if (audioFormat === 0xfffe && want >= 26) audioFormat = u16(buf, 24); // extensible: the real format is the sub-format's first two bytes
          const pcm = audioFormat === 1 && (bits === 8 || bits === 16 || bits === 24 || bits === 32);
          const float = audioFormat === 3 && bits === 32;
          if (!(pcm || float)) throw new VoiceServerError('format', `the WAV format is not supported (format ${audioFormat}, ${bits} bits)`);
          if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96_000) throw new VoiceServerError('format', 'the WAV rate or channel count is not supported');
          wav = { audioFormat, channels, sampleRate, bits, blockAlign: blockAlign || (channels * bits) / 8 };
          buf = buf.subarray(want + (want % 2));
          stage = 'chunk';
        } else if (stage === 'skip') {
          const n = Math.min(want, buf.length);
          buf = buf.subarray(n);
          want -= n;
          if (want > 0) break;
          stage = 'chunk';
        } else if (stage === 'data') {
          const w = wav!;
          if (!announced) {
            announced = true;
            const rate = w.sampleRate * w.channels * (w.bits / 8);
            format = { sampleRate: w.sampleRate, channels: w.channels, ...(Number.isFinite(remaining) ? { estimatedMs: Math.round((remaining / rate) * 1000) } : {}) };
          }
          const take = Math.min(buf.length, remaining);
          const whole = take - (take % w.blockAlign);
          if (whole > 0) {
            const part = convert(buf.subarray(0, whole), w);
            produced += part.length;
            if (produced > MAX_SAMPLES) throw new VoiceServerError('format', 'the audio is too long');
            if (samples) {
              const joined = new Float32Array(samples.length + part.length);
              joined.set(samples, 0);
              joined.set(part, samples.length);
              samples = joined;
            } else samples = part;
            buf = buf.subarray(whole);
            if (Number.isFinite(remaining)) remaining -= whole;
          }
          if (Number.isFinite(remaining) && remaining < w.blockAlign) {
            stage = 'done';
            buf = new Uint8Array(0);
          }
          break;
        } else break;
      }
      return { ...(format ? { format } : {}), ...(samples ? { samples } : {}) };
    },
    /** True when the stream gave a format at all (a body that ends before its data is an error). */
    get started(): boolean {
      return announced;
    },
  };
}

/** Reads `rate` and `channels` out of a type such as `audio/pcm; rate=24000; channels=1`. */
export function parsePcmType(contentType: string): PcmFormat | null {
  const [type, ...params] = contentType.split(';').map((p) => p.trim().toLowerCase());
  if (type !== 'audio/pcm' && type !== 'audio/x-raw' && type !== 'audio/l16') return null;
  const get = (name: string): number | undefined => {
    const p = params.find((x) => x.startsWith(`${name}=`));
    const n = p ? Number(p.slice(name.length + 1).replace(/"/g, '')) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const sampleRate = get('rate') ?? 0;
  const channels = get('channels') ?? 1;
  if (sampleRate < 8000 || sampleRate > 96_000 || (channels !== 1 && channels !== 2)) return null;
  return { sampleRate, channels };
}

function pcm16(bytes: Uint8Array): Float32Array {
  const n = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export type StreamSpeechOptions = {
  url: string;
  text: string;
  /** Sent as `voice` when set: which voice the server should use (its own name for one). */
  voice?: string;
  signal?: AbortSignal;
  /** The whole request, start to the last sample. Default 30000. */
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/**
 * Asks the server to say `text` and yields what it sends as it arrives: a `format` first, then `pcm` pieces, then `end`.
 * Throws a VoiceServerError when the server is not reachable, answers an error, sends something that is not audio it can read,
 * or does not finish in time; stopping it with `signal` ends it quietly (the generator returns).
 */
export async function* streamSpeech(options: StreamSpeechOptions): AsyncGenerator<VoiceEvent> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await doFetch(options.url, {
      method: 'POST',
      // The words go to the address that was set and to no other: a redirect (which could name any address, even a private one) is an error, not followed.
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/wav, audio/pcm' },
      body: JSON.stringify({ text: options.text, ...(options.voice ? { voice: options.voice } : {}) }),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) return;
    if (timeout.aborted) throw new VoiceServerError('timeout', 'the voice server did not answer in time', { cause: error });
    throw new VoiceServerError('unavailable', 'the voice server is not reachable', { cause: error });
  }
  if (!response.ok || !response.body) {
    let why = '';
    try {
      why = (await response.text()).slice(0, 160).replace(/\s+/g, ' ').trim();
    } catch {
      // no body to read
    }
    throw new VoiceServerError('server', `the voice server answered ${response.status}${why ? `: ${why}` : ''}`);
  }
  const type = response.headers.get('content-type') ?? '';
  const raw = parsePcmType(type);
  const length = Number(response.headers.get('content-length'));
  const reader = response.body.getReader();
  const wav = createWavDecoder();
  let announced = false;
  let leftover: Uint8Array = new Uint8Array(0);
  try {
    for (;;) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (error) {
        if (options.signal?.aborted) return;
        if (timeout.aborted) throw new VoiceServerError('timeout', 'the voice server did not finish in time', { cause: error });
        throw new VoiceServerError('unavailable', 'the voice server stopped sending', { cause: error });
      }
      if (read.done) break;
      let bytes = read.value;
      if (raw) {
        if (!announced) {
          announced = true;
          const rate = raw.sampleRate * raw.channels * 2;
          yield { kind: 'format', ...raw, ...(Number.isFinite(length) && length > 0 ? { estimatedMs: Math.round((length / rate) * 1000) } : {}) };
        }
        if (leftover.length) {
          const joined = new Uint8Array(leftover.length + bytes.length);
          joined.set(leftover, 0);
          joined.set(bytes, leftover.length);
          bytes = joined;
        }
        const whole = bytes.length - (bytes.length % (2 * raw.channels));
        leftover = bytes.slice(whole);
        if (whole > 0) yield { kind: 'pcm', samples: pcm16(bytes.subarray(0, whole)) };
      } else {
        const got = wav.push(bytes);
        if (got.format) {
          announced = true;
          yield { kind: 'format', ...got.format };
        }
        if (got.samples && got.samples.length > 0) yield { kind: 'pcm', samples: got.samples };
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  if (!announced) throw new VoiceServerError('format', 'the voice server sent no audio');
  yield { kind: 'end' };
}
