import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ANSWER_SCHEME, answerOf, CARD_SIZE, CARD_WINDOW_OPTIONS, cardBounds, cardHtml, createConsentCard } from '../src/main/consent-card.ts';
import type { CardWindow, Rect } from '../src/main/consent-card.ts';

const AREA: Rect = { x: 1920, y: 0, width: 1920, height: 1040 };

function fakeWindow() {
  const log: string[] = [];
  let answer: ((yes: boolean) => void) | undefined;
  const shown: Array<{ html: string; bounds: Rect }> = [];
  const win: CardWindow = {
    show: (html, bounds) => { shown.push({ html, bounds }); log.push('show'); },
    hide: () => void log.push('hide'),
    destroy: () => void log.push('destroy'),
    onAnswer: (l) => void (answer = l),
  };
  return { win, log, shown, click: (yes: boolean) => answer!(yes) };
}

test('the card sits at the bottom right of the display it is asked on, inside its usable area', () => {
  const b = cardBounds(AREA);
  assert.equal(b.width, CARD_SIZE.width);
  assert.ok(b.x >= AREA.x && b.x + b.width <= AREA.x + AREA.width);
  assert.ok(b.y >= AREA.y && b.y + b.height <= AREA.y + AREA.height);
  assert.ok(b.x + b.width > AREA.x + AREA.width - 100 && b.y + b.height > AREA.y + AREA.height - 200, 'near the corner');
});

test('the page says the question, escaped, and holds a Yes and a No that are addresses main reads', () => {
  const html = cardHtml('I can open <that> "tab" & more');
  assert.ok(html.includes('I can open &lt;that&gt; &quot;tab&quot; &amp; more'));
  assert.ok(!html.includes('<that>'));
  assert.ok(html.includes(`href="${ANSWER_SCHEME}//yes"`) && html.includes(`href="${ANSWER_SCHEME}//no"`));
  assert.ok(!/<script/i.test(html), 'no script at all');
});

test('only the two answer addresses are answers', () => {
  assert.equal(answerOf(`${ANSWER_SCHEME}//yes`), true);
  assert.equal(answerOf(`${ANSWER_SCHEME}//no`), false);
  for (const other of ['', 'https://example.com/yes', `${ANSWER_SCHEME}//maybe`, `${ANSWER_SCHEME}//yes/../x`, 'tt-answer:yes', 'file:///c:/x']) assert.equal(answerOf(other), null, other);
});

test('the window is never click-through, never takes focus, has no script and no way out: that is what lets it take a tap with no mouse move before it', () => {
  assert.equal(CARD_WINDOW_OPTIONS.focusable, false);
  assert.equal(CARD_WINDOW_OPTIONS.alwaysOnTop, true);
  assert.equal(CARD_WINDOW_OPTIONS.frame, false);
  const source = readFileSync(new URL('../src/main/consent-window.ts', import.meta.url), 'utf8');
  assert.ok(!/setIgnoreMouseEvents\s*\(/.test(source), 'the window must not be made click-through');
  assert.ok(/javascript:\s*false/.test(source) && !/preload/.test(source.replace(/\/\/.*$/gm, '')), 'no script, no preload');
  assert.ok(/will-navigate/.test(source) && /preventDefault/.test(source), 'a click on a button is a navigation that main reads and stops');
});

test('asking shows the card with the text on the right display; a click on Yes or No hides it and tells main; the window is made once', () => {
  const f = fakeWindow();
  const answers: boolean[] = [];
  let made = 0;
  const card = createConsentCard({ makeWindow: () => (made++, f.win), areaOf: (id) => (id === 7 ? AREA : null), onAnswer: (yes) => void answers.push(yes) });
  card.show(7, 'May I?');
  assert.equal(made, 1);
  assert.equal(f.shown.length, 1);
  assert.ok(f.shown[0]!.html.includes('May I?'));
  assert.deepEqual(f.shown[0]!.bounds, cardBounds(AREA));
  f.click(true);
  assert.deepEqual(answers, [true]);
  assert.equal(f.log.at(-1), 'hide', 'the card goes when it is answered');
  card.show(7, 'Again?');
  assert.equal(made, 1, 'the same window');
  f.click(false);
  assert.deepEqual(answers, [true, false]);
});

test('hiding a card that is not showing does nothing; an unknown display shows nothing; disposing destroys the window', () => {
  const f = fakeWindow();
  const card = createConsentCard({ makeWindow: () => f.win, areaOf: (id) => (id === 7 ? AREA : null), onAnswer: () => undefined });
  card.hide();
  card.show(99, 'x');
  assert.deepEqual(f.log, []);
  card.show(7, 'x');
  card.hide();
  assert.deepEqual(f.log, ['show', 'hide']);
  card.hide();
  assert.deepEqual(f.log, ['show', 'hide'], 'hidden once');
  card.dispose();
  assert.equal(f.log.at(-1), 'destroy');
});
