import { BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CHANNEL } from '../shared/ipc.ts';
import type { CaptureMetadata, DisplayInfo, SceneMessage } from '../shared/ipc.ts';
import { createSceneState, startTurn, validateScene } from '../scene/index.ts';
import type { Scene } from '../scene/index.ts';
import type { Options } from './args.ts';

/**
 * Frame grabs: draws scenes in a hidden window (nothing appears on any screen), at the
 * requested moments, and writes one PNG per moment. The window is transparent, so a --backdrop
 * image is what shows behind the marks.
 */
export async function runGrab(grab: NonNullable<Options['grab']>, backdrop: string | undefined, env: { preload: string; page: string }): Promise<string[]> {
  // One state across the files, as in a real thread, so a follow-up can reach the earlier ids.
  const state = createSceneState();
  const scene: Scene = { steps: [] };
  const inputs: Array<{ path: string; sha256: string }> = [];
  for (const file of grab.scenes) {
    startTurn(state);
    const bytes = readFileSync(file);
    if (grab.metadata) inputs.push({ path: resolve(file), sha256: createHash('sha256').update(bytes).digest('hex') });
    const result = validateScene(JSON.parse(bytes.toString('utf8')), state);
    if (!result.ok || !result.scene) throw new Error(`${file} was refused by the validator`);
    scene.steps.push(...result.scene.steps);
  }
  mkdirSync(grab.out, { recursive: true });

  const window = new BrowserWindow({
    show: false,
    width: grab.width,
    height: grab.height,
    useContentSize: true,
    transparent: true,
    frame: false,
    // A hidden normal window, not an offscreen one: offscreen windows always render at a device scale
    // of 1. The scale comes from the force-device-scale-factor switch (set in main before ready).
    webPreferences: { preload: env.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // Electron centers new windows within the display work area, clamping oversized dimensions.
  // Restore the requested viewport after construction, before the page can lay out or paint.
  window.setContentSize(grab.width, grab.height);
  const display: DisplayInfo = {
    id: 0,
    bounds: { x: 0, y: 0, width: grab.width, height: grab.height },
    scaleFactor: grab.scaleFactor,
  };
  if (backdrop) display.backdrop = pathToFileURL(resolve(backdrop)).href;

  const waiters = new Map<number, (value: unknown) => void>();
  const onRendered = (event: Electron.IpcMainEvent, token: number, metadata?: unknown) => {
    if (event.sender === window.webContents && Number.isSafeInteger(token)) waiters.get(token)?.(metadata);
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
    const hashIfPresent = (path: string): string | null => { try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return null; } };
    const build = grab.metadata ? { pageSha256: hashIfPresent(env.page), overlaySha256: hashIfPresent(join(dirname(env.page), 'overlay.js')), preloadSha256: hashIfPresent(env.preload) } : undefined;
    const requestSeek = async (step: number, t: number, view: (typeof grab.steps)[number]['view']): Promise<CaptureMetadata | null> => {
      const mine = ++token;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const frame = new Promise<unknown>((done, fail) => {
          waiters.set(mine, done);
          timer = setTimeout(() => fail(new Error(`no frame for step ${step} at ${t}s within 15 s`)), 15000);
        });
        const message: SceneMessage = { kind: 'seek', scene, step, t, token: mine, cameraFit: 'instant', ...(view ? { view } : {}), ...(grab.metadata ? { captureMetadata: true } : {}) };
        window.webContents.send(CHANNEL.scene, message);
        const result = await frame;
        return captureMetadata(result);
      } finally { if (timer) clearTimeout(timer); waiters.delete(mine); }
    };
    const capture = async (file: string): Promise<void> => {
      await new Promise((r) => setTimeout(r, 120)); // one more paint after the renderer's own
      const image = await window.webContents.capturePage();
      writeFileSync(file, image.toPNG({ scaleFactor: grab.scaleFactor }));
      written.push(file);
    };
    for (const [index, { step, t, view }] of grab.steps.entries()) {
      const stem = `step${step}-t${String(t).replace('.', '_')}${view ? '-' + Object.entries(view).map(([k, v]) => k + String(v).replace('.', '_')).join('-') : ''}`;
      const optIn = Boolean(grab.layoutSeeks || grab.metadata);
      const unique = optIn ? `request${index}-${stem}` : stem;
      const initial = await requestSeek(step, t, view);
      const initialCount = token;
      await capture(join(grab.out, `${unique}${optIn && grab.layoutSeeks ? '-initial' : ''}.png`));
      let attempt: CaptureMetadata | null = null;
      for (let i = 0; i < (grab.layoutSeeks ?? 0); i++) attempt = await requestSeek(step, t, view);
      if (grab.layoutSeeks) await capture(join(grab.out, `${unique}-layout-attempt-${grab.layoutSeeks}.png`));
      if (grab.metadata) writeFileSync(join(grab.out, `${unique}.json`), JSON.stringify({ inputs, build, request: { step, t, view: view ?? null, cameraFit: 'instant' }, layoutSeeks: grab.layoutSeeks ?? 0, initial: { seekCount: initialCount, renderer: initial }, attempt: grab.layoutSeeks ? { seekCount: token, renderer: attempt } : null, boundary: 'renderer acknowledgement precedes capturePage by at least 120 ms', width: grab.width, height: grab.height, scaleFactor: grab.scaleFactor }, null, 2));
    }
  } finally {
    ipcMain.off(CHANNEL.rendered, onRendered);
    ipcMain.off(CHANNEL.ready, onReady);
    window.destroy();
  }
  return written;
}

/** Accept only a small, finite capture acknowledgement; legacy or malformed responses are unknown. */
function captureMetadata(value: unknown): CaptureMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.seekClock !== 'number' || !Number.isFinite(v.seekClock) || v.seekClock < 0 || v.seekClock > 1e9) return null;
  if (v.camera === null) return { seekClock: v.seekClock, camera: null, worldCamera: null };
  if (!v.camera || typeof v.camera !== 'object') return null;
  const c = v.camera as Record<string, unknown>;
  if (![c.az, c.el, c.zoom].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7) || (c.zoom as number) <= 0) return null;
  let worldCamera: CaptureMetadata['worldCamera'] = null;
  if (v.worldCamera && typeof v.worldCamera === 'object') {
    const w = v.worldCamera as Record<string, unknown>;
    const valid = (x: unknown, length: number): x is number[] => Array.isArray(x) && x.length === length && x.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7);
    if (valid(w.position, 3) && valid(w.quaternion, 4)) worldCamera = { position: w.position as [number, number, number], quaternion: w.quaternion as [number, number, number, number] };
  }
  return { seekClock: v.seekClock, camera: { az: c.az as number, el: c.el as number, zoom: c.zoom as number }, worldCamera };
}
