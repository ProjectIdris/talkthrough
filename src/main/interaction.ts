/**
 * Whether an overlay window lets mouse events pass through to whatever is beneath it. Normally it
 * does, except while the page says the pointer is over something the user can drag. While the pen is
 * on the window always takes the mouse, whatever the page says: a drag must reach the pen, never the
 * app beneath.
 */
export function ignoreMouse(pageWantsClicks: boolean, penOn: boolean): boolean {
  return !(penOn || pageWantsClicks);
}

/** How long the page's "the pointer is over the model" holds without being said again (the page repeats it while it is true). */
export const CLICK_LEASE_MS = 8000;

export type ClickGuardOptions = {
  /** Called when the lease runs out: the window must go back to click-through. */
  onExpire: () => void;
  leaseMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Keeps an overlay window from staying solid by accident. The page says it wants clicks while the pointer is
 * over the 3D model; if it then stops saying so (it crashed, hung, or lost the pointer without telling us), the
 * lease runs out and the window is made click-through again, so the screen beneath is never lost to a dead page.
 */
export function createClickGuard(options: ClickGuardOptions) {
  const leaseMs = options.leaseMs ?? CLICK_LEASE_MS;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  let held = false;
  const stop = (): void => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  return {
    /** The page wants clicks (again): the lease starts over. */
    grant(): void {
      held = true;
      stop();
      timer = setTimer(() => {
        timer = undefined;
        held = false;
        options.onExpire();
      }, leaseMs);
    },
    /** The page does not want clicks (or the window is going away). */
    release(): void {
      held = false;
      stop();
    },
    get held(): boolean {
      return held;
    },
  };
}
