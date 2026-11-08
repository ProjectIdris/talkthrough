import type { Box } from './placement.ts';
import type { Frame } from './timeline.ts';

export function surfacesOverlap(a: Box, b: Box): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 1e-6
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 1e-6;
}

/** Last line of defence after placement: retain readable sizes and the existing paint order.
 * Rebuilt each frame so clear, replacement, resize and the end of an animation release room.
 * Keep the whole panel, or omit it; never paint one panel through another's writing.
 */
export class SurfaceAdmission {
  readonly shown = new Map<string, Box>();
  readonly omitted = new Map<string, Box>();
  private readonly keepOut: readonly Box[];
  constructor(keepOut: readonly Box[] = []) { this.keepOut = keepOut; }

  admit(id: string, box: Box): boolean {
    if ([...this.keepOut, ...this.shown.values()].some(other => surfacesOverlap(box, other))) {
      this.omitted.set(id, box);
      return false;
    }
    this.shown.set(id, box);
    return true;
  }
}

/** Omitted cards have no pointer footprint and their annotations must not float on other panels. */
export function admittedFrame(frame: Frame, admission: SurfaceAdmission, owners: ReadonlyMap<string, string>): Frame {
  if (!admission.omitted.size) return frame;
  return { ...frame,
    diagrams: frame.diagrams.filter(d => !admission.omitted.has(d.id)),
    marks: frame.marks.filter(m => !admission.omitted.has(m.id) && !admission.omitted.has(owners.get(m.id) ?? '')),
  };
}

/** If even the cue cannot fit beside the stage, release both the stage and its retained labels. */
export function omitStageForCue(frame: Frame, board: { keep(alive: ReadonlySet<number>): void }): Frame {
  board.keep(new Set());
  return { ...frame, panel: null, objects: [], marks: frame.marks.filter(m => m.mark.op !== 'pin') };
}
