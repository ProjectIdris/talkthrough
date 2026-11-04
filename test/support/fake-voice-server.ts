// A stand-in text-to-speech server for tests: a real HTTP server on a loopback port that answers a POST with audio, the way a
// voice server is expected to (see src/adapters/http-voice.ts). It can be slow to begin, slow between pieces, fail, or hang.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A mono 16 bit WAV of a tone: `seconds` long at `rate`. `size` is what the header claims for the data: 'real' (default), 'zero' or 'unknown'. */
export function wavBytes(seconds: number, options: { rate?: number; size?: 'real' | 'zero' | 'unknown'; float?: boolean; channels?: number; extra?: boolean; amplitude?: number } = {}): Buffer {
  const rate = options.rate ?? 24000, channels = options.channels ?? 1, bytes = options.float ? 4 : 2;
  const frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * channels * bytes);
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / rate) * (options.amplitude ?? 0.5);
    for (let c = 0; c < channels; c++) {
      if (options.float) data.writeFloatLE(v, (i * channels + c) * 4);
      else data.writeInt16LE(Math.round(v * 32767), (i * channels + c) * 2);
    }
  }
  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(options.float ? 3 : 1, 8);
  fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12);
  fmt.writeUInt32LE(rate * channels * bytes, 16);
  fmt.writeUInt16LE(channels * bytes, 20);
  fmt.writeUInt16LE(bytes * 8, 22);
  const list = options.extra ? Buffer.concat([Buffer.from('LIST'), Buffer.from([5, 0, 0, 0]), Buffer.from('abcde'), Buffer.from([0])]) : Buffer.alloc(0);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0);
  head.writeUInt32LE(options.size === 'unknown' ? 0xffffffff : 4 + fmt.length + list.length + 8 + data.length, 4);
  head.write('WAVE', 8);
  const dataHead = Buffer.alloc(8);
  dataHead.write('data', 0);
  dataHead.writeUInt32LE(options.size === 'unknown' ? 0xffffffff : options.size === 'zero' ? 0 : data.length, 4);
  return Buffer.concat([head, fmt, list, dataHead, data]);
}

/** The samples of wavBytes as the decoder should give them back (16 bit, mono): for comparing. */
export function toneSamples(seconds: number, rate = 24000): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * 32767) + 0) / 32768; // + 0: a rounded -0.3 is -0, which a decoded 0 is not
  return out;
}

export type FakeVoiceOptions = {
  /** What it does with a request. */
  mode?: 'wav' | 'pcm' | 'error' | 'hang' | 'text' | 'empty' | 'dropped' | 'redirect';
  /** For mode 'redirect': where to send the caller (status 307, or `redirectStatus`). */
  location?: string;
  redirectStatus?: number;
  /** Seconds of audio. Default 0.5. */
  seconds?: number;
  /** Before the first byte. */
  firstByteMs?: number;
  /** Between pieces (the audio is sent in `pieces` parts). */
  pieceMs?: number;
  pieces?: number;
  wavSize?: 'real' | 'zero' | 'unknown';
  rate?: number;
  /** Loudness of the tone, 0 (silence) to 1. Default 0.5. */
  amplitude?: number;
};

export type FakeVoice = {
  url: string;
  /** The bodies it was sent, parsed. */
  requests: Array<{ text?: string; voice?: string; contentType: string | undefined; accept: string | undefined }>;
  /** How many requests are being answered right now. */
  active(): number;
  set(options: FakeVoiceOptions): void;
  close(): Promise<void>;
};

export async function startFakeVoice(initial: FakeVoiceOptions = {}): Promise<FakeVoice> {
  let o: FakeVoiceOptions = initial;
  let active = 0;
  const requests: FakeVoice['requests'] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: { text?: string; voice?: string } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
      } catch {
        // not JSON: recorded as empty
      }
      requests.push({ ...body, contentType: req.headers['content-type'], accept: req.headers.accept });
      active++;
      let over = false;
      const done = (): void => {
        if (!over) active--;
        over = true;
      };
      res.on('close', done);
      const send = (): void => {
        const seconds = o.seconds ?? 0.5;
        if (o.mode === 'redirect') {
          res.writeHead(o.redirectStatus ?? 307, { Location: o.location ?? '/', 'Content-Length': '0' });
          res.end();
          return;
        }
        if (o.mode === 'error') {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('the model is not loaded');
          return;
        }
        if (o.mode === 'text') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('this is not audio at all, not even a little bit');
          return;
        }
        if (o.mode === 'empty') {
          res.writeHead(200, { 'Content-Type': 'audio/wav' });
          res.end();
          return;
        }
        let payload: Buffer;
        if (o.mode === 'pcm') {
          const wav = wavBytes(seconds, { rate: o.rate ?? 24000, ...(o.amplitude !== undefined ? { amplitude: o.amplitude } : {}) });
          payload = wav.subarray(44);
          res.writeHead(200, { 'Content-Type': `audio/pcm; rate=${o.rate ?? 24000}; channels=1` });
        } else {
          payload = wavBytes(seconds, { size: o.wavSize ?? 'real', rate: o.rate ?? 24000, ...(o.amplitude !== undefined ? { amplitude: o.amplitude } : {}) });
          res.writeHead(200, { 'Content-Type': 'audio/wav' });
        }
        const pieces = Math.max(1, o.pieces ?? 1);
        const each = Math.ceil(payload.length / pieces);
        let i = 0;
        const next = (): void => {
          if (res.destroyed) return;
          if (i >= payload.length) {
            if (o.mode === 'dropped') res.destroy();
            else res.end();
            return;
          }
          const part = payload.subarray(i, i + each);
          i += each;
          if (o.mode === 'dropped' && i >= each * Math.max(1, Math.floor(pieces / 2))) {
            res.write(part, () => res.destroy());
            return;
          }
          res.write(part);
          if (o.pieceMs) setTimeout(next, o.pieceMs);
          else setImmediate(next);
        };
        next();
      };
      if (o.mode === 'hang') return; // never answers
      if (o.firstByteMs) setTimeout(send, o.firstByteMs);
      else send();
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/speak`,
    requests,
    active: () => active,
    set: (next) => {
      o = next;
    },
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}
