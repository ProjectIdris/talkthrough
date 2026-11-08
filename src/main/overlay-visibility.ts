// When an overlay window is on the screen. The overlay is a full-screen, transparent, topmost window; left up all day it sits over everything the person
// watches, whether or not anything is drawn in it. So it is hidden while it has nothing to show and shown (without taking focus) only while an answer is
// asked for, written or shown. This holds the rule, with time injected; overlay-windows.ts feeds it what it knows and does the showing.

/** After the last thing that needed the window, how long it stays before it goes (so a pause between steps, or a fade, never makes it blink). */
export const HIDE_AFTER_MS = 800;
/** After a message that starts something (a question, a step, a notice), the window is kept this long even if the page has not yet said what it draws. */
export const WAKE_MS = 3000;

export type OverlayVisibilityDeps = {
  show(): void;
  hide(): void;
  now?: () => number;
  hideAfterMs?: number;
  wakeMs?: number;
};

export type OverlayVisibility = {
  /** Something is about to be drawn or said (a message for the page): the window is up before the page gets it. */
  wake(): void;
  /** What is known now: whether anything needs the window. Call it when that may have changed, and now and then. */
  update(occupied: boolean): void;
  readonly shown: boolean;
};

export function createOverlayVisibility(deps: OverlayVisibilityDeps): OverlayVisibility {
  const now = deps.now ?? Date.now;
  const hideAfter = deps.hideAfterMs ?? HIDE_AFTER_MS;
  const wakeFor = deps.wakeMs ?? WAKE_MS;
  let shown = false;
  /** The last moment the window was known to be needed. */
  let needed = -Infinity;
  const up = (): void => {
    if (shown) return;
    shown = true;
    deps.show();
  };
  return {
    wake(): void {
      needed = Math.max(needed, now() + wakeFor);
      up();
    },
    update(occupied: boolean): void {
      const t = now();
      if (occupied) {
        needed = Math.max(needed, t);
        up();
      } else if (shown && t - needed >= hideAfter) {
        shown = false;
        deps.hide();
      }
    },
    get shown(): boolean { return shown; },
  };
}

/** The messages to a page that begin something to see or hear. The rest (clear, dismiss, the end of a turn, an idle status, queries about the pointer) only matter when the window is already up. */
export function wakesOverlay(message: { kind: string; status?: string; on?: boolean }): boolean {
  switch (message.kind) {
    case 'play': case 'begin': case 'step': case 'step-open': case 'action': case 'step-close': case 'notice': return true;
    case 'status': return message.status !== 'idle';
    case 'pen': return message.on === true;
    default: return false;
  }
}

export type OccupancyState = {
  /** A development run that keeps the window up (a backdrop or a fixed size to look at). */
  alwaysUp: boolean;
  pen: boolean;
  /** The page says a drawing of an answer is up. */
  showing: boolean;
  /** The page holds a click lease, a press on the model, or the pointer button. */
  holding: boolean;
  /** An answer is being asked for, written or heard (the session says; it is not tied to one display). */
  busy: boolean;
  /** This window is already up, so the busy answer is plainly on this display. */
  shown: boolean;
  /** The alpha of every region the page last published (pills, captions, answer cards, marks, the model). */
  alphas: readonly number[];
};

/**
 * Whether anything needs the window. The page's own list of what it shows decides what is drawn; the rest keep a window that is up while the person is
 * in the middle of something. A busy answer never raises a window by itself (it would light every display): the message that started it does.
 */
export function overlayOccupied(s: OccupancyState): boolean {
  if (s.alwaysUp || s.pen || s.showing || s.holding) return true;
  if (s.busy && s.shown) return true;
  return s.alphas.some((a) => a > 0.02);
}
