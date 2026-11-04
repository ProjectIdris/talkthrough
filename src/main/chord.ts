// The push-to-talk chord: Right Ctrl + Right Shift held together.
// This keeps two booleans and nothing else: every other key is ignored on arrival, never stored
// or logged, and no key text is ever formed.

/** Scan codes as the global hook reports them (libuiohook). */
export const KEY_RIGHT_CTRL = 3613;
export const KEY_RIGHT_SHIFT = 54;

export type ChordEvents = {
  /**
   * Right Ctrl went down while Right Shift was not: the chord may be about to be made. Lets the
   * microphone and the screen grab start early. Followed by either start() or cancel().
   */
  arm?(): void;
  /** Right Ctrl came up before the chord was made. */
  cancel?(): void;
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
  let armed = false;

  function update(): void {
    const both = ctrl && shift;
    if (both && !held) {
      held = true;
      armed = false;
      events.start();
    } else if (!both && held) {
      held = false;
      events.stop();
    } else if (armed && !ctrl) {
      armed = false;
      events.cancel?.();
    }
  }

  return {
    keyDown(keycode) {
      if (keycode === KEY_RIGHT_CTRL) {
        const first = !ctrl && !shift;
        ctrl = true;
        if (first) {
          armed = true;
          events.arm?.();
        }
      } else if (keycode === KEY_RIGHT_SHIFT) shift = true;
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
      if (armed) {
        armed = false;
        events.cancel?.();
      }
    },
  };
}
