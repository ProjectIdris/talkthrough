// The window behind one overlay button's catcher (see button-catchers.ts). Like the consent card it is never click-through, so
// a click or a tap on it is taken with or without a mouse move before it. It never takes focus, runs no script and has no
// preload; a press is a navigation that main reads and stops.

import { BrowserWindow } from 'electron';
import { CATCHER_WINDOW_OPTIONS, pressOf } from './button-catchers.ts';
import type { CatcherWindow } from './button-catchers.ts';

export function electronCatcherWindow(options: { hideFromCapture: boolean }): CatcherWindow {
  const window = new BrowserWindow({
    ...CATCHER_WINDOW_OPTIONS,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  if (options.hideFromCapture) window.setContentProtection(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let listener: (() => void) | null = null;
  let loaded: string | null = null;
  let wanted = false; // put away again before its page had loaded: it must not appear then
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (pressOf(url) !== null) listener?.();
  });
  const present = (): void => {
    if (wanted && !window.isDestroyed()) {
      window.showInactive();
      window.moveTop(); // above the overlay, which is at the same level
    }
  };
  return {
    show(html, bounds) {
      wanted = true;
      window.setBounds(bounds);
      if (loaded === html) {
        present();
        return;
      }
      loaded = html;
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(present);
    },
    hide: () => {
      wanted = false;
      if (!window.isDestroyed()) window.hide();
    },
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    onPress: (l) => void (listener = l),
  };
}
