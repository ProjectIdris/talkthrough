// The push-to-talk chord: Right Ctrl + Right Shift held together.
// This keeps two booleans and nothing else: every other key is ignored on arrival, never stored
// or logged, and no key text is ever formed.

/** Scan codes as the global hook reports them (libuiohook). */
export const KEY_RIGHT_CTRL = 3613;
export const KEY_RIGHT_SHIFT = 54;

export type ChordEvents = {
  /** Both keys are down (called once per press of the chord). */
  start(): void;
  /** One of the two keys went up while the chord was held. */
  stop(): void;
};

export type ChordTracker = {
  keyDown(keycode: number): void;
  keyUp(keycode: number): void;
  /** True while the chord is held. */
  readonly held: boolean;
  /** Forget everything (e.g. after the hook restarts); fires stop if the chord was held. */
  reset(): void;
};

export function createChordTracker(events: ChordEvents): ChordTracker {
  let ctrl = false;
  let shift = false;
  let held = false;

  function update(): void {
    const both = ctrl && shift;
    if (both && !held) {
      held = true;
      events.start();
    } else if (!both && held) {
      held = false;
      events.stop();
    }
  }

  return {
    keyDown(keycode) {
      if (keycode === KEY_RIGHT_CTRL) ctrl = true;
      else if (keycode === KEY_RIGHT_SHIFT) shift = true;
      else return;
      update();
    },
    keyUp(keycode) {
      if (keycode === KEY_RIGHT_CTRL) ctrl = false;
      else if (keycode === KEY_RIGHT_SHIFT) shift = false;
      else return;
      update();
    },
    get held() {
      return held;
    },
    reset() {
      ctrl = false;
      shift = false;
      update();
    },
  };
}
