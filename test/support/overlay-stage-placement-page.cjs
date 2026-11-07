const { app, BrowserWindow, ipcMain, nativeImage, session } = require('electron');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
require('./electron-profile-guard.cjs')(process.env.TT_TEST_PROFILE, () => {});
const root = path.resolve(__dirname, '../..');
const scene = { v: 1, steps: [
  { say: '', actions: [
    { op: 'panel', x: 70, y: 65, w: 860, h: 830 },
    { op: 'orbit', az: 25, el: 18, dur: 0 },
    ...[[-1.7, 1.3, 0], [-1.7, -1.3, 0], [1.6, 1.3, 0], [1.6, -1.3, 0]].map((pos, i) => ({ op: 'add', shape: 'box', id: `body${i}`, pos, size: i === 2 ? [2.9, 1.6, 1.1] : [2, 2, 1.1] })),
  ] },
  { say: '', actions: [{ op: 'orbit', az: -38, el: -20, dur: 0 }] },
] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out`)), 10000); })]).finally(() => clearTimeout(timer));
};
let latest;
ipcMain.on('tt:visibleRegions', (_event, value) => { latest = value; });

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_web, _permission, done) => done(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_request, done) => done({ cancel: true }));
  // A neutral page enables real placement. Without a backdrop there is no placer,
  // and a geometry-only screenshot cannot expose the control feedback regression.
  const backdrop = path.join(process.env.TT_TEST_PROFILE, 'neutral.png');
  writeFileSync(backdrop, nativeImage.createFromBitmap(Buffer.from([240, 240, 240, 255]), { width: 1, height: 1 }).toPNG());
  const win = new BrowserWindow({ width: 1100, height: 800, useContentSize: true, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'overlay-followup-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.setContentSize(1100, 800);
  const ready = new Promise(resolve => ipcMain.once('tt:ready', resolve));
  await win.loadFile(path.join(root, 'dist/overlay/index.html'), { query: { tier: 'low' } });
  await bounded(ready, 'ready');
  win.webContents.send('tt:display', { id: 1, bounds: { x: 0, y: 0, width: 1100, height: 800 }, scaleFactor: 1, silent: true, detail: true, backdrop: pathToFileURL(backdrop).href });
  let token = 0;
  const seek = async step => {
    const mine = ++token;
    const rendered = new Promise(resolve => {
      const listener = (event, value) => {
        if (event.sender === win.webContents && value === mine) { ipcMain.off('tt:rendered', listener); resolve(); }
      };
      ipcMain.on('tt:rendered', listener);
    });
    win.webContents.send('tt:scene', { kind: 'seek', scene, step, t: 3, token: mine });
    await bounded(rendered, `seek ${mine}`);
    await sleep(100);
    const model = latest?.regions.find(region => region.id === 'model-geometry' && region.shape.type === 'rect');
    assert.ok(model, 'actual model bounds are published, not a graphics fallback');
    const buttons = ['button:explode', 'button:cut', 'button:detail'].map(id => latest.regions.find(region => region.id === id));
    assert.ok(buttons.every(button => button?.shape.type === 'rect'), 'stage following controls are visible');
    const receipt = { token: mine, step, model: model.shape, buttons: buttons.map(button => button.shape) };
    console.log('STAGE_PLACEMENT_FRAME', JSON.stringify(receipt));
    return receipt;
  };
  // Fixed-panel reference bounds include the existing camera-fit easing after
  // an authored orbit. A new angle need not have the previous frame's size.
  const expectedViews = [
    { x: 223.504791, y: 48.919189, w: 583.871585, h: 612.981420 },
    { x: 226.433472, y: 51.755633, w: 579.119506, h: 608.128845 },
    { x: 229.106395, y: 54.346898, w: 574.776356, h: 603.691415 },
    { x: 252.327169, y: 116.749708, w: 625.135849, h: 560.589032 },
  ];
  const modelMatches = (actual, expected) => {
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(actual.model[key] - expected[key]) <= 3,
      `repeat ${actual.token} moved or resized model ${key}: ${actual.model[key]} vs ${expected[key]}`);
  };
  const stable = (actual, expected) => {
    modelMatches(actual, expected.model);
    for (let i = 0; i < actual.buttons.length; i++) for (const key of ['x', 'y']) assert.ok(Math.abs(actual.buttons[i][key] - expected.buttons[i][key]) <= 3,
      `repeat ${actual.token} displaced its following control ${i} ${key}`);
  };
  const first = await seek(0);
  for (let i = 0; i < 5; i++) stable(await seek(0), first);
  for (let i = 0; i < 3; i++) modelMatches(await seek(1), expectedViews[i]);
  modelMatches(await seek(0), expectedViews[3]);
  console.log('STAGE_PLACEMENT_OK');
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
