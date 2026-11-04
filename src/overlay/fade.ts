// What the overlay does once an answer has finished: it stays up for a while, then fades away,
// unless the pointer is on it. Pure logic over a time given by the caller, so tests need no clock.

import type { Frame } from './timeline.ts';

/** How long a finished scene stays at full strength after the last thing happened to it, unless told otherwise. */
export const HOLD_MS = 4000;
/** How long it then takes to fade out. */
export const FADE_MS = 1200;

export class AutoFade {
  private since: number | undefined;
  private readonly hold: number;

  constructor(holdMs: number = HOLD_MS) {
    this.hold = holdMs;
  }

  /** True from the moment a scene finishes until new content arrives. */
  get armed(): boolean {
    return this.since !== undefined;
  }

  /** A scene has finished: start counting. */
  arm(now: number): void {
    this.since = now;
  }

  /** New content is coming or has arrived: it is shown in full and nothing is counting. */
  disarm(): void {
    this.since = undefined;
  }

  /** The pointer is on the scene, or the user just used it: the count starts again, and a scene already fading comes back. */
  touch(now: number): void {
    if (this.since !== undefined) this.since = now;
  }

  /** 1 while shown, falling to 0 over FADE_MS once HOLD_MS has passed. */
  alpha(now: number): number {
    if (this.since === undefined) return 1;
    const late = now - this.since - this.hold;
    if (late <= 0) return 1;
    return Math.max(0, 1 - late / FADE_MS);
  }

  /** Milliseconds until `alpha` next changes, 0 while it is changing, undefined when nothing is counting or it is all gone. */
  untilChange(now: number): number | undefined {
    if (this.since === undefined) return undefined;
    const late = now - this.since - this.hold;
    if (late < 0) return -late;
    return late >= FADE_MS ? undefined : 0;
  }
}

/** A frame with everything in it dimmed by `k` (1 leaves it alone). */
export function fadeFrame(frame: Frame, k: number): Frame {
  if (k >= 1) return frame;
  const f = Math.max(0, k);
  return {
    ...frame,
    panel: frame.panel ? { ...frame.panel, fade: frame.panel.fade * f } : null,
    marks: frame.marks.map((m) => ({ ...m, fade: m.fade * f })),
    diagrams: frame.diagrams.map((d) => ({ ...d, fade: d.fade * f })),
    objects: frame.objects.map((o) => ({ ...o, fade: o.fade * f })),
  };
}
