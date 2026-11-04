// Development tool: renders a scene with the overlay page in a hidden, software-rendered Electron
// window and writes PNG frames, so the renderer can be judged without the live overlay.
//
//   npm run build
//   (run it as `env -u ELECTRON_RUN_AS_NODE` if your shell sets that)
//   npx electron scripts/overlay-frames.cjs <scene.json> --out <dir> --steps 0:0.5,1:2 \
//       [--size 1920x1080] [--dpr 1] [--hidden] [--backdrop <image>] [--controls <boxes.json>] [--after <earlier-scene.json>] \n//       [--tier low|mid|high] [--gpu yes] [--clean yes] [--metrics yes] [--hold <ms>]
//
// --steps is a list of step:seconds pairs (seconds into that step; earlier steps are complete).
// --dpr sets the display scale; offscreen windows always render at 1, so use --hidden (a hidden, non-offscreen window) for dpr other than 1.
// --after plays another scene to its end first, so a follow-up scene can reach its objects.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A scratch run must never put an error dialog on someone's screen.
dialog.showErrorBox = () => undefined;
process.on('uncaughtException', (e) => {
  console.error(e);
  app.exit(1);
});

const CHANNEL = { display: 'tt:display', scene: 'tt:scene', ready: 'tt:ready', interactive: 'tt:interactive', rendered: 'tt:rendered', done: 'tt:done' };

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const scenePath = args._[0];
if (!scenePath || !args.out || !(args.steps || args.play || args.schedule || args.pen)) {
  console.error('usage: electron scripts/overlay-frames.cjs <scene.json> --out <dir> --steps 0:0.5,1:2 [--size WxH] [--dpr N] [--backdrop img] [--after scene.json]');
  console.error('   or: --schedule frames.json renders every frame of a clip plan (see scripts/clip-schedule.ts) as f00001.png, f00002.png, ...');
  console.error('   or: --pen "x,y;x,y;..." (0..1000) turns the pen on, drags it through the points with real mouse events, saves pen-1.png (with --keys-first yes the keys come up before the button, then a second short stroke is drawn), then ends the answer and saves pen-2.png after the fade');
  console.error('   or: --play [--every 2] plays the scene in real time (silently) and saves a frame every few seconds until it finishes');
  process.exit(2);
}
const [width, height] = (args.size || '1920x1080').split('x').map(Number);
const dpr = Number(args.dpr || 1);
const root = path.resolve(__dirname, '..');

// The graphics card is used only when asked for (--gpu); the default is software rendering, which is what runs without one.
if (!args.gpu) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', String(dpr));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(args.out, { recursive: true });
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'overlay-frames-preload.cjs'), offscreen: !args.hidden, contextIsolation: true, sandbox: true },
  });
  // Offscreen windows paint at the device scale; capturePage would hand back the DIP-sized image.
  let latest = null;
  let painted = 0;
  win.webContents.on('paint', (_e, _dirty, image) => { latest = image; painted++; });
  // The next paint after now (a frame of a clip must not be the one before it).
  const freshPaint = async () => {
    if (args.hidden) return capture();
    const before = painted;
    for (let tries = 0; tries < 40 && painted === before; tries++) {
      win.webContents.invalidate();
      await sleep(50);
    }
    return latest;
  };
  const capture = async () => {
    win.webContents.invalidate();
    await sleep(250);
    if (args.hidden) { const img = await win.webContents.capturePage(); return { toPNG: () => img.toPNG({ scaleFactor: dpr }), getSize: () => img.getSize() }; }
    return latest || win.webContents.capturePage();
  };
  win.webContents.on('console-message', (_e, _level, message) => console.log('[page]', message));
  const ready = new Promise((resolve) => ipcMain.once(CHANNEL.ready, resolve));
  const pending = new Map();
  ipcMain.on(CHANNEL.rendered, (_e, token) => pending.get(token)?.());
  fs.mkdirSync(path.join(root, 'dist', 'overlay'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src', 'overlay', 'index.html'), path.join(root, 'dist', 'overlay', 'index.html'));
  const query = {};
  if (args.tier) query.tier = args.tier;
  await win.loadFile(path.join(root, 'dist', 'overlay', 'index.html'), { query });
  await ready;
  // --clean yes: the app's own Explode and Cut buttons are left out of the picture (for clips and stills of the scene alone).
  if (args.clean) await win.webContents.insertCSS('#explode, #cut { display: none !important; }');
  console.log('page devicePixelRatio:', await win.webContents.executeJavaScript('window.devicePixelRatio'));
  console.log('WebGL renderer:', await win.webContents.executeJavaScript(`(() => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'none'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`));
  win.webContents.send(CHANNEL.display, {
    id: 1, bounds: { x: 0, y: 0, width, height }, scaleFactor: dpr,
    backdrop: args.backdrop ? pathToFileURL(path.resolve(args.backdrop)).href : undefined,
  });
  // --controls <json>: the real controls of the window in the backdrop, boxes on the 0..1000 scale (see src/main/uia.ts), as the main process would send them.
  if (args.controls) {
    await sleep(400);
    win.webContents.send(CHANNEL.scene, { kind: 'controls', boxes: JSON.parse(fs.readFileSync(args.controls, 'utf8')) });
    await sleep(100);
  }
  let token = 0;
  const seek = async (scene, step, t, name) => {
    const mine = ++token;
    const done = new Promise((r) => pending.set(mine, r));
    win.webContents.send(CHANNEL.scene, { kind: 'seek', scene, step, t, token: mine });
    await Promise.race([done, sleep(10000).then(() => { throw new Error('no frame painted for ' + name); })]);
    await sleep(120 + Number(args.hold || 0)); // --hold <ms>: wait longer so tags that glide or fade in real time have arrived
    const image = await capture();
    const file = path.join(args.out, name + '.png');
    fs.writeFileSync(file, image.toPNG());
    const size = image.getSize();
    console.log('wrote', file, size.width + 'x' + size.height);
  };
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  if (args.play) {
    win.webContents.setAudioMuted(true);
    const finished = new Promise((r) => ipcMain.once(CHANNEL.done, r));
    const every = Number(args.every || 2) * 1000;
    const started = Date.now();
    win.webContents.send(CHANNEL.scene, { kind: 'play', scene, turn: 1 });
    let n = 0;
    let over = false;
    finished.then(() => { over = true; });
    while (!over && Date.now() - started < 120000) {
      await Promise.race([finished, sleep(every)]);
      const image = await capture();
      const file = path.join(args.out, path.basename(scenePath, '.json') + '-play-' + String(++n).padStart(2, '0') + '.png');
      fs.writeFileSync(file, image.toPNG());
      console.log('wrote', file, 'at', ((Date.now() - started) / 1000).toFixed(1) + 's', over ? '(done)' : '');
    }
    console.log(over ? 'finished after ' + ((Date.now() - started) / 1000).toFixed(1) + 's' : 'did not finish');
    app.quit();
    return;
  }
  if (args.pen) {
    const strokes = [];
    ipcMain.on('tt:stroke', (_e, piece) => strokes.push(piece));
    const pts = args.pen.split(';').map((p) => p.split(',').map(Number));
    const px = (p) => ({ x: Math.round((p[0] / 1000) * width), y: Math.round((p[1] / 1000) * height) });
    win.webContents.send(CHANNEL.scene, { kind: 'pen', on: true });
    await sleep(300);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...px(pts[0]), button: 'left', clickCount: 1 });
    for (const p of pts.slice(1)) {
      win.webContents.sendInputEvent({ type: 'mouseMove', ...px(p), button: 'left', modifiers: ['leftButtonDown'] });
      await sleep(40);
    }
    const last = px(pts[pts.length - 1]);
    if (args['keys-first'] === 'yes') {
      // The keys come up while the button is still down; the button goes up afterwards, then the pen goes on again for a short second stroke.
      win.webContents.send(CHANNEL.scene, { kind: 'pen', on: false });
      await sleep(150);
      win.webContents.sendInputEvent({ type: 'mouseUp', ...last, button: 'left', clickCount: 1 });
      await sleep(100);
      win.webContents.send(CHANNEL.scene, { kind: 'pen', on: true });
      await sleep(200);
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 200, y: 200, button: 'left', clickCount: 1 });
      for (const [x, y] of [[260, 230], [330, 260], [400, 300]]) {
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] });
        await sleep(40);
      }
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 400, y: 300, button: 'left', clickCount: 1 });
      await sleep(100);
    } else {
      win.webContents.sendInputEvent({ type: 'mouseUp', ...last, button: 'left', clickCount: 1 });
      await sleep(100);
    }
    win.webContents.send(CHANNEL.scene, { kind: 'pen', on: false });
    await sleep(300);
    fs.writeFileSync(path.join(args.out, 'pen-1.png'), (await capture()).toPNG());
    win.webContents.send(CHANNEL.scene, { kind: 'end' });
    await sleep(1200);
    fs.writeFileSync(path.join(args.out, 'pen-2.png'), (await capture()).toPNG());
    console.log('strokes reported:', JSON.stringify(strokes.map((p) => ({ id: p.id, points: p.points.length, done: p.done }))));
    app.quit();
    return;
  }
  if (args.schedule) {
    const plan = JSON.parse(fs.readFileSync(args.schedule, 'utf8'));
    const started = Date.now();
    for (let i = 0; i < plan.frames.length; i++) {
      const [step, t] = plan.frames[i];
      const mine = ++token;
      const done = new Promise((r) => pending.set(mine, r));
      win.webContents.send(CHANNEL.scene, { kind: 'seek', scene, step, t, token: mine });
      await Promise.race([done, sleep(10000).then(() => { throw new Error('no frame painted for ' + i); })]);
      const image = await freshPaint();
      fs.writeFileSync(path.join(args.out, 'f' + String(i + 1).padStart(5, '0') + '.png'), image.toPNG());
      if (i % 30 === 29) console.log('frame', i + 1, 'of', plan.frames.length, ((Date.now() - started) / 1000).toFixed(0) + 's');
    }
    console.log('wrote', plan.frames.length, 'frames,', plan.fps, 'fps,', plan.seconds.toFixed(2), 's');
    app.quit();
    return;
  }
  const label = path.basename(scenePath, '.json');
  let base = null;
  if (args.after) {
    base = JSON.parse(fs.readFileSync(args.after, 'utf8'));
    // A follow-up is drawn after its first scene: seek treats the pair as one scene.
    scene.steps = base.steps.concat(scene.steps);
  }
  const offset = base ? base.steps.length : 0;
  for (const pair of args.steps.split(',')) {
    const [s, t] = pair.split(':').map(Number);
    await seek(scene, s + offset, t, `${label}-s${s}-t${String(t).replace('.', '_')}`);
  }
  // --metrics yes: what the graphics card process and the page hold after the last frame, and the time the steps took.
  if (args.metrics) {
    for (const m of app.getAppMetrics()) {
      if (m.type === 'GPU' || m.type === 'Tab') console.log('metrics', m.type, 'working set', Math.round(m.memory.workingSetSize / 1024), 'MB', 'private', Math.round((m.memory.privateBytes || 0) / 1024), 'MB');
    }
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) await seek(scene, 1 + offset, 1 + (i % 4) * 0.5, `bench`);
    console.log('metrics 20 seeks', Date.now() - t0, 'ms');
  }
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
