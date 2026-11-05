import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import type { Display, IpcMainEvent } from 'electron';
import { CHANNEL } from '../shared/ipc.ts';
import type { DisplayInfo, Milestone, SceneMessage, Stroke } from '../shared/ipc.ts';
import { createButtonCatchers, validRects } from './button-catchers.ts';
import type { ButtonCatchers, ButtonRect } from './button-catchers.ts';
import { electronCatcherWindow } from './button-window.ts';
import { createClickGuard, createKeyGate, createKeyHold, ignoreMouse, keyWanted } from './interaction.ts';
import { createEscape } from './escape.ts';
import type { Region } from './interaction.ts';
import type { VoiceBridge } from './voice-bridge.ts';

/** A stroke piece sent just after the pen went off (the last points of a drag) still counts for this long. */
const PEN_GRACE_MS = 500;

export type OverlayOptions = {
  preload: string;
  /** Path of the overlay page (HTML file). */
  page: string;
  backdrop?: string;
  /** Hide the overlay from screen capture and recordings (on unless asked otherwise). */
  hideFromCapture: boolean;
  /** Development runs: never show the windows (they still render, and can be snapshotted). */
  hidden?: boolean;
  /** False in a check or development run: the E key is never taken from the system (default true). */
  globalKeys?: boolean;
  /** Development runs: tell the pages to speak nothing. */
  silent?: boolean;
  /** What an answer's words are given as (settings): told to each page, which shows captions for 'text' and 'both'. */
  captions?: 'voice' | 'text' | 'both';
  /** Development runs: make each window this size (at its display's top-left corner) instead of covering the display, so a recording has the shape asked for. */
  size?: { width: number; height: number };
  /** Development runs: the windows make no sound (a recording has the audio from the voice server's own stream). */
  muted?: boolean;
  /** Called when an overlay page reports ready, with a one-line description of its window. */
  onReady?: (description: string) => void;
  /** The person pressed Escape while it was ours (an answer is being asked for, written or shown). */
  onEscape?: () => void;
  /** A question is being asked, written or heard (the session says): Escape is ours for that, whether or not a drawing is up. */
  answerBusy?: () => boolean;
  /** Every line the page says about itself (the voice's choices, its warnings and errors), told to whoever keeps the record of questions. */
  onPageLine?: (line: string, level: 'info' | 'warning' | 'error') => void;
  /** Called when the renderer reports the end of a played scene. */
  onDone?: (displayId: number) => void;
  /** Called with each piece of a pen stroke the page reports. */
  onStroke?: (displayId: number, stroke: Stroke) => void;
  /** Called when the person right-clicks while the pen is on (`released` false), and again when the button comes up. */
  onCancel?: (displayId: number, released: boolean) => void;
  /** Called when the page reports the first mark or word of a live turn. */
  onMilestone?: (milestone: Milestone) => void;
  /** Called when the user clicks the escalation offer. */
  onOffer?: (displayId: number) => void;
  /** A voice server (the pages ask it for the audio of a step's words, and fall back to the system voice when it is down or slow). */
  voice?: { bridge: VoiceBridge; firstAudioMs: number; cooldownMs: number };
  /** A detail model is set up (the page then offers "More detail"), and what to do when the user asks for it. */
  onDetail?: (displayId: number) => void;
};

type Overlay = { catchers: ButtonCatchers; buttons: ButtonRect[]; window: BrowserWindow; display: Display; ready: boolean; queue: SceneMessage[]; pageWantsClicks: boolean; pen: boolean; penOffAt: number; /** The person pressed on the model (E is then ours until they leave it). */ engaged: boolean; /** The model's region on the screen (what the page last said the pointer is over) and the gate that checks the real cursor against it. */ region?: Region; gate: ReturnType<typeof createKeyGate>; guard: ReturnType<typeof createClickGuard> };

/**
 * One overlay window per display: transparent, frameless, always on top, off the taskbar, never
 * focused, and click-through (mouse events still reach the page, so it can see the pointer) except
 * while the page says the pointer is over something draggable.
 */
export function createOverlayManager(options: OverlayOptions) {
  const overlays = new Map<number, Overlay>();

  // The E key: taken from the system only while it is wanted (see keyWanted), never by focusing a window.
  const keys = createKeyHold({
    enabled: options.globalKeys !== false,
    accelerator: 'E',
    register: (accelerator, onKey) => {
      try {
        return globalShortcut.register(accelerator, onKey);
      } catch {
        return false;
      }
    },
    unregister: (accelerator) => {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // already gone
      }
    },
    onKey: () => {
      for (const overlay of overlays.values()) {
        if (keyWanted([stateOf(overlay)]) && overlay.ready && !overlay.window.isDestroyed()) overlay.window.webContents.send(CHANNEL.scene, { kind: 'toggle-explode' } satisfies SceneMessage);
      }
    },
  });
  // The Escape key: taken only while an answer is being asked for, written or shown, and given back at once after (see escape.ts); never in a check run.
  const escape = createEscape({
    enabled: options.globalKeys !== false,
    register: (accelerator, onKey) => {
      try {
        return globalShortcut.register(accelerator, onKey);
      } catch {
        return false;
      }
    },
    unregister: (accelerator) => {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
        // already gone
      }
    },
    onKey: () => options.onEscape?.(),
    busy: () => options.answerBusy?.() === true,
  });
  const refreshEscape = (): void => escape.refresh();
  const stateOf = (overlay: Overlay) => ({ engaged: overlay.engaged, held: overlay.guard.held, penOn: overlay.pen, alive: !overlay.window.isDestroyed() });
  /** Everything that decides whether E is ours goes through here after it changes. The real cursor is checked each time: a page that says the pointer is on the model while the cursor is elsewhere does not keep E. */
  const refreshKey = (): void => {
    for (const overlay of overlays.values()) if (overlay.engaged && !overlay.gate.check(overlay.region)) overlay.engaged = false;
    keys.want(keyWanted([...overlays.values()].map(stateOf)));
  };
  // Between the page's renewals: the cursor leaving the region, or ten seconds without it moving there, gives the key back.
  if (options.globalKeys !== false) {
    setInterval(() => {
      if (keys.held) refreshKey();
      refreshEscape();
    }, 500).unref();
  }

  function infoFor(display: Display): DisplayInfo {
    const info: DisplayInfo = { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor };
    if (options.backdrop) info.backdrop = options.backdrop;
    if (options.silent) info.silent = true;
    if (options.onDetail) info.detail = true;
    if (options.captions) info.captions = options.captions;
    if (options.voice) info.voice = { firstAudioMs: options.voice.firstAudioMs, cooldownMs: options.voice.cooldownMs };
    return info;
  }

  /** A display as the overlay covers it: the display itself, or (development recordings) a window of the size asked for at its corner. */
  const covered = (real: Display): Display => (options.size ? { ...real, bounds: { ...real.bounds, width: options.size.width, height: options.size.height } } : real);

  function create(realDisplay: Display): void {
    const display = covered(realDisplay);
    const window = new BrowserWindow({
      ...display.bounds,
      show: false,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      title: 'Talkthrough overlay',
      webPreferences: {
        preload: options.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        // The voice server's audio plays without anyone pressing anything on the page.
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    if (options.muted) window.webContents.setAudioMuted(true);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setIgnoreMouseEvents(true, { forward: true });
    if (options.hideFromCapture) window.setContentProtection(true);
    // Keep clicks and focus away from us, and never let the page open windows or navigate.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    // Surface the page's warnings and errors in the app log, and the few lines it says about itself (nothing else the page prints).
    window.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        console.error('[talkthrough] overlay page ' + event.level + ': ' + event.message);
        options.onPageLine?.(event.message, event.level);
      } else if (event.message.startsWith('talkthrough: ')) {
        console.error('[talkthrough] ' + event.message.slice('talkthrough: '.length));
        options.onPageLine?.(event.message.slice('talkthrough: '.length), 'info');
      }
    });
    window.on('page-title-updated', (event) => event.preventDefault()); // keep our own title
    window.once('ready-to-show', () => {
      if (options.hidden) return;
      window.showInactive();
      // Windows places a window by the DPI of the display it started on; set the bounds again once shown.
      window.setBounds(display.bounds);
    });
    void window.loadFile(options.page);
    const overlay: Overlay = {
      catchers: createButtonCatchers({
        makeWindow: () => electronCatcherWindow({ hideFromCapture: options.hideFromCapture }),
        onPress: (id) => {
          if (!window.isDestroyed()) window.webContents.send(CHANNEL.scene, { kind: 'press', id } satisfies SceneMessage);
        },
      }),
      buttons: [],
      window, display, ready: false, queue: [], pageWantsClicks: false, pen: false, penOffAt: 0, engaged: false,
      gate: createKeyGate({ cursor: () => screen.getCursorScreenPoint() }),
      // The page repeats "the pointer is over the model" while it is true; if it goes quiet, the window lets clicks through again.
      guard: createClickGuard({
        onExpire: () => {
          overlay.pageWantsClicks = false;
          overlay.engaged = false;
          refreshKey();
          applyMouse(overlay);
        },
      }),
    };
    overlays.set(display.id, overlay);
    escape.open(display.id);
    // Its requests to the voice server go with it, instead of being left to run out their time.
    const pageId = window.webContents.id;
    window.on('closed', () => {
      overlay.catchers.dispose();
      options.voice?.bridge.cancelGroup(String(pageId));
      overlay.guard.release();
      overlay.engaged = false;
      overlays.delete(display.id);
      refreshKey();
      escape.close(display.id);
    });
  }

  /** The region the page named (in its own pixels) as a rectangle on the screen, or undefined when it named none. */
  function screenRegion(overlay: Overlay, raw: unknown): Region | undefined {
    const r = raw as Partial<Region> | null | undefined;
    if (!r || ![r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n)) || (r.w as number) <= 0 || (r.h as number) <= 0) return undefined;
    const b = overlay.window.getBounds();
    return { x: b.x + (r.x as number), y: b.y + (r.y as number), w: r.w as number, h: r.h as number };
  }

  function find(event: IpcMainEvent): Overlay | undefined {
    for (const overlay of overlays.values()) {
      if (overlay.window.webContents === event.sender) return overlay;
    }
    return undefined;
  }

  ipcMain.on(CHANNEL.ready, (event) => {
    const overlay = find(event);
    if (!overlay) return;
    event.sender.send(CHANNEL.display, infoFor(overlay.display));
    overlay.ready = true;
    const w = overlay.window;
    const b = w.getBounds();
    options.onReady?.(`overlay for display ${overlay.display.id}: window ${b.width}x${b.height} at ${b.x},${b.y} (display ${overlay.display.bounds.width}x${overlay.display.bounds.height} at ${overlay.display.bounds.x},${overlay.display.bounds.y}, scale ${overlay.display.scaleFactor}), alwaysOnTop ${w.isAlwaysOnTop()}, focusable ${w.isFocusable()}, visible ${w.isVisible()}`);
    for (const message of overlay.queue.splice(0)) event.sender.send(CHANNEL.scene, message);
  });
  ipcMain.on(CHANNEL.interactive, (event, over: unknown, region: unknown) => {
    const overlay = find(event);
    if (!overlay || typeof over !== 'boolean') return;
    overlay.pageWantsClicks = over;
    overlay.region = over ? screenRegion(overlay, region) : undefined;
    if (over) overlay.guard.grant();
    else {
      overlay.guard.release();
      overlay.engaged = false;
    }
    refreshKey();
    applyMouse(overlay);
  });
  // The user pressed on the model (or its button): E is ours until the pointer leaves it, the click lease runs out or the
  // pen goes on. The window never takes focus, so the program they are using keeps its keyboard throughout.
  ipcMain.on(CHANNEL.engage, (event, on: unknown) => {
    const overlay = find(event);
    if (!overlay || typeof on !== 'boolean') return;
    overlay.engaged = on && overlay.guard.held && !overlay.pen && overlay.gate.press(overlay.region);
    refreshKey();
  });
  // The page says a drawing is up (repeating it while it is); when it says it is gone, or goes quiet, Escape goes back to whatever the person is typing into.
  ipcMain.on(CHANNEL.showing, (event, on: unknown) => {
    const overlay = find(event);
    if (!overlay || typeof on !== 'boolean') return;
    escape.showing(overlay.display.id, on);
  });
  ipcMain.on(CHANNEL.stroke, (event, stroke: unknown) => {
    const overlay = find(event);
    const t = stroke as Partial<Stroke> | null;
    if (!overlay || !(overlay.pen || Date.now() - overlay.penOffAt < PEN_GRACE_MS) || !t || typeof t.id !== 'number' || !Array.isArray(t.points)) return;
    const points: Array<[number, number]> = [];
    for (const p of t.points.slice(0, 2000)) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) points.push([Math.min(1000, Math.max(0, Number(p[0]))), Math.min(1000, Math.max(0, Number(p[1])))]);
    }
    options.onStroke?.(overlay.display.id, { id: t.id, points, done: t.done === true, ...(t.removed === true ? { removed: true as const } : {}) });
  });
  ipcMain.on(CHANNEL.cancel, (event, released: unknown) => {
    const overlay = find(event);
    if (!overlay || !(overlay.pen || Date.now() - overlay.penOffAt < PEN_GRACE_MS)) return;
    options.onCancel?.(overlay.display.id, released === true);
  });
  ipcMain.on(CHANNEL.done, (event) => {
    const overlay = find(event);
    if (overlay) options.onDone?.(overlay.display.id);
  });

  ipcMain.on(CHANNEL.milestone, (event, milestone: unknown) => {
    const overlay = find(event);
    const m = milestone as { what?: unknown; at?: unknown } | null;
    if (overlay && m && (m.what === 'first-mark' || m.what === 'first-word') && typeof m.at === 'number') options.onMilestone?.({ what: m.what, at: m.at });
  });
  ipcMain.on(CHANNEL.offer, (event) => {
    const overlay = find(event);
    if (overlay) options.onOffer?.(overlay.display.id);
  });
  ipcMain.on(CHANNEL.buttons, (event, list: unknown) => {
    const overlay = find(event);
    if (!overlay) return;
    overlay.buttons = validRects(list);
    syncCatchers(overlay);
  });
  // The voice server's audio, for the page that asked: a request is named by the page's window and its own number.
  const voiceKey = (event: IpcMainEvent, id: number): string => `${event.sender.id}:${id}`;
  ipcMain.on(CHANNEL.voiceSpeak, (event, request: unknown) => {
    const r = request as { id?: unknown; text?: unknown } | null;
    const bridge = options.voice?.bridge;
    if (!bridge || !find(event) || !r || !Number.isSafeInteger(r.id) || typeof r.text !== 'string' || r.text.trim() === '') return;
    const sender = event.sender, id = r.id as number;
    bridge.speak(voiceKey(event, id), r.text, (e) => {
      if (!sender.isDestroyed()) sender.send(CHANNEL.voiceEvent, id, e);
    }, String(sender.id));
  });
  ipcMain.on(CHANNEL.voiceCancel, (event, id: unknown) => {
    if (find(event) && Number.isSafeInteger(id)) options.voice?.bridge.cancel(voiceKey(event, id as number));
  });
  ipcMain.on(CHANNEL.detail, (event) => {
    const overlay = find(event);
    if (overlay) options.onDetail?.(overlay.display.id);
  });

  /** Puts a catcher over each of the page's buttons (and away while the pen is on or the overlay is hidden). */
  function syncCatchers(overlay: Overlay): void {
    if (overlay.window.isDestroyed()) return;
    overlay.catchers.update(overlay.buttons, { x: overlay.display.bounds.x, y: overlay.display.bounds.y }, !overlay.pen && !options.hidden);
  }

  function applyMouse(overlay: Overlay): void {
    if (ignoreMouse(overlay.pageWantsClicks, overlay.pen)) overlay.window.setIgnoreMouseEvents(true, { forward: true });
    else overlay.window.setIgnoreMouseEvents(false);
  }

  function sync(): void {
    const current = screen.getAllDisplays();
    for (const real of current) {
      const display = covered(real);
      const existing = overlays.get(display.id);
      if (!existing) create(real);
      else {
        existing.display = display;
        existing.window.setBounds(display.bounds);
        existing.window.webContents.send(CHANNEL.display, infoFor(display));
      }
    }
    for (const [id, overlay] of overlays) {
      if (!current.some((d) => d.id === id)) overlay.window.destroy();
    }
  }

  screen.on('display-added', sync);
  screen.on('display-removed', sync);
  screen.on('display-metrics-changed', sync);

  return {
    start: sync,
    /** Send a scene message to the overlay of one display; every other display's overlay is cleared. */
    send(displayId: number, message: SceneMessage): void {
      const deliver = (overlay: Overlay, m: SceneMessage) => {
        if (overlay.ready) overlay.window.webContents.send(CHANNEL.scene, m);
        else overlay.queue.push(m);
      };
      for (const [id, overlay] of overlays) {
        if (id === displayId) deliver(overlay, message);
        else if ((message.kind === 'play' || message.kind === 'begin') && message.turn === 1 && !('detail' in message && message.detail)) deliver(overlay, { kind: 'clear' });
      }
    },
    /**
     * Turns the pen on for one display (its overlay then takes the mouse) and off everywhere else;
     * null turns it off on every display and gives click-through back.
     */
    setPen(displayId: number | null): void {
      for (const [id, overlay] of overlays) {
        const on = id === displayId;
        if (overlay.pen && !on) overlay.penOffAt = Date.now();
        overlay.pen = on;
        // One window failing must never leave another one holding the mouse.
        try {
          if (!overlay.window.isDestroyed()) {
            if (on) overlay.engaged = false; // the pen draws on the screen; E is not ours then
            applyMouse(overlay);
            syncCatchers(overlay);
          }
        } catch (error) {
          console.error('[talkthrough] pen:', error instanceof Error ? error.message : String(error));
        }
      }
      refreshKey();
    },
    clearAll(): void {
      for (const overlay of overlays.values()) {
        if (overlay.ready) overlay.window.webContents.send(CHANNEL.scene, { kind: 'clear' } satisfies SceneMessage);
        overlay.queue.length = 0;
      }
    },
    /** A picture of what one overlay is showing now (development checks). */
    async snapshot(displayId: number): Promise<Buffer | null> {
      const overlay = overlays.get(displayId);
      if (!overlay || !overlay.ready) return null;
      return (await overlay.window.webContents.capturePage()).toPNG();
    },
    /** The window's picture now as raw BGRA bytes (development recordings). */
    async frame(displayId: number): Promise<{ bitmap: Buffer; width: number; height: number } | null> {
      const overlay = overlays.get(displayId);
      if (!overlay || !overlay.ready || overlay.window.isDestroyed()) return null;
      const image = await overlay.window.webContents.capturePage();
      const size = image.getSize();
      return { bitmap: image.toBitmap(), width: size.width, height: size.height };
    },
    /** A mouse event on the window, as a person's would be (development scripts). */
    input(displayId: number, event: Electron.MouseInputEvent): void {
      const overlay = overlays.get(displayId);
      if (overlay && !overlay.window.isDestroyed()) overlay.window.webContents.sendInputEvent(event);
    },
    /** Where an element of the page is, in its pixels (development scripts). */
    /** Presses one of the page's buttons the way the small catcher windows over them do (development scripts: the hidden overlay has none). */
    press(displayId: number, id: 'explode' | 'cut' | 'detail'): void {
      const overlay = overlays.get(displayId);
      if (overlay && !overlay.window.isDestroyed()) overlay.window.webContents.send(CHANNEL.scene, { kind: 'press', id } satisfies SceneMessage);
    },
    async rectOf(displayId: number, id: string): Promise<{ x: number; y: number; w: number; h: number; text: string } | null> {
      const overlay = overlays.get(displayId);
      if (!overlay || overlay.window.isDestroyed()) return null;
      const r = (await overlay.window.webContents.executeJavaScript(
        `(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.style.display === 'none') return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, text: e.textContent }; })()`,
      )) as { x: number; y: number; w: number; h: number; text: string } | null;
      return r;
    },
    displayIds(): number[] {
      return [...overlays.keys()];
    },
    /** Whatever changed what Escape is for (the keys went down, a question ended): look again at whether it is ours. */
    refreshEscape,
    /** Escape was pressed: every page stops its voice and lets its drawing fade quickly away. */
    dismissAll(): void {
      for (const overlay of overlays.values()) {
        overlay.queue.length = 0;
        if (overlay.ready && !overlay.window.isDestroyed()) overlay.window.webContents.send(CHANNEL.scene, { kind: 'dismiss' } satisfies SceneMessage);
      }
    },
    dispose(): void {
      options.voice?.bridge.dispose();
      screen.off('display-added', sync);
      screen.off('display-removed', sync);
      screen.off('display-metrics-changed', sync);
      for (const overlay of overlays.values()) {
        overlay.catchers.dispose();
        overlay.guard.release();
        overlay.engaged = false;
        overlay.window.destroy();
      }
      overlays.clear();
      refreshKey();
      escape.dispose();
    },
  };
}
