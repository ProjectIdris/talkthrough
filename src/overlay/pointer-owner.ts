/** The visible target that owns a press, in precedence order. */
export function routePointer(hit: { captureControl?: boolean; pen?: boolean; pill?: boolean; guideTarget?: boolean; content?: boolean }): 'control' | 'pen' | 'guide' | 'content' | 'dismiss' {
  if (hit.captureControl) return 'control';
  if (hit.pen) return 'pen';
  if (hit.pill) return 'control';
  if (hit.guideTarget) return 'guide';
  if (hit.content) return 'content';
  return 'dismiss';
}

/** Tracks the captured model drag independently of DOM event delivery. */
export function createPointerOwner(onDrag: (on: boolean) => void, options: { timeoutMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {}) {
  let id: number | undefined;
  let timer: unknown;
  let generation = 0;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const end = (): void => {
    if (id === undefined) return;
    id = undefined;
    generation++;
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    onDrag(false);
  };
  const renew = (): void => {
    if (timer !== undefined) clearTimer(timer);
    const current = ++generation;
    timer = setTimer(() => { if (generation === current) end(); }, options.timeoutMs ?? 8000);
  };
  return {
    begin(pointerId: number): void {
      if (id !== undefined) return;
      id = pointerId;
      onDrag(true);
      renew();
    },
    move(pointerId: number): boolean { if (id !== pointerId) return false; renew(); return true; },
    lost(pointerId: number): void { if (id === pointerId) end(); },
    cancel: end,
    blur: end,
    get dragging(): boolean { return id !== undefined; },
  };
}

/** How long a background press may be held with no release and no sign that the pointer was lost before it is given up (never a dismissal). */
export const DISMISS_STALL_MS = 10000;

/**
 * Holds a background dismissal through the release of the same pointer. A press whose release never comes (the button went up over another window)
 * would otherwise hold for ever and take the next button-up of the same pointer, the pen's, for its own release: it is given up after `stallMs`
 * without a dismissal, and `onStall` lets the page hand the pointer back.
 */
export function createDismissCapture(dismiss: () => void, options: { timeoutMs?: number; stallMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void; onTimeout?: () => void; onStall?: () => void } = {}) {
  let id: number | undefined;
  let suppressed = false;
  let timer: unknown;
  let generation = 0;
  let stall: unknown;
  let stallGeneration = 0;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const clear = (): void => { generation++; if (timer !== undefined) clearTimer(timer); timer = undefined; stallGeneration++; if (stall !== undefined) clearTimer(stall); stall = undefined; };
  const finish = (): void => { id = undefined; clear(); if (!suppressed) dismiss(); suppressed = false; };
  return {
    begin(pointerId: number): boolean {
      if (id !== undefined) return false;
      id = pointerId;
      suppressed = false;
      const current = ++stallGeneration;
      stall = setTimer(() => {
        if (current !== stallGeneration || id === undefined) return;
        id = undefined;
        suppressed = false;
        clear();
        options.onStall?.();
      }, options.stallMs ?? DISMISS_STALL_MS);
      return true;
    },
    release(pointerId: number): void {
      if (id !== pointerId) return;
      finish();
    },
    lost(pointerId: number): void {
      if (id !== pointerId || timer !== undefined) return;
      const current = ++generation;
      timer = setTimer(() => {
        if (current !== generation || id === undefined) return;
        finish();
        options.onTimeout?.();
      }, options.timeoutMs ?? 1500);
    },
    suppress(): void { if (id !== undefined) suppressed = true; },
    abort(): void { id = undefined; suppressed = false; clear(); },
    get held(): boolean { return id !== undefined; },
  };
}
