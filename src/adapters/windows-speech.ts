import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { SpeechToTextError } from './speech-to-text.ts';
import type { SpeechClip, SpeechToText, Transcript } from './speech-to-text.ts';
import { toRate16k } from './local-speech-server.ts';

/**
 * The recogniser Windows already has (System.Speech, the desktop recogniser): nothing to download, nothing leaves the computer. It is the
 * zero-setup way to hear a question, and a plain one: fair on short, clear English, behind whisper.cpp or a speech server on anything harder.
 *
 * It runs in one Windows PowerShell child that is started when the keys first go down (`wake`) or on the first question, holds the engine
 * loaded, and ends by itself after a quiet spell (a loaded engine is some 100 MB). One question is one line in (a number and the 16 kHz
 * 16-bit samples, base64) and one line of JSON out. The script is this app's own text; nothing a model wrote reaches it.
 */

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Speech
  $info = $null
  foreach ($r in [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()) { if ($r.Culture.TwoLetterISOLanguageName -eq 'en') { $info = $r; break } }
  if (-not $info) { Say @{ ready = $false; why = 'no-recogniser' }; exit }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, 'Sixteen', 'Mono')
  Say @{ ready = $true; name = $info.Name }
} catch { Say @{ ready = $false; why = 'failed' }; exit }
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $tab = $line.IndexOf([char]9)
  if ($tab -lt 1) { continue }
  $id = [int]$line.Substring(0, $tab)
  try {
    $bytes = [Convert]::FromBase64String($line.Substring($tab + 1))
    $stream = New-Object System.IO.MemoryStream(, $bytes)
    $engine.SetInputToAudioStream($stream, $format)
    $result = $engine.Recognize([TimeSpan]::FromSeconds(8))
    Say @{ id = $id; text = $(if ($result) { $result.Text } else { '' }); confidence = $(if ($result) { [math]::Round($result.Confidence, 2) } else { 0 }) }
  } catch { Say @{ id = $id; error = 'failed' } }
}
`;

/** The script as the child is started with it (comments and blank lines dropped; it travels on the command line). */
export const WINDOWS_SPEECH_SOURCE = SCRIPT.split('\n').map((l) => l.trim()).filter((l) => l !== '').join('\n');

export type SpeechChild = {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
};

export type WindowsSpeechOptions = {
  /** For tests: how the child is started. */
  start?: () => SpeechChild;
  /** How long one question may take, the first one including the engine's start. Default 20000. */
  timeoutMs?: number;
  /** The child ends after this long without a question. Default 600000 (ten minutes); 0 keeps it. */
  idleMs?: number;
};

function startPowerShell(): SpeechChild {
  const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(WINDOWS_SPEECH_SOURCE, 'utf16le').toString('base64');
  const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stdin.on('error', () => undefined);
  let pending = '';
  return {
    write: (line) => void child.stdin.write(line),
    onLine: (listener) => child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      let at: number;
      while ((at = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, at).trim();
        pending = pending.slice(at + 1);
        if (line) listener(line);
      }
    }),
    onExit: (listener) => { child.on('exit', listener); child.on('error', listener); },
    kill: () => { try { child.stdin.end(); } catch { /* already closed */ } child.kill(); },
  };
}

/** 16 kHz, 16-bit, mono, with a little silence after the words so the engine knows they are over. */
export function pcm16(clip: SpeechClip): Buffer {
  const samples = toRate16k(clip);
  const tail = 8000; // half a second
  const out = Buffer.alloc((samples.length + tail) * 2);
  for (let i = 0; i < samples.length; i++) out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] as number)) * 32767), i * 2);
  return out;
}

export function createWindowsSpeechRecogniser(options: WindowsSpeechOptions = {}): SpeechToText {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const idleMs = options.idleMs ?? 600_000;
  type Waiting = { resolve(line: Record<string, unknown>): void };
  let child: SpeechChild | undefined;
  let ready: Promise<void> | undefined;
  let readyFail: SpeechToTextError | undefined;
  let nextId = 1;
  const waiting = new Map<number, Waiting>();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let alive = false;

  const stopChild = (): void => {
    alive = false;
    const c = child;
    child = undefined;
    ready = undefined;
    for (const w of waiting.values()) w.resolve({ error: 'gone' });
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

  function start(): Promise<void> {
    if (ready) return ready;
    readyFail = undefined;
    const c = (options.start ?? startPowerShell)();
    child = c;
    alive = true;
    ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        readyFail = new SpeechToTextError('unavailable', 'The Windows speech recogniser did not start in time.');
        stopChild();
        reject(readyFail);
      }, timeoutMs);
      timer.unref?.();
      c.onLine((line) => {
        let body: Record<string, unknown>;
        try { body = JSON.parse(line) as Record<string, unknown>; } catch { return; }
        if ('ready' in body) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (body.ready === true) resolve();
          else {
            readyFail = new SpeechToTextError('unavailable', body.why === 'no-recogniser' ? 'Windows has no English speech recogniser installed.' : 'The Windows speech recogniser could not start.');
            reject(readyFail);
            stopChild();
          }
          return;
        }
        const id = body.id;
        if (typeof id === 'number') {
          const w = waiting.get(id);
          if (w) { waiting.delete(id); w.resolve(body); }
        }
      });
      c.onExit(() => {
        if (child === c) { child = undefined; ready = undefined; alive = false; }
        for (const w of waiting.values()) w.resolve({ error: 'gone' });
        waiting.clear();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          readyFail = new SpeechToTextError('unavailable', 'The Windows speech recogniser stopped.');
          reject(readyFail);
        }
      });
    });
    ready.catch(() => undefined);
    touch();
    return ready;
  }

  return {
    id: 'windows-speech',
    async warm() {
      await start();
    },
    async wake() {
      if (!alive) await start().catch(() => undefined);
      else touch();
    },
    async transcribe(clip: SpeechClip, opts?: { signal?: AbortSignal }): Promise<Transcript> {
      if (opts?.signal?.aborted) throw new SpeechToTextError('aborted', 'aborted');
      const began = Date.now();
      try {
        await start();
      } catch (error) {
        throw error instanceof SpeechToTextError ? error : new SpeechToTextError('unavailable', 'The Windows speech recogniser is not available.', { cause: error });
      }
      const c = child;
      if (!c) throw readyFail ?? new SpeechToTextError('unavailable', 'The Windows speech recogniser stopped.');
      touch();
      const id = nextId++;
      const answer = new Promise<Record<string, unknown>>((resolve) => {
        waiting.set(id, { resolve });
        const timer = setTimeout(() => { waiting.delete(id); resolve({ error: 'timeout' }); }, timeoutMs);
        timer.unref?.();
        opts?.signal?.addEventListener('abort', () => { waiting.delete(id); resolve({ error: 'aborted' }); }, { once: true });
      });
      c.write(`${id}\t${pcm16(clip).toString('base64')}\n`);
      const body = await answer;
      if (body.error === 'aborted') throw new SpeechToTextError('aborted', 'aborted');
      if (body.error === 'timeout' || body.error === 'gone') {
        stopChild(); // it may be stuck: the next question starts a fresh one
        throw new SpeechToTextError('failed', 'The Windows speech recogniser did not answer.');
      }
      if (typeof body.error === 'string') throw new SpeechToTextError('failed', 'The Windows speech recogniser could not read that.');
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) throw new SpeechToTextError('empty', 'nothing was recognised');
      return { text, engine: 'windows-speech', seconds: (Date.now() - began) / 1000 };
    },
    async close() {
      if (idleTimer) clearTimeout(idleTimer);
      stopChild();
    },
  };
}
