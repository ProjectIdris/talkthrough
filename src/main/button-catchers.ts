// A click on one of the overlay's buttons (the escalation offer, Explode, Cut, More detail, the button on a notice, Copy, Pin and Close on a words-only answer) must reach the button whether or
// not the pointer moved first. The overlay window is click-through and only learns the pointer is over a button from a mouse
// move, so a tap, or a click that arrives with no move before it, went to the application underneath. The page now reports where
// its buttons are; over each one main lays a tiny window that is never click-through and says nothing but "pressed". The overlay
// stays click-through everywhere else (the page, the model, the screen), and the catchers are put away while the pen is on.
// This file is the part that needs no Electron; button-window.ts is the window.

import type { Rect } from './consent-card.ts';

/** The buttons the page may report. */
export const BUTTON_IDS = ['offer', 'explode', 'cut', 'detail', 'fix', 'copy', 'pin', 'close'] as const;
export type ButtonId = (typeof BUTTON_IDS)[number];

/** Where a button is on the overlay page (CSS pixels from the page's top left, which is the display's top left). */
export type ButtonRect = { id: ButtonId; x: number; y: number; w: number; h: number };

/** What the page sent, read strictly: only the known ids, each once, with sane numbers. Anything else is dropped. */
export function validRects(input: unknown): ButtonRect[] {
  if (!Array.isArray(input)) return [];
  const out: ButtonRect[] = [];
  for (const item of input.slice(0, 16)) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, x, y, w, h } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !(BUTTON_IDS as readonly string[]).includes(id) || out.some((r) => r.id === id)) continue;
    if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const [px, py, pw, ph] = [x, y, w, h] as number[];
    if (pw! < 4 || ph! < 4 || pw! > 600 || ph! > 200 || px! < -50 || py! < -50 || px! > 30000 || py! > 30000) continue;
    out.push({ id: id as ButtonId, x: px!, y: py!, w: pw!, h: ph! });
  }
  return out;
}

export const PRESS_SCHEME = 'tt-press:';

/** The button an address stands for; null for any other address. */
export function pressOf(url: string): ButtonId | null {
  if (!url.startsWith(`${PRESS_SCHEME}//`)) return null;
  const id = url.slice(PRESS_SCHEME.length + 2).replace(/\/$/, '');
  return (BUTTON_IDS as readonly string[]).includes(id) ? (id as ButtonId) : null;
}

/** The page of a catcher: all of it is one link that main reads and stops. */
export function catcherHtml(id: ButtonId): string {
  return `<!doctype html><meta charset="utf-8"><title>Talkthrough</title><style>html,body{margin:0;height:100%;overflow:hidden;background:rgba(0,0,0,.01)}a{position:fixed;inset:0;display:block;cursor:pointer}</style><a href="${PRESS_SCHEME}//${id}"></a>`;
}

/** How a catcher window is made (given to BrowserWindow as it is): never click-through, never focused, nothing to see. */
export const CATCHER_WINDOW_OPTIONS = {
  frame: false,
  transparent: true,
  hasShadow: false,
  focusable: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  show: false,
  title: 'Talkthrough button',
} as const;

export type CatcherWindow = {
  /** Lays the window over this rectangle (screen DIPs), loading its page the first time, and shows it without taking focus. */
  show(html: string, bounds: Rect): void;
  hide(): void;
  destroy(): void;
  onPress(listener: () => void): void;
};

export type ButtonCatchers = {
  /**
   * The buttons the page has now, and where the page sits on the screen. `enabled` false (the pen is on, or the overlay is
   * hidden) puts every catcher away.
   */
  update(rects: readonly ButtonRect[], origin: { x: number; y: number }, enabled: boolean): void;
  dispose(): void;
};

export function createButtonCatchers(deps: { makeWindow(id: ButtonId): CatcherWindow; onPress(id: ButtonId): void }): ButtonCatchers {
  const windows = new Map<ButtonId, { win: CatcherWindow; at: string | null }>();
  return {
    update(rects, origin, enabled) {
      const want = new Map(rects.map((r) => [r.id, r]));
      for (const [id, entry] of windows) {
        if (!enabled || !want.has(id)) {
          if (entry.at !== null) entry.win.hide();
          entry.at = null;
        }
      }
      if (!enabled) return;
      for (const r of want.values()) {
        let entry = windows.get(r.id);
        if (!entry) {
          const win = deps.makeWindow(r.id);
          win.onPress(() => deps.onPress(r.id));
          entry = { win, at: null };
          windows.set(r.id, entry);
        }
        const bounds: Rect = { x: Math.round(origin.x + r.x), y: Math.round(origin.y + r.y), width: Math.max(1, Math.round(r.w)), height: Math.max(1, Math.round(r.h)) };
        const at = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
        if (entry.at === at) continue;
        entry.at = at;
        entry.win.show(catcherHtml(r.id), bounds);
      }
    },
    dispose() {
      for (const { win } of windows.values()) win.destroy();
      windows.clear();
    },
  };
}
