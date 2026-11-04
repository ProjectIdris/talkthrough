import test from 'node:test';
import assert from 'node:assert/strict';
import { createFallbackVoice } from '../src/adapters/fallback-voice.ts';
import type { FallbackClock } from '../src/adapters/fallback-voice.ts';
import type { SpeechEnd, SpeechListener, Voice } from '../src/adapters/voice.ts';

/** A clock the test turns by hand. */
function fakeClock() {
  let t = 0;
  const timers: Array<{ at: number; run(): void; live: boolean }> = [];
  const clock: FallbackClock = {
    now: () => t,
    after(ms, run) {
      const timer = { at: t + ms, run, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
  };
  return {
    clock,
    advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((x) => x.live && x.at <= t)) {
        timer.live = false;
        timer.run();
      }
    },
  };
}

/** A voice the test drives: it records what it was asked to say and says nothing until told. */
function scripted(id: string) {
  const spoken: Array<{ text: string; listener: SpeechListener; cancelled: boolean; end(e: SpeechEnd): void }> = [];
  const voice: Voice = {
    id,
    speak(text, listener = {}) {
      let settle!: (e: SpeechEnd) => void;
      const finished = new Promise<SpeechEnd>((r) => (settle = r));
      const entry = {
        text, listener, cancelled: false,
        end(e: SpeechEnd) { settle(e); listener.end?.(e); },
      };
      spoken.push(entry);
      return { finished, cancel() { entry.cancelled = true; entry.end({ reason: 'cancelled' }); } };
    },
    cancel() {
      for (const s of spoken) if (!s.cancelled) { s.cancelled = true; s.end({ reason: 'cancelled' }); }
    },
  };
  return { voice, spoken };
}

function rig(options: { firstAudioMs?: number; cooldownMs?: number } = {}) {
  const c = fakeClock();
  const primary = scripted('server');
  const spare = scripted('system');
  const log: string[] = [];
  const voice = createFallbackVoice({ primary: primary.voice, fallback: spare.voice, firstAudioMs: options.firstAudioMs ?? 2000, cooldownMs: options.cooldownMs ?? 20_000, clock: c.clock, log: (l) => log.push(l) });
  return { ...c, primary, spare, voice, log };
}

test('a primary that speaks in time is the voice: its start and end pass through and the spare is never asked', async () => {
  const r = rig();
  const events: string[] = [];
  const h = r.voice.speak('Open the tab.', { start: (e) => events.push(`start ${e.estimatedMs}`), end: (e) => events.push(`end ${e.reason}`) });
  r.advance(1500);
  r.primary.spoken[0]!.listener.start?.({ estimatedMs: 1800 });
  r.advance(5000); // the timer is over: nothing switches
  r.primary.spoken[0]!.end({ reason: 'finished' });
  assert.deepEqual(events, ['start 1800', 'end finished']);
  assert.equal(r.spare.spoken.length, 0);
  assert.deepEqual(await h.finished, { reason: 'finished' });
});

test('a primary with no sound by the time limit is cancelled and the same words are spoken by the spare, which starts and ends as the utterance', async () => {
  const r = rig();
  const events: string[] = [];
  const h = r.voice.speak('Open the tab.', { start: () => events.push('start'), end: (e) => events.push(`end ${e.reason}`) });
  r.advance(1999);
  assert.equal(r.spare.spoken.length, 0, 'not yet');
  r.advance(2);
  assert.equal(r.primary.spoken[0]!.cancelled, true, 'the slow server request is stopped');
  assert.deepEqual(r.spare.spoken.map((s) => s.text), ['Open the tab.']);
  assert.deepEqual(events, [], 'the primary being cancelled is not the end of the utterance');
  r.spare.spoken[0]!.listener.start?.({ estimatedMs: 900 });
  r.spare.spoken[0]!.end({ reason: 'finished' });
  assert.deepEqual(events, ['start', 'end finished']);
  assert.deepEqual(await h.finished, { reason: 'finished' });
  assert.match(r.log[0]!, /gave no sound/);
});

test('a primary that fails before any sound (server down) is replaced at once, without waiting for the time limit', () => {
  const r = rig();
  const events: string[] = [];
  r.voice.speak('Hello there.', { start: () => events.push('start'), end: (e) => events.push(`end ${e.reason}`) });
  r.primary.spoken[0]!.end({ reason: 'error', error: 'the voice server is not reachable' });
  assert.deepEqual(r.spare.spoken.map((s) => s.text), ['Hello there.']);
  r.advance(10_000);
  assert.equal(r.spare.spoken.length, 1, 'the timer did not speak it twice');
  r.spare.spoken[0]!.listener.start?.({});
  r.spare.spoken[0]!.end({ reason: 'finished' });
  assert.deepEqual(events, ['start', 'end finished']);
});

test('after a failure the primary is left alone for the cooldown, then tried again, and a success puts it back', () => {
  const r = rig({ cooldownMs: 20_000 });
  r.voice.speak('one', {});
  r.advance(2000);
  r.spare.spoken[0]!.end({ reason: 'finished' });
  r.voice.speak('two', {});
  assert.equal(r.primary.spoken.length, 1, 'during the cooldown the spare is used straight away');
  assert.deepEqual(r.spare.spoken.map((s) => s.text), ['one', 'two']);
  r.spare.spoken[1]!.end({ reason: 'finished' });
  r.advance(20_000);
  r.voice.speak('three', {});
  assert.equal(r.primary.spoken.length, 2, 'after it, the primary gets another chance');
  r.primary.spoken[1]!.listener.start?.({});
  r.primary.spoken[1]!.end({ reason: 'finished' });
  r.voice.speak('four', {});
  assert.equal(r.primary.spoken.length, 3, 'and having spoken, it stays in use');
  assert.ok(r.log.some((l) => /speaking again/.test(l)));
});

test('a primary that fails again after its retry goes back into the cooldown', () => {
  const r = rig({ cooldownMs: 5000 });
  r.voice.speak('one', {});
  r.advance(2000);
  r.advance(5000);
  r.voice.speak('two', {});
  r.advance(2000);
  r.voice.speak('three', {});
  assert.equal(r.primary.spoken.length, 2, 'two tries so far, and the third is spoken by the spare');
  assert.equal(r.spare.spoken.length, 3);
});

test('a primary that breaks half-way is not replaced mid-sentence: the utterance ends as an error and the primary rests', () => {
  const r = rig();
  const ends: string[] = [];
  r.voice.speak('A longer sentence.', { end: (e) => ends.push(e.reason) });
  r.primary.spoken[0]!.listener.start?.({});
  r.primary.spoken[0]!.end({ reason: 'error', error: 'the voice server stopped sending' });
  assert.deepEqual(ends, ['error']);
  assert.equal(r.spare.spoken.length, 0);
  r.voice.speak('Next.', {});
  assert.equal(r.spare.spoken.length, 1, 'the next one goes to the spare for a while');
});

test('cancel stops whichever voice is speaking, ends the utterance once as cancelled and drops the timer', async () => {
  const r = rig();
  const ends: string[] = [];
  const a = r.voice.speak('one', { end: (e) => ends.push(`a ${e.reason}`) });
  r.voice.cancel();
  r.advance(5000);
  assert.deepEqual(ends, ['a cancelled']);
  assert.equal(r.spare.spoken.length, 0, 'a cancelled utterance is not given to the spare when its timer runs out');
  assert.deepEqual(await a.finished, { reason: 'cancelled' });
  // cancelled while the spare has it
  const b = r.voice.speak('two', { end: (e) => ends.push(`b ${e.reason}`) });
  r.advance(2000);
  b.cancel();
  assert.deepEqual(ends, ['a cancelled', 'b cancelled']);
  assert.equal(r.spare.spoken[0]!.cancelled, true);
});

test('a primary that starts just as the time limit comes is the voice (the limit is for the first sound only)', () => {
  const r = rig();
  const events: string[] = [];
  r.voice.speak('x', { start: () => events.push('start') });
  r.advance(1999);
  r.primary.spoken[0]!.listener.start?.({});
  r.advance(100);
  assert.equal(r.spare.spoken.length, 0);
  assert.deepEqual(events, ['start']);
});
