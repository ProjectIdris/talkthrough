import { BrowserWindow, ipcMain, screen } from 'electron';
import type { Display, IpcMainEvent } from 'electron';
import { CHANNEL } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';

export type OverlayOptions = {
  preload: string;
  /** Path of the overlay page (HTML file). */
  page: string;
  backdrop?: string;
  /** Hide the overlay from screen capture and recordings (on unless asked otherwise). */
  hideFromCapture: boolean;
  /** Called when an overlay page reports ready, with a one-line description of its window. */
  onReady?: (description: string) => void;
  /** Called when the renderer reports the end of a played scene. */
  onDone?: (displayId: number) => void;
};

type Overlay = { window: BrowserWindow; display: Display; ready: boolean; queue: SceneMessage[] };

/**
 * One overlay window per display: transparent, frameless, always on top, off the taskbar, never
 * focused, and click-through (mouse events still reach the page, so it can see the pointer) except
 * while the page says the pointer is over something draggable.
 */
export function createOverlayManager(options: OverlayOptions) {
  const overlays = new Map<number, Overlay>();

  function infoFor(display: Display): DisplayInfo {
    const info: DisplayInfo = { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor };
    if (options.backdrop) info.backdrop = options.backdrop;
    return info;
  }

  function create(display: Display): void {
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
      },
    });
    window.setAlwaysOnTop(true, 'screen-saver');
    window.setIgnoreMouseEvents(true, { forward: true });
    if (options.hideFromCapture) window.setContentProtection(true);
    // Keep clicks and focus away from us, and never let the page open windows or navigate.
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.on('page-title-updated', (event) => event.preventDefault()); // keep our own title
    window.once('ready-to-show', () => {
      window.showInactive();
      // Windows places a window by the DPI of the display it started on; set the bounds again once shown.
      window.setBounds(display.bounds);
    });
    void window.loadFile(options.page);
    overlays.set(display.id, { window, display, ready: false, queue: [] });
    window.on('closed', () => overlays.delete(display.id));
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
  ipcMain.on(CHANNEL.interactive, (event, over: unknown) => {
    const overlay = find(event);
    if (!overlay || typeof over !== 'boolean') return;
    if (over) overlay.window.setIgnoreMouseEvents(false);
    else overlay.window.setIgnoreMouseEvents(true, { forward: true });
  });
  ipcMain.on(CHANNEL.done, (event) => {
    const overlay = find(event);
    if (overlay) options.onDone?.(overlay.display.id);
  });

  function sync(): void {
    const current = screen.getAllDisplays();
    for (const display of current) {
      const existing = overlays.get(display.id);
      if (!existing) create(display);
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
        else if (message.kind === 'play' && message.turn === 1) deliver(overlay, { kind: 'clear' });
      }
    },
    clearAll(): void {
      for (const overlay of overlays.values()) {
        if (overlay.ready) overlay.window.webContents.send(CHANNEL.scene, { kind: 'clear' } satisfies SceneMessage);
        overlay.queue.length = 0;
      }
    },
    displayIds(): number[] {
      return [...overlays.keys()];
    },
    dispose(): void {
      screen.off('display-added', sync);
      screen.off('display-removed', sync);
      screen.off('display-metrics-changed', sync);
      for (const overlay of overlays.values()) overlay.window.destroy();
      overlays.clear();
    },
  };
}
