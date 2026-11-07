import { BrowserWindow, ipcMain, session, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import { CHANNEL } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import { TOUR_CHANNEL } from '../shared/visual-tour.ts';
import { createVisualTourModel } from './visual-tour-model.ts';

export type VisualTourOptions = { samplesDir: string; page: string; preload: string; overlayPage: string; overlayPreload: string };

/** A local, silent gallery. Its renderer is deliberately not registered as a live overlay. */
export function createVisualTourWindow(options: VisualTourOptions) {
  let active: { window: BrowserWindow; model: ReturnType<typeof createVisualTourModel>; render(): void } | null = null;
  let disposed = false;
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => active && event.sender === active.window.webContents && event.senderFrame === event.sender.mainFrame;
  ipcMain.handle(TOUR_CHANNEL.get, event => trusted(event) ? active!.model.state() : null);
  const onCommand = (event: Electron.IpcMainEvent, command: unknown) => {
    if (trusted(event) && active!.model.command(command)) active!.render();
  };
  ipcMain.on(TOUR_CHANNEL.command, onCommand);

  function open(): void {
    if (disposed) return;
    if (active) { active.window.show(); active.window.focus(); return; }
    const model = createVisualTourModel(options.samplesDir);
    // No persistent cookies/cache, network, microphone or screen access in either page.
    const local = session.fromPartition(`tour-${randomUUID()}`, { cache: false });
    local.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_details, callback) => callback({ cancel: true }));
    local.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    local.setPermissionCheckHandler(() => false);
    const window = new BrowserWindow({
      width: 1120, height: 780, minWidth: 940, minHeight: 720, useContentSize: true,
      title: 'Explore Talkthrough', backgroundColor: '#101827', autoHideMenuBar: true,
      webPreferences: { preload: options.preload, session: local, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.setMenu(null);
    const preview = new WebContentsView({ webPreferences: { preload: options.overlayPreload, session: local, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    preview.setBackgroundColor('#142033');
    window.contentView.addChildView(preview);
    let ready = false;
    let closed = false;
    let token = 0;
    let queuedFrame: Extract<SceneMessage, { kind: 'seek' }> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => { if (!closed) window.webContents.send(TOUR_CHANNEL.state, model.state()); };
    const fail = (message: string) => {
      if (closed) return;
      clearTimeout(pending);
      ++token; // A late frame from the failed request cannot clear its error.
      queuedFrame = undefined;
      model.status(false, message);
      preview.setVisible(false);
      publish();
    };
    const bounds = () => {
      const { width, height } = window.getContentBounds();
      return { x: 292, y: 116, width: Math.max(1, width - 312), height: Math.max(1, height - 136) };
    };
    const display = () => {
      const rect = bounds();
      preview.setBounds(rect);
      if (ready) {
        const message: DisplayInfo = { id: 0, bounds: { x: 0, y: 0, width: rect.width, height: rect.height }, scaleFactor: 1, silent: true, captions: 'voice' };
        preview.webContents.send(CHANNEL.display, message);
      }
    };
    function render(): void {
      if (closed) return;
      const scene = model.scene();
      if (!scene) { model.status(false); preview.setVisible(false); publish(); return; }
      if (!ready) {
        model.status(false, 'The preview has not started. Close and reopen the explorer to try again.');
        publish();
        return;
      }
      clearTimeout(pending);
      preview.setVisible(true);
      model.status(true, null);
      publish();
      const mine = ++token;
      queuedFrame = { kind: 'seek', scene, step: model.state().step, t: 99, token: mine + 1 };
      pending = setTimeout(() => fail('This example could not be drawn. Try another example or close and reopen the explorer.'), 15000);
      // Seek mode freezes layout easing. Paint an empty diagram first so the diagram
      // painter releases prior item positions before this independent gallery frame.
      preview.webContents.send(CHANNEL.scene, { kind: 'clear' } satisfies SceneMessage);
      preview.webContents.send(CHANNEL.scene, { kind: 'seek', scene: { steps: [{ say: '', actions: [{ op: 'diagram', id: 'gallery-reset', kind: 'flow', x: 80, y: 80, w: 840, h: 840 }] }] }, step: 0, t: 99, token: mine } satisfies SceneMessage);
    }
    active = { window, model, render };
    const onReady = (event: Electron.IpcMainEvent) => {
      if (event.sender !== preview.webContents || event.senderFrame !== event.sender.mainFrame || closed) return;
      clearTimeout(pending);
      ready = true;
      display();
      render();
    };
    const onRendered = (event: Electron.IpcMainEvent, received: unknown) => {
      if (closed || event.sender !== preview.webContents || event.senderFrame !== event.sender.mainFrame || received !== token) return;
      if (queuedFrame) {
        const message = queuedFrame;
        queuedFrame = undefined;
        token = message.token;
        preview.webContents.send(CHANNEL.scene, message);
        return;
      }
      clearTimeout(pending);
      model.status(false, null);
      publish();
    };
    ipcMain.on(CHANNEL.ready, onReady);
    ipcMain.on(CHANNEL.rendered, onRendered);
    for (const contents of [window.webContents, preview.webContents]) {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', event => event.preventDefault());
      contents.on('will-attach-webview', event => event.preventDefault());
    }
    // The preview has no live assistant controls. The scene renderer itself is unchanged.
    preview.webContents.on('did-finish-load', () => {
      void preview.webContents.insertCSS('#dock,#offer,#ask-more,#capture-controls,#explode,#cut,#detail,#undo,#caption,#answer{display:none!important}').catch(() => fail('The preview could not be prepared. Close and reopen the explorer.'));
    });
    preview.webContents.on('render-process-gone', () => fail('The preview stopped. Close and reopen the explorer to try again.'));
    window.on('resize', () => {
      if (!ready) { display(); return; }
      ++token;
      queuedFrame = undefined;
      model.status(true);
      publish();
      display();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 100);
    });
    window.on('closed', () => {
      closed = true;
      clearTimeout(pending);
      clearTimeout(resizeTimer);
      ipcMain.off(CHANNEL.ready, onReady);
      ipcMain.off(CHANNEL.rendered, onRendered);
      if (!preview.webContents.isDestroyed()) preview.webContents.close();
      if (active?.window === window) active = null;
    });
    display();
    model.status(true);
    pending = setTimeout(() => fail('The preview did not start. Close and reopen the explorer to try again.'), 20000);
    void window.loadFile(options.page).catch(() => { if (!closed) window.destroy(); });
    void preview.webContents.loadFile(options.overlayPage).catch(() => fail('The preview could not be loaded. Close and reopen the explorer.'));
  }
  return {
    open,
    dispose(): void {
      disposed = true;
      active?.window.destroy();
      ipcMain.removeHandler(TOUR_CHANNEL.get);
      ipcMain.off(TOUR_CHANNEL.command, onCommand);
    },
  };
}
