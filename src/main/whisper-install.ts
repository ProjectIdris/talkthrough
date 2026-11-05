// Getting whisper.cpp onto this computer, only when the person has said yes (the settings window asks first, and says what is downloaded, from where and how
// big). Two files, both pinned here by size and SHA-256 so that what arrives is exactly what was looked at, whatever the server sends back:
//   - the program: the official Windows CPU build from the whisper.cpp project's releases on GitHub (MIT licence), a small zip with `whisper-cli.exe`;
//   - a model: an English-only model from the project's models page on Hugging Face (the project's own published files).
// Nothing runs while it downloads. A file that is the wrong size or hash is deleted and the install stops. The files live in the app's own data folder.

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';

export type Pin = { file: string; url: string; bytes: number; sha256: string };
export type ModelPin = Pin & { label: string };
export type WhisperPins = { tag: string; program: Pin; models: Record<string, ModelPin> };

const RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454';
const MODELS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

export const WHISPER_PINS: WhisperPins = {
  tag: 'b5454',
  program: { file: 'whisper-bin-x64.zip', url: `${RELEASE}/whisper-bin-x64.zip`, bytes: 8_928_640, sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb' },
  models: {
    'tiny.en': { file: 'ggml-tiny.en.bin', url: `${MODELS}/ggml-tiny.en.bin`, bytes: 77_704_715, sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f', label: 'Fast (about 75 MB)' },
    'base.en': { file: 'ggml-base.en.bin', url: `${MODELS}/ggml-base.en.bin`, bytes: 147_964_211, sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', label: 'Better (about 140 MB)' },
  },
};

export type InstallStep = 'program' | 'model' | 'unpack';
export type InstallProgress = { step: InstallStep; received: number; total: number };
export type Installed = { command: string; model: string; modelName: string; tag: string };

export class InstallError extends Error {
  readonly code: 'offline' | 'wrong-file' | 'unpack' | 'aborted' | 'disk';
  constructor(code: InstallError['code'], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InstallError';
    this.code = code;
  }
}

export type InstallOptions = {
  /** The folder this lives in (inside the app's data folder). */
  dir: string;
  model: string;
  pins?: WhisperPins;
  fetch?: typeof fetch;
  onProgress?(progress: InstallProgress): void;
  signal?: AbortSignal;
  /** For tests: how the zip is opened. */
  unzip?(zip: string, into: string): Promise<void>;
};

const MANIFEST = 'whisper.json';

/** Downloads one pinned file to `to` (through a `.part` file), checking size and hash; a file of the wrong size or hash is deleted. */
async function download(pin: Pin, to: string, step: InstallStep, options: InstallOptions): Promise<void> {
  if (!pin.url.startsWith('https://')) throw new InstallError('wrong-file', 'Only https downloads are made.');
  const doFetch = options.fetch ?? globalThis.fetch;
  const part = `${to}.part`;
  let response: Response;
  try {
    response = await doFetch(pin.url, { redirect: 'follow', ...(options.signal ? { signal: options.signal } : {}) });
  } catch (error) {
    if (options.signal?.aborted) throw new InstallError('aborted', 'Stopped.');
    throw new InstallError('offline', 'Could not reach the download. Check the connection and try again.', { cause: error });
  }
  if (!response.ok || !response.body) throw new InstallError('offline', `The download was refused (${response.status}).`);
  if (response.url && !response.url.startsWith('https://')) throw new InstallError('wrong-file', 'The download was sent somewhere that is not https.');
  const hash = createHash('sha256');
  let received = 0;
  const out = createWriteStream(part);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > pin.bytes) throw new InstallError('wrong-file', 'The download is bigger than expected, so it was not kept.');
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((ok) => out.once('drain', ok));
      options.onProgress?.({ step, received, total: pin.bytes });
    }
    await new Promise<void>((ok, bad) => {
      out.once('error', bad);
      out.end(ok);
    });
  } catch (error) {
    out.destroy();
    await rm(part, { force: true });
    if (error instanceof InstallError) throw error;
    if (options.signal?.aborted) throw new InstallError('aborted', 'Stopped.');
    throw new InstallError('offline', 'The download was cut off. Try again.', { cause: error });
  }
  if (received !== pin.bytes || hash.digest('hex') !== pin.sha256) {
    await rm(part, { force: true });
    throw new InstallError('wrong-file', 'The download is not the file that was expected, so it was not kept.');
  }
  await rename(part, to);
}

/** Windows ships `tar`, which opens zip files; PowerShell is the fallback. */
async function unzipWithSystem(zip: string, into: string): Promise<void> {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const run = (exe: string, args: string[]): Promise<number | null> => new Promise((ok) => {
    const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => ok(null));
    child.on('close', ok);
  });
  if ((await run(join(root, 'System32', 'tar.exe'), ['-xf', zip, '-C', into])) === 0) return;
  const quote = (p: string): string => `'${p.split("'").join("''")}'`;
  const ps = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if ((await run(ps, ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(into)} -Force`])) === 0) return;
  throw new InstallError('unpack', 'The program could not be unpacked.');
}

async function findFile(dir: string, name: string, depth = 4): Promise<string | undefined> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory() && depth > 0) {
      const inner = await findFile(full, name, depth - 1);
      if (inner) return inner;
    }
  }
  return undefined;
}

const inside = (dir: string, path: string): boolean => {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-z]:/i.test(rel);
};

/** What is installed (the program and a model, both there and the right size), or null. */
export async function findInstalled(dir: string, pins: WhisperPins = WHISPER_PINS): Promise<Installed | null> {
  try {
    const m = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as { tag?: string; model?: string; command?: string; modelFile?: string };
    const pin = typeof m.model === 'string' ? pins.models[m.model] : undefined;
    if (!pin || typeof m.command !== 'string' || typeof m.modelFile !== 'string') return null;
    const command = join(dir, m.command), model = join(dir, m.modelFile);
    if (!inside(dir, command) || !inside(dir, model)) return null;
    if (!(await stat(command)).isFile() || (await stat(model)).size !== pin.bytes) return null;
    return { command, model, modelName: m.model as string, tag: String(m.tag ?? pins.tag) };
  } catch {
    return null;
  }
}

export async function installWhisper(options: InstallOptions): Promise<Installed> {
  const pins = options.pins ?? WHISPER_PINS;
  const modelPin = pins.models[options.model];
  if (!modelPin) throw new InstallError('wrong-file', 'That model is not one this app offers.');
  const dir = options.dir;
  try {
    await mkdir(join(dir, 'bin'), { recursive: true });
  } catch (error) {
    throw new InstallError('disk', 'Could not make a folder for it.', { cause: error });
  }
  const zip = join(dir, pins.program.file);
  const modelPath = join(dir, modelPin.file);
  try {
    await download(pins.program, zip, 'program', options);
    options.onProgress?.({ step: 'unpack', received: 0, total: 1 });
    await rm(join(dir, 'bin'), { recursive: true, force: true });
    await mkdir(join(dir, 'bin'), { recursive: true });
    try {
      await (options.unzip ?? unzipWithSystem)(zip, join(dir, 'bin'));
    } catch (error) {
      if (error instanceof InstallError) throw error;
      throw new InstallError('unpack', 'The program could not be unpacked.', { cause: error });
    }
    const command = await findFile(join(dir, 'bin'), 'whisper-cli.exe');
    if (!command || !inside(dir, command)) throw new InstallError('unpack', 'The program is not in the download as expected.');
    await download(modelPin, modelPath, 'model', options);
    await writeFile(join(dir, MANIFEST), JSON.stringify({ tag: pins.tag, model: options.model, command: relative(dir, command), modelFile: modelPin.file, installedAt: new Date().toISOString() }));
    await rm(zip, { force: true });
    return { command, model: modelPath, modelName: options.model, tag: pins.tag };
  } catch (error) {
    await rm(`${zip}.part`, { force: true });
    await rm(`${modelPath}.part`, { force: true });
    throw error;
  }
}

/** Takes it all away (the person asked). */
export async function removeWhisper(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
