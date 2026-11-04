import { uIOhook } from 'uiohook-napi';
import { createChordTracker } from './chord.ts';
import type { ChordEvents } from './chord.ts';

/**
 * Installs the global key hook for the push-to-talk chord only. Key events go straight into the
 * chord tracker, which looks at the scan code, keeps two booleans and drops the rest; nothing is
 * logged or buffered. Mouse events are not requested at all.
 */
export function startHotkey(events: ChordEvents) {
  const tracker = createChordTracker(events);
  uIOhook.on('keydown', (event) => tracker.keyDown(event.keycode));
  uIOhook.on('keyup', (event) => tracker.keyUp(event.keycode));
  uIOhook.start();
  return {
    stop(): void {
      tracker.reset();
      uIOhook.removeAllListeners();
      uIOhook.stop();
    },
  };
}
