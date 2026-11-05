import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerBox, QUESTION_CHARS } from '../src/overlay/answer-box.ts';
import { ACTION_EXTRA_MS, ACTION_LABELS, HudState, NOTICE_FADE_MS, NOTICE_MS, STATUS_LABELS } from '../src/overlay/hud.ts';
import type { CaptionState } from '../src/overlay/captions.ts';

const said = (text: string, upTo = text.length): CaptionState => ({ text, upTo, endedAt: undefined });

test('a words-only answer is a box once a whole step has come with no drawing and some words are shown; a drawing, or Close, takes it away', () => {
  const box = answerBox();
  box.reset('What is a virus?');
  assert.equal(box.visible(), false, 'nothing said yet');
  box.words(said('A virus is not a cell.', 0));
  box.stepClosed();
  assert.equal(box.visible(), false, 'no words shown yet');
  box.words(said('A virus is not a cell.', 7));
  assert.equal(box.visible(), true);
  assert.deepEqual(box.view(), { question: 'What is a virus?', said: 'A virus', rest: ' is not a cell.' });
  box.drew();
  assert.equal(box.visible(), false, 'an answer that draws shows its words as captions');
  box.reset('Again');
  box.words(said('One.'));
  assert.equal(box.visible(), false, 'words arriving are not yet known to be a words-only answer: the step may still draw');
  box.stepClosed();
  assert.equal(box.visible(), true);
  box.close();
  assert.equal(box.visible(), false);
});

test('the words of earlier steps stay as the next is said, in order, and Copy has all of them', () => {
  const box = answerBox();
  box.reset('Q');
  box.words(said('First step.'));
  box.stepClosed();
  box.words(said('Second step is longer.', 6));
  assert.deepEqual(box.view(), { question: 'Q', said: 'First step. Second', rest: ' step is longer.' });
  box.words(null); // the captions let the step go once it has been said: it is kept
  assert.equal(box.fullText(), 'First step. Second step is longer.');
  box.words(said('Third.', 0));
  assert.deepEqual(box.view(), { question: 'Q', said: 'First step. Second step is longer.', rest: ' Third.' });
});

test('the question is cut to a heading, and a new answer starts clean', () => {
  const box = answerBox();
  box.reset('x'.repeat(500));
  assert.equal(box.view().question.length, QUESTION_CHARS);
  box.words(said('Old.'));
  box.reset('New');
  assert.equal(box.fullText(), '');
  assert.equal(box.visible(), false);
});

test('the dock says each status in words, a fault with a button stays longer, and a warning is a level of its own', () => {
  assert.equal(STATUS_LABELS.working, 'Thinking');
  assert.equal(STATUS_LABELS.detail, 'Adding detail…');
  assert.deepEqual(ACTION_LABELS, { hearing: 'Set up hearing', settings: 'Open Settings' });
  const hud = new HudState();
  hud.showNotice('Gone wrong.', 'error', 0, 'settings');
  assert.deepEqual(hud.view(NOTICE_MS.error + ACTION_EXTRA_MS - 1).notice, { text: 'Gone wrong.', level: 'error', alpha: 1, action: 'settings' });
  assert.ok((hud.view(NOTICE_MS.error + ACTION_EXTRA_MS + NOTICE_FADE_MS / 2).notice?.alpha ?? 1) < 1, 'then it fades');
  hud.showNotice('Not looking here.', 'warning', 0);
  const w = hud.view(NOTICE_MS.warning - 1).notice;
  assert.deepEqual([w?.level, w?.action], ['warning', undefined]);
  assert.equal(hud.view(NOTICE_MS.warning + NOTICE_FADE_MS).notice, null, 'one without a button goes at its own time');
});
