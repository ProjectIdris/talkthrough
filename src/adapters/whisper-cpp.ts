import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SpeechToTextError } from './speech-to-text.ts';
import type { SpeechClip, SpeechToText, Transcript } from './speech-to-text.ts';
import { toRate16k } from './local-speech-server.ts';

/**
 * Speech to text with whisper.cpp, run on this computer: the `whisper-cli` program and a model file that the person agreed to download
 * (see `src/main/whisper-install.ts`). One question is one run of the program on a small WAV file in the app's own temporary folder, which is
 * removed as soon as the run ends; nothing is sent anywhere. The recognised text is never logged.
 */

/** A 16 kHz, 16-bit, mono WAV file of the clip. */
export function wavBytes(clip: SpeechClip): Buffer {
  const samples = toRate16k(clip);
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 32767), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24); head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** What whisper prints for nothing said, and the sound notes it puts in brackets: not a question. */
export function cleanWhisperText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ') // [BLANK_AUDIO], (silence), *music*
    .replace(/\s+/g, ' ')
    .trim();
}

export type RunResult = { code: number | null; stdout: string };
export type WhisperCppOptions = {
  /** The whisper-cli program. */
  command: string;
  /** The model file (an English-only model such as ggml-base.en.bin; others work with `language` set). */
  model: string;
  /** A folder the app owns, for the WAV file of each question. */
  tempDir: string;
  threads?: number;
  /** "en" by default. */
  language?: string;
  /** Give up on one question after this long. Default 30000. */
  timeoutMs?: number;
  /** For tests: how the program is run. */
  run?(command: string, args: string[], signal: AbortSignal): Promise<RunResult>;
};

function runProgram(command: string, args: string[], signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, signal });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });
}

export function createWhisperCppRecogniser(options: WhisperCppOptions): SpeechToText {
  const run = options.run ?? runProgram;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let counter = 0;
  return {
    id: 'whisper-cpp',
    async transcribe(clip: SpeechClip, opts?: { signal?: AbortSignal }): Promise<Transcript> {
      if (opts?.signal?.aborted) throw new SpeechToTextError('aborted', 'aborted');
      const began = Date.now();
      await mkdir(options.tempDir, { recursive: true });
      const wav = join(options.tempDir, `question-${process.pid}-${counter++}.wav`);
      await writeFile(wav, wavBytes(clip));
      const signal = opts?.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      try {
        const args = ['-m', options.model, '-f', wav, '-nt', '-np', '-l', options.language ?? 'en', '-t', String(options.threads ?? 4)];
        let result: RunResult;
        try {
          result = await run(options.command, args, signal);
        } catch (error) {
          if (opts?.signal?.aborted) throw new SpeechToTextError('aborted', 'aborted');
          const code = (error as { code?: string }).code;
          if (code === 'ENOENT' || code === 'EACCES') throw new SpeechToTextError('unavailable', 'The speech program is not there (it may have been removed).', { cause: error });
          throw new SpeechToTextError('failed', 'The speech program stopped before it answered.', { cause: error });
        }
        if (result.code !== 0) throw new SpeechToTextError('failed', 'The speech program could not read that.');
        const text = cleanWhisperText(result.stdout);
        if (!text) throw new SpeechToTextError('empty', 'nothing was recognised');
        return { text, engine: 'whisper-cpp', seconds: (Date.now() - began) / 1000 };
      } finally {
        await rm(wav, { force: true });
      }
    },
  };
}
