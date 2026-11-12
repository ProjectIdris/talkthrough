import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HudState, MORE_DELAY_MS, NOTICE_FADE_MS, NOTICE_MS, shownStatus } from '../src/overlay/hud.ts';
import { Player } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';
import { followupSpot } from '../src/overlay/followup-placement.ts';
import type { SpeechListener, Voice } from '../src/adapters/voice.ts';

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
  return { clock, advance, now: () => now };
}

/** A voice the test drives by hand. */
function manualVoice() {
  const spoken: Array<{ text: string; listener: SpeechListener }> = [];
  const voice: Voice = {
    id: 'manual',
    speak(text, listener = {}) {
      spoken.push({ text, listener });
      return { finished: new Promise(() => {}), cancel() {} };
    },
    cancel() {},
  };
  return { voice, spoken };
}

/**
 * The page as overlay.ts drives it: the same calls on the same two objects for each message (begin, step-open, action, step-close,
 * step, end, status, notice, clear), and the same question each frame ("what does the wait pill say?").
 */
function page() {
  const t = fakeClock();
  const v = manualVoice();
  const player = new Player({ voice: v.voice, clock: t.clock });
  const hud = new HudState();
  const box = (id: string) => ({ op: 'box', id, x: 10, y: 10, w: 100, h: 50, color: 'red' });
  const api = {
    player, hud, v,
    /** A frame: the player moves on, the HUD is told whether a turn has run dry, and the pill is read. */
    pill() {
      player.update();
      hud.setAwaitingNext(player.awaitingNext, t.now());
      return hud.waitPill(t.now());
    },
    wait(ms: number) { t.advance(ms); },
    now() { return t.now(); },
    // messages
    release() { hud.setStatus('working'); },
    begin(detail = false) { hud.newTurn(); player.beginTurn(detail); },
    stepOpen(say: string) { hud.stopWorking(); player.openStep(say); },
    action(id: string) { player.addAction(box(id) as never); },
    stepClose() { player.closeStep(); },
    step(say: string, ...ids: string[]) { hud.stopWorking(); player.pushStep({ say, actions: ids.map(box) } as never); },
    end() { hud.stopWorking(); player.endTurn(); },
    status(s: Parameters<HudState['setStatus']>[0]) { if (s === 'idle') hud.setStatus('idle'); else hud.setStatus(s); },
    notice(level: 'info' | 'error' | 'warning') { hud.showNotice('text', level, t.now()); },
    /** Escape: the page clears the player and the HUD (the 'clear' message after the quick fade). */
    escape() { player.clear(); hud.reset(); },
    /** The voice finishes the step in turn. */
    said(i: number) {
      v.spoken[i]?.listener.start?.({ estimatedMs: 300 });
      v.spoken[i]?.listener.end?.({ reason: 'finished' });
      t.advance(3000);
      player.update();
      hud.setAwaitingNext(player.awaitingNext, t.now()); // the frame on which the step finished
    },
  };
  return api;
}

test('a turn is awaiting its next step only once it is open, has shown a step, has said it and nothing is queued', () => {
  const p = page();
  assert.equal(p.player.awaitingNext, false, 'no turn');
  p.begin();
  assert.equal(p.player.awaitingNext, false, 'a turn with no step yet is the Thinking pill, not this one');
  p.step('one', 'a');
  assert.equal(p.player.awaitingNext, false, 'the first step is still being said');
  p.said(0);
  assert.equal(p.player.awaitingNext, true, 'said and drawn, the turn still open');
  p.step('two', 'b');
  assert.equal(p.player.awaitingNext, false, 'the next step is here');
  p.said(1);
  assert.equal(p.player.awaitingNext, true);
  p.stepOpen('three');
  assert.equal(p.player.awaitingNext, false, 'a step being written (opened, not closed) is not waited for');
  p.stepClose();
  p.said(2);
  assert.equal(p.player.awaitingNext, true);
  p.end();
  assert.equal(p.player.awaitingNext, false, 'the turn has ended');
});

test('a cleared player, a detail pass and a replaced turn are not awaiting anything', () => {
  const p = page();
  p.begin();
  p.step('one', 'a');
  p.said(0);
  assert.equal(p.player.awaitingNext, true);
  p.player.clear();
  assert.equal(p.player.awaitingNext, false, 'cleared');
  p.begin();
  p.step('one', 'a');
  p.said(1);
  assert.equal(p.player.awaitingNext, true);
  p.begin();
  assert.equal(p.player.awaitingNext, false, 'a new turn starts from its own Thinking');
  p.begin(true);
  p.step('detail words', 'z');
  p.said(2);
  assert.equal(p.player.awaitingNext, false, 'a detail pass has its own "Adding detail" status and speaks nothing');
});

test('Thinking: from the release until the first piece, and not before or after', () => {
  const p = page();
  assert.equal(p.pill(), null, 'nothing before the question');
  p.release();
  assert.equal(p.pill(), 'thinking', 'at the release');
  p.wait(20000);
  assert.equal(p.pill(), 'thinking', 'as long as the first piece takes');
  p.begin();
  assert.equal(p.pill(), 'thinking', 'the begin is not content: the first piece is a word or a mark');
  p.stepOpen('First words.');
  assert.equal(p.pill(), null, 'the first piece: the pill goes');
});

test('Thinking ends on a whole first step too, and on a turn that ends with nothing', () => {
  const whole = page();
  whole.release();
  whole.begin();
  whole.step('All at once.', 'a');
  assert.equal(whole.pill(), null);
  const empty = page();
  empty.release();
  empty.begin();
  empty.end();
  assert.equal(empty.pill(), null);
});

test('More coming: after a step is said and the next has not come, after a short pause, until it does', () => {
  const p = page();
  p.release();
  p.begin();
  p.stepOpen('One.');
  p.action('a');
  p.stepClose();
  assert.equal(p.pill(), null, 'while the first step is being said');
  p.said(0);
  assert.equal(p.pill(), null, 'at once there is no pill: a step that follows straight on would only make it blink');
  p.wait(MORE_DELAY_MS - 1);
  assert.equal(p.pill(), null);
  p.wait(2);
  assert.equal(p.pill(), 'more', 'past the pause');
  p.wait(30000);
  assert.equal(p.pill(), 'more', 'it stays as long as the next step takes');
  p.stepOpen('Two.');
  assert.equal(p.pill(), null, 'the next step arrives: it goes at once');
  p.action('b');
  p.stepClose();
  p.said(1);
  assert.equal(p.pill(), null, 'the frame that finds it dry starts the pause');
  p.wait(MORE_DELAY_MS + 5);
  assert.equal(p.pill(), 'more', 'again between the second and third');
  p.step('Three.', 'c');
  assert.equal(p.pill(), null);
});

test('More coming goes at the end of the answer, whether it had shown or the end came inside the pause', () => {
  const shown = page();
  shown.begin();
  shown.step('One.', 'a');
  shown.said(0);
  shown.wait(MORE_DELAY_MS + 5);
  assert.equal(shown.pill(), 'more');
  shown.end();
  assert.equal(shown.pill(), null, 'the end: gone');
  shown.wait(MORE_DELAY_MS * 4);
  assert.equal(shown.pill(), null, 'and it does not come back');

  const quick = page();
  quick.begin();
  quick.step('One.', 'a');
  quick.said(0);
  quick.wait(MORE_DELAY_MS / 2);
  quick.end();
  quick.wait(MORE_DELAY_MS * 4);
  assert.equal(quick.pill(), null, 'an end inside the pause: it never showed');
});

test('Escape clears both: Thinking and More coming', () => {
  const thinking = page();
  thinking.release();
  assert.equal(thinking.pill(), 'thinking');
  thinking.escape();
  assert.equal(thinking.pill(), null);

  const more = page();
  more.begin();
  more.step('One.', 'a');
  more.said(0);
  more.wait(MORE_DELAY_MS + 5);
  assert.equal(more.pill(), 'more');
  more.escape();
  assert.equal(more.pill(), null);
  more.wait(MORE_DELAY_MS * 4);
  assert.equal(more.pill(), null, 'nothing left to wait for');
});

test('an error notice takes over from either pill, and a plain notice does not', () => {
  const thinking = page();
  thinking.release();
  thinking.notice('error');
  assert.equal(thinking.pill(), null, 'Thinking, then an error');

  const more = page();
  more.begin();
  more.step('One.', 'a');
  more.said(0);
  more.wait(MORE_DELAY_MS + 5);
  assert.equal(more.pill(), 'more');
  more.notice('error');
  assert.equal(more.pill(), null, 'More coming, then an error');
  more.wait(10000);
  assert.equal(more.pill(), 'more', 'once the error notice has gone and the turn is still open, the wait is told again');

  const info = page();
  info.release();
  info.notice('info');
  assert.equal(info.pill(), 'thinking', 'a passing notice is not an error');
});

test('guide mode: a replan says Thinking, not More coming too, and the person\'s turn and the check say neither', () => {
  const p = page();
  p.begin();
  p.step('Click the Share button.', 'a');
  p.said(0);
  p.status('waiting');
  p.wait(MORE_DELAY_MS * 3);
  assert.equal(p.pill(), null, 'your turn: click, the walk is waiting for the person');
  p.status('checking');
  assert.equal(p.pill(), null, 'the check after the click');
  p.status('working');
  assert.equal(p.pill(), 'thinking', 'the replan');
  p.begin();
  assert.equal(p.pill(), 'thinking', 'the replan has begun: still no first piece');
  p.stepOpen('Now pick Anyone.');
  assert.equal(p.pill(), null, 'the first piece of the replan');
  p.stepClose();
  p.said(1);
  p.wait(MORE_DELAY_MS + 5);
  assert.equal(p.pill(), 'more');
});

test('a new press while a turn waits says Listening, not More coming', () => {
  const p = page();
  p.begin();
  p.step('One.', 'a');
  p.said(0);
  p.wait(MORE_DELAY_MS + 5);
  assert.equal(p.pill(), 'more');
  p.status('listening');
  assert.equal(p.pill(), null);
});

test('the page is woken when the pause is over, since a turn that waits draws no frames', () => {
  const hud = new HudState();
  assert.equal(hud.untilChange(0), undefined, 'nothing to wait for');
  hud.setAwaitingNext(true, 1000);
  assert.equal(hud.untilChange(1000), MORE_DELAY_MS);
  assert.equal(hud.untilChange(1000 + 200), MORE_DELAY_MS - 200);
  assert.equal(hud.waitPill(1000 + MORE_DELAY_MS), 'more');
  assert.equal(hud.untilChange(1000 + MORE_DELAY_MS), undefined, 'once it shows, nothing changes by itself');
  hud.setAwaitingNext(false, 5000);
  assert.equal(hud.untilChange(5000), undefined);
});

test('the pill is kept off the model, the guide target and the answer, and sits at its home when nothing is there', () => {
  const view = { width: 1600, height: 900 }, size = { w: 120, h: 30 };
  const home = { x: (1600 - 120) / 2, y: 900 - 28 - 30 };
  assert.deepEqual(followupSpot(view, size, [], undefined, home), home, 'clear screen: at home, bottom centre');
  const model = { x: 500, y: 300, w: 600, h: 600 };
  const at = followupSpot(view, size, [model], undefined, home);
  const overlaps = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x < r.x + r.w && p.x + size.w > r.x && p.y < r.y + r.h && p.y + size.h > r.y;
  assert.equal(overlaps(at, model), false, 'a model standing where home is: moved off it');
  const target = { x: 700, y: 700, w: 200, h: 60 };
  const two = followupSpot(view, size, [model, target], undefined, home);
  assert.equal(overlaps(two, model) || overlaps(two, target), false, 'the model and a guide target');
  assert.deepEqual(followupSpot(view, size, [{ x: 0, y: 0, w: 100, h: 100 }], undefined, home), home, 'something far away leaves it at home');
});

test('without a home the control group keeps its usual corner', () => {
  assert.deepEqual(followupSpot({ width: 1600, height: 900 }, { w: 120, h: 30 }, []), { x: 22, y: 900 - 28 - 30 });
});

const html = readFileSync(new URL('../src/overlay/index.html', import.meta.url), 'utf8');

test('reduced motion shows the pill still: the dot and the three dots stop, and the pill is not animated in', () => {
  const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([^]*?)\n\s*\}\s*\n/.exec(html)?.[1] ?? '';
  assert.match(block, /#status\s+\.dot[^{}]*\{[^}]*animation:\s*none/);
  assert.match(block, /\.ell\s+i[^{}]*\{[^}]*animation:\s*none/);
});

test('the smaller pill for "More coming" exists beside the status pill, in the same dock, with its dots', () => {
  assert.match(html, /#status\.more\s*\{[^}]*font-size/);
  assert.match(html, /#status\.more \.ell/);
});

test('an error ends Thinking for good: the pill does not come back behind the notice when it has gone', () => {
  const p = page();
  p.release();
  assert.equal(p.pill(), 'thinking');
  p.notice('error');
  assert.equal(p.pill(), null, 'the notice has taken over');
  p.wait(NOTICE_MS.error + NOTICE_FADE_MS + 1000);
  assert.equal(p.hud.view(p.now()).status, 'idle', 'the working status was dropped with the error');
  assert.equal(p.pill(), null, 'and nothing is thinking behind the gone notice');
});

test('a new question and a clear each forget a pause that was running', () => {
  for (const [name, end] of [['new question', (h: HudState) => h.newTurn()], ['clear', (h: HudState) => h.reset()]] as const) {
    const hud = new HudState();
    hud.setAwaitingNext(true, 0);
    end(hud);
    assert.equal(hud.waitPill(MORE_DELAY_MS * 3), null, `${name}: the old pause does not show More coming`);
    assert.equal(hud.untilChange(0), undefined, `${name}: and nothing is scheduled for it`);
  }
});

test('Thinking does not show beside an error that is already up: a replan after a fault leaves the notice alone, and Thinking comes back when it has gone', () => {
  const p = page();
  p.begin();
  p.notice('error');
  p.status('working'); // the guide replans after the fault
  assert.equal(p.hud.waitPill(p.now()), null, 'the error notice is in view: no Thinking beside it');
  assert.equal(shownStatus(p.hud, p.now()), 'idle', 'and the page shows no status pill for it');
  p.wait(NOTICE_MS.error + NOTICE_FADE_MS + 100);
  assert.equal(p.hud.waitPill(p.now()), 'thinking', 'the work goes on, so Thinking returns once the notice has gone');
  assert.equal(shownStatus(p.hud, p.now()), 'working');
});
