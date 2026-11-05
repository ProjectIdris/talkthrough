import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpeechToTextError } from '../src/adapters/speech-to-text.ts';
import type { SpeechToText } from '../src/adapters/speech-to-text.ts';
import { createWindowsSpeechRecogniser, pcm16 } from '../src/adapters/windows-speech.ts';
import type { SpeechChild } from '../src/adapters/windows-speech.ts';
import { cleanWhisperText, createWhisperCppRecogniser, wavBytes } from '../src/adapters/whisper-cpp.ts';
import { createSpeechChain } from '../src/adapters/speech-chain.ts';
import { findInstalled, installWhisper, InstallError } from '../src/main/whisper-install.ts';
import type { WhisperPins } from '../src/main/whisper-install.ts';

// The three ways a question can be heard without a speech server of one's own: the recogniser Windows has, whisper.cpp fetched with consent, and a chain
// that tries them in order. None of these runs a real program here: each is given a stand-in.

const clip = { samples: new Float32Array(16000).fill(0.1), sampleRate: 16000 };
const heard = (text: string): Record<string, unknown> => ({ text, confidence: 0.7 });

/** A stand-in for the PowerShell child: says it is ready (or not), then answers each question line. */
function fakeChild(opts: { ready?: boolean; answer?: (id: number, base64: string) => Record<string, unknown> | undefined }): { child: SpeechChild; killed: () => boolean; lines: string[] } {
  let onLine: (line: string) => void = () => undefined;
  let onExit: () => void = () => undefined;
  let killed = false;
  const lines: string[] = [];
  const child: SpeechChild = {
    write(line) {
      lines.push(line);
      const [id, data] = line.trim().split('\t') as [string, string];
      const out = opts.answer?.(Number(id), data);
      if (out) queueMicrotask(() => onLine(JSON.stringify({ id: Number(id), ...out })));
    },
    onLine(l) { onLine = l; queueMicrotask(() => l(JSON.stringify(opts.ready === false ? { ready: false, why: 'no-recogniser' } : { ready: true, name: 'fake' }))); },
    onExit(l) { onExit = l; },
    kill() { killed = true; onExit(); },
  };
  return { child, killed: () => killed, lines };
}

test('the Windows recogniser is started once, sent each question as 16 kHz 16-bit samples with a little silence after, and answers with the words', async () => {
  const f = fakeChild({ answer: () => heard('where do I click') });
  let starts = 0;
  const r = createWindowsSpeechRecogniser({ start: () => (starts++, f.child), idleMs: 0 });
  const a = await r.transcribe(clip);
  const b = await r.transcribe(clip);
  assert.equal(a.text, 'where do I click');
  assert.equal(a.engine, 'windows-speech');
  assert.equal(b.text, 'where do I click');
  assert.equal(starts, 1, 'one child, kept for the next question');
  const bytes = Buffer.from((f.lines[0] as string).split('\t')[1] as string, 'base64');
  assert.equal(bytes.length, (16000 + 8000) * 2, 'the clip and half a second of silence, 16 bit');
  assert.equal(bytes.readInt16LE(0), Math.round(0.1 * 32767));
  assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
  await r.close?.();
  assert.equal(f.killed(), true);
});

test('with no English recogniser on the computer, the Windows engine says it is unavailable (not that it failed), so the next one is tried', async () => {
  const f = fakeChild({ ready: false });
  const r = createWindowsSpeechRecogniser({ start: () => f.child, idleMs: 0 });
  await assert.rejects(r.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'unavailable' && /no English speech recogniser/.test(e.message));
  assert.equal(f.killed(), true);
});

test('nothing recognised is "empty", and a child that does not answer is stopped (the next question starts a fresh one)', async () => {
  const quiet = fakeChild({ answer: () => heard('') });
  const r1 = createWindowsSpeechRecogniser({ start: () => quiet.child, idleMs: 0 });
  await assert.rejects(r1.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'empty');
  const stuck = fakeChild({ answer: () => undefined });
  const r2 = createWindowsSpeechRecogniser({ start: () => stuck.child, timeoutMs: 40, idleMs: 0 });
  await assert.rejects(r2.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'failed');
  assert.equal(stuck.killed(), true);
});

test('pcm16 clamps what is out of range and resamples a clip recorded at another rate', () => {
  const loud = pcm16({ samples: Float32Array.from([2, -2]), sampleRate: 16000 });
  assert.equal(loud.readInt16LE(0), 32767);
  assert.equal(loud.readInt16LE(2), -32767);
  assert.equal(pcm16({ samples: new Float32Array(48000), sampleRate: 48000 }).length, (16000 + 8000) * 2);
});

test('a whisper.cpp question is one run of the program on a WAV file that is gone again afterwards, and its sound notes are not words', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-whisper-'));
  try {
    let seen: string[] = [];
    let wavThere = false;
    const r = createWhisperCppRecogniser({
      command: 'whisper-cli.exe', model: 'm.bin', tempDir: dir, threads: 2,
      run: async (_c, args) => { seen = args; wavThere = existsSync(args[args.indexOf('-f') + 1] as string); return { code: 0, stdout: ' [BLANK_AUDIO] Where do I click to export this? (clears throat)\n' }; },
    });
    const out = await r.transcribe(clip);
    assert.equal(out.text, 'Where do I click to export this?');
    assert.deepEqual(seen.filter((a) => ['-nt', '-np'].includes(a)), ['-nt', '-np']);
    assert.equal(seen[seen.indexOf('-m') + 1], 'm.bin');
    assert.equal(wavThere, true);
    assert.deepEqual(readdirSync(dir), [], 'the recording is removed as soon as the run ends');
    const silent = createWhisperCppRecogniser({ command: 'x', model: 'm', tempDir: dir, run: async () => ({ code: 0, stdout: '[BLANK_AUDIO]\n' }) });
    await assert.rejects(silent.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'empty');
    const gone = createWhisperCppRecogniser({ command: 'x', model: 'm', tempDir: dir, run: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } });
    await assert.rejects(gone.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'unavailable');
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(cleanWhisperText('[MUSIC]'), '');
  assert.equal(wavBytes(clip).length, 44 + 32000);
  assert.equal(wavBytes(clip).toString('ascii', 0, 4), 'RIFF');
});

test('the chain tries the engines in order, passes over one that is unavailable or fails, stops at "nothing heard", and then prefers the one that last answered', async () => {
  const calls: string[] = [];
  const engine = (id: string, behave: () => string): SpeechToText => ({
    id,
    async transcribe() { calls.push(id); return { text: behave() }; },
  });
  const down = engine('whisper', () => { throw new SpeechToTextError('unavailable', 'gone'); });
  const win = engine('windows', () => 'hello');
  const chain = createSpeechChain([down, win]);
  assert.equal((await chain.transcribe(clip)).text, 'hello');
  assert.deepEqual(calls, ['whisper', 'windows']);
  calls.length = 0;
  await chain.transcribe(clip);
  assert.deepEqual(calls, ['windows'], 'the one that answered goes first next time');
  const none = createSpeechChain([engine('a', () => { throw new SpeechToTextError('empty', 'nothing'); }), win]);
  await assert.rejects(none.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'empty');
  const allDown = createSpeechChain([down, down]);
  await assert.rejects(allDown.transcribe(clip), (e: unknown) => e instanceof SpeechToTextError && e.code === 'unavailable');
});

// ---- the download -------------------------------------------------------------------------------------------------------------------

const bytesOf = (text: string): Buffer => Buffer.from(text);
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const programZip = bytesOf('PK-pretend-zip');
const modelFile = bytesOf('pretend-model-weights');
const pins: WhisperPins = {
  tag: 'test',
  program: { file: 'prog.zip', url: 'https://example.test/prog.zip', bytes: programZip.length, sha256: sha(programZip) },
  models: { 'base.en': { file: 'ggml-base.en.bin', url: 'https://example.test/m.bin', bytes: modelFile.length, sha256: sha(modelFile), label: 'x' } },
};
const serve = (files: Record<string, Buffer>): typeof fetch => (async (url: string | URL | Request) => {
  const body = files[String(url)];
  if (!body) return new Response('no', { status: 404 });
  return new Response(new Blob([new Uint8Array(body)]).stream(), { status: 200 });
}) as typeof fetch;
const fakeUnzip = async (_zip: string, into: string): Promise<void> => {
  mkdirSync(join(into, 'Release'), { recursive: true });
  writeFileSync(join(into, 'Release', 'whisper-cli.exe'), 'exe');
};

test('the download is checked against its pinned size and hash, unpacked, and found again afterwards; only then is it kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-install-'));
  try {
    const steps: string[] = [];
    const done = await installWhisper({ dir, model: 'base.en', pins, fetch: serve({ [pins.program.url]: programZip, 'https://example.test/m.bin': modelFile }), unzip: fakeUnzip, onProgress: (p) => { if (!steps.includes(p.step)) steps.push(p.step); } });
    assert.deepEqual(steps, ['program', 'unpack', 'model']);
    assert.ok(done.command.endsWith('whisper-cli.exe') && existsSync(done.command) && existsSync(done.model));
    assert.equal(existsSync(join(dir, 'prog.zip')), false, 'the zip is not kept');
    assert.deepEqual((await findInstalled(dir, pins))?.modelName, 'base.en');
    rmSync(done.model);
    assert.equal(await findInstalled(dir, pins), null, 'a model that has gone is not "installed"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a download that is not the pinned file (wrong bytes, too big, not https) is deleted and nothing is installed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tt-install-'));
  try {
    const swapped = serve({ [pins.program.url]: bytesOf('PK-pretend-zip'.replace('PK', 'XX')), 'https://example.test/m.bin': modelFile });
    await assert.rejects(installWhisper({ dir, model: 'base.en', pins, fetch: swapped, unzip: fakeUnzip }), (e: unknown) => e instanceof InstallError && e.code === 'wrong-file');
    const big = serve({ [pins.program.url]: Buffer.concat([programZip, bytesOf('extra')]), 'https://example.test/m.bin': modelFile });
    await assert.rejects(installWhisper({ dir, model: 'base.en', pins, fetch: big, unzip: fakeUnzip }), (e: unknown) => e instanceof InstallError && e.code === 'wrong-file');
    await assert.rejects(installWhisper({ dir, model: 'base.en', pins: { ...pins, program: { ...pins.program, url: 'http://example.test/prog.zip' } }, fetch: serve({}), unzip: fakeUnzip }), (e: unknown) => e instanceof InstallError && e.code === 'wrong-file');
    await assert.rejects(installWhisper({ dir, model: 'base.en', pins, fetch: serve({}), unzip: fakeUnzip }), (e: unknown) => e instanceof InstallError && e.code === 'offline');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.part') || f.endsWith('.zip') || f.endsWith('.json')), []);
    assert.equal(await findInstalled(dir, pins), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
