// What the tray icon says: ready, listening, thinking, or needs you. The state follows what the session tells the page (its status and its notices), and the icon
// is drawn in code, so the app needs no icon files. This is the part that needs no Electron; tray.ts puts it on the tray.

export type TrayState = 'ready' | 'listening' | 'thinking' | 'needs';

/** The first line of the tray menu for each state. */
export const TRAY_LINES: Record<TrayState, string> = { ready: 'Talkthrough is ready', listening: 'Listening', thinking: 'Thinking', needs: 'Needs you' };

/** How long "needs you" shows after a fault, unless something new begins. */
export const NEEDS_MS = 6000;

/** The part of a scene message the tray cares about. */
export type TrayFeed = { kind: string; status?: string; level?: string };

export type TrayStatus = { feed(message: TrayFeed): void; state(): TrayState; dispose(): void };

export function createTrayStatus(onChange: (state: TrayState) => void, options: { needsMs?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (handle: unknown) => void } = {}): TrayStatus {
  const needsMs = options.needsMs ?? NEEDS_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  });
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  let base: Exclude<TrayState, 'needs'> = 'ready';
  let needs: unknown;
  let shown: TrayState = 'ready';
  const show = (): void => {
    const next: TrayState = needs !== undefined ? 'needs' : base;
    if (next === shown) return;
    shown = next;
    onChange(next);
  };
  const endNeeds = (): void => {
    if (needs !== undefined) clearTimer(needs);
    needs = undefined;
  };
  return {
    feed(m) {
      if (m.kind === 'status') {
        if (m.status === 'listening') {
          base = 'listening';
          endNeeds();
        } else if (m.status === 'working' || m.status === 'backend' || m.status === 'detail' || m.status === 'checking') {
          base = 'thinking';
          endNeeds();
        } else if (m.status === 'idle' || m.status === 'waiting') base = 'ready';
        // 'hush' (the keys went down) says nothing yet: listening follows when the microphone is open
      } else if (m.kind === 'notice' && (m.level === 'error' || m.level === 'warning')) {
        endNeeds();
        needs = setTimer(() => {
          needs = undefined;
          show();
        }, needsMs);
      }
      show();
    },
    state: () => shown,
    dispose: endNeeds,
  };
}

// ---- The icon, drawn in code -------------------------------------------------------------------------------------------------------------

type Rgb = [number, number, number];
const GREY: Rgb = [160, 174, 192];
const BLUE: Rgb = [124, 196, 255];
const PINK: Rgb = [255, 138, 147];
const RED: Rgb = [226, 84, 90];

/** How much of a pixel at distance `d` from the centre is inside a circle of radius `r` (0..1, soft at the edge). */
const inside = (d: number, r: number): number => Math.max(0, Math.min(1, r + 0.5 - d));

/**
 * The icon for a state as BGRA pixels (what Electron's createFromBitmap takes): ready is a grey ring, listening a filled blue disc, thinking a blue ring
 * with a disc inside it, needs you a pink ring with a red centre. The ring is as thick on a 16 pixel icon as the eye needs: widths are in 32nds of the size.
 */
export function trayIconPixels(state: TrayState, size = 32): { width: number; height: number; data: Buffer } {
  const data = Buffer.alloc(size * size * 4);
  const u = size / 32;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let rgb: Rgb = GREY;
      let alpha = 0;
      const ring = (outer: number, inner: number): number => Math.max(0, inside(d, outer * u) - inside(d, inner * u));
      const disc = (r: number): number => inside(d, r * u);
      if (state === 'ready') alpha = ring(14, 10);
      else if (state === 'listening') {
        rgb = BLUE;
        alpha = disc(13);
      } else if (state === 'thinking') {
        rgb = BLUE;
        alpha = Math.max(ring(14, 11), disc(7));
      } else {
        const rim = ring(14, 10), middle = disc(6);
        rgb = middle > 0 && middle >= rim ? RED : PINK;
        alpha = Math.max(rim, middle);
      }
      const o = (y * size + x) * 4;
      data[o] = rgb[2];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[0];
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data };
}

/** A small filled dot of the state's colour, for the first line of the menu. */
export function trayDotPixels(state: TrayState, size = 16): { width: number; height: number; data: Buffer } {
  const data = Buffer.alloc(size * size * 4);
  const rgb: Rgb = state === 'needs' ? RED : state === 'ready' ? [110, 231, 168] : BLUE;
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      data[o] = rgb[2];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[0];
      data[o + 3] = Math.round(inside(Math.hypot(x - c, y - c), size * 0.3) * 255);
    }
  }
  return { width: size, height: size, data };
}
