import assert from 'node:assert/strict';
import test from 'node:test';
import { microphoneFault, modelFault, toolOf, VOICE_SERVER_DOWN } from '../src/shared/fault-help.ts';

test('the connector is read from the model id first, then from the adapter words; joined ids defer to the words', () => {
  assert.equal(toolOf('x', 'codex:gpt-6:fast'), 'codex');
  assert.equal(toolOf('x', 'openai:m'), 'api');
  assert.equal(toolOf('x', 'local:m'), 'local');
  assert.equal(toolOf('x', 'claude-haiku-5-5'), 'claude');
  assert.equal(toolOf('claude stopped before answering', 'codex:a+claude-b'), 'claude', 'two connectors: the words decide');
  assert.equal(toolOf('something else'), 'other');
});

test('each fault names the tool and the next step, and an unknown fault keeps the old general words', () => {
  assert.match(modelFault('unavailable', 'the codex command was not found'), /Codex isn't installed, or Talkthrough can't find it/);
  assert.match(modelFault('unavailable', 'claude could not start: spawn EPERM'), /would not start.*full path/);
  assert.match(modelFault('unavailable', 'claude stopped before answering'), /stopped before it answered.*`claude`/);
  assert.match(modelFault('auth', 'whatever the tool said', 'claude-haiku-5-5'), /isn't signed in.*`claude`/);
  assert.match(modelFault('auth', 'whatever', 'codex:gpt'), /`codex login`/);
  assert.equal(modelFault('rate-limited', 'x'), "The model's usage limit has been reached for now.");
  assert.equal(modelFault('unavailable', 'a mystery'), "I couldn't reach the model. Is it installed and signed in?");
  assert.equal(modelFault('weird', 'x'), 'Something went wrong while I was thinking. Try again?');
});

test('a failed microphone says whether it is blocked, missing or busy', () => {
  assert.match(microphoneFault('Permission denied'), /Privacy and security, Microphone/);
  assert.match(microphoneFault('NotAllowedError: Permission dismissed'), /Privacy and security/);
  assert.match(microphoneFault('Requested device not found'), /No microphone was found/);
  assert.match(microphoneFault('Could not start audio source'), /another app may be using it/);
  assert.match(microphoneFault('recording failed'), /connected and allowed in Windows/);
});

test('the notices are short enough to read on the screen', () => {
  for (const text of [VOICE_SERVER_DOWN, modelFault('auth', 'x', 'claude-haiku-5-5'), microphoneFault('Permission denied'), modelFault('unavailable', 'the codex command was not found')]) assert.ok(text.length <= 170, text);
});

test('a chosen connector gets its install help when it is missing and its sign-in help when it is found; the others get none', async () => {
  const { routeHelp } = await import('../src/shared/fault-help.ts');
  assert.match(routeHelp('claude', false), /^Claude Code wasn't found.*Install it.*`claude`/);
  assert.equal(routeHelp('claude', true).startsWith('Open a terminal, run `claude`'), true);
  assert.match(routeHelp('codex', false), /Codex wasn't found.*`codex login`/);
  assert.equal(routeHelp('openai', false), '');
  assert.equal(routeHelp('local', true), '');
});
