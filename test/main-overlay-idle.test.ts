import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { HIDE_AFTER_MS, WAKE_MS, createOverlayVisibility, overlayOccupied, wakesOverlay } from '../src/main/overlay-visibility.ts';

// The overlay windows cover the whole screen, topmost, over whatever the person watches. They are up only while an answer is asked for, written or shown.

type Call = [string, ...unknown[]];

/** The real overlay manager over a stand-in for Electron (test/support/overlay-idle-child.ts), run in a process of its own so the module can be replaced. */
function run(mode: string): Call[] {
  const child = fileURLToPath(new URL('./support/overlay-idle-child.ts', import.meta.url));
  const r = spawnSync(process.execPath, ['--no-warnings', '--experimental-test-module-mocks', child, mode], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as Call[];
}

/** Whether a window was up at each mark of the log (the marks are named in the child; each is set after what it names). */
function stateAt(log: Call[], window: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  let up = false;
  for (const [what, ...rest] of log) {
    if (what === `${window}.show`) up = true;
    else if (what === `${window}.hide`) up = false;
    else if (what === '--') out[rest[0] as string] = up;
  }
  return out;
}

test('the overlay window is up for a question and its answer, and down between them', () => {
  const log = run('normal');
  const up = stateAt(log, 'window100');
  assert.equal(up['idle at start'], false, 'nothing is up before anyone asks');
  assert.equal(up['a question starts'], false, 'the mark precedes the question');
  assert.equal(up['the answer draws'], true, 'the question raised it and the cue keeps it');
  assert.equal(up['the answer is over, the drawing still up'], true, 'a drawing and a busy answer hold it');
  assert.equal(up['the drawing is gone'], true, 'still the grace');
  assert.equal(up['a pause shorter than the grace'], true, 'a short pause between steps never makes it blink');
  assert.equal(up['past the grace'], false, 'and then it goes');
  assert.equal(up['a clear or dismiss never raises it'], false);
  assert.equal(up['busy alone never raises it'], false, 'an answer in hand does not light a window nothing asked for');
  assert.equal(up['a step raises it again'], true);
  assert.equal(up['a step that drew nothing lets it go'], false);
  assert.equal(up['the pen is on'], true);
  assert.equal(up['the pen is off, its stroke fading'], true);
  assert.equal(up['the stroke is gone'], false);
  assert.equal(up['a guide step waits for the click'], true, 'a guide target keeps the window for as long as it waits');
  assert.equal(up['the guide step is over'], false);
  assert.equal(up['a fresh play on display 1 clears display 2 and leaves it down'], true);
  assert.equal(stateAt(log, 'window101')['a fresh play on display 1 clears display 2 and leaves it down'], false, 'the other display stays down');
  assert.equal(log.filter(([w]) => w === 'window101.show').length, 0);
});

test('the window is up before the page is told, so the first frame is not waiting for it', () => {
  const log = run('normal');
  const names = log.map(([w, ...rest]) => (w === 'page100.send' ? `send:${rest[1]}` : w));
  const shown = names.indexOf('window100.show');
  const first = names.indexOf('send:status:hush');
  assert.ok(shown >= 0 && first > shown, 'shown, then bounds set, then the message');
  assert.equal(names[shown + 1], 'window100.bounds', 'the bounds are set once it is up (the display it started on may differ)');
  // every show in the run is followed, before the next message to that page, by its bounds
  names.forEach((n, i) => { if (n === 'window100.show') assert.equal(names[i + 1], 'window100.bounds'); });
});

test('a window kept hidden for a development run is never shown, and one with a backdrop to look at stays up', () => {
  assert.equal(run('hidden').filter(([w]) => w.endsWith('.show')).length, 0);
  const log = run('backdrop');
  assert.equal(log.filter(([w]) => w === 'window100.show').length, 1);
  assert.equal(log.filter(([w]) => w === 'window100.hide').length, 0, 'it is not taken down while the backdrop is the point');
});

// ---- the rule itself, with the clock in hand -------------------------------------------------------------------

function clock() {
  let t = 1000;
  const events: string[] = [];
  const vis = createOverlayVisibility({ now: () => t, show: () => events.push('show'), hide: () => events.push('hide') });
  return { vis, events, advance: (ms: number) => { t += ms; } };
}

test('a wake shows the window once and holds it, even if the page says nothing is drawn yet', () => {
  const c = clock();
  assert.equal(c.vis.shown, false);
  c.vis.wake();
  c.vis.wake();
  assert.deepEqual(c.events, ['show']);
  c.advance(WAKE_MS - 1);
  c.vis.update(false);
  assert.equal(c.vis.shown, true, 'the page has had its time to say what it draws');
  c.advance(HIDE_AFTER_MS + 1);
  c.vis.update(false);
  assert.deepEqual(c.events, ['show', 'hide']);
});

test('occupied keeps it up, and it goes only after the grace once nothing needs it', () => {
  const c = clock();
  c.vis.update(true);
  assert.deepEqual(c.events, ['show']);
  for (let i = 0; i < 20; i++) { c.advance(1000); c.vis.update(true); }
  assert.deepEqual(c.events, ['show']);
  c.advance(HIDE_AFTER_MS - 1);
  c.vis.update(false);
  assert.equal(c.vis.shown, true);
  c.advance(1);
  c.vis.update(false);
  assert.equal(c.vis.shown, false);
  c.vis.update(false);
  assert.deepEqual(c.events, ['show', 'hide'], 'hidden once, not on every look');
});

test('a message that starts something wakes the window; the ones that end or ask about the pointer do not', () => {
  for (const kind of ['play', 'begin', 'step', 'step-open', 'action', 'step-close', 'notice']) assert.equal(wakesOverlay({ kind }), true, kind);
  for (const status of ['hush', 'listening', 'working', 'backend', 'detail', 'waiting', 'checking']) assert.equal(wakesOverlay({ kind: 'status', status }), true, status);
  assert.equal(wakesOverlay({ kind: 'status', status: 'idle' }), false);
  assert.equal(wakesOverlay({ kind: 'pen', on: true }), true);
  assert.equal(wakesOverlay({ kind: 'pen', on: false }), false);
  for (const kind of ['clear', 'dismiss', 'end', 'press', 'toggle-explode', 'model-hit-query', 'guide-arm', 'screenshot', 'controls', 'seek']) assert.equal(wakesOverlay({ kind }), false, kind);
});

test('what the page shows, the pen, a click lease and a busy answer in a window already up keep it; a busy answer alone does not raise one', () => {
  const none = { alwaysUp: false, pen: false, showing: false, holding: false, busy: false, shown: false, alphas: [] as number[] };
  assert.equal(overlayOccupied(none), false);
  assert.equal(overlayOccupied({ ...none, alphas: [0, 0.01] }), false, 'a faded-out region is not a drawing');
  assert.equal(overlayOccupied({ ...none, alphas: [0.4] }), true);
  assert.equal(overlayOccupied({ ...none, pen: true }), true);
  assert.equal(overlayOccupied({ ...none, showing: true }), true);
  assert.equal(overlayOccupied({ ...none, holding: true }), true);
  assert.equal(overlayOccupied({ ...none, busy: true }), false);
  assert.equal(overlayOccupied({ ...none, busy: true, shown: true }), true);
  assert.equal(overlayOccupied({ ...none, alwaysUp: true }), true);
});

test('nothing but the visibility rule shows or hides an overlay window', () => {
  const source = readFileSync(new URL('../src/main/overlay-windows.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/\.showInactive\(\)/g) ?? []).length, 1, 'one place shows it');
  assert.equal((source.match(/window\.hide\(\)/g) ?? []).length, 1, 'one place hides it');
  assert.ok(/if \(wakesOverlay\(m\)\) overlay\.vis\.wake\(\);\s+if \(m\.kind === 'clear'/.test(source), 'the window is raised before the page is sent the message');
});

test('the overlay windows are in every capture except our own: not protected when made or while up, protected for the read of a capture of ours, and not after', () => {
  const normal = run('normal');
  assert.equal(normal.filter(([w]) => String(w).endsWith('.protect')).length, 0, 'content protection is never set on a window as it is made or shown');
  const log = run('shield');
  const order = log.map(([w, ...rest]) => (String(w).endsWith('.protect') ? `${w}:${rest[0]}` : w === '--' ? `mark:${rest[0]}` : w));
  const at = (name: string): number => order.indexOf(name);
  assert.ok(at('window100.protect:true') !== -1 && at('window101.protect:true') !== -1, 'every overlay window, up or down');
  assert.ok(at('window100.protect:true') < at('settle') && at('window101.protect:true') < at('settle'), 'the wait follows the change, as the window is up');
  assert.ok(at('settle') < at('read'), 'the frame is read after the wait');
  assert.ok(at('read') < at('window100.protect:false') && at('read') < at('window101.protect:false'), 'and the windows come back after the read');
  assert.ok(order.indexOf('window100.protect:false') < at('mark:after the capture'));
  assert.equal(order.slice(0, at('mark:before the capture')).filter((x) => x.includes('.protect')).length, 0, 'nothing protected before the capture');
});
