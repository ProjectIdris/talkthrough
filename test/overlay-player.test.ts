import test from 'node:test';
import assert from 'node:assert/strict';
import { Player, VOICE_PATIENCE_MS, createSilentVoice } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';
import type { SpeechListener, Voice } from '../src/adapters/voice.ts';
import type { Scene } from '../src/scene/index.ts';

/** A clock that only moves when the test says so. */
function fakeClock() {
  let now = 0;
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  const clock: Clock = {
    now: () => now,
    after: (ms, fn) => {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => { t.live = false; };
    },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.fn();
    }
    now = target;
  };
  return { clock, advance };
}

/** A voice the test drives by hand. */
function manualVoice() {
  const spoken: Array<{ text: string; listener: SpeechListener }> = [];
  let cancels = 0;
  const voice: Voice = {
    id: 'manual',
    speak(text, listener = {}) {
      spoken.push({ text, listener });
      return { finished: new Promise(() => {}), cancel() {} };
    },
    cancel() { cancels++; },
  };
  return { voice, spoken, cancels: () => cancels };
}

const box = (id: string, extra: object = {}) => ({ op: 'box', id, x: 10, y: 10, w: 100, h: 50, color: 'red', ...extra });
const scene = (...steps: Array<{ say: string; actions: unknown[] }>): Scene => ({ steps }) as Scene;
const ids = (f: { marks: Array<{ id: string }> }) => f.marks.map((m) => m.id);

test('a step starts when its speech starts, runs over it, and the next is spoken only once both are over', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  let done = 0;
  const player = new Player({ voice: v.voice, clock, onDone: () => done++ });
  player.play(scene(
    { say: 'one two three four five', actions: [box('a'), box('b', { at: 1 })] },
    { say: 'next', actions: [box('c')] },
  ));
  assert.equal(v.spoken.length, 1);
  assert.deepEqual(ids(player.update()), [], 'nothing is drawn before the voice starts');
  advance(500);
  assert.deepEqual(ids(player.update()), [], 'still waiting');

  v.spoken[0]?.listener.start?.({ estimatedMs: 2000 });
  assert.deepEqual(ids(player.update()), ['a']);
  advance(1200);
  assert.deepEqual(ids(player.update()), ['a', 'b']);

  advance(5000);
  player.update();
  assert.equal(v.spoken.length, 1, 'the drawing is long finished but the speech has not ended');
  v.spoken[0]?.listener.end?.({ reason: 'finished' });
  const frame = player.update();
  assert.equal(v.spoken.length, 2, 'the next step is spoken once both are over');
  assert.deepEqual(ids(frame), ['a', 'b'], 'the first step stays drawn');

  v.spoken[1]?.listener.start?.({ estimatedMs: 800 });
  assert.deepEqual(ids(player.update()), ['a', 'b', 'c']);
  v.spoken[1]?.listener.end?.({ reason: 'finished' });
  advance(2000);
  assert.deepEqual(ids(player.update()), ['a', 'b', 'c']);
  assert.equal(done, 1);
  assert.equal(player.active, false);
});

test('the speech length stretches or squeezes the step so the actions run over the utterance', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  // Five words are 2 s at the assumed pace; the voice says it will take 4 s, so the action at 1 s lands at 2 s.
  player.play(scene({ say: 'one two three four five', actions: [box('late', { at: 1 })] }));
  v.spoken[0]?.listener.start?.({ estimatedMs: 4000 });
  advance(1500);
  assert.deepEqual(ids(player.update()), []);
  advance(700);
  assert.deepEqual(ids(player.update()), ['late']);
});

test('a voice that never answers does not stall the picture', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.play(scene({ say: 'hello there', actions: [box('a')] }, { say: 'again', actions: [box('b')] }));
  advance(VOICE_PATIENCE_MS - 100);
  assert.deepEqual(ids(player.update()), []);
  advance(300);
  assert.deepEqual(ids(player.update()), ['a']);
  advance(1000);
  player.update();
  assert.equal(v.spoken.length, 2, 'and it moves on to the next step');
});

test('a voice that ends without starting (none installed) still plays the drawing', () => {
  const { clock } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.play(scene({ say: 'hello', actions: [box('a')] }));
  v.spoken[0]?.listener.end?.({ reason: 'error' });
  assert.deepEqual(ids(player.update()), ['a']);
});

test('a step with nothing to say plays at once', () => {
  const { clock } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.play(scene({ say: '', actions: [box('a')] }));
  assert.equal(v.spoken.length, 0);
  assert.deepEqual(ids(player.update()), ['a']);
});

test('a new scene replaces the one playing but keeps what is drawn; stale speech events are ignored', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.play(scene({ say: 'first', actions: [box('a')] }));
  v.spoken[0]?.listener.start?.({ estimatedMs: 1000 });
  advance(100);
  const before = v.cancels();
  player.play(scene({ say: 'second', actions: [box('b')] }));
  assert.ok(v.cancels() > before, 'the old speech is cancelled');
  // The cancelled utterance reports back late; that must not start or end the new step.
  v.spoken[0]?.listener.end?.({ reason: 'cancelled' });
  v.spoken[0]?.listener.start?.({ estimatedMs: 1 });
  assert.deepEqual(ids(player.update()), ['a'], 'the first scene is settled, the second has not started');
  v.spoken[1]?.listener.start?.({ estimatedMs: 1000 });
  assert.deepEqual(ids(player.update()), ['a', 'b']);
});

test('clear removes everything and stops the voice', () => {
  const { clock } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.play(scene({ say: '', actions: [box('a')] }));
  player.clear();
  assert.deepEqual(ids(player.update()), []);
  assert.ok(v.cancels() > 0);
  assert.equal(player.active, false);
});

test('seek shows an earlier step complete and the chosen step part way, with no clock', () => {
  const { clock } = fakeClock();
  const player = new Player({ voice: manualVoice().voice, clock });
  player.seek(scene(
    { say: 'a', actions: [box('a')] },
    { say: 'b', actions: [box('b', { at: 1 }), box('c', { at: 5 })] },
  ), 1, 2);
  assert.deepEqual(ids(player.update()), ['a', 'b']);
  assert.equal(player.active, false);
});

test('dragging the camera moves it, in every state, and the move is kept for the next scene', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.dragCamera(20, 5);
  assert.equal(player.update().camera.az, 20, 'before anything is drawn');

  player.play(scene({ say: 'x', actions: [{ op: 'add', shape: 'box', id: 'c', size: [1, 1, 1], color: 'red' }] }));
  player.dragCamera(10, 0);
  assert.equal(player.update().camera.az, 30, 'while waiting for the voice');
  v.spoken[0]?.listener.start?.({ estimatedMs: 1000 });
  player.dragCamera(10, 0);
  assert.equal(player.update().camera.az, 40, 'while the step runs');
  v.spoken[0]?.listener.end?.({ reason: 'finished' });
  advance(5000);
  assert.equal(player.update().camera.az, 40, 'and when it has finished');
  player.dragCamera(-15, 0);
  assert.equal(player.update().camera.az, 25, 'when idle');
  player.play(scene({ say: '', actions: [] }));
  assert.equal(player.update().camera.az, 25, 'the next scene starts from there');

  const grabbed = new Player({ voice: v.voice, clock });
  grabbed.seek(scene({ say: 'x', actions: [] }), 0, 0);
  grabbed.dragCamera(7, 0);
  assert.equal(grabbed.update().camera.az, 7, 'also in a frozen frame');
});

test('the silent voice paces a step by its words and can be cancelled', async () => {
  const { clock, advance } = fakeClock();
  const voice = createSilentVoice(clock);
  const events: string[] = [];
  const handle = voice.speak('one two three four five', {
    start: (e) => events.push(`start ${e.estimatedMs}`),
    end: (e) => events.push(`end ${e.reason}`),
  });
  advance(1);
  advance(1999);
  assert.deepEqual(events, ['start 2000', 'end finished']);
  assert.deepEqual(await handle.finished, { reason: 'finished' });

  events.length = 0;
  const second = voice.speak('one two three four five', { end: (e) => events.push(`end ${e.reason}`) });
  voice.cancel();
  advance(5000);
  assert.deepEqual(events, ['end cancelled']);
  assert.deepEqual(await second.finished, { reason: 'cancelled' });
});

test('live play: steps pushed while one plays queue behind it, and the turn is done only once it has ended and drained', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  let done = 0;
  const player = new Player({ voice: v.voice, clock, onDone: () => done++ });
  player.beginTurn();
  assert.equal(v.spoken.length, 0, 'nothing to say yet');
  assert.equal(player.active, false, 'waiting for the model costs no frames');
  player.pushStep({ say: 'one', actions: [box('a')] } as never);
  assert.equal(v.spoken.length, 1, 'the first step starts at once');
  player.pushStep({ say: 'two', actions: [box('b')] } as never);
  player.pushStep({ say: 'three', actions: [box('c')] } as never);
  assert.equal(v.spoken.length, 1, 'later steps wait their turn');
  v.spoken[0]?.listener.start?.({ estimatedMs: 500 });
  v.spoken[0]?.listener.end?.({ reason: 'finished' });
  advance(2000);
  player.update();
  assert.equal(v.spoken.length, 2);
  v.spoken[1]?.listener.start?.({ estimatedMs: 500 });
  v.spoken[1]?.listener.end?.({ reason: 'finished' });
  advance(2000);
  player.update();
  v.spoken[2]?.listener.start?.({ estimatedMs: 500 });
  v.spoken[2]?.listener.end?.({ reason: 'finished' });
  advance(2000);
  assert.deepEqual(ids(player.update()), ['a', 'b', 'c']);
  assert.equal(done, 0, 'the model may still be writing: not done until the turn ends');
  assert.equal(player.active, false);
  player.endTurn();
  assert.equal(done, 1);
  player.endTurn();
  assert.equal(done, 1, 'ending twice reports once');
});

test('live play: a step that arrives after the player ran dry starts from where the picture stands', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.beginTurn();
  player.pushStep({ say: 'one', actions: [box('a')] } as never);
  v.spoken[0]?.listener.start?.({ estimatedMs: 300 });
  v.spoken[0]?.listener.end?.({ reason: 'finished' });
  advance(3000);
  assert.deepEqual(ids(player.update()), ['a']);
  assert.equal(player.active, false);
  player.pushStep({ say: 'two', actions: [box('b')] } as never);
  assert.equal(player.active, true);
  assert.equal(v.spoken.length, 2);
  v.spoken[1]?.listener.start?.({ estimatedMs: 300 });
  assert.deepEqual(ids(player.update()), ['a', 'b']);
});

test('live play: a turn that ends with no steps is done at once; the answer so far stays drawn', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  let done = 0;
  const player = new Player({ voice: v.voice, clock, onDone: () => done++ });
  player.beginTurn();
  player.endTurn();
  assert.equal(done, 1);

  player.play(scene({ say: '', actions: [box('a')] }));
  advance(5000);
  player.update();
  assert.equal(done, 2);
  player.beginTurn();
  assert.deepEqual(ids(player.update()), ['a'], 'a follow-up turn continues what is on screen');
  player.clear();
  player.pushStep({ say: '', actions: [box('z')] } as never);
  assert.deepEqual(ids(player.update()), ['z'], 'a step with no open turn opens one');
});

test('live play: a new turn cancels the speech of the old one and drops its queue', () => {
  const { clock } = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock });
  player.beginTurn();
  player.pushStep({ say: 'one', actions: [box('a')] } as never);
  player.pushStep({ say: 'two', actions: [box('b')] } as never);
  const before = v.cancels();
  player.beginTurn();
  assert.ok(v.cancels() > before);
  v.spoken[0]?.listener.end?.({ reason: 'cancelled' });
  assert.equal(v.spoken.length, 1, 'the queued step of the old turn never plays');
});

test('hush stops the speech at once, drops what is queued, and lets the step in progress finish drawing', () => {
  const { clock, advance } = fakeClock();
  const v = manualVoice();
  let done = 0;
  const player = new Player({ voice: v.voice, clock, onDone: () => done++ });
  player.beginTurn();
  player.pushStep({ say: 'one', actions: [box('a')] } as never);
  player.pushStep({ say: 'two', actions: [box('b')] } as never);
  v.spoken[0]?.listener.start?.({ estimatedMs: 2000 });
  const before = v.cancels();
  player.hush();
  assert.ok(v.cancels() > before, 'the voice is stopped');
  v.spoken[0]?.listener.end?.({ reason: 'cancelled' });
  advance(5000);
  assert.deepEqual(ids(player.update()), ['a'], 'the step in progress finished drawing; the queued one never starts');
  assert.equal(v.spoken.length, 1, 'nothing more is spoken');
  assert.equal(done, 1, 'and the turn is over');
  player.pushStep({ say: 'late', actions: [box('c')] } as never);
  advance(100);
  assert.equal(v.spoken.length, 2, 'a step that still arrives after a hush opens a new turn instead of joining the old one');
});

test('the speech-start hook fires when the voice really starts, once for each step', () => {
  const { clock } = fakeClock();
  const v = manualVoice();
  let starts = 0;
  const player = new Player({ voice: v.voice, clock, onSpeechStart: () => starts++ });
  player.play(scene({ say: 'one two', actions: [box('a')] }, { say: 'three', actions: [box('b')] }));
  assert.equal(starts, 0, 'asking to speak is not speaking');
  v.spoken[0]?.listener.start?.({ estimatedMs: 500 });
  v.spoken[0]?.listener.start?.({ estimatedMs: 500 });
  assert.equal(starts, 1);
});

test('a voice can be swapped for a development run with no speech', () => {
  const { clock, advance } = fakeClock();
  const loud = manualVoice();
  const quiet = manualVoice();
  const player = new Player({ voice: loud.voice, clock });
  player.setVoice(quiet.voice);
  player.play(scene({ say: 'hi', actions: [box('a')] }));
  assert.equal(loud.spoken.length, 0);
  assert.equal(quiet.spoken.length, 1);
  advance(1);
});
