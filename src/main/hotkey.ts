import { uIOhook, UiohookKey } from 'uiohook-napi';
import { createChordTracker } from './chord.ts';
import type { ChordEvents, ChordKeys } from './chord.ts';

/**
 * Installs the global key hook for the push-to-talk chord only. Key events go straight into the
 * chord tracker, which looks at the scan code, keeps two booleans and drops the rest; nothing is
 * logged or buffered. Mouse events are not read here; guide mode reads them only while a step waits (watchGuideInput).
 */
export function startHotkey(events: ChordEvents, keys?: ChordKeys) {
  const tracker = createChordTracker(events, keys);
  uIOhook.on('keydown', (event) => tracker.keyDown(event.keycode));
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
export function watchGuideInput(handlers: { down(point: { x: number; y: number }): void; up(point: { x: number; y: number }): void; escape(): void; /** Any other key (only told that one was pressed, never which). */ key?(): void }): () => void {
  const down = (event: { x: number; y: number }): void => handlers.down({ x: event.x, y: event.y });
  const up = (event: { x: number; y: number }): void => handlers.up({ x: event.x, y: event.y });
  const key = (event: { keycode: number }): void => {
    if (event.keycode === UiohookKey.Escape) handlers.escape();
    else handlers.key?.();
  };
  uIOhook.on('mousedown', down);
  uIOhook.on('mouseup', up);
  uIOhook.on('keydown', key);
  return () => {
    uIOhook.off('mousedown', down);
    uIOhook.off('mouseup', up);
    uIOhook.off('keydown', key);
  };
}
