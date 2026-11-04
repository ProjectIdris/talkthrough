// Development tool: renders a scene with the overlay page in a hidden, software-rendered Electron
// window and writes PNG frames, so the renderer can be judged without the live overlay.
//
//   npm run build
//   (run it as `env -u ELECTRON_RUN_AS_NODE` if your shell sets that)
//   npx electron scripts/overlay-frames.cjs <scene.json> --out <dir> --steps 0:0.5,1:2 \
//       [--size 1920x1080] [--dpr 1] [--hidden] [--backdrop <image>] [--after <earlier-scene.json>]
//
// --steps is a list of step:seconds pairs (seconds into that step; earlier steps are complete).
// --dpr sets the display scale; offscreen windows always render at 1, so use --hidden (a hidden, non-offscreen window) for dpr other than 1.
// --after plays another scene to its end first, so a follow-up scene can reach its objects.

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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
if (!scenePath || !args.out || !(args.steps || args.play)) {
  console.error('usage: electron scripts/overlay-frames.cjs <scene.json> --out <dir> --steps 0:0.5,1:2 [--size WxH] [--dpr N] [--backdrop img] [--after scene.json]');
  console.error('   or: --play [--every 2] plays the scene in real time (silently) and saves a frame every few seconds until it finishes');
  process.exit(2);
}
const [width, height] = (args.size || '1920x1080').split('x').map(Number);
const dpr = Number(args.dpr || 1);
const root = path.resolve(__dirname, '..');

app.disableHardwareAcceleration();
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
  win.webContents.on('paint', (_e, _dirty, image) => { latest = image; });
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
  await win.loadFile(path.join(root, 'dist', 'overlay', 'index.html'));
  await ready;
  console.log('page devicePixelRatio:', await win.webContents.executeJavaScript('window.devicePixelRatio'));
  console.log('WebGL renderer:', await win.webContents.executeJavaScript(`(() => { const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return 'none'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`));
  win.webContents.send(CHANNEL.display, {
    id: 1, bounds: { x: 0, y: 0, width, height }, scaleFactor: dpr,
    backdrop: args.backdrop ? pathToFileURL(path.resolve(args.backdrop)).href : undefined,
  });
  let token = 0;
  const seek = async (scene, step, t, name) => {
    const mine = ++token;
    const done = new Promise((r) => pending.set(mine, r));
    win.webContents.send(CHANNEL.scene, { kind: 'seek', scene, step, t, token: mine });
    await Promise.race([done, sleep(10000).then(() => { throw new Error('no frame painted for ' + name); })]);
    await sleep(120);
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
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
