import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSystemVoice, SYSTEM_VOICE_SOURCE } from '../src/main/system-voice.ts';
import type { VoiceEvent } from '../src/adapters/http-voice.ts';
import type { SpeechChild } from '../src/adapters/windows-speech.ts';

/** A 16-bit mono WAV of `n` samples at `rate`, as the synthesiser writes one. */
function wav(n: number, rate = 22050): Buffer {
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(i % 2 === 0 ? 8000 : -8000, i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** A stand-in for the PowerShell child: says ready, answers each line it is given the way the test says. */
function fakeChild(answer: (id: number, text: string) => Record<string, unknown> | undefined, ready: Record<string, unknown> = { ready: true, name: 'Test Voice' }) {
  const lines: string[] = [];
  const written: Array<{ id: number; text: string }> = [];
  let onLine: (line: string) => void = () => undefined;
  let exit: () => void = () => undefined;
  let killed = false;
  let starts = 0;
  const make = (): SpeechChild => {
    starts++;
    return {
      write(line) {
        const tab = line.indexOf('\t');
        const id = Number(line.slice(0, tab));
        const text = Buffer.from(line.slice(tab + 1).trim(), 'base64').toString('utf8');
        written.push({ id, text });
        const reply = answer(id, text);
        if (reply) setImmediate(() => onLine(JSON.stringify({ id, ...reply })));
      },
      onLine(l) { onLine = l; setImmediate(() => onLine(JSON.stringify(ready))); },
      onExit(l) { exit = l; },
      kill() { killed = true; },
    };
  };
  return { make, written, lines, get killed() { return killed; }, get starts() { return starts; }, die: () => exit() };
}

const collect = (events: VoiceEvent[], until: (e: VoiceEvent) => boolean = (e) => e.kind === 'end' || e.kind === 'error'): Promise<VoiceEvent[]> => new Promise((resolve) => {
  const tick = setInterval(() => { if (events.some(until)) { clearInterval(tick); resolve(events); } }, 5);
});

test('the words go to the child as data, and the audio comes back as the events a voice server gives: format, pieces, end', async () => {
  const child = fakeChild(() => ({ wav: wav(5000).toString('base64') }));
  const voice = createSystemVoice({ start: child.make, log: () => undefined, platform: 'win32', pieceSamples: 2000 });
  const events: VoiceEvent[] = [];
  voice.speak('1:1', 'Héllo "world" \t and a line\nbreak', (e) => events.push(e));
  await collect(events);
  assert.equal(child.written[0]?.text, 'Héllo "world" \t and a line\nbreak', 'the words arrive whole, whatever they hold');
  assert.equal(events[0]?.kind, 'format');
  assert.deepEqual(events[0] && events[0].kind === 'format' ? [events[0].sampleRate, events[0].channels, events[0].estimatedMs] : [], [22050, 1, 227]);
  const pieces = events.filter((e) => e.kind === 'pcm');
  assert.equal(pieces.length, 3, '5000 samples in pieces of 2000');
  assert.equal(pieces.reduce((n, e) => n + (e.kind === 'pcm' ? e.samples.length : 0), 0), 5000);
  assert.equal(events.at(-1)?.kind, 'end');
  voice.dispose();
  assert.equal(child.killed, true);
});

test('utterances are made one at a time in the order asked; a cancelled one is never sent, and a new request under the same key replaces the old', async () => {
  const child = fakeChild((_, text) => ({ wav: wav(text.length * 100).toString('base64') }));
  const voice = createSystemVoice({ start: child.make, log: () => undefined, platform: 'win32' });
  const a: VoiceEvent[] = [], b: VoiceEvent[] = [], c: VoiceEvent[] = [], d: VoiceEvent[] = [];
  voice.speak('k1', 'one', (e) => a.push(e));
  voice.speak('k2', 'two', (e) => b.push(e));
  voice.speak('k3', 'three', (e) => c.push(e));
  voice.cancel('k2');
  voice.speak('k1', 'one again', (e) => d.push(e));
  await collect(c);
  await collect(d);
  assert.deepEqual(child.written.map((w) => w.text), ['three', 'one again'], 'the cancelled and the replaced were never made');
  assert.equal(a.length, 0);
  assert.equal(b.length, 0);
  voice.dispose();
});

test('when the speech engine is missing, slow, or fails, the page is told with an error so it can use its spare', async () => {
  const none = fakeChild(() => undefined, { ready: false });
  const v1 = createSystemVoice({ start: none.make, log: () => undefined, platform: 'win32' });
  const e1: VoiceEvent[] = [];
  v1.speak('a', 'hello', (e) => e1.push(e));
  await collect(e1);
  assert.equal(e1[0]?.kind, 'error');
  v1.dispose();

  const failing = fakeChild(() => ({ error: 'failed' }));
  const v2 = createSystemVoice({ start: failing.make, log: () => undefined, platform: 'win32' });
  const e2: VoiceEvent[] = [];
  v2.speak('a', 'hello', (e) => e2.push(e));
  await collect(e2);
  assert.match(e2[0]?.kind === 'error' ? e2[0].message : '', /could not be made/);
  v2.dispose();

  const silent = fakeChild(() => undefined);
  const v3 = createSystemVoice({ start: silent.make, log: () => undefined, platform: 'win32', timeoutMs: 60 });
  const e3: VoiceEvent[] = [];
  v3.speak('a', 'hello', (e) => e3.push(e));
  await collect(e3);
  assert.match(e3[0]?.kind === 'error' ? e3[0].message : '', /took too long/);
  v3.dispose();

  const other = createSystemVoice({ start: () => { throw new Error('must not start'); }, log: () => undefined, platform: 'linux' });
  const e4: VoiceEvent[] = [];
  other.speak('a', 'hello', (e) => e4.push(e));
  await collect(e4);
  assert.match(e4[0]?.kind === 'error' ? e4[0].message : '', /only be made on Windows/);
});

test('the child that died is started again for the next utterance, and the words are not logged', async () => {
  const log: string[] = [];
  const child = fakeChild(() => ({ wav: wav(100).toString('base64') }));
  const voice = createSystemVoice({ start: child.make, log: (l) => log.push(l), platform: 'win32' });
  const first: VoiceEvent[] = [];
  voice.speak('a', 'a secret sentence', (e) => first.push(e));
  await collect(first);
  child.die();
  const second: VoiceEvent[] = [];
  voice.speak('b', 'another secret sentence', (e) => second.push(e));
  await collect(second);
  assert.equal(child.starts, 2);
  assert.equal(second.at(-1)?.kind, 'end');
  assert.ok(!log.some((l) => /secret/.test(l)));
  voice.dispose();
});

test('the script is one this app wrote: it reads the words as data and never runs them', () => {
  assert.match(SYSTEM_VOICE_SOURCE, /SetOutputToWaveStream/);
  assert.match(SYSTEM_VOICE_SOURCE, /FromBase64String/);
  assert.doesNotMatch(SYSTEM_VOICE_SOURCE, /Invoke-Expression|iex\b/i);
});
