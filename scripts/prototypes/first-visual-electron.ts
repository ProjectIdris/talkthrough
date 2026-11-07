// Bundled and launched only by benchmark-first-visual.ts. Never run against a real profile.
import { app, BrowserWindow, ipcMain, session } from 'electron';
import type { NativeImage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createCatalogue } from './catalogue-retrieval.ts';
import type { ComponentCard } from './catalogue-retrieval.ts';
import { countMarkerPixels, createVisualProbe, MARKER } from './first-visual-probe.ts';
import { USEFUL_3D_ACTIONS, inspectUseful3dPixels } from './first-useful-3d.ts';
import type { Useful3dEvidence } from './first-useful-3d.ts';
import { CHANNEL } from '../../src/shared/ipc.ts';
import type { SceneMessage } from '../../src/shared/ipc.ts';

const root = resolve(process.env.TT_PROBE_ROOT!);
const work = resolve(process.env.TT_PROBE_WORK!);
const assets = join(work, 'assets');
const boot = performance.now();
const is3d = process.env.TT_PROBE_FIXTURE === '3d';
const model = { called: false, firstTokenMs: null, firstOutputMs: null };
const target = { milliseconds: 3000, met: null, reason: 'No live model, microphone, transcription, network or physical display measurement.' };
const usefulness = { accepted: null, firstUsefulOutputMs: null, reason: 'Two-colour pixel coverage is a fixture gate, not semantic usefulness. Human review is still required.' };
const runtime = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.version, platform: process.platform, arch: process.arch };
require(join(root, 'test/support/electron-profile-guard.cjs'))(process.env.TT_TEST_PROFILE, () => {});
if (!is3d) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => app.quit());
const watchdog = setTimeout(() => { console.error('first-visual probe timed out'); app.exit(1); }, 20_000);
process.on('uncaughtException', error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function run(): Promise<void> {
  await app.whenReady();
  const isolated = session.fromPartition('first-visual-probe');
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  isolated.setPermissionCheckHandler(() => false);
  const allowed = new Set(['index.html', 'overlay.js'].map(p => join(assets, p)));
  let blockedRequests = 0;
  isolated.webRequest.onBeforeRequest((details, done) => {
    let permitted = false;
    try { permitted = details.url.startsWith('file:') && allowed.has(fileURLToPath(details.url)); } catch { /* denied */ }
    if (!permitted) blockedRequests++;
    done({ cancel: !permitted });
  });
  const win = new BrowserWindow({
    width: 640, height: 480, useContentSize: true, frame: false, transparent: true, show: false,
    webPreferences: { session: isolated, preload: join(assets, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.setFrameRate(60);
  let lastImage: NativeImage | undefined;
  let observedPaints = 0;
  let controlPhase = false;
  let negativeControlPaints = 0;
  let negativeControlMaxMarkerPixels = 0;
  let checking = false;
  let requestStart = 0;
  let firstPaintMs: number | null = null;
  let markerPixels = 0;
  let firstImage: NativeImage | undefined;
  let firstEvidence: Useful3dEvidence | undefined;
  const countPixels = (image: NativeImage): number => {
    const { width, height } = image.getSize();
    if (!is3d) return countMarkerPixels(image.toBitmap(), width, height);
    const evidence = inspectUseful3dPixels(image.toBitmap(), width, height);
    return evidence.magenta.pixels + evidence.green.pixels;
  };
  let resolvePaint: (() => void) | undefined;
  win.webContents.on('paint', (_event, _dirty, image) => {
    const receivedAt = performance.now();
    lastImage = image;
    observedPaints++;
    if (controlPhase) {
      negativeControlPaints++;
      negativeControlMaxMarkerPixels = Math.max(negativeControlMaxMarkerPixels, countPixels(image));
    }
    if (!checking || firstPaintMs !== null) return;
    const { width, height } = image.getSize();
    const evidence = is3d ? inspectUseful3dPixels(image.toBitmap(), width, height) : undefined;
    const count = evidence ? evidence.magenta.pixels + evidence.green.pixels : countMarkerPixels(image.toBitmap(), width, height);
    if (is3d ? !evidence?.qualifies : count < 12) return;
    firstEvidence = evidence;
    firstPaintMs = receivedAt - requestStart;
    markerPixels = count;
    firstImage = image;
    resolvePaint?.();
  });
  const ready = new Promise<void>(done => ipcMain.on(CHANNEL.ready, event => { if (event.sender === win.webContents) done(); }));
  await win.loadFile(join(assets, 'index.html'));
  await ready;
  const graphics = is3d ? await win.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('gl');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.style.display === 'none') return { webgl2: false, rendererName: null };
    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) return { webgl2: false, rendererName: null };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, rendererName: String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) };
  })()`) as { webgl2: boolean; rendererName: string | null } : undefined;
  if (graphics && !graphics.webgl2) {
    writeFileSync(join(work, 'result.json'), JSON.stringify({
      mode: 'offline-hand-written-3d-fixture', status: 'unavailable',
      reason: 'The real overlay could not initialize a WebGL2 renderer under the default security settings. No 3D pixel or timing result exists.',
      model, target, usefulness, runtime,
      renderer: { ...graphics, mode: 'offscreen-default-gpu', startupAndCapabilityCheckMs: performance.now() - boot, gpuFeatureStatus: app.getGPUFeatureStatus(), blockedRequests },
      catalogue: null, pipeline: null,
      limits: ['No security or software-rendering override was attempted.', 'Unavailable is not a latency pass or successful native visual acceptance.'],
    }, null, 2));
    win.destroy();
    return;
  }
  const send = (message: SceneMessage) => win.webContents.send(CHANNEL.scene, message);
  win.webContents.send(CHANNEL.display, { id: 1, bounds: { x: 0, y: 0, width: 640, height: 480 }, scaleFactor: 1, silent: true });

  // A real narration/invalid-action control exercises paint activity without qualifying as a mark.
  controlPhase = true;
  const control = createVisualProbe(send, () => 0);
  control.push('{"steps":[{"say":"Words only","actions":[{"op":"invalid"}]}]}');
  const controlReport = control.end();
  await sleep(250);
  controlPhase = false;
  if (controlReport.acceptedActions !== 0 || controlReport.validationIssues === 0 || negativeControlPaints === 0 || negativeControlMaxMarkerPixels !== 0) throw new Error('negative control did not remain drawing-free');
  send({ kind: 'clear' });
  const beforeClear = observedPaints;
  win.webContents.invalidate();
  for (let i = 0; i < 100 && observedPaints === beforeClear; i++) await sleep(10);
  if (!lastImage || observedPaints === beforeClear) throw new Error('no baseline paint');
  if (countPixels(lastImage) !== 0) throw new Error('baseline contains marker pixels');
  const startupMs = performance.now() - boot;
  const baselinePaints = observedPaints;

  // Only this clock spans catalogue preparation through the first real fixture paint receipt.
  requestStart = performance.now();
  const elapsed = () => performance.now() - requestStart;
  const catalogueBytes = readFileSync(join(work, 'catalogue.json'));
  const fileReadMs = elapsed();
  const cards = JSON.parse(catalogueBytes.toString('utf8')) as ComponentCard[];
  const parseEndMs = elapsed();
  const catalogue = createCatalogue(cards);
  const indexEndMs = elapsed();
  const response = catalogue.search('mechanical');
  const encoded = JSON.stringify(response);
  const lookupEndMs = elapsed();
  const probe = createVisualProbe(send, elapsed);
  const painted = new Promise<void>(done => { resolvePaint = done; });
  checking = true;
  const actions = is3d ? USEFUL_3D_ACTIONS : [MARKER];
  const prefix = '{"steps":[{"say":"","actions":[' + actions.map(action => JSON.stringify(action)).join(',');
  const fixtureStartMs = elapsed();
  for (let at = 0; at < prefix.length; at += 11) probe.push(prefix.slice(at, at + 11));
  const fixtureFeedEndMs = elapsed();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([painted, new Promise<never>((_done, fail) => { timeout = setTimeout(() => fail(new Error('no qualifying marker paint within 5 seconds')), 5_000); })]);
  } finally { clearTimeout(timeout); }
  const beforeClose = probe.snapshot();
  if (beforeClose.completeSteps !== 0 || beforeClose.acceptedActions !== actions.length) throw new Error('expected a streamed action before step completion');
  // Deliberately withheld fixture bytes, not a simulated model delay.
  probe.push(']}]}');
  const pipeline = probe.end();
  if (blockedRequests !== 0) throw new Error(`unexpected blocked requests: ${blockedRequests}`);
  if (!firstImage) throw new Error('missing pixel evidence');
  writeFileSync(join(work, 'first-paint.png'), firstImage.toPNG());
  writeFileSync(join(work, 'result.json'), JSON.stringify({
    mode: is3d ? 'offline-hand-written-3d-fixture' : 'offline-hand-written-2d-fixture',
    ...(is3d ? { status: 'measured', usefulness } : {}),
    model,
    target,
    runtime,
    renderer: { width: 640, height: 480, frameRateCap: 60, mode: is3d ? 'offscreen-default-gpu' : 'offscreen-software', ...(is3d ? { ...graphics, evidence: firstEvidence } : {}), startupAndControlMs: startupMs, baselinePaints, negativeControlPaints, negativeControlMaxMarkerPixels, markerPixels, baselineMarkerPixels: 0, streamedBeforeStepClose: true, blockedRequests },
    catalogue: { entries: Array.isArray(cards) ? cards.length : 0, fileBytes: catalogueBytes.length, responseBytes: Buffer.byteLength(encoded), returnedCards: response.cards.length,
      fileReadMs, decodeAndParseMs: parseEndMs - fileReadMs, indexMs: indexEndMs - parseEndMs, lookupAndEncodeMs: lookupEndMs - indexEndMs, readyAfterRequestMs: lookupEndMs },
    pipeline: { ...pipeline, fixtureStartMs, fixtureFeedEndMs, firstQualifyingPaintReceiptMs: firstPaintMs, ...(is3d ? { firstSubstantial3dPaintReceiptMs: firstPaintMs } : {}) },
    limits: ['Synthetic catalogue entries repeat 21 built-in descriptions; they do not add components.', 'Fresh Electron process and index, but file and OS caches are not flushed.', 'Catalogue retrieval is measured, but does not influence the fixed marker or any model prompt.', is3d ? 'The endpoint is offscreen paint delivery with both fixture colours having >=600 pixels, >=30px extent on each axis and >=15% bounding-box occupancy. It does not establish gear correctness or semantic usefulness.' : 'The observed endpoint is offscreen paint delivery with at least 12 qualifying marker pixels, not monitor presentation or a useful 3D model.', 'Electron/renderer startup and the negative control occur before the request clock.', 'Pixel detection and offscreen readback add instrumentation cost; do not treat this as production latency.'],
  }, null, 2));
  win.destroy();
}

run().then(() => { clearTimeout(watchdog); app.exit(0); }, error => { console.error(error); clearTimeout(watchdog); app.exit(1); });
