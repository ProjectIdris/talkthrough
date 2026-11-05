// The system voice, made here instead of in the page. The page's own speech synthesis (the Web Speech API) can only play on the default output, so when
// the person has chosen a speaker it cannot be used; this renders the same Windows voice (System.Speech, the desktop one: nothing to download,
// nothing leaves the computer) to audio in memory and hands it to the page the way a voice server's audio is handed, so it plays through the chosen speaker
// and the captions follow the sound that is really heard (adapters/streamed-voice.ts).
//
// One Windows PowerShell child holds the synthesiser, started when first needed and ended after a quiet spell. One utterance is one line in (a number,
// a tab, the words as base64 UTF-8) and one line of JSON out (the WAV as base64). The script is this app's own text; nothing a model wrote reaches it
// except the words to be said, which travel as data. Words are never logged.

import { createWavDecoder } from '../adapters/http-voice.ts';
import type { VoiceEvent } from '../adapters/http-voice.ts';
import { startPowerShellChild } from '../adapters/windows-speech.ts';
import type { SpeechChild } from '../adapters/windows-speech.ts';
import { VOICE_IN_FLIGHT_MAX, VOICE_TEXT_MAX } from './voice-bridge.ts';
import type { VoiceBridge } from './voice-bridge.ts';

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  Say @{ ready = $true; name = $synth.Voice.Name }
} catch { Say @{ ready = $false }; exit }
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $tab = $line.IndexOf([char]9)
  if ($tab -lt 1) { continue }
  $id = [int]$line.Substring(0, $tab)
  try {
    $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring($tab + 1)))
    $stream = New-Object System.IO.MemoryStream
    $synth.SetOutputToWaveStream($stream)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    Say @{ id = $id; wav = [Convert]::ToBase64String($stream.ToArray()) }
  } catch { Say @{ id = $id; error = 'failed' } }
}
`;

/** The script as the child is started with it (comments and blank lines dropped; it travels on the command line). */
export const SYSTEM_VOICE_SOURCE = SCRIPT.split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');

export type SystemVoiceOptions = {
  /** For tests: how the child is started. */
  start?: () => SpeechChild;
  log(line: string): void;
  platform?: string;
  /** One utterance may take this long, the first one including the engine's start. Default 20000. */
  timeoutMs?: number;
  /** The child ends after this long with nothing to say. Default 600000 (ten minutes); 0 keeps it. */
  idleMs?: number;
  /** The audio goes to the page in pieces of about this many samples. Default 24000 (a second at 24 kHz). */
  pieceSamples?: number;
};

export type SystemVoice = VoiceBridge & {
  /** Starts the synthesiser now (best effort), so the first step does not wait for it. */
  warm(): Promise<void>;
};

type Reply = { id?: number; wav?: string; error?: string; ready?: boolean };

export function createSystemVoice(options: SystemVoiceOptions): SystemVoice {
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const idleMs = options.idleMs ?? 600_000;
  const piece = options.pieceSamples ?? 24_000;
  type Job = { key: string; group: string; cancelled: boolean; send(event: VoiceEvent): void };
  const jobs = new Map<string, Job>();
  let child: SpeechChild | undefined;
  let ready: Promise<boolean> | undefined;
  let nextId = 1;
  const waiting = new Map<number, (reply: Reply) => void>();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Utterances are made one at a time, in the order they were asked for. */
  let tail: Promise<void> = Promise.resolve();

  const stopChild = (): void => {
    const c = child;
    child = undefined;
    ready = undefined;
    for (const w of waiting.values()) w({ error: 'gone' });
    waiting.clear();
    c?.kill();
  };
  const touch = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    if (idleMs > 0) {
      idleTimer = setTimeout(stopChild, idleMs);
      idleTimer.unref?.();
    }
  };

  function start(): Promise<boolean> {
    if (ready) return ready;
    const c = (options.start ?? (() => startPowerShellChild(SYSTEM_VOICE_SOURCE)))();
    child = c;
    const mine = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        options.log('system voice: the speech engine did not start in time');
        if (child === c) stopChild();
        resolve(false);
      }, timeoutMs);
      timer.unref?.();
      c.onLine((line) => {
        let body: Reply;
        try { body = JSON.parse(line) as Reply; } catch { return; }
        if ('ready' in body) {
          clearTimeout(timer);
          if (body.ready !== true) {
            options.log('system voice: Windows has no speech engine to make the voice with');
            if (child === c) stopChild();
          }
          resolve(body.ready === true);
          return;
        }
        if (typeof body.id === 'number') {
          const w = waiting.get(body.id);
          if (w) { waiting.delete(body.id); w(body); }
        }
      });
      c.onExit(() => {
        clearTimeout(timer);
        if (child === c) { child = undefined; ready = undefined; }
        for (const w of waiting.values()) w({ error: 'gone' });
        waiting.clear();
        resolve(false);
      });
    });
    ready = mine;
    touch();
    return mine;
  }

  async function render(job: Job, text: string): Promise<void> {
    try {
      if (job.cancelled) return;
      if (platform !== 'win32') return job.send({ kind: 'error', message: 'the system voice can only be made on Windows' });
      if (!(await start()) || !child) return job.send({ kind: 'error', message: 'the system speech engine is not available' });
      if (job.cancelled) return;
      const c = child;
      touch();
      const id = nextId++;
      const answer = new Promise<Reply>((resolve) => {
        const timer = setTimeout(() => { waiting.delete(id); resolve({ error: 'timeout' }); }, timeoutMs);
        timer.unref?.();
        waiting.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
      });
      c.write(`${id}\t${Buffer.from(text, 'utf8').toString('base64')}\n`);
      const reply = await answer;
      if (job.cancelled) return;
      if (typeof reply.wav !== 'string') return job.send({ kind: 'error', message: reply.error === 'timeout' ? 'the system voice took too long' : 'the system voice could not be made' });
      const decoder = createWavDecoder();
      const got = decoder.push(Buffer.from(reply.wav, 'base64'));
      if (!got.format) return job.send({ kind: 'error', message: 'the system voice gave no audio' });
      const samples = got.samples ?? new Float32Array(0);
      job.send({ kind: 'format', sampleRate: got.format.sampleRate, channels: got.format.channels, ...(samples.length > 0 ? { estimatedMs: Math.round((samples.length / got.format.channels / got.format.sampleRate) * 1000) } : {}) });
      for (let at = 0; at < samples.length; at += piece) {
        if (job.cancelled) return;
        job.send({ kind: 'pcm', samples: samples.subarray(at, at + piece) });
      }
      job.send({ kind: 'end' });
    } catch (error) {
      if (!job.cancelled) job.send({ kind: 'error', message: error instanceof Error ? error.message.slice(0, 200) : 'the system voice failed' });
    } finally {
      if (jobs.get(job.key) === job) jobs.delete(job.key);
    }
  }

  return {
    speak(key, text, send, group = key) {
      const old = jobs.get(key);
      if (old) old.cancelled = true;
      jobs.delete(key);
      if ([...jobs.values()].filter((j) => j.group === group).length >= VOICE_IN_FLIGHT_MAX) {
        options.log('system voice: too many requests at once from one page; this one was refused');
        send({ kind: 'error', message: 'too many voice requests at once' });
        return;
      }
      const job: Job = { key, group, cancelled: false, send };
      jobs.set(key, job);
      const spoken = text.length > VOICE_TEXT_MAX ? text.slice(0, VOICE_TEXT_MAX) : text;
      tail = tail.then(() => render(job, spoken));
    },
    cancel(key) {
      const j = jobs.get(key);
      if (j) j.cancelled = true;
      jobs.delete(key);
    },
    cancelGroup(group) {
      for (const [key, j] of [...jobs]) {
        if (j.group !== group) continue;
        j.cancelled = true;
        jobs.delete(key);
      }
    },
    dispose() {
      for (const j of jobs.values()) j.cancelled = true;
      jobs.clear();
      if (idleTimer) clearTimeout(idleTimer);
      stopChild();
    },
    async warm() {
      if (platform !== 'win32') return;
      await start().catch(() => false);
    },
  };
}
