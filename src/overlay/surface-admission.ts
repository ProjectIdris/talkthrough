import type { Box } from './placement.ts';
import type { Frame } from './timeline.ts';

export function surfacesOverlap(a: Box, b: Box): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 1e-6
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 1e-6;
}

// Timeline departure is distinct from the scene-wide idle/Escape fade.
const isLeaving = (s: { leaving?: boolean; fade: number }) => s.leaving ?? s.fade < 1;

/** Last line of defence after placement: retain readable sizes and give the current explanation priority.
 * Rebuilt each frame so clear, replacement, resize and the end of an animation release room.
 * Keep the whole panel, or omit it; never paint one panel through another's writing.
 */
export class SurfaceAdmission {
  readonly shown = new Map<string, Box>();
  readonly omitted = new Map<string, Box>();
  readonly hidden = new Set<string>();
  private readonly candidates = new Map<string, Box>();
  private readonly keepOut: readonly Box[];
  constructor(keepOut: readonly Box[] = []) { this.keepOut = keepOut; }

  admit(id: string, box: Box): boolean {
    this.candidates.set(id, box);
    if ([...this.keepOut, ...this.shown.values()].some(other => surfacesOverlap(box, other))) {
      this.omitted.set(id, box);
      this.hidden.add(id);
      return false;
    }
    this.shown.set(id, box);
    return true;
  }
  /** Resolve actual painted bounds independently of paint order. Stage/cue reservations stay first.
   * A leaving surface may finish fading in free space, but yields to every live surface silently.
   */
  prioritize(frame: Frame, keepOut: readonly Box[] = this.keepOut): SurfaceAdmission {
    const surfaces = new Map([...frame.marks, ...frame.diagrams].map(s => [s.id, s]));
    const rank = (id: string) => {
      const s = surfaces.get(id);
      return { leaving: s ? isLeaving(s) : false, current: !!s?.currentStep, key: s?.key ?? 0 };
    };
    const ordered = [...this.candidates].sort(([a], [b]) => {
      const x = rank(a), y = rank(b);
      return Number(x.leaving) - Number(y.leaving) || Number(y.current) - Number(x.current) || y.key - x.key;
    });
    const result = new SurfaceAdmission(keepOut);
    for (const [id, box] of ordered) {
      if (!result.admit(id, box) && rank(id).leaving) result.omitted.delete(id);
    }
    return result;
  }
}

/** A clear followed by reuse of an id replaces the fading instance, even across surface kinds. */
export function withoutReplacedSurfaces(frame: Frame, owners: ReadonlyMap<string, string> = new Map()): Frame {
  const surfaces = [...frame.marks.filter(m => m.mark.op === 'card' || m.mark.op === 'image'), ...frame.diagrams];
  const active = new Map(surfaces.filter(s => !isLeaving(s)).map(s => [s.id, s.key]));
  const keep = (s: { id: string; key: number }) => !active.has(s.id) || active.get(s.id) === s.key;
  const replaced = new Set(surfaces.filter(s => !keep(s)).map(s => s.id));
  return { ...frame,
    marks: frame.marks.filter(m => keep(m) && !(isLeaving(m) && replaced.has(owners.get(m.id) ?? ''))),
    diagrams: frame.diagrams.filter(keep),
  };
}

/** Omitted cards have no pointer footprint and their annotations must not float on other panels. */
export function admittedFrame(frame: Frame, admission: SurfaceAdmission, owners: ReadonlyMap<string, string>): Frame {
  if (!admission.hidden.size) return frame;
  return { ...frame,
    diagrams: frame.diagrams.filter(d => !admission.hidden.has(d.id)),
    marks: frame.marks.filter(m => !admission.hidden.has(m.id) && !admission.hidden.has(owners.get(m.id) ?? '')),
  };
}

/** If even the cue cannot fit beside the stage, release both the stage and its retained labels. */
export function omitStageForCue(frame: Frame, board: { keep(alive: ReadonlySet<number>): void }): Frame {
  board.keep(new Set());
  return { ...frame, panel: null, objects: [], marks: frame.marks.filter(m => m.mark.op !== 'pin') };
}

const omissionText = (count: number) => `${count} ${count === 1 ? 'panel' : 'panels'} hidden to prevent overlap`;

/** Measure outside the live region, once per count bound and viewport width. */
export class OmissionCue {
  private measured: { key: string; w: number; h: number } | undefined;
  private readonly live: { textContent: string | null };
  private readonly measure: { textContent: string | null; getBoundingClientRect(): { width: number; height: number } };
  constructor(
    live: { textContent: string | null },
    measure: { textContent: string | null; getBoundingClientRect(): { width: number; height: number } },
  ) { this.live = live; this.measure = measure; }

  size(maxCount: number, viewportWidth: number): { w: number; h: number } {
    const key = `${maxCount}:${viewportWidth}`;
    if (this.measured?.key !== key) {
      this.measure.textContent = omissionText(maxCount);
      const { width: w, height: h } = this.measure.getBoundingClientRect();
      this.measured = { key, w, h };
    }
    return { w: this.measured.w, h: this.measured.h };
  }

  show(count: number): void {
    const text = omissionText(count);
    if (this.live.textContent !== text) this.live.textContent = text;
  }
}
