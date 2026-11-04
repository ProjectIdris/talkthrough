import { BrowserWindow, ipcMain } from 'electron';
import { SETTINGS_CHANNEL } from '../shared/ipc.ts';
import { KeyStoreError } from './keystore.ts';
import type { createKeyStore } from './keystore.ts';

/**
 * The small window where the API key is entered (opened from the tray). Only that window's page may
 * talk to the key store, the key is never sent back to it, and it is never logged.
 */
export function createSettingsWindow(options: { preload: string; page: string; keys: ReturnType<typeof createKeyStore> }) {
  let window: BrowserWindow | null = null;

  const trusted = (event: Electron.IpcMainInvokeEvent) => window !== null && event.sender === window.webContents;
  ipcMain.handle(SETTINGS_CHANNEL.status, (event) => {
    if (!trusted(event)) return { available: false, saved: false };
    return { available: options.keys.available(), saved: options.keys.has() };
  });
  ipcMain.handle(SETTINGS_CHANNEL.save, (event, key: unknown) => {
    if (!trusted(event) || typeof key !== 'string') return { ok: false, message: 'Not saved.' };
    try {
      options.keys.save(key);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof KeyStoreError ? error.message : 'The key could not be saved.' };
    }
  });
  ipcMain.handle(SETTINGS_CHANNEL.clear, (event) => {
    if (trusted(event)) options.keys.clear();
  });

  return {
    open(): void {
      if (window) {
        window.show();
        window.focus();
        return;
      }
      window = new BrowserWindow({
        width: 480,
        height: 360,
        title: 'Talkthrough settings',
        autoHideMenuBar: true,
        minimizable: false,
        maximizable: false,
        webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.on('page-title-updated', (event) => event.preventDefault());
      window.on('closed', () => {
        window = null;
      });
      void window.loadFile(options.page);
    },
    dispose(): void {
      window?.destroy();
    },
  };
}
