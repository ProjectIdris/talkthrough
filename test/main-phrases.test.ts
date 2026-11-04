import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSpoken } from '../src/main/phrases.ts';

test('"ask the backend" at the start of a sentence hands the question over; the rest is the question', () => {
  assert.deepEqual(parseSpoken('Ask the backend.'), { kind: 'backend', rest: '' });
  assert.deepEqual(parseSpoken('ask the backend why does this table have two headers'), { kind: 'backend', rest: 'why does this table have two headers' });
  assert.deepEqual(parseSpoken('Hey, please ask the deeper backend: what is wrong here?'), { kind: 'backend', rest: 'what is wrong here?' });
  assert.deepEqual(parseSpoken('Send this to the back end'), { kind: 'backend', rest: '' });
  assert.deepEqual(parseSpoken('Pass it on to the backend, about the error'), { kind: 'backend', rest: 'the error' });
});

test('a question that only mentions the backend is an ordinary question', () => {
  assert.equal(parseSpoken('What does the backend of this page do?'), null);
  assert.equal(parseSpoken('Why would I ask the backend for this?'), null);
  assert.equal(parseSpoken('What is this?'), null);
  assert.equal(parseSpoken(''), null);
});

test('"pin this" has to be the whole request', () => {
  for (const ok of ['Pin this.', 'pin that', 'Please pin it', 'Hey, pin this answer!', 'pin this one']) assert.deepEqual(parseSpoken(ok), { kind: 'pin' }, ok);
  for (const no of ['Pin this to the top of the page', 'What does pin this mean?', 'How do I pin this tab to the taskbar', 'pinned']) assert.equal(parseSpoken(no), null, no);
});
