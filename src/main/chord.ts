// The push-to-talk chord: two modifier keys held together (Right Ctrl + Right Shift unless the settings name another pair).
// This keeps two booleans and nothing else: every other key is ignored on arrival, never stored
// or logged, and no key text is ever formed.

import { CHORD_KEYS, DEFAULT_HOTKEY, splitHotkey } from '../shared/chord-keys.ts';
export { CHORD_KEYS, DEFAULT_HOTKEY };

/** Scan codes as the global hook reports them (libuiohook). */
export const KEY_RIGHT_CTRL = 3613;
export const KEY_RIGHT_SHIFT = 54;

export type ChordKeys = {
  /** Every key of the hotkey: one, two or more, as the hook reports them. The hotkey is held while all of them are down. */
  keys: readonly number[];
  label: string;
  /** The first key, held alone, may open the microphone and the screen grab early. Only for a chord (two or more keys) whose first key is Ctrl, Shift or Alt: a key that types would open the microphone with every letter. */
  early: boolean;
};

/** "right-ctrl+right-shift" (or one key, or up to four) -> the scan codes and the words for them; null for anything else (an unknown key, the same key twice). */
export function parseHotkey(text: unknown): ChordKeys | null {
  const parts = splitHotkey(text);
  if (!parts) return null;
  const defs = parts.names.map((n) => CHORD_KEYS[n]!);
  return { keys: defs.map((d) => d.code), label: parts.label, early: defs.length > 1 && defs[0]!.modifier };
}

export type ChordEvents = {
  /**
   * Right Ctrl went down while Right Shift was not: the chord may be about to be made. Lets the
   * microphone and the screen grab start early. Followed by either start() or cancel().
   */
  arm?(): void;
  /** The first key came up before the chord was made. */
  cancel?(): void;
  /** Every key is down (called once per press). */
  start(): void;
  /** One of the keys went up while the hotkey was held. */
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


/**
 * Development checks: makes the chord (every key down, held, all up) by feeding the tracker itself, the way the key hook does, so nothing is
 * sent to the system (a press made through the operating system reaches whatever window the person is using, and a run that ends mid-hold
 * leaves the keys down). Gives the release back, so a run that ends can call it at once.
 */
export function pressChord(tracker: Pick<ChordTracker, 'keyDown' | 'keyUp'>, keys: ChordKeys, holdMs: number, later: (fn: () => void, ms: number) => unknown = setTimeout): () => void {
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    for (const code of [...keys.keys].reverse()) tracker.keyUp(code);
  };
  for (const code of keys.keys) tracker.keyDown(code);
  later(release, holdMs);
  return release;
}

export function createChordTracker(events: ChordEvents, keys: ChordKeys = parseHotkey(DEFAULT_HOTKEY)!): ChordTracker {
  const down = new Set<number>();
  const lead = keys.keys[0]!;
  let held = false;
  let armed = false;

  function update(): void {
    const all = keys.keys.every((code) => down.has(code));
    if (all && !held) {
      held = true;
      armed = false;
      events.start();
    } else if (!all && held) {
      held = false;
      events.stop();
    } else if (armed && !down.has(lead)) {
      armed = false;
      events.cancel?.();
    }
  }

  return {
    keyDown(keycode) {
      if (!keys.keys.includes(keycode)) return;
      // The first key of the chord down while none of the others is: the chord may be about to be made.
      const first = keycode === lead && down.size === 0;
      down.add(keycode);
      if (first && keys.early) {
        armed = true;
        events.arm?.();
      }
      update();
    },
    keyUp(keycode) {
      if (!keys.keys.includes(keycode)) return;
      down.delete(keycode);
      update();
    },
    get held() {
      return held;
    },
    reset() {
      down.clear();
      update();
      if (armed) {
        armed = false;
        events.cancel?.();
      }
    },
  };
}
