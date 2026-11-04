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

/** What decides whether the E key is ours: one overlay window's state. */
export type KeyState = { engaged: boolean; held: boolean; penOn: boolean; alive: boolean };

/**
 * The E key (it opens and closes a model) is taken from the whole system only while the person has pressed on the
 * model, the pointer is still on it (the click lease is held), the pen is off and the window is alive: in every other
 * state it belongs to whatever they are typing into. The window itself never takes the keyboard.
 */
export function keyWanted(states: Iterable<KeyState>): boolean {
  for (const s of states) if (s.engaged && s.held && !s.penOn && s.alive) return true;
  return false;
}

export type KeyHoldOptions = {
  accelerator: string;
  /** Registers a system-wide key; false when another program already owns it. */
  register: (accelerator: string, onKey: () => void) => boolean;
  unregister: (accelerator: string) => void;
  onKey: () => void;
};

/** Holds the key while it is wanted and gives it back the moment it is not (call `want` whenever anything that decides it changes). */
export function createKeyHold(options: KeyHoldOptions) {
  let registered = false;
  return {
    want(on: boolean): void {
      if (on && !registered) registered = options.register(options.accelerator, options.onKey);
      else if (!on && registered) {
        registered = false; // whatever unregister does, it is not ours any more
        options.unregister(options.accelerator);
      }
    },
    get held(): boolean {
      return registered;
    },
  };
}
