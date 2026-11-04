import { BrowserWindow, ipcMain, session } from 'electron';
import type { Display } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { FrameResult, GrabRequest, MicResult } from '../shared/ipc.ts';
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
  let grabbing: { resolve(result: FrameResult): void; reject(error: Error): void } | null = null;
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
    if (!mine(event) || !grabbing) return;
    const g = grabbing;
    grabbing = null;
    g.resolve(result);
  });
  ipcMain.on(AUDIO_CHANNEL.frameError, (event, message: unknown) => {
    if (!mine(event) || !grabbing) return;
    const g = grabbing;
    grabbing = null;
    g.reject(new Error(typeof message === 'string' ? message : 'capture failed'));
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
      const request: GrabRequest = {
        sourceId,
        maxEdge,
        nativeWidth: Math.round(display.size.width * display.scaleFactor),
        nativeHeight: Math.round(display.size.height * display.scaleFactor),
      };
      const frame = await new Promise<FrameResult>((resolve, reject) => {
        grabbing = { resolve, reject };
        window?.webContents.send(AUDIO_CHANNEL.grab, request);
        setTimeout(() => reject(new Error('the screen capture took too long')), 10_000).unref();
      });
      return {
        screenshot: { mime: 'image/png', base64: Buffer.from(frame.png).toString('base64'), width: frame.width, height: frame.height },
        display,
        nativeWidth: frame.nativeWidth,
        nativeHeight: frame.nativeHeight,
        ms: Math.round(performance.now() - started),
      };
    },
    dispose(): void {
      window?.destroy();
    },
  };
}
