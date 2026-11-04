// Reads where the real controls of the window in front are (a button, a tab, a menu item, a field), so a mark the
// model drew at one can be put exactly on it (shared/controls.ts). Windows only, through the .NET UI Automation that
// ships with Windows PowerShell: nothing to install. It is READ-ONLY by construction (uia-script.ts): it asks the
// accessibility tree for each control's rectangle, kind and whether it is off screen, and nothing else. It never invokes,
// selects, expands, toggles, focuses or types into anything, and never reads a control's name or value.
//
// It asks the long-lived helper (ps-helper.ts) once per question, when the chord is complete and never waited for: the
// answer's first mark does not depend on it (the model takes seconds), and a read that is late, fails or finds nothing
// leaves the page snapping marks to the picture alone.
//
// A browser window (Chromium, Electron, Firefox, Qt) is never read: asking a browser for its accessibility tree turns
// accessibility on for the whole browser until it is restarted, which costs it real CPU. The helper checks the window
// class before it calls the accessibility API, and answers 'browser'. The picture snapping carries on there.

import { createHelper } from './ps-helper.ts';
import type { Helper } from './ps-helper.ts';

export { UIA_SCRIPT } from './uia-script.ts';

/** A control as the system reports it: a rectangle in physical screen pixels, and the control type (button, tabitem, ...). */
export type ScreenControl = { x: number; y: number; w: number; h: number; kind: string };

/** Reads the controls text the script prints: x,y,w,h,kind separated by semicolons. Anything that is not that is dropped. */
export function parseControls(text: string): ScreenControl[] {
  const out: ScreenControl[] = [];
  for (const part of text.split(';')) {
    const m = /^(-?\d{1,6}),(-?\d{1,6}),(\d{1,6}),(\d{1,6}),([a-z]{1,20})$/.exec(part.trim());
    if (!m) continue;
    out.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]), kind: m[5] as string });
    if (out.length >= 800) break;
  }
  return out;
}

/**
 * Controls in physical screen pixels become boxes on the 0..1000 scale of one display: `toDip` is the system's
 * conversion of a screen point, `bounds` the display's rectangle in the same units it gives. What lies outside the
 * display is dropped, what is partly off it is cut to it, and nothing too small to aim at is kept.
 */
export function toDisplayBoxes(
  controls: readonly ScreenControl[],
  toDip: (p: { x: number; y: number }) => { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; w: number; h: number; kind: string }[] {
  const out: { x: number; y: number; w: number; h: number; kind: string }[] = [];
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  for (const c of controls) {
    const a = toDip({ x: c.x, y: c.y }), b = toDip({ x: c.x + c.w, y: c.y + c.h });
    const x0 = Math.max(0, ((a.x - bounds.x) / bounds.width) * 1000), y0 = Math.max(0, ((a.y - bounds.y) / bounds.height) * 1000);
    const x1 = Math.min(1000, ((b.x - bounds.x) / bounds.width) * 1000), y1 = Math.min(1000, ((b.y - bounds.y) / bounds.height) * 1000);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    out.push({ x: round1(x0), y: round1(y0), w: round1(x1 - x0), h: round1(y1 - y0), kind: c.kind });
  }
  return out;
}

export type UiaRead = { controls: ScreenControl[]; ms: number; why?: string };

export type UiaReaderOptions = {
  /** Gives up after this long. */
  timeoutMs?: number;
  /** Read this window and not the one in front: for checks on a window of its own. */
  hwnd?: number;
  /** The helper to ask (shared with the navigator); by default the reader starts its own. */
  helper?: Helper;
};

export type UiaReader = { read(signal?: AbortSignal): Promise<UiaRead> };

/** The reader for this system: only Windows has one (elsewhere the page keeps snapping to the picture). */
export function createUiaReader(options: UiaReaderOptions = {}): UiaReader | undefined {
  const helper = options.helper ?? createHelper();
  if (!helper) return undefined;
  const timeoutMs = options.timeoutMs ?? 2500;
  return {
    async read(signal) {
      const hwnd = options.hwnd !== undefined && Number.isSafeInteger(options.hwnd) && options.hwnd > 0 ? options.hwnd : 0;
      const r = await helper.request({ op: 'read', hwnd }, { timeoutMs, ...(signal ? { signal } : {}) });
      if (r.why || !r.body) return { controls: [], ms: r.ms, why: r.why ?? 'failed' };
      if (typeof r.body.skip === 'string') return { controls: [], ms: r.ms, why: r.body.skip };
      return { controls: typeof r.body.out === 'string' ? parseControls(r.body.out) : [], ms: r.ms };
    },
  };
}
