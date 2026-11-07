const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('./electron-profile-guard.cjs')(process.env.TT_TEST_PROFILE, () => {});
app.disableHardwareAcceleration();

const out = process.env.TT_CONTROLS_OUT;
const root = path.resolve(__dirname, '../..');
const scene = process.env.TT_CONTROLS_SCENE ? JSON.parse(fs.readFileSync(process.env.TT_CONTROLS_SCENE, 'utf8')) : {
  v: 1, steps: [{ say: '', actions: [
    { op: 'label', id: 'title', x: 55, y: 55, text: 'Keep the drawing readable', size: 32 },
    { op: 'label', id: 'footnote', x: 55, y: 929, text: 'ORIGINAL SCENE / SCHEMATIC, NOT TO SCALE', size: 14 },
  ] }],
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
let latest, buttons = [], commands = [];
ipcMain.on('tt:visibleRegions', (_e, value) => { latest = value; });
ipcMain.on('tt:buttons', (_e, value) => { buttons = value; });
ipcMain.on('tt:followup', (_e, value) => { commands.push(value); });
const receipts = [];

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, done) => done({ cancel: true }));
  const win = new BrowserWindow({ width: 960, height: 640, useContentSize: true, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'overlay-followup-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  let stage = 'load';
  const progress = value => {
    stage = value; console.log('LAYOUT_STAGE', stage);
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.appendFileSync(path.join(out, 'progress.log'), `${stage}\n`); }
  };
  const bounded = (promise, operation) => Promise.race([promise, sleep(5000).then(() => { throw new Error(`${operation} timed out: ${stage}`); })]);
  const execute = code => bounded(win.webContents.executeJavaScript(code), 'renderer evaluation');
  win.webContents.on('render-process-gone', (_event, details) => console.error('RENDERER_GONE', details));
  const ready = new Promise(resolve => ipcMain.once('tt:ready', resolve));
  await win.loadFile(path.join(root, 'dist/overlay/index.html'));
  await ready;
  async function settled() {
    await execute('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await sleep(100);
  }
  const measure = ids => execute(`(${(names => Object.fromEntries(names.map(id => {
    const el = document.getElementById(id), r = el.getBoundingClientRect();
    return [id, { x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName, disabled: !!el.disabled, tabIndex: el.tabIndex }];
  }))).toString()})(${JSON.stringify(ids)})`);
  async function check(width, height, state, ids) {
    await settled();
    const measured = await measure(ids);
    assert.ok(latest?.regions.length, 'renderer published actual content and controls');
    const content = latest.regions.filter(r => r.kind !== 'capture-control' && r.shape.type === 'rect' && r.alpha > 0.02);
    const footer = content.find(r => r.id === 'mark:footnote');
    assert.ok(footer, 'credit text stays present');
    const receipt = { width, height, state, measured, regions: latest.regions, buttons };
    receipts.push(receipt);
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      // Screenshots use scripts/overlay-frames.cjs in separate, fixed-size windows. Keep
      // interactive resize/focus assertions independent of hidden-window capture lifecycles.
      fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(receipts, null, 2));
    }
    for (const id of ids) {
      const r = measured[id];
      assert.ok(r.w >= 44 && r.h >= 28 && r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height, `${id} stays usable and on screen`);
      assert.equal(r.tag, 'BUTTON'); assert.equal(r.disabled, false); assert.ok(r.tabIndex >= 0);
      for (const obstacle of content) assert.equal(overlap(r, obstacle.shape), 0, `${width}x${height} ${id} overlaps ${obstacle.id}`);
      const hit = latest.regions.find(region => region.id === `button:${id}`)?.shape;
      assert.ok(hit, `published hit for ${id}`);
      for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(hit[key] - r[key]) < 0.01, `${id} hit ${key} follows its pixels`);
      const catcher = buttons.find(button => button.id === id);
      assert.ok(catcher); for (const key of ['x', 'y', 'w', 'h']) assert.equal(catcher[key], Math.round(r[key]));
      progress(`${width}x${height} ${state} focus ${id}`);
      await execute(`document.getElementById(${JSON.stringify(id)}).focus()`);
      assert.equal(await execute('document.activeElement.id'), id);
    }
    return measured;
  }
  let token = 0;
  for (const [width, height] of [[960, 640], [640, 360], [1280, 720], [360, 640]]) {
    progress(`${width}x${height} seek`);
    win.setContentSize(width, height);
    win.webContents.send('tt:display', { id: 1, bounds: { x: 0, y: 0, width, height }, scaleFactor: 1, silent: true });
    win.webContents.send('tt:scene', { kind: 'status', status: 'idle' });
    const rendered = new Promise(resolve => ipcMain.once('tt:rendered', resolve));
    win.webContents.send('tt:scene', { kind: 'seek', scene, step: scene.steps.length - 1, t: 99, token: ++token });
    await bounded(rendered, 'seek acknowledgement');
    progress(`${width}x${height} ask`);
    const before = await check(width, height, 'ask', ['ask-more']);
    progress(`${width}x${height} redraw`);
    win.webContents.send('tt:scene', { kind: 'status', status: 'idle' });
    await settled();
    assert.deepEqual(await measure(['ask-more']), before, 'a clear control stays still on redraw');
    progress(`${width}x${height} keyboard`);
    win.webContents.send('tt:scene', { kind: 'press', id: 'ask-more' });
    await settled(); assert.equal(commands.at(-1), 'start');
    // Focus the test window for native keyboard input, rather than merely assigning DOM focus.
    win.show(); win.focus(); win.webContents.focus();
    await execute('document.getElementById("ask-more").focus()');
    await settled();
    const count = commands.length;
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    // sendInputEvent does not synthesize keypress from raw keyDown. A native Enter includes
    // this char event, which is what Chromium uses to activate a focused button.
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await settled();
    assert.equal(commands.length, count + 1, 'a focused native button still activates with Enter');
    assert.equal(commands.at(-1), 'start');
    win.hide();
    progress(`${width}x${height} listening`);
    win.webContents.send('tt:scene', { kind: 'status', status: 'listening' });
    await check(width, height, 'listening', ['send-followup', 'cancel-followup']);
    for (const [id, command] of [['send-followup', 'send'], ['cancel-followup', 'cancel']]) {
      progress(`${width}x${height} press ${id}`);
      win.webContents.send('tt:scene', { kind: 'press', id });
      await settled(); assert.equal(commands.at(-1), command);
    }
    if (width === 360) {
      progress(`${width}x${height} large controls`);
      const css = await win.webContents.insertCSS('#ask-more, #capture-controls button { font-size: 25px !important; }');
      win.webContents.send('tt:scene', { kind: 'status', status: 'listening' });
      await check(width, height, 'large-controls', ['send-followup', 'cancel-followup']);
      await win.webContents.removeInsertedCSS(css);
    }
  }
  console.log('FOLLOWUP_LAYOUT_OK', JSON.stringify(receipts.map(({ width, height, state }) => ({ width, height, state }))));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
