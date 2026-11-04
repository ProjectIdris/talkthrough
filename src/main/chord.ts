// The push-to-talk chord: two modifier keys held together (Right Ctrl + Right Shift unless the settings name another pair).
// This keeps two booleans and nothing else: every other key is ignored on arrival, never stored
// or logged, and no key text is ever formed.

/** Scan codes as the global hook reports them (libuiohook). */
export const KEY_RIGHT_CTRL = 3613;
export const KEY_RIGHT_SHIFT = 54;

/**
 * The keys a chord may be made of: modifiers only, so holding one types nothing. The first key of the pair is the one that, held
 * alone, opens the microphone and the screen grab early.
 */
export const CHORD_KEYS = {
  'right-ctrl': { code: 3613, label: 'Right Ctrl' },
  'right-shift': { code: 54, label: 'Right Shift' },
  'right-alt': { code: 3640, label: 'Right Alt' },
  'left-ctrl': { code: 29, label: 'Left Ctrl' },
  'left-shift': { code: 42, label: 'Left Shift' },
  'left-alt': { code: 56, label: 'Left Alt' },
} as const;
export type ChordKeyName = keyof typeof CHORD_KEYS;
export const DEFAULT_HOTKEY = 'right-ctrl+right-shift';

export type ChordKeys = { lead: number; second: number; label: string };

/** "right-ctrl+right-shift" -> the two scan codes and the words for it; null for anything else (an unknown key, the same key twice). */
export function parseHotkey(text: unknown): ChordKeys | null {
  if (typeof text !== 'string') return null;
  const parts = text.split('+').map((p) => p.trim().toLowerCase());
  if (parts.length !== 2) return null;
  const [a, b] = parts as [string, string];
  if (a === b || !(a in CHORD_KEYS) || !(b in CHORD_KEYS)) return null;
  const first = CHORD_KEYS[a as ChordKeyName], second = CHORD_KEYS[b as ChordKeyName];
  return { lead: first.code, second: second.code, label: `${first.label} + ${second.label}` };
}

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

export function createChordTracker(events: ChordEvents, keys: ChordKeys = parseHotkey(DEFAULT_HOTKEY)!): ChordTracker {
  let leadDown = false;
  let secondDown = false;
  let held = false;
  let armed = false;

  function update(): void {
    const both = leadDown && secondDown;
    if (both && !held) {
      held = true;
      armed = false;
      events.start();
    } else if (!both && held) {
      held = false;
      events.stop();
    } else if (armed && !leadDown) {
      armed = false;
      events.cancel?.();
    }
  }

  return {
    keyDown(keycode) {
      if (keycode === keys.lead) {
        const first = !leadDown && !secondDown;
        leadDown = true;
        if (first) {
          armed = true;
          events.arm?.();
        }
      } else if (keycode === keys.second) secondDown = true;
      else return;
      update();
    },
    keyUp(keycode) {
      if (keycode === keys.lead) leadDown = false;
      else if (keycode === keys.second) secondDown = false;
      else return;
      update();
    },
    get held() {
      return held;
    },
    reset() {
      leadDown = false;
      secondDown = false;
      update();
      if (armed) {
        armed = false;
        events.cancel?.();
      }
    },
  };
}
