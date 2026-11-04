import { BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHANNEL } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import { createSceneState, startTurn, validateScene } from '../scene/index.ts';
import type { Scene } from '../scene/index.ts';
import type { Options } from './args.ts';

/**
 * Frame grabs: draws scenes in an offscreen window (nothing appears on any screen), at the
 * requested moments, and writes one PNG per moment. The window is transparent, so a --backdrop
 * image is what shows behind the marks.
 */
export async function runGrab(grab: NonNullable<Options['grab']>, backdrop: string | undefined, env: { preload: string; page: string }): Promise<string[]> {
  // One state across the files, as in a real thread, so a follow-up can reach the earlier ids.
  const state = createSceneState();
  const scene: Scene = { steps: [] };
  for (const file of grab.scenes) {
    startTurn(state);
    const result = validateScene(JSON.parse(readFileSync(file, 'utf8')), state);
    if (!result.ok || !result.scene) throw new Error(`${file} was refused by the validator`);
    scene.steps.push(...result.scene.steps);
  }
  mkdirSync(grab.out, { recursive: true });

  const window = new BrowserWindow({
    show: false,
    width: grab.width,
    height: grab.height,
    transparent: true,
    frame: false,
    webPreferences: { preload: env.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true },
  });
  window.webContents.setFrameRate(30);
  const display: DisplayInfo = {
    id: 0,
    bounds: { x: 0, y: 0, width: grab.width, height: grab.height },
    scaleFactor: grab.scaleFactor,
  };
  if (backdrop) display.backdrop = pathToFileURL(resolve(backdrop)).href;

  const waiters = new Map<number, () => void>();
  const onRendered = (event: Electron.IpcMainEvent, token: number) => {
    if (event.sender === window.webContents) waiters.get(token)?.();
  };
  const onReady = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents) event.sender.send(CHANNEL.display, display);
  };
  ipcMain.on(CHANNEL.rendered, onRendered);
  ipcMain.on(CHANNEL.ready, onReady);

  const written: string[] = [];
  try {
    const loaded = new Promise<void>((done, fail) => {
      ipcMain.once(CHANNEL.ready, () => done());
      setTimeout(() => fail(new Error('the overlay page never reported ready')), 20000);
    });
    void window.loadFile(env.page);
    await loaded;
    await new Promise((r) => setTimeout(r, 200)); // let the display message land
    let token = 0;
    for (const { step, t } of grab.steps) {
      token++;
      const frame = new Promise<void>((done, fail) => {
        waiters.set(token, done);
        setTimeout(() => fail(new Error(`no frame for step ${step} at ${t}s within 15 s`)), 15000);
      });
      const message: SceneMessage = { kind: 'seek', scene, step, t, token };
      window.webContents.send(CHANNEL.scene, message);
      await frame;
      await new Promise((r) => setTimeout(r, 120)); // one more paint after the renderer's own
      const image = await window.webContents.capturePage();
      const file = join(grab.out, `step${step}-t${String(t).replace('.', '_')}.png`);
      writeFileSync(file, image.toPNG());
      written.push(file);
    }
  } finally {
    ipcMain.off(CHANNEL.rendered, onRendered);
    ipcMain.off(CHANNEL.ready, onReady);
    window.destroy();
  }
  return written;
}
