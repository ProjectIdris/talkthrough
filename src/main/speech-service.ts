import { join } from 'node:path';
import { createLocalSpeechServerRecogniser } from '../adapters/local-speech-server.ts';
import { createSpeechChain } from '../adapters/speech-chain.ts';
import { SpeechToTextError } from '../adapters/speech-to-text.ts';
import type { SpeechClip, SpeechToText, Transcript } from '../adapters/speech-to-text.ts';
import { createWhisperCppRecogniser } from '../adapters/whisper-cpp.ts';
import { createWindowsSpeechRecogniser } from '../adapters/windows-speech.ts';
import { findInstalled, installWhisper, removeWhisper, WHISPER_PINS } from './whisper-install.ts';
import type { InstallProgress } from './whisper-install.ts';

/**
 * How a question is heard, in the order a person would rather have it: a speech server they set up (their own address), else whisper.cpp when they have agreed
 * to download it, else the recogniser Windows has. So the app can hear a stranger at once with nothing set up, and hear better after one yes.
 * The set is looked at again after an install or a removal, so a download takes effect on the next question without a restart.
 */
export type SpeechStatus = {
  /** The engines in the order they are tried, as ids. Empty: nothing can hear (not Windows, and nothing set up). */
  order: string[];
  server: boolean;
  windows: boolean;
  whisper: { installed: boolean; model?: string };
  installing: boolean;
};

export type SpeechServiceOptions = {
  /** A folder for what it keeps (the downloaded program and model, and the recording of a question while it is read). */
  dir: string;
  speechServerUrl?: string;
  speechLimitMs?: number;
  platform?: string;
  /** For tests. */
  make?: { server?(url: string, limitMs?: number): SpeechToText; windows?(): SpeechToText; whisper?(command: string, model: string, tempDir: string): SpeechToText };
  install?: typeof installWhisper;
};

export type SpeechService = {
  /** The recogniser the session uses: it follows what is installed. */
  engine: SpeechToText;
  status(): Promise<SpeechStatus>;
  /** Downloads whisper.cpp and a model (the person has said yes). One at a time. */
  install(model: string, onProgress?: (p: InstallProgress) => void): Promise<void>;
  cancelInstall(): void;
  remove(): Promise<void>;
};

export function createSpeechService(options: SpeechServiceOptions): SpeechService {
  const platform = options.platform ?? process.platform;
  const make = options.make ?? {};
  const whisperDir = join(options.dir, 'whisper');
  let chain: Promise<{ engine: SpeechToText | null; ids: string[]; whisper: { installed: boolean; model?: string } }> | undefined;
  let installing: AbortController | undefined;

  const build = async () => {
    const engines: SpeechToText[] = [];
    if (options.speechServerUrl) engines.push((make.server ?? ((url, limit) => createLocalSpeechServerRecogniser({ url, ...(limit ? { limitMs: limit } : {}) })))(options.speechServerUrl, options.speechLimitMs));
    const found = await findInstalled(whisperDir);
    if (found) engines.push((make.whisper ?? ((command, model, tempDir) => createWhisperCppRecogniser({ command, model, tempDir })))(found.command, found.model, join(options.dir, 'tmp')));
    if (platform === 'win32') engines.push((make.windows ?? (() => createWindowsSpeechRecogniser()))());
    return { engine: engines.length > 0 ? createSpeechChain(engines) : null, ids: engines.map((e) => e.id), whisper: found ? { installed: true, model: found.modelName } : { installed: false } };
  };
  const current = () => (chain ??= build());
  const rebuild = async (): Promise<void> => {
    const old = await chain?.catch(() => undefined);
    chain = undefined;
    void old?.engine?.close?.().catch(() => undefined);
    await current();
  };

  const engine: SpeechToText = {
    id: 'speech',
    async transcribe(clip: SpeechClip, opts?: { signal?: AbortSignal }): Promise<Transcript> {
      const c = (await current()).engine;
      if (!c) throw new SpeechToTextError('unavailable', 'There is no way to hear a question set up on this computer.');
      return c.transcribe(clip, opts);
    },
    async warm() {
      await (await current()).engine?.warm?.();
    },
    async wake() {
      await (await current()).engine?.wake?.();
    },
    async close() {
      await (await current()).engine?.close?.();
    },
  };

  return {
    engine,
    async status() {
      const c = await current();
      return { order: c.ids, server: Boolean(options.speechServerUrl), windows: platform === 'win32', whisper: c.whisper, installing: installing !== undefined };
    },
    async install(model, onProgress) {
      if (installing) throw new Error('A download is already running.');
      installing = new AbortController();
      try {
        await (options.install ?? installWhisper)({ dir: whisperDir, model, signal: installing.signal, ...(onProgress ? { onProgress } : {}) });
      } finally {
        installing = undefined;
      }
      await rebuild();
    },
    cancelInstall() {
      installing?.abort();
    },
    async remove() {
      installing?.abort();
      await removeWhisper(whisperDir);
      await rebuild();
    },
  };
}

/** The sizes the settings page tells the person before they say yes. */
export const WHISPER_OFFER = {
  tag: WHISPER_PINS.tag,
  program: { name: WHISPER_PINS.program.file, bytes: WHISPER_PINS.program.bytes, from: 'github.com' },
  models: Object.entries(WHISPER_PINS.models).map(([name, m]) => ({ name, label: m.label, bytes: m.bytes, from: 'huggingface.co' })),
};
