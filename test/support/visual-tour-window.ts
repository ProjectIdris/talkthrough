import * as electron from 'electron';
import { app, BrowserWindow, ipcMain, WebContentsView } from 'electron';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createSettingsWindow } from '../../src/main/settings-window.ts';
import { createSettingsService } from '../../src/main/settings-service.ts';
import { createVisualTourWindow } from '../../src/main/visual-tour-window.ts';
import { CHANNEL } from '../../src/shared/ipc.ts';
import { TOUR_CHANNEL } from '../../src/shared/visual-tour.ts';

const require = createRequire(__filename);
require('./profile-guard.cjs')(process.env.TT_TEST_PROFILE, (receipt: unknown) => writeFileSync(join(__dirname, 'profile.json'), JSON.stringify(receipt)));
app.on('window-all-closed', () => {});
// Windows stops painting a window that other windows fully cover (native occlusion), so a preview opened behind another window, or under this
// fixture's own welcome window, never produces its frame and the waits below time out. These windows are checked, not watched: keep them painting.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!(await check())) { if (Date.now() > deadline) throw new Error(`Timeout: ${what}`); await pause(30); }
}
void app.whenReady().then(async () => {
  const beforeReady = ipcMain.listenerCount(CHANNEL.ready);
  const beforeRendered = ipcMain.listenerCount(CHANNEL.rendered);
  const tour = createVisualTourWindow({ samplesDir: process.env.TT_TOUR_SAMPLES!, page: join(__dirname, 'tour/index.html'), preload: join(__dirname, 'tour-preload.cjs'), overlayPage: join(__dirname, 'overlay/index.html'), overlayPreload: join(__dirname, 'preload.cjs') });
  let voiceRequests = 0;
  ipcMain.on(CHANNEL.voiceSpeak, () => voiceRequests++);
  tour.open();
  const window = BrowserWindow.getAllWindows()[0]!;
  tour.open();
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'opening twice reuses the window');
  const state = () => window.webContents.executeJavaScript('window.talkthroughTour.state()');
  await until(async () => { try { const s = await state(); return s && !s.busy && !s.error; } catch { return false; } }, 'first real frame');
  assert.equal((await state()).selected, 'web-request');
  const preview = window.contentView.children.find(child => child instanceof WebContentsView) as WebContentsView;
  assert.ok(preview);
  const previewContents = preview.webContents;
  assert.equal(await preview.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(preview.webContents.session.getStoragePath(), null, 'in-memory preview session');
  await assert.rejects(preview.webContents.session.fetch('https://example.invalid/tour-must-not-connect'), /ERR_BLOCKED_BY_CLIENT/);
  const capture = async (name: string) => {
    if (!process.env.TT_TOUR_CAPTURE_DIR) return;
    mkdirSync(process.env.TT_TOUR_CAPTURE_DIR, { recursive: true });
    await pause(150);
    writeFileSync(join(process.env.TT_TOUR_CAPTURE_DIR, `${name}.png`), (await window.capturePage()).toPNG());
    writeFileSync(join(process.env.TT_TOUR_CAPTURE_DIR, `${name}-preview.png`), (await preview.webContents.capturePage()).toPNG());
  };
  await capture('web-request-step1');
  await window.webContents.executeJavaScript("document.getElementById('next').click()");
  await until(async () => (await state()).step === 1 && !(await state()).busy, 'next');
  await capture('web-request-step2');
  await window.webContents.executeJavaScript("document.getElementById('back').click()");
  await until(async () => (await state()).step === 0 && !(await state()).busy, 'back');
  for (const id of ['recipe', 'supply-demand', 'timeline']) {
    await window.webContents.executeJavaScript(`document.querySelector('[data-example="${id}"]').click()`);
    await until(async () => (await state()).selected === id && !(await state()).busy, id);
    assert.equal((await state()).error, null);
    await capture(id);
  }
  await window.webContents.executeJavaScript("document.getElementById('restart').click()");
  await until(async () => !(await state()).busy, 'restart');
  const attacker = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, 'tour-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await attacker.loadURL('about:blank');
  assert.equal(await attacker.webContents.executeJavaScript('window.talkthroughTour.state()'), null);
  await attacker.webContents.executeJavaScript("window.talkthroughTour.command({kind:'select',id:'recipe'})");
  await pause(100);
  assert.equal((await state()).selected, 'timeline');
  attacker.destroy();
  window.setContentSize(940, 720);
  await pause(250); // allow the native resize event and its debounced render to run
  await until(async () => !(await state()).busy, 'resize');
  await capture('minimum-size');
  const timelinePixels = (await previewContents.capturePage()).toBitmap();
  let redPixels = 0;
  for (let i = 0; i < timelinePixels.length; i += 4) if (timelinePixels[i + 2]! > 180 && timelinePixels[i + 1]! < 160 && timelinePixels[i]! < 160 && timelinePixels[i + 3]! > 0) redPixels++;
  console.log('MINIMUM_RED_PIXELS', redPixels);
  assert.ok(redPixels > 10, 'the red Hastings event remains visible after resizing the timeline');
  assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await window.webContents.executeJavaScript('document.getElementById("restart").getBoundingClientRect().bottom <= innerHeight'), true);
  assert.equal(voiceRequests, 0);
  if (process.env.TT_TOUR_INSPECT_MS) await pause(Math.min(120000, Number(process.env.TT_TOUR_INSPECT_MS) || 0));
  // Exercise a late acknowledgement after a failed request, not a real GPU crash.
  let lastToken: unknown;
  const send = previewContents.send.bind(previewContents);
  previewContents.send = (channel: string, ...args: unknown[]) => { if (channel === CHANNEL.scene) lastToken = (args[0] as { token: number }).token; send(channel, ...args); };
  await window.webContents.executeJavaScript('document.getElementById("restart").click()');
  await until(async () => lastToken !== undefined, 'render request token');
  previewContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  ipcMain.emit(CHANNEL.rendered, { sender: previewContents, senderFrame: previewContents.mainFrame }, lastToken);
  assert.match((await state()).error, /preview stopped/);
  window.close();
  await until(async () => previewContents.isDestroyed(), 'view cleanup');
  assert.equal(ipcMain.listenerCount(CHANNEL.ready), beforeReady);
  assert.equal(ipcMain.listenerCount(CHANNEL.rendered), beforeRendered);
  // The actual first-run button opens the explorer, leaving setup and first-run progress alone.
  const settingsPath = join(__dirname, 'settings.json');
  let firstRunDone = false;
  const settings = createSettingsWindow({
    preload: join(__dirname, 'settings-preload.cjs'), page: join(__dirname, 'firstrun/index.html'), firstRunPage: join(__dirname, 'firstrun/index.html'),
    keys: { available: () => false, has: () => false, load: () => undefined, save: () => { throw new Error('Unexpected key save'); }, clear: () => { throw new Error('Unexpected key clear'); } },
    settings: createSettingsService({ path: settingsPath }), onRestart: () => { throw new Error('Unexpected restart'); },
    onFirstRunDone: () => { firstRunDone = true; }, onVisualTour: tour.open,
  });
  settings.openFirstRun();
  const welcome = BrowserWindow.getAllWindows()[0]!;
  await until(async () => { try { return await welcome.webContents.executeJavaScript('Boolean(window.talkthroughSettings && document.getElementById("visualTour"))'); } catch { return false; } }, 'welcome');
  await welcome.webContents.executeJavaScript('document.getElementById("visualTour").click()');
  await until(async () => BrowserWindow.getAllWindows().length === 2, 'first-run reopen');
  const reopened = BrowserWindow.getAllWindows().find(candidate => candidate !== welcome)!;
  await until(async () => { try { const s = await reopened.webContents.executeJavaScript('window.talkthroughTour.state()'); return s && !s.busy && !s.error; } catch { return false; } }, 'reopened real frame');
  assert.equal(firstRunDone, false);
  assert.equal(existsSync(settingsPath), false);
  assert.equal(welcome.isDestroyed(), false);
  tour.dispose();
  settings.dispose();
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  assert.equal(ipcMain.listenerCount(TOUR_CHANNEL.command), 0);
  const brokenSamples = join(__dirname, 'broken-samples');
  mkdirSync(brokenSamples);
  copyFileSync(join(process.env.TT_TOUR_SAMPLES!, 'diagram-steps.json'), join(brokenSamples, 'diagram-steps.json'));
  const recovery = createVisualTourWindow({ samplesDir: brokenSamples, page: join(__dirname, 'tour/index.html'), preload: join(__dirname, 'tour-preload.cjs'), overlayPage: join(__dirname, 'overlay/index.html'), overlayPreload: join(__dirname, 'preload.cjs') });
  recovery.open();
  const broken = BrowserWindow.getAllWindows()[0]!;
  const brokenState = () => broken.webContents.executeJavaScript('window.talkthroughTour.state()');
  await until(async () => { try { const s = await brokenState(); return s && !s.busy && Boolean(s.error); } catch { return false; } }, 'missing initial scene error');
  await broken.webContents.executeJavaScript("document.querySelector('[data-example=\"recipe\"]').click()");
  await until(async () => { const s = await brokenState(); return s.selected === 'recipe' && !s.busy && !s.error; }, 'recovery from missing example');
  recovery.dispose();
  const unavailable = createVisualTourWindow({ samplesDir: process.env.TT_TOUR_SAMPLES!, page: join(__dirname, 'tour/index.html'), preload: join(__dirname, 'tour-preload.cjs'), overlayPage: join(__dirname, 'missing-overlay.html'), overlayPreload: join(__dirname, 'preload.cjs') });
  unavailable.open();
  const failed = BrowserWindow.getAllWindows()[0]!;
  const failedState = () => failed.webContents.executeJavaScript('window.talkthroughTour.state()');
  await until(async () => { try { const s = await failedState(); return s && !s.busy && Boolean(s.error); } catch { return false; } }, 'load failure');
  const loadError = (await failedState()).error;
  failed.setContentSize(1000, 740);
  await pause(250);
  assert.equal((await failedState()).busy, false, 'resizing a failed startup must not enter an unbounded busy state');
  assert.equal((await failedState()).error, loadError);
  unavailable.dispose();
  // Every window of this run was made off every display, never took focus, and still painted (the waits above would have timed out otherwise).
  const watched = (electron as unknown as { windowWatch(): { windows: number; samples: number; onDisplay: number; focused: number } }).windowWatch();
  console.log('WINDOW_WATCH', JSON.stringify(watched));
  assert.ok(watched.windows >= 6 && watched.samples > 100, 'the windows were watched');
  assert.equal(watched.onDisplay, 0, 'no window was ever on a display');
  assert.equal(watched.focused, 0, 'no window ever took focus');
  console.log('TOUR_CHECKS_PASSED: navigation, four real scenes, network blocked, sender isolation, window reuse, minimum size, no voice, cleanup and reopen');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
