import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavConsent, parseConsent } from '../src/main/nav-consent.ts';

test('nothing is given at first; a question stays open until it is answered, and a yes is remembered', async () => {
  const c = createNavConsent({ after: () => () => undefined });
  assert.equal(c.given(), false);
  assert.equal(c.pending(), false);
  const asked = c.ask();
  assert.equal(c.pending(), true);
  assert.equal(c.ask(), asked, 'a second ask while one is open shares it');
  assert.equal(c.answer(true), true);
  assert.equal(await asked, 'yes');
  assert.equal(c.given(), true);
  assert.equal(c.pending(), false);
  assert.equal(await c.ask(), 'yes', 'asked again, it is yes at once');
});

test('a no is not remembered; the next first move asks again', async () => {
  const c = createNavConsent({ after: () => () => undefined });
  const asked = c.ask();
  c.answer(false);
  assert.equal(await asked, 'no');
  assert.equal(c.given(), false);
  void c.ask();
  assert.equal(c.pending(), true);
});

test('an answer with nothing asked changes nothing: a stray yes gives no permission', () => {
  const c = createNavConsent({ after: () => () => undefined });
  assert.equal(c.answer(true), false);
  assert.equal(c.given(), false);
});

test('a question not answered in time is a timeout, and gives no permission', async () => {
  let fire!: () => void;
  const c = createNavConsent({ timeoutMs: 1234, after: (ms, run) => { assert.equal(ms, 1234); fire = run; return () => undefined; } });
  const asked = c.ask();
  fire();
  assert.equal(await asked, 'timeout');
  assert.equal(c.given(), false);
  assert.equal(c.pending(), false);
});

test('a cancel closes the question with no permission', async () => {
  const c = createNavConsent({ after: () => () => undefined });
  const asked = c.ask();
  c.cancel();
  assert.equal(await asked, 'cancelled');
  assert.equal(c.given(), false);
});

test('a pause answers any open question no, refuses new ones even after a yes, and leaves the yes standing for when it is lifted', async () => {
  const c = createNavConsent({ after: () => () => undefined });
  const open = c.ask();
  c.setPaused(true);
  assert.equal(await open, 'no');
  assert.equal(await c.ask(), 'no', 'paused: no');
  c.setPaused(false);
  const again = c.ask();
  c.answer(true);
  assert.equal(await again, 'yes');
  c.setPaused(true);
  assert.equal(await c.ask(), 'no', 'a yes does not outrank a pause');
  c.setPaused(false);
  assert.equal(await c.ask(), 'yes');
});

test('listeners hear every change (so the tray can redraw)', () => {
  const c = createNavConsent({ after: () => () => undefined });
  let n = 0;
  c.onChange(() => void n++);
  void c.ask();
  c.answer(true);
  c.setPaused(true);
  assert.ok(n >= 3);
});

test('short spoken yes and no are told from questions', () => {
  for (const t of ['Yes', 'yes.', 'Yeah', 'yes please', 'Okay', 'ok', 'sure', 'go ahead', 'Go ahead.', 'do it', 'yes, go ahead', 'please do', 'yep']) assert.equal(parseConsent(t), 'yes', t);
  for (const t of ['No', 'no.', 'nope', 'stop', 'cancel', 'not now', "don't", 'no thanks', "I'll do it myself", 'never mind']) assert.equal(parseConsent(t), 'no', t);
  for (const t of ['', 'how do I export this', 'yes but why is the file menu greyed out', 'what does okay mean here', 'open the file menu and then click export now please', 'no idea where this setting is']) assert.equal(parseConsent(t), null, t);
});
