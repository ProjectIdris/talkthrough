import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrayStatus, trayDotPixels, trayIconPixels, TRAY_LINES } from '../src/main/tray-state.ts';
import type { TrayState } from '../src/main/tray-state.ts';
import { readAction, COPY_MAX_CHARS } from '../src/main/page-action.ts';

function rig(needsMs = 1000) {
  const seen: TrayState[] = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const status = createTrayStatus((s) => seen.push(s), {
    needsMs,
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => void ((h as { live: boolean }).live = false),
  });
  const fire = (): void => {
    for (const t of timers) if (t.live) {
      t.live = false;
      t.fn();
    }
  };
  return { status, seen, fire };
}

test('the tray follows the status: listening, thinking, and ready again when it ends', () => {
  const { status, seen } = rig();
  status.feed({ kind: 'status', status: 'hush' });
  status.feed({ kind: 'status', status: 'listening' });
  status.feed({ kind: 'status', status: 'working' });
  status.feed({ kind: 'step' });
  status.feed({ kind: 'status', status: 'idle' });
  assert.deepEqual(seen, ['listening', 'thinking', 'ready']);
  assert.equal(status.state(), 'ready');
});

test('a fault says "needs you" for a few seconds and then goes back; a new press ends it at once', () => {
  const a = rig();
  a.status.feed({ kind: 'notice', level: 'info' });
  assert.deepEqual(a.seen, [], 'an ordinary notice is not a fault');
  a.status.feed({ kind: 'notice', level: 'error' });
  assert.deepEqual(a.seen, ['needs']);
  a.fire();
  assert.deepEqual(a.seen, ['needs', 'ready']);
  const b = rig();
  b.status.feed({ kind: 'notice', level: 'warning' });
  b.status.feed({ kind: 'status', status: 'listening' });
  assert.deepEqual(b.seen, ['needs', 'listening']);
  b.fire();
  assert.deepEqual(b.seen, ['needs', 'listening'], 'the timer that was left does nothing');
});

test('each state has its own icon: a ring, a disc, a ring with a disc, a pink ring with a red centre; and a menu line', () => {
  const alphaAt = (state: TrayState, x: number, y: number): number => {
    const { width, data } = trayIconPixels(state);
    return data[(y * width + x) * 4 + 3] as number;
  };
  const colourAt = (state: TrayState, x: number, y: number): number[] => {
    const { width, data } = trayIconPixels(state);
    const o = (y * width + x) * 4;
    return [data[o + 2] as number, data[o + 1] as number, data[o] as number];
  };
  assert.equal(alphaAt('ready', 16, 16), 0, 'a ring is hollow');
  assert.ok(alphaAt('ready', 16, 3) > 200, 'and drawn at its rim');
  assert.ok(alphaAt('listening', 16, 16) > 250, 'a disc is filled');
  assert.deepEqual(colourAt('listening', 16, 16), [124, 196, 255]);
  assert.equal(alphaAt('thinking', 16, 8), 0, 'thinking: a gap between the ring and the disc');
  assert.ok(alphaAt('thinking', 16, 16) > 250 && alphaAt('thinking', 16, 3) > 200);
  assert.deepEqual(colourAt('needs', 16, 16), [226, 84, 90], 'needs you: a red centre');
  assert.deepEqual(colourAt('needs', 16, 3), [255, 138, 147], 'in a pink ring');
  assert.equal(trayIconPixels('ready', 16).data.length, 16 * 16 * 4);
  assert.ok(trayDotPixels('ready').data[(8 * 16 + 8) * 4 + 3]! > 250);
  assert.equal(TRAY_LINES.ready, 'Talkthrough is ready');
});

test('what a page button may ask is read strictly: three plain actions and a copy of a bounded text, nothing else', () => {
  for (const what of ['settings', 'hearing', 'pin'] as const) assert.deepEqual(readAction({ what }), { what });
  assert.deepEqual(readAction({ what: 'copy', text: 'words' }), { what: 'copy', text: 'words' });
  assert.equal((readAction({ what: 'copy', text: 'x'.repeat(COPY_MAX_CHARS + 50) }) as { text: string }).text.length, COPY_MAX_CHARS);
  for (const bad of [null, 'copy', 7, {}, { what: 'run' }, { what: 'copy' }, { what: 'copy', text: '  ' }, { what: 'copy', text: 5 }, { what: 'open-file', path: 'C:/x' }]) assert.equal(readAction(bad), null, JSON.stringify(bad));
});
