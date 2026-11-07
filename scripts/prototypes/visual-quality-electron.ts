// Only launched by check-visual-quality.ts, against an isolated temporary profile.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL } from '../../src/shared/ipc.ts';
import type { CaptureMetadata, SceneMessage } from '../../src/shared/ipc.ts';
import { validateScene } from '../../src/scene/index.ts';
import { analyseFrame, thresholds } from './visual-quality-pixels.ts';
import { visualFixtures, visualViews } from './visual-quality-fixtures.ts';
import { prepareVisualFrame, cameraMatchesView } from './visual-quality-sequence.ts';
import { applyVisualRenderingMode } from './visual-quality-rendering.ts';
import { visualStatus } from './visual-quality-report.ts';
import type { Capture } from './visual-quality-report.ts';

const root = process.env.TT_VISUAL_ROOT!, work = process.env.TT_VISUAL_WORK!;
const assets = join(work, 'assets'), output = join(work, 'output');
require(join(root, 'test/support/electron-profile-guard.cjs'))(process.env.TT_TEST_PROFILE, () => {});
const requestedRenderingMode = applyVisualRenderingMode(app, process.env.TT_VISUAL_RENDERING_MODE);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const width = 800, height = 600;
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const report: Record<string, unknown> & { captures: Capture[] } = {
  status: 'failed', requestedRenderingMode, nativeVisualAcceptance: null, modelCalled: false, captures: [], thresholds,
  runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.version, platform: process.platform, arch: process.arch },
  viewport: { width, height, scaleFactor: 1, tier: process.env.TT_VISUAL_TIER },
  renderer: { available: false, browserOnlySubstitute: false }, blockedRequests: 0,
  boundary: 'Production overlay sought at fixed scene times; native Electron capturePage output after renderer acknowledgement plus 150 ms. Not a physical screen capture.',
  limits: ['Hand-written fixtures, no live model or catalogue inference.', 'Only the 3D canvas is visible. Captions, 2D marks and controls cannot satisfy these checks.', 'Pixel thresholds are conservative smoke diagnostics, not complete shape, material or aesthetic validation.', 'The requested rendering mode is recorded separately from the actual renderer. Software mode uses the app’s existing disableHardwareAcceleration API; it does not guarantee WebGL2. No GPU backend, blocklist, security or sandbox overrides are applied.', 'No physical desktop, input, voice, latency target or native visual acceptance is established.'],
};
const logs: string[] = [];
let window: BrowserWindow | undefined;
const save = () => { report.rendererLog = logs; writeFileSync(join(output, 'native-result.json'), JSON.stringify(report, null, 2)); };
process.on('uncaughtException', error => { report.status = 'failed'; report.reason = String(error); save(); app.exit(1); });
const watchdog = setTimeout(() => { report.reason = 'Native visual check timed out'; save(); app.exit(1); }, 65_000);
async function run(): Promise<void> {
  await app.whenReady();
  const isolated = session.fromPartition('visual-quality');
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  isolated.setPermissionCheckHandler(() => false);
  const allowed = new Set(['index.html', 'overlay.js'].map(p => join(assets, p)));
  isolated.webRequest.onBeforeRequest((details, done) => {
    let permitted = false;
    try { permitted = details.url.startsWith('file:') && allowed.has(fileURLToPath(details.url)); } catch { /* denied */ }
    if (!permitted) report.blockedRequests = Number(report.blockedRequests) + 1;
    done({ cancel: !permitted });
  });
  window = new BrowserWindow({ width, height, useContentSize: true, frame: false, transparent: false, backgroundColor: '#eef2f7', show: false,
    webPreferences: { session: isolated, preload: join(assets, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  const win = window;
  win.webContents.setAudioMuted(true);
  win.webContents.setFrameRate(60);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('console-message', event => { if (logs.length < 80) logs.push(event.message.slice(0, 1000)); });
  const ready = new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('Overlay never reported ready')), 15_000);
    const listener = (event: Electron.IpcMainEvent) => { if (event.sender === win.webContents) { clearTimeout(timer); ipcMain.off(CHANNEL.ready, listener); done(); } };
    ipcMain.on(CHANNEL.ready, listener);
  });
  await win.loadFile(join(assets, 'index.html'), { query: { tier: process.env.TT_VISUAL_TIER! } });
  await ready;
  // Pixel acceptance is 3D only: no caption, HUD, panel frame or 2D mark can substitute.
  await win.webContents.insertCSS('html,body{background:#eef2f7!important}body>*{visibility:hidden!important}#gl{visibility:visible!important}');
  win.webContents.send(CHANNEL.display, { id: 1, bounds: { x: 0, y: 0, width, height }, scaleFactor: 1, silent: true });
  await sleep(150);
  const renderer = await win.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('gl');
    if (!canvas || getComputedStyle(canvas).display === 'none') return { available: false, reason: 'Production overlay disabled its unavailable WebGL renderer' };
    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) return { available: false, reason: 'Production WebGL2 context missing or lost' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { available: true, name: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), version: String(gl.getParameter(gl.VERSION)) };
  })()`);
  report.renderer = { ...renderer, requestedRenderingMode, hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(), browserOnlySubstitute: false, mode: 'native-electron-offscreen', gpuFeatures: app.getGPUFeatureStatus() };
  let token = 0;
  const seek = (scene: import('../../src/scene/types.ts').Scene, view?: { az: number; el: number; zoom: number }): Promise<CaptureMetadata | undefined> => new Promise((done, fail) => {
    const mine = ++token;
    const listener = (event: Electron.IpcMainEvent, responseToken: number, metadata?: CaptureMetadata) => {
      if (event.sender !== win.webContents || responseToken !== mine) return;
      clearTimeout(timer); ipcMain.off(CHANNEL.rendered, listener); done(metadata);
    };
    const timer = setTimeout(() => { ipcMain.off(CHANNEL.rendered, listener); fail(new Error(`No renderer acknowledgement for seek ${mine}`)); }, 8_000);
    ipcMain.on(CHANNEL.rendered, listener);
    const message: SceneMessage = { kind: 'seek', scene, step: 0, t: 3, token: mine, captureMetadata: true, ...(view ? { view } : {}) };
    win.webContents.send(CHANNEL.scene, message);
  });
  await seek({ steps: [{ say: '', actions: [] }] });
  await sleep(150);
  const baselineImage = await win.webContents.capturePage();
  const size = baselineImage.getSize();
  if (size.width !== width || size.height !== height) throw new Error(`Unexpected capture size ${size.width}x${size.height}`);
  writeFileSync(join(output, 'baseline.png'), baselineImage.toPNG());
  if (report.blockedRequests !== 0) throw new Error(`Unexpected resource requests were blocked (${report.blockedRequests})`);
  if (!renderer.available) {
    report.status = 'unsupported'; report.reason = renderer.reason; return;
  }
  for (const fixture of visualFixtures) for (const view of visualViews) {
    const validated = validateScene(fixture.scene);
    if (!validated.ok || !validated.scene || validated.issues.length) throw new Error(`Fixture ${fixture.id} was changed or refused by the validator`);
    const metadata = await prepareVisualFrame(validated.scene, view, seek);
    await sleep(150);
    const image = await win.webContents.capturePage();
    const id = `${fixture.id}-${view.id}`;
    writeFileSync(join(output, `${id}.png`), image.toPNG());
    const imageSize = image.getSize();
    if (imageSize.width !== width || imageSize.height !== height) throw new Error(`Capture dimensions changed for ${id}`);
    const analysis = analyseFrame(image.toBitmap(), baselineImage.toBitmap(), width, height);
    if (!cameraMatchesView(metadata, view)) { analysis.failures.push('missing-or-mismatched-renderer-camera'); analysis.status = 'fail'; }
    report.captures.push({ id, image: `${id}.png`, inspect: fixture.inspect, analysis, metadata: { ...metadata, view, sceneTimeSeconds: 3, seekCount: token, resetSeeks: 1, fixtureSeeks: 2 } });
    save();
  }
  if (report.blockedRequests !== 0) throw new Error(`Unexpected resource requests were blocked (${report.blockedRequests})`);
  report.status = visualStatus(true, report.captures, visualFixtures.length * visualViews.length);
}
run().catch(error => { report.status = 'failed'; report.reason = String(error); }).finally(() => {
  clearTimeout(watchdog); save(); window?.destroy(); app.exit(report.status === 'passed-smoke-checks' ? 0 : report.status === 'unsupported' ? 2 : 1);
});
