// Development only (a recording asked for on the command line): records what the computer is playing, as the window's own sound is (the system
// voice cannot be saved at its source). A hidden window asks for the screen's "loopback" audio and a MediaRecorder keeps the sound.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, desktopCapturer, session } from 'electron';

export type Loopback = {
  /** Starts recording; resolves with the wall-clock time (ms since the epoch) the sound began to be kept. */
  start(): Promise<number>;
  /** Ends it and gives the recording (WebM, Opus), or null when nothing was kept. */
  stop(): Promise<Buffer | null>;
};

export function createLoopback(log: (line: string) => void): Loopback {
  let window: BrowserWindow | undefined;
  return {
    async start() {
      const ses = session.fromPartition('loopback-recording');
      ses.setDisplayMediaRequestHandler((_request, callback) => {
        void desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          const source = sources[0];
          if (source) callback({ video: source, audio: 'loopback' });
          else callback({});
        });
      });
      window = new BrowserWindow({ show: false, webPreferences: { session: ses, backgroundThrottling: false } });
      // A page from a file counts as a secure place, which asking for the screen's sound needs (a blank page does not).
      const page = join(mkdtempSync(join(tmpdir(), 'loopback-')), 'recorder.html');
      writeFileSync(page, '<!doctype html><title>recorder</title>');
      await window.loadFile(page);
      const began = (await window.webContents.executeJavaScript(
        `(async () => {
          const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          s.getVideoTracks().forEach((t) => t.stop());
          const rec = new MediaRecorder(new MediaStream(s.getAudioTracks()), { mimeType: 'audio/webm;codecs=opus' });
          window.__chunks = [];
          rec.ondataavailable = (e) => window.__chunks.push(e.data);
          window.__rec = rec;
          rec.start(250);
          return Date.now();
        })()`,
        true,
      )) as number;
      log('loopback: recording the sound the computer plays');
      return began;
    },
    async stop() {
      if (!window || window.isDestroyed()) return null;
      const base64 = (await window.webContents.executeJavaScript(
        `new Promise((resolve) => {
          const rec = window.__rec;
          rec.onstop = async () => {
            const bytes = new Uint8Array(await new Blob(window.__chunks).arrayBuffer());
            let s = '';
            for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
            resolve(btoa(s));
          };
          rec.stop();
        })`,
        true,
      )) as string;
      window.destroy();
      window = undefined;
      return base64.length > 0 ? Buffer.from(base64, 'base64') : null;
    },
  };
}
