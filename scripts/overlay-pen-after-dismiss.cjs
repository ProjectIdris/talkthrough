// Check, in a hidden (never shown, software-drawn) window with the real overlay page and real mouse events, that the pen still draws after a click on
// the background dismissed an answer, and that a background press whose release never came does not turn the pen's button-up into a dismissal.
// No window is shown and nothing is sent to the system. Run:  electron scripts/overlay-pen-after-dismiss.cjs   (after `node scripts/build.mjs`)
// Exit 0 when every scenario passes; every run is capped at 100 s.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const W = 1600, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();
setTimeout(() => { console.log('FAIL: the check did not finish in 100 s'); app.exit(3); }, 100000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false, frame: false, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'overlay-pen-after-dismiss-preload.cjs'), offscreen: true, contextIsolation: true, sandbox: true },
  });
  win.webContents.setAudioMuted(true);
  const seen = { strokes: [], followups: [], held: [] };
  ipcMain.on('tt:stroke', (_e, p) => seen.strokes.push(p));
  ipcMain.on('tt:pointer-held', (_e, on) => seen.held.push(on));
  ipcMain.on('tt:followup', (_e, c) => { seen.followups.push(c); if (c === 'dismiss') win.webContents.send('tt:scene', { kind: 'dismiss' }); });
  const ready = () => new Promise((r) => ipcMain.once('tt:ready', r));
  const scene = JSON.parse(fs.readFileSync(path.join(root, 'samples', 'scenes', 'continuous-surfaces.json'), 'utf8'));
  const px = (x, y) => ({ x: Math.round(x / 1000 * W), y: Math.round(y / 1000 * H) });
  const ev = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, ...px(x, y), ...extra });
  const down = (x, y) => ev('mouseDown', x, y, { button: 'left', clickCount: 1 });
  const up = (x, y) => ev('mouseUp', x, y, { button: 'left', clickCount: 1 });
  const click = async (x, y, hold = 80) => { ev('mouseMove', x, y); await sleep(30); down(x, y); await sleep(hold); up(x, y); await sleep(100); };
  const circle = async (attemptId) => {
    seen.strokes = [];
    win.webContents.send('tt:scene', { kind: 'pen', on: true, attemptId }); await sleep(250);
    const pts = []; for (let i = 0; i <= 24; i++) pts.push([500 + 150 * Math.cos(i / 24 * 6.283), 500 + 150 * Math.sin(i / 24 * 6.283)]);
    down(...pts[0]);
    for (const p of pts.slice(1)) { ev('mouseMove', ...p, { button: 'left', modifiers: ['leftButtonDown'] }); await sleep(25); }
    up(...pts[24]); await sleep(100);
    win.webContents.send('tt:scene', { kind: 'pen', on: false, attemptId }); await sleep(300);
    return seen.strokes.reduce((n, s) => n + s.points.length, 0);
  };
  const fresh = async () => {
    const loaded = ready();
    await win.loadFile(path.join(root, 'dist', 'overlay', 'index.html'));
    await loaded;
    win.webContents.send('tt:display', { id: 1, bounds: { x: 0, y: 0, width: W, height: H }, scaleFactor: 1 });
    seen.followups = []; seen.held = [];
    win.webContents.send('tt:scene', { kind: 'play', scene, turn: 1 });
    await sleep(4500); // the answer is up and the page says so
  };

  const scenarios = {
    'a click on the background, then the pen': async () => { await click(20, 500); await sleep(500); return { dismissed: 1 }; },
    'a press on the model and a click on the background, then the pen': async () => { await click(394, 422, 200); await click(20, 500); await sleep(500); return { dismissed: 1 }; },
    'a background press whose release never came, then the pen': async () => { ev('mouseMove', 20, 500); await sleep(30); down(20, 500); await sleep(300); return { dismissed: 0 }; },
  };
  let failed = 0;
  for (const [name, before] of Object.entries(scenarios)) {
    await fresh();
    const { dismissed } = await before();
    const dismissalsBefore = seen.followups.filter((c) => c === 'dismiss').length;
    const points = await circle(2);
    const dismissalsDuring = seen.followups.filter((c) => c === 'dismiss').length - dismissalsBefore;
    const ok = points > 0 && dismissalsBefore === dismissed && dismissalsDuring === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}: ${points} stroke points reached the program; ${dismissalsBefore} dismissal(s) before the pen (expected ${dismissed}), ${dismissalsDuring} while it drew (expected 0)`);
  }
  app.exit(failed ? 1 : 0);
});
