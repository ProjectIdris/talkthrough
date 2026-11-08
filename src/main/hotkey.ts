import { uIOhook, UiohookKey } from 'uiohook-napi';
import { createChordTracker } from './chord.ts';
import type { ChordEvents, ChordKeys } from './chord.ts';

/**
 * Installs the global key hook for the push-to-talk chord only. Key events go straight into the
 * chord tracker, which looks at the scan code, keeps two booleans and drops the rest; nothing is
 * logged or buffered. The one other key it looks at is Escape, and only while the chord is held (a question being asked is cancelled; Windows makes Ctrl+Shift+Esc
 * of it, which no program can take, so it is watched, not taken). Mouse events are not read here; guide mode reads them only while a step waits (watchGuideInput).
 */
export function startHotkey(events: ChordEvents, keys?: ChordKeys, escapeWhileHeld?: () => void) {
  const tracker = createChordTracker(events, keys);
  uIOhook.on('keydown', (event) => {
    tracker.keyDown(event.keycode);
    if (event.keycode === UiohookKey.Escape && tracker.held) escapeWhileHeld?.();
  });
  uIOhook.on('keyup', (event) => tracker.keyUp(event.keycode));
  uIOhook.start();
  return {
    /** What the hook feeds with the person's keys; development checks feed it too (see pressChord), so they send nothing to the system. */
    tracker,
    stop(): void {
      tracker.reset();
      uIOhook.removeAllListeners();
      uIOhook.stop();
    },
  };
}

/**
 * While guide mode waits for the person's click: their mouse button going down and up, as screen points, and Escape.
 * Nothing is kept or logged; the listeners are taken off as soon as the returned function is called.
 */
export function watchGuideInput(handlers: { down(point: { x: number; y: number; button?: number }): void; up(point: { x: number; y: number; button?: number }): void; escape(): void; /** Any other key (only told that one was pressed, never which). */ key?(): void; /** The mouse wheel turned (only told that it did). */ wheel?(): void }): (() => void) & { clicks(on: boolean): void } {
  const down = (event: { x: number; y: number; button?: unknown }): void => handlers.down({ x: event.x, y: event.y, ...(typeof event.button === 'number' ? { button: event.button } : {}) });
  const up = (event: { x: number; y: number; button?: unknown }): void => handlers.up({ x: event.x, y: event.y, ...(typeof event.button === 'number' ? { button: event.button } : {}) });
  const key = (event: { keycode: number }): void => {
    if (event.keycode === UiohookKey.Escape) handlers.escape();
    else handlers.key?.();
  };
  const wheel = (): void => handlers.wheel?.();
  let observing = false;
  const clicks = (on: boolean): void => {
    if (observing === on) return;
    observing = on;
    if (on) { uIOhook.on('mousedown', down); uIOhook.on('mouseup', up); }
    else { uIOhook.off('mousedown', down); uIOhook.off('mouseup', up); }
  };
  clicks(true);
  uIOhook.on('keydown', key);
  uIOhook.on('wheel', wheel);
  return Object.assign(() => {
    clicks(false);
    uIOhook.off('keydown', key);
    uIOhook.off('wheel', wheel);
  }, { clicks });
}
