import { BrowserWindow, ipcMain, session } from 'electron';
import type { Display } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { ComposeRequest, ComposeResult, FrameResult, GrabRequest, MicResult, UseImageRequest } from '../shared/ipc.ts';
import { screenSourceId } from './capture.ts';
import type { Capture } from './capture.ts';

/**
 * The hidden page that listens and looks: it records the question (MediaRecorder needs a renderer)
 * and grabs one scaled frame of a screen, so neither work lands on the main process, which also
 * carries the key hook. The microphone is opened only on request and released on stop or abort, so
 * the system's "in use" indicator shows only while recording. Audio and frames stay in memory.
 */
export function createMedia(options: { preload: string; page: string }) {
  let window: BrowserWindow | null = null;
  let pending: { resolve(result: MicResult): void; reject(error: Error): void } | null = null;
  // Grabs in flight, by id: a late reply to an earlier grab can never resolve a later one.
  const grabbing = new Map<number, { resolve(result: FrameResult): void; reject(error: Error): void }>();
  let nextGrab = 1;
  const composing = new Map<number, { resolve(result: ComposeResult): void; reject(error: Error): void }>();
  let nextCompose = 1;
  let ready: Promise<void> | null = null;
  let onStarted: (() => void) | null = null;

  const mine = (event: Electron.IpcMainEvent) => window !== null && event.sender === window.webContents;
  ipcMain.on(AUDIO_CHANNEL.result, (event, result: MicResult) => {
    if (!mine(event) || !pending) return;
    const p = pending;
    pending = null;
    p.resolve(result);
  });
  ipcMain.on(AUDIO_CHANNEL.error, (event, message: unknown) => {
    if (!mine(event) || !pending) return;
    const p = pending;
    pending = null;
    p.reject(new Error(typeof message === 'string' ? message : 'recording failed'));
  });
  ipcMain.on(AUDIO_CHANNEL.started, (event) => {
    if (mine(event)) onStarted?.();
  });
  ipcMain.on(AUDIO_CHANNEL.frame, (event, result: FrameResult) => {
    if (!mine(event)) return;
    const g = grabbing.get(result?.id);
    if (!g) return;
    grabbing.delete(result.id);
    g.resolve(result);
  });
  ipcMain.on(AUDIO_CHANNEL.frameError, (event, id: unknown, message: unknown) => {
    if (!mine(event) || typeof id !== 'number') return;
    const g = grabbing.get(id);
    if (!g) return;
    grabbing.delete(id);
    g.reject(new Error(typeof message === 'string' ? message : 'capture failed'));
  });

  ipcMain.on(AUDIO_CHANNEL.composed, (event, result: ComposeResult) => {
    if (!mine(event)) return;
    const c = composing.get(result?.id);
    if (!c) return;
    composing.delete(result.id);
    c.resolve(result);
  });
  ipcMain.on(AUDIO_CHANNEL.composeError, (event, id: unknown, message: unknown) => {
    if (!mine(event) || typeof id !== 'number') return;
    const c = composing.get(id);
    if (!c) return;
    composing.delete(id);
    c.reject(new Error(typeof message === 'string' ? message : 'could not draw the stroke'));
  });

  function open(): Promise<void> {
    if (ready) return ready;
    window = new BrowserWindow({
      show: false,
      title: 'Talkthrough media',
      webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    const ownContents = window.webContents;
    // Only this hidden page may use the microphone or capture the screen.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback((permission === 'media' || permission === 'display-capture') && contents === ownContents));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => (permission === 'media' || permission === 'display-capture') && contents === ownContents);
    ownContents.on('did-fail-load', (_event, code, description) => console.error('[talkthrough] media page failed to load: ' + description + ' (' + code + ')'));
    ready = window.loadFile(options.page).catch((error: unknown) => {
      ready = null; // so the next press tries again
      throw error;
    });
    window.on('closed', () => {
      window = null;
      ready = null;
    });
    return ready;
  }

  return {
    /** Load the hidden page ahead of the first press. */
    warm: open,
    /** Called when a recording has really started (the device is open and the recorder running). */
    set onStarted(listener: (() => void) | null) {
      onStarted = listener;
    },
    async startMic(): Promise<void> {
      await open();
      window?.webContents.send(AUDIO_CHANNEL.start);
    },
    /** Stops recording and resolves with the clip. */
    stopMic(): Promise<MicResult> {
      return new Promise((resolve, reject) => {
        if (!window) return reject(new Error('the media page is not open'));
        pending = { resolve, reject };
        window.webContents.send(AUDIO_CHANNEL.stop);
      });
    },
    /** Stops recording and throws what was recorded away. */
    abortMic(): void {
      pending = null;
      window?.webContents.send(AUDIO_CHANNEL.abort);
    },
    /** One frame of a display, scaled so its longer side is at most maxEdge, as PNG bytes in memory. */
    async capture(display: Display, maxEdge = 1280): Promise<Capture> {
      const started = performance.now();
      const [sourceId] = await Promise.all([screenSourceId(display), open()]);
      const id = nextGrab++;
      const request: GrabRequest = {
        id,
        sourceId,
        maxEdge,
        nativeWidth: Math.round(display.size.width * display.scaleFactor),
        nativeHeight: Math.round(display.size.height * display.scaleFactor),
      };
      const frame = await new Promise<FrameResult>((resolve, reject) => {
        grabbing.set(id, { resolve, reject });
        window?.webContents.send(AUDIO_CHANNEL.grab, request);
        setTimeout(() => {
          if (grabbing.delete(id)) reject(new Error('the screen capture took too long'));
        }, 10_000).unref();
      });
      return {
        screenshot: { mime: 'image/png', base64: Buffer.from(frame.png).toString('base64'), width: frame.width, height: frame.height },
        display,
        nativeWidth: frame.nativeWidth,
        nativeHeight: frame.nativeHeight,
        ms: Math.round(performance.now() - started),
        grabId: id,
      };
    },
    /** Closes the full-resolution frame the page holds for this grab (the question no longer needs it). */
    release(grabId: number): void {
      window?.webContents.send(AUDIO_CHANNEL.release, grabId);
    },
    /** Checks only: a PNG taken as if it were the screen (the page keeps it for pen crops like a real grab). */
    async captureFromImage(display: Display, png: Buffer, maxEdge = 1280): Promise<Capture> {
      const started = performance.now();
      await open();
      const id = nextGrab++;
      const request: UseImageRequest = { id, png: new Uint8Array(png), maxEdge };
      const frame = await new Promise<FrameResult>((resolve, reject) => {
        grabbing.set(id, { resolve, reject });
        window?.webContents.send(AUDIO_CHANNEL.useImage, request);
        setTimeout(() => {
          if (grabbing.delete(id)) reject(new Error('the image took too long to read'));
        }, 10_000).unref();
      });
      return {
        screenshot: { mime: 'image/png', base64: Buffer.from(frame.png).toString('base64'), width: frame.width, height: frame.height },
        display,
        nativeWidth: frame.nativeWidth,
        nativeHeight: frame.nativeHeight,
        ms: Math.round(performance.now() - started),
        grabId: id,
      };
    },
    /**
     * Draws the pen strokes onto a frame grabbed earlier and crops around them from its full-resolution
     * picture. Rejects when the frame is no longer held (a newer grab has replaced it).
     */
    async compose(grabId: number, strokes: Array<Array<[number, number]>>, maxEdge = 1280, cropEdge = 1024) {
      const id = nextCompose++;
      const request: ComposeRequest = { id, grab: grabId, maxEdge, cropEdge, strokes };
      const result = await new Promise<ComposeResult>((resolve, reject) => {
        composing.set(id, { resolve, reject });
        window?.webContents.send(AUDIO_CHANNEL.compose, request);
        setTimeout(() => {
          if (composing.delete(id)) reject(new Error('drawing the stroke took too long'));
        }, 10_000).unref();
      });
      const toShot = (p: { png: Uint8Array; width: number; height: number }) => ({ mime: 'image/png' as const, base64: Buffer.from(p.png).toString('base64'), width: p.width, height: p.height });
      if (!result.full) throw new Error('the page sent no picture');
      return {
        screenshot: toShot(result.full),
        focus: result.marks.map((m) => ({ crop: toShot(m), box: m.box, kind: m.kind, ...(m.loops !== undefined ? { loops: m.loops } : {}), ...(m.open ? { open: true } : {}) })),
      };
    },
    /** A part of a grabbed frame (a 0..1000 box), cut from the full-resolution picture with nothing drawn on it. Null when the frame is no longer held. */
    async crop(grabId: number, box: { x: number; y: number; w: number; h: number }, cropEdge = 1024) {
      const id = nextCompose++;
      const request: ComposeRequest = { id, grab: grabId, maxEdge: 0, cropEdge, strokes: [], boxes: [box], grid: true };
      try {
        const result = await new Promise<ComposeResult>((resolve, reject) => {
          composing.set(id, { resolve, reject });
          window?.webContents.send(AUDIO_CHANNEL.compose, request);
          setTimeout(() => {
            if (composing.delete(id)) reject(new Error('cutting the picture took too long'));
          }, 5_000).unref();
        });
        const m = result.marks[0];
        return m ? { mime: 'image/png' as const, base64: Buffer.from(m.png).toString('base64'), width: m.width, height: m.height, ...(m.grid ? { grid: m.grid } : {}) } : null;
      } catch {
        return null;
      }
    },
    dispose(): void {
      window?.destroy();
    },
  };
}
