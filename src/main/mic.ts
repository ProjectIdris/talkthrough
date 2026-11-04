import { BrowserWindow, ipcMain, session } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { MicResult } from '../shared/ipc.ts';

/**
 * Records the question while the chord is held, in a hidden page (MediaRecorder needs a renderer).
 * The microphone is opened on start and released on stop, so the system's "in use" indicator shows
 * only while recording. The audio stays in memory.
 */
export function createMic(options: { preload: string; page: string }) {
  let window: BrowserWindow | null = null;
  let pending: { resolve(result: MicResult): void; reject(error: Error): void } | null = null;
  let ready: Promise<void> | null = null;

  ipcMain.on(AUDIO_CHANNEL.result, (event, result: MicResult) => {
    if (!window || event.sender !== window.webContents || !pending) return;
    const p = pending;
    pending = null;
    p.resolve(result);
  });
  ipcMain.on(AUDIO_CHANNEL.error, (event, message: unknown) => {
    if (!window || event.sender !== window.webContents || !pending) return;
    const p = pending;
    pending = null;
    p.reject(new Error(typeof message === 'string' ? message : 'recording failed'));
  });

  function open(): Promise<void> {
    if (ready) return ready;
    window = new BrowserWindow({
      show: false,
      title: 'Talkthrough audio',
      webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    const ownContents = window.webContents;
    // Only this hidden page may use the microphone.
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && contents === ownContents));
    session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === 'media' && contents === ownContents);
    ownContents.on('did-fail-load', (_event, code, description) => console.error('[talkthrough] audio page failed to load: ' + description + ' (' + code + ')'));
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
    async start(): Promise<void> {
      await open();
      window?.webContents.send(AUDIO_CHANNEL.start);
    },
    /** Stops recording and resolves with the clip. */
    stop(): Promise<MicResult> {
      return new Promise((resolve, reject) => {
        if (!window) return reject(new Error('the audio page is not open'));
        pending = { resolve, reject };
        window.webContents.send(AUDIO_CHANNEL.stop);
      });
    },
    dispose(): void {
      window?.destroy();
    },
  };
}
