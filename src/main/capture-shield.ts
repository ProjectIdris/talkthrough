// Our windows are hidden from our own screenshot, and from nothing else. Windows can take a window out of every capture (setContentProtection), but
// left on it also takes the overlay out of a person's recordings and screen shares, and may blank a video playing behind it. So the windows are
// shown to capture as usual, and are put out of it only for the moment of a capture of ours: raised just before the frame is read, lowered right after.
//
// Captures are taken one at a time through `around`, so one can never lower the protection under another that is still reading; when another is
// already waiting the protection is simply kept up for it. Nothing here touches Electron: a window is anything with the three methods below.

export type ShieldWindow = {
  setContentProtection(on: boolean): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
};

export type CaptureShield = {
  /** A window that must be out of our own captures. Returns what takes it out of the shield again (when it closes). */
  add(window: ShieldWindow): () => void;
  /**
   * Runs one capture with every window out of it. `work` is handed a promise that resolves when the change has had time to reach the picture
   * (the capture waits for it just before it reads the frame, and does its other work meanwhile). Captures run one at a time, in order.
   */
  around<T>(work: (settled: Promise<void>) => Promise<T>): Promise<T>;
  /** Whether the windows are out of capture right now. */
  readonly raised: boolean;
};

/**
 * How long, in milliseconds, after setting the flag before a frame read is certain to be without the window. The flag is applied when the window
 * manager next composes the screen, and a capture reads what it composed; one refresh is 16.7 ms at 60 Hz and 33 ms at 30 Hz. `scripts/capture-check.cjs`
 * measures the real figure on a machine (the smallest wait after which not one of many captures showed the window) and prints it.
 */
export const SETTLE_MS = 50;

export function createCaptureShield(options: {
  /** False for a run that keeps the windows in captures (--visible-to-capture): the shield then does nothing at all. */
  enabled: boolean;
  settleMs?: number;
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): CaptureShield {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const windows = new Set<ShieldWindow>();
  let raised = false;
  let pending: Promise<void> = Promise.resolve(); // the change reaching the picture, for as long as the windows are up
  let waiting = 0; // captures asked for and not yet finished
  let tail: Promise<unknown> = Promise.resolve();

  const protect = (on: boolean): void => {
    for (const window of windows) {
      try {
        if (!window.isDestroyed()) window.setContentProtection(on);
      } catch (error) {
        options.log?.(`capture shield: could not ${on ? 'raise' : 'lower'} a window (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  };
  const anyVisible = (): boolean => [...windows].some((w) => {
    try { return !w.isDestroyed() && w.isVisible(); } catch { return false; }
  });

  return {
    get raised() { return raised; },
    add(window) {
      if (!options.enabled) return () => undefined;
      windows.add(window);
      if (raised) {
        try { window.setContentProtection(true); } catch { /* a window that is going away */ }
      }
      return () => { windows.delete(window); };
    },
    around(work) {
      if (!options.enabled) return work(Promise.resolve());
      waiting++;
      const run = async (): Promise<ReturnType<typeof work> extends Promise<infer T> ? T : never> => {
        if (!raised) {
          // Nothing on the screen to wait for when no window of ours is up: a window shown during the capture is shown already out of it.
          const needsWait = anyVisible();
          protect(true);
          raised = true;
          pending = needsWait ? wait(settleMs) : Promise.resolve();
        }
        try {
          // Every capture run while the windows are up gets the same wait, so one queued behind a capture that failed early never reads inside it.
          return await work(pending) as never;
        } finally {
          waiting--;
          if (waiting === 0) {
            raised = false;
            pending = Promise.resolve();
            protect(false);
          }
        }
      };
      const result = tail.then(run, run);
      tail = result.catch(() => undefined);
      return result as never;
    },
  };
}
