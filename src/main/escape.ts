// The Escape key stops an answer: the voice, the steps still to come, the drawing. Escape belongs to whatever the person is typing into, so it is
// taken from the system only while an answer is being asked for, written or shown, and handed back the moment there is none (the same lease and
// release as the E key, see interaction.ts): never in a check run, never longer than the page keeps saying a drawing is up.

import { createClickGuard, createKeyHold } from './interaction.ts';

/** How long the page's "a drawing is up" holds without being said again (the page repeats it while it is true): a page that dies gives Escape back. */
export const SHOWING_LEASE_MS = 3000;

/** One overlay window's part in the decision. */
export type EscapeWindow = { /** The page has said, lately, that a drawing is up. */ showing: boolean; alive: boolean };

/**
 * Whether Escape is ours: a question is being asked for, written or walked through (the session says), or a drawing is up. Both need a live overlay
 * window to be on: with none (they all closed, the program is going) it is never held.
 */
export function escapeWanted(input: { busy: boolean; windows: Iterable<EscapeWindow> }): boolean {
  let alive = false;
  for (const w of input.windows) {
    if (!w.alive) continue;
    if (w.showing) return true;
    alive = true;
  }
  return alive && input.busy;
}

export type EscapeOptions = {
  /** False in a check run: Escape is then never taken from anyone. */
  enabled?: boolean;
  accelerator?: string;
  register(accelerator: string, onKey: () => void): boolean;
  unregister(accelerator: string): void;
  /** Escape was pressed while it was ours. */
  onKey(): void;
  /** A question is being asked, written or walked through. */
  busy(): boolean;
  leaseMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * The Escape key's hold. Windows come and go (`open`, `close`); each page says a drawing is up (`showing`, a lease it must renew); `refresh` looks
 * again at everything and takes the key or gives it back. Every way out lands in `refresh`: a drawing gone, a lease run out, a window closed, the
 * session no longer busy, `dispose`.
 */
export function createEscape(options: EscapeOptions) {
  const hold = createKeyHold({
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    accelerator: options.accelerator ?? 'Escape',
    register: options.register,
    unregister: options.unregister,
    onKey: options.onKey,
  });
  const windows = new Map<number, ReturnType<typeof createClickGuard>>();
  let disposed = false;
  const refresh = (): void => {
    hold.want(!disposed && escapeWanted({ busy: options.busy(), windows: [...windows.values()].map((guard) => ({ showing: guard.held, alive: true })) }));
  };
  return {
    open(id: number): void {
      windows.get(id)?.release();
      windows.set(id, createClickGuard({
        onExpire: refresh,
        leaseMs: options.leaseMs ?? SHOWING_LEASE_MS,
        ...(options.setTimer ? { setTimer: options.setTimer } : {}),
        ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
      }));
      refresh();
    },
    close(id: number): void {
      windows.get(id)?.release();
      windows.delete(id);
      refresh();
    },
    /** The page on `id` says a drawing is up (it says so again while it is) or gone. */
    showing(id: number, on: boolean): void {
      const guard = windows.get(id);
      if (!guard) return;
      if (on) guard.grant();
      else guard.release();
      refresh();
    },
    refresh,
    /** Everything given back, for good. */
    dispose(): void {
      disposed = true;
      for (const guard of windows.values()) guard.release();
      windows.clear();
      refresh();
    },
    get held(): boolean {
      return hold.held;
    },
  };
}
