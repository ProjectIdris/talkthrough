import { BrowserWindow, ipcMain } from 'electron';
import { SETTINGS_CHANNEL } from '../shared/ipc.ts';
import type { DeviceList, FirstRunInfo, MicTestResult, SpeechInfo, ToolsFound, UpdateView } from '../shared/ipc.ts';
import { testLocalModel } from '../adapters/local-model.ts';
import { KeyStoreError } from './keystore.ts';
import type { createKeyStore } from './keystore.ts';
import type { SettingsService } from './settings-service.ts';
import { WHISPER_OFFER } from './speech-service.ts';
import type { SpeechService } from './speech-service.ts';
import { InstallError } from './whisper-install.ts';
import type { SettingsForm } from '../shared/settings-form.ts';

/**
 * The settings window (opened from the tray) and, the first time the app runs, the first-run window: both are pages of the same kind, with the same
 * preload, and only the window's own page may talk to the key store; the key is never sent back to it, and it is never logged. The other settings
 * are checked by the settings service (the same checks as the file) before anything is written.
 */
export type SettingsWindowOptions = {
  preload: string;
  page: string;
  /** The first-run page (a window of its own, asked for by `openFirstRun`). */
  firstRunPage?: string;
  /** Browse bundled explanations without configuring a model. */
  onVisualTour?(): void;
  keys: ReturnType<typeof createKeyStore>;
  settings: SettingsService;
  /** How a question is heard, and the download of better hearing (asked for by the page, after a yes). */
  speech?: SpeechService;
  /** The microphones and speakers the system lists. */
  devices?: () => Promise<DeviceList>;
  /** The tools found on this computer for answering. */
  tools?: () => Promise<ToolsFound>;
  /** About three seconds of the microphone: how loud, and what the recogniser made of it. */
  micTest?: () => Promise<MicTestResult>;
  /** The sentence that says what answers will use, from the settings as they are now. */
  modelLine?: () => string;
  /** The person finished (or closed) the first-run window; `restart` is true when what they chose needs the app started again. */
  onFirstRunDone?(restart: boolean): void;
  /** Updates: where they stand, a look now, and (the person's yes, from the page's button) the install. */
  updates?: { view(): UpdateView; check(): Promise<UpdateView>; install(): Promise<UpdateView> };
  /** Quit and start again. */
  onRestart(): void;
  /** Called with the settings as saved, so what can take effect at once does. */
  onSaved?(form: SettingsForm): void;
};

export function createSettingsWindow(options: SettingsWindowOptions) {
  let window: BrowserWindow | null = null;
  let firstRun = false;

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
  ipcMain.handle(SETTINGS_CHANNEL.get, (event) => (trusted(event) ? options.settings.read() : null));
  ipcMain.handle(SETTINGS_CHANNEL.put, (event, form: unknown) => {
    if (!trusted(event)) return { ok: false, messages: ['Not saved.'] };
    const result = options.settings.save(form);
    if (result.ok) options.onSaved?.(result.form);
    return result;
  });
  ipcMain.on(SETTINGS_CHANNEL.restart, (event) => {
    if (trusted(event)) options.onRestart();
  });
  ipcMain.handle(SETTINGS_CHANNEL.speechStatus, async (event): Promise<SpeechInfo | null> => (trusted(event) && options.speech ? { ...(await options.speech.status()), offer: WHISPER_OFFER } : null));
  ipcMain.handle(SETTINGS_CHANNEL.speechInstall, async (event, model: unknown) => {
    if (!trusted(event) || !options.speech || typeof model !== 'string') return { ok: false, message: 'Not started.' };
    try {
      await options.speech.install(model, (progress) => { if (!event.sender.isDestroyed()) event.sender.send(SETTINGS_CHANNEL.speechProgress, progress); });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof InstallError ? error.message : 'It could not be installed.' };
    }
  });
  ipcMain.on(SETTINGS_CHANNEL.speechCancel, (event) => {
    if (trusted(event)) options.speech?.cancelInstall();
  });
  ipcMain.handle(SETTINGS_CHANNEL.speechRemove, async (event) => {
    if (trusted(event)) await options.speech?.remove();
  });
  // The explicit local model test sends only a generated picture and a fixed setup question to the address on this computer.
  ipcMain.handle(SETTINGS_CHANNEL.testLocal, async (event, request: unknown) => {
    const r = request as { baseUrl?: unknown; model?: unknown } | null;
    if (!trusted(event) || !r || typeof r.baseUrl !== 'string' || typeof r.model !== 'string') return { ok: false, message: 'The test could not be run.' };
    return testLocalModel({ baseUrl: r.baseUrl.slice(0, 300), model: r.model.slice(0, 200) });
  });
  ipcMain.handle(SETTINGS_CHANNEL.devices, async (event): Promise<DeviceList> => {
    const none: DeviceList = { microphones: [{ id: '', name: 'System default' }], speakers: [{ id: '', name: 'System default' }] };
    if (!trusted(event) || !options.devices) return none;
    return options.devices().catch(() => none);
  });
  ipcMain.handle(SETTINGS_CHANNEL.tools, async (event): Promise<ToolsFound> => {
    const none: ToolsFound = { claude: false, codex: false, apiKey: options.keys.has() };
    if (!trusted(event) || !options.tools) return none;
    return { ...(await options.tools().catch(() => none)), apiKey: options.keys.has() };
  });
  ipcMain.handle(SETTINGS_CHANNEL.firstRun, async (event): Promise<FirstRunInfo | null> => {
    if (!trusted(event) || !firstRun) return null;
    const none: ToolsFound = { claude: false, codex: false, apiKey: options.keys.has() };
    const tools = options.tools ? { ...(await options.tools().catch(() => none)), apiKey: options.keys.has() } : none;
    return { form: options.settings.read(), line: options.modelLine?.() ?? '', tools };
  });
  ipcMain.handle(SETTINGS_CHANNEL.micTest, async (event): Promise<MicTestResult> => {
    if (!trusted(event) || !options.micTest) return { ok: false, message: 'The microphone test is not available.' };
    return options.micTest().catch(() => ({ ok: false as const, message: 'The microphone could not be used.' }));
  });
  ipcMain.handle(SETTINGS_CHANNEL.updateStatus, (event): UpdateView | null => (trusted(event) && options.updates ? options.updates.view() : null));
  ipcMain.handle(SETTINGS_CHANNEL.updateCheck, async (event): Promise<UpdateView | null> => (trusted(event) && options.updates ? options.updates.check() : null));
  ipcMain.handle(SETTINGS_CHANNEL.updateInstall, async (event): Promise<UpdateView | null> => (trusted(event) && options.updates ? options.updates.install() : null));
  ipcMain.on(SETTINGS_CHANNEL.visualTour, (event) => {
    if (trusted(event)) options.onVisualTour?.();
  });
  ipcMain.on(SETTINGS_CHANNEL.firstRunDone, (event, restart: unknown) => {
    if (!trusted(event) || !firstRun) return;
    finishFirstRun(restart === true);
  });

  function finishFirstRun(restart: boolean): void {
    if (!firstRun) return;
    firstRun = false;
    options.onFirstRunDone?.(restart);
    if (restart) options.onRestart();
    else window?.destroy();
  }

  function make(page: string, title: string, size: { width: number; height: number; minWidth: number; minHeight: number }): BrowserWindow {
    const made = new BrowserWindow({
      ...size,
      backgroundColor: '#0e1320',
      title,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    made.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    made.webContents.on('will-navigate', (event) => event.preventDefault());
    made.on('page-title-updated', (event) => event.preventDefault());
    made.on('closed', () => {
      if (window === made) window = null;
      // Closing the first-run window is leaving it: it is not shown again.
      if (firstRun) {
        firstRun = false;
        options.onFirstRunDone?.(false);
      }
    });
    void made.loadFile(page);
    return made;
  }

  return {
    /** Opens (or brings forward) the settings window; `section` asks the page to show one of its cards ('hearing'). */
    open(section?: string): void {
      if (window && firstRun) window.destroy();
      if (window && !window.isDestroyed()) {
        window.show();
        window.focus();
        if (section) window.webContents.send(SETTINGS_CHANNEL.focus, section);
        return;
      }
      window = make(options.page, 'Talkthrough settings', { width: 720, height: 860, minWidth: 560, minHeight: 480 });
      if (section) {
        const target = window;
        target.webContents.once('did-finish-load', () => setTimeout(() => { if (!target.isDestroyed()) target.webContents.send(SETTINGS_CHANNEL.focus, section); }, 300));
      }
    },
    /** The window of the first run. */
    openFirstRun(): void {
      if (!options.firstRunPage) return;
      if (window && !window.isDestroyed()) window.destroy();
      firstRun = true;
      window = make(options.firstRunPage, 'Welcome to Talkthrough', { width: 780, height: 700, minWidth: 640, minHeight: 600 });
    },
    dispose(): void {
      firstRun = false;
      window?.destroy();
    },
  };
}
