// Check: our windows are out of our own screenshot and in everything else. It needs a visible screen: it puts four patches of known colour on the
// primary display for under a minute (windows of the same kinds as the overlay, the button catcher and the consent card, made by the app's own window
// code and registered with the app's own capture shield), then takes the app's own capture (the same hidden page, the same screen source) both ways.
//
//   npm run build                                  (the capture page and its preload come from dist/)
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/capture-check.cjs [--out <dir>] [--trials 12] [--software yes] [--dry yes]
//
// Phases, each judged by the share of a patch's pixels that are its colour in the captured picture:
//   A  an ordinary capture (no shield): every patch is in it.                                  (the windows are in a recording)
//   B  a capture through the shield: no patch is in it.                                        (the windows are out of our screenshot)
//   C  an ordinary capture right after B: every patch is back.                                 (the protection is off again)
//   D  two captures asked for together: both without a patch, and every patch back after.      (serialized; one cannot lower it under the other)
//   E  a shield that is not enabled (--visible-to-capture): the patches are in the capture.
//   G  a hidden overlay window shown during a capture through the shield: not in it.           (the idle-hide window shown mid-capture)
//   F  how long to wait: for each wait in a list, `--trials` captures through a shield with that wait, from a clean start each time. The least wait with no
//      patch in any capture of that wait or a longer one is printed with the figure built into the app (SETTLE_MS in src/main/capture-shield.ts).
// Exit code 0 when A, B, C, D, E, G pass and the built-in wait lost no trial; 1 otherwise. Frames of the first failure of each phase, and one of A and B,
// are written to --out so they can be looked at. --dry yes runs the same steps over stand-ins (no window, no capture, nothing on the screen) to check the
// script itself.
//
// Not covered: the real overlay page (this uses windows with the overlay's flags and a patch for a page) and the capture of a video playing behind the
// overlay (look at that by hand: a recording of a video with Talkthrough running should show the video, and the overlay).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { share, toPicture, leastSafeWait } = require('./capture-check-pixels.cjs');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
  return args;
}
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '..');
const dry = args.dry === 'yes';
const trials = Number(args.trials || 12);
const SWEEP = [0, 4, 8, 16, 25, 33, 50, 100];
const out = args.out ? path.resolve(args.out) : path.join(os.tmpdir(), `capture-check-${Date.now()}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const electron = require('electron');
const { app, BrowserWindow, dialog, screen, nativeImage } = electron;
dialog.showErrorBox = () => undefined;
if (args.software === 'yes') app.disableHardwareAcceleration();
// A profile of its own, taken away at the end, so the check leaves nothing in the app's data folder.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-check-profile-'));
app.setPath('userData', profile);
process.on('uncaughtException', (e) => { console.error(e); app.exit(2); });

// The app's own window code and capture, built from source into a temporary file.
function buildApp() {
  const esbuild = require('esbuild');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-check-build-'));
  const entry = path.join(dir, 'entry.ts');
  const q = (p) => JSON.stringify(p.split(path.sep).join('/'));
  fs.writeFileSync(entry, [
    `export { createCaptureShield, SETTLE_MS } from ${q(path.join(root, 'src/main/capture-shield.ts'))};`,
    `export { createMedia } from ${q(path.join(root, 'src/main/media.ts'))};`,
    `export { electronCatcherWindow } from ${q(path.join(root, 'src/main/button-window.ts'))};`,
    `export { electronCardWindow } from ${q(path.join(root, 'src/main/consent-window.ts'))};`,
  ].join('\n'));
  const file = path.join(dir, 'app.cjs');
  esbuild.buildSync({ entryPoints: [entry], outfile: file, bundle: true, platform: 'node', format: 'cjs', target: 'es2023', external: ['electron', 'uiohook-napi', 'get-windows'], logLevel: 'warning' });
  return { module: require(file), dir };
}

const PATCH = 300; // device-independent pixels, square
function patches(display) {
  const y = display.bounds.y + 120;
  const x = (k) => display.bounds.x + 120 + k * (PATCH + 40);
  return [
    { name: 'overlay-like window', rgb: [255, 0, 255], rect: { x: x(0), y, w: PATCH, h: PATCH } },
    { name: 'button catcher', rgb: [0, 255, 255], rect: { x: x(1), y, w: PATCH, h: PATCH } },
    { name: 'consent card', rgb: [255, 255, 0], rect: { x: x(2), y, w: PATCH, h: PATCH } },
    { name: 'overlay window shown during a capture', rgb: [0, 255, 0], rect: { x: x(3), y, w: PATCH, h: PATCH } },
  ];
}
const pageOf = (rgb) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:rgb(${rgb.join(',')})">`;

// ---- the real thing: windows on the screen, the app's own capture ------------------------------------------------------------------------------------
function realEnvironment(built, shield, display) {
  const { createMedia, electronCatcherWindow, electronCardWindow } = built;
  const list = patches(display);
  const bounds = (p) => ({ x: p.rect.x, y: p.rect.y, width: p.rect.w, height: p.rect.h });
  // The overlay's own flags (src/main/overlay-windows.ts): transparent, frameless, never focused, topmost at the screen-saver level, clicks pass through.
  const overlay = new BrowserWindow({
    ...bounds(list[0]), show: false, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, title: 'capture check overlay',
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.on('closed', shield.add(overlay));
  const late = new BrowserWindow({
    ...bounds(list[3]), show: false, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, title: 'capture check late overlay',
  });
  late.setAlwaysOnTop(true, 'screen-saver');
  late.setIgnoreMouseEvents(true, { forward: true });
  late.on('closed', shield.add(late));
  const catcher = electronCatcherWindow({ shield });
  const card = electronCardWindow({ shield });
  const media = createMedia({ preload: path.join(root, 'dist/main/audio-preload.cjs'), page: path.join(root, 'dist/audio/index.html') });
  const edge = Math.max(Math.round(display.size.width * display.scaleFactor), Math.round(display.size.height * display.scaleFactor));
  return {
    list,
    async show() {
      await overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageOf(list[0].rgb))}`);
      await late.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pageOf(list[3].rgb))}`);
      overlay.showInactive();
      catcher.show(pageOf(list[1].rgb), bounds(list[1]));
      card.show(pageOf(list[2].rgb), bounds(list[2]));
      await media.warm();
      await sleep(1500); // painted, composed and settled
    },
    showLate: () => late.showInactive(),
    hideLate: () => late.hide(),
    /** One capture of the display, in full resolution. `settled` is what a shield hands the capture. */
    async capture(settled) {
      const c = await media.capture(display, edge, settled);
      const image = nativeImage.createFromBuffer(Buffer.from(c.screenshot.base64, 'base64'));
      const size = image.getSize();
      return { width: size.width, height: size.height, data: image.toBitmap(), ms: c.ms, png: Buffer.from(c.screenshot.base64, 'base64') };
    },
    close() {
      catcher.destroy(); card.destroy();
      if (!overlay.isDestroyed()) overlay.destroy();
      if (!late.isDestroyed()) late.destroy();
    },
  };
}

// ---- --dry: the same steps over stand-ins (nothing on the screen, nothing captured) ----------------------------------------------------------------
function dryEnvironment(shield, display) {
  const list = patches(display);
  const make = (name) => {
    const w = { name, prot: false, visible: false, destroyed: false, setContentProtection(on) { w.prot = on; }, isVisible: () => w.visible, isDestroyed: () => w.destroyed };
    shield.add(w);
    return w;
  };
  const windows = [make('o'), make('c'), make('k'), make('late')];
  const width = Math.round(display.bounds.width), height = Math.round(display.bounds.height);
  return {
    list,
    async show() { windows[0].visible = windows[1].visible = windows[2].visible = true; },
    showLate: () => { windows[3].visible = true; },
    hideLate: () => { windows[3].visible = false; },
    async capture(settled) {
      await settled; // a real capture reads after the wait
      const data = Buffer.alloc(width * height * 4, 40);
      list.forEach((p, i) => {
        if (!windows[i].visible || windows[i].prot) return;
        for (let y = p.rect.y - display.bounds.y; y < p.rect.y - display.bounds.y + p.rect.h; y++) {
          for (let x = p.rect.x - display.bounds.x; x < p.rect.x - display.bounds.x + p.rect.w; x++) {
            const j = (y * width + x) * 4;
            data[j] = p.rgb[2]; data[j + 1] = p.rgb[1]; data[j + 2] = p.rgb[0]; data[j + 3] = 255;
          }
        }
      });
      return { width, height, data, ms: 1, png: Buffer.alloc(0) };
    },
    close() {},
  };
}

async function main() {
  if (!dry) {
    for (const file of ['dist/main/audio-preload.cjs', 'dist/audio/index.html']) {
      if (!fs.existsSync(path.join(root, file))) throw new Error(`${file} is missing: run "npm run build" first`);
    }
  }
  fs.mkdirSync(out, { recursive: true });
  const display = screen.getPrimaryDisplay();
  const built = buildApp();
  const { createCaptureShield, SETTLE_MS } = built.module;
  // The wait is the app's own unless the sweep (F) sets another: the windows are registered with this one shield, so only its wait changes.
  let sweepWait = null;
  const shield = createCaptureShield({ enabled: true, wait: (ms) => sleep(sweepWait === null ? ms : sweepWait), log: (line) => console.log(`  [app] ${line}`) });
  const env = dry ? dryEnvironment(shield, display) : realEnvironment(built.module, shield, display);

  const results = [];
  const frames = [];
  const judge = (phase, what, picture, want, hidden = []) => {
    // want: 'in' (the patch is in the picture) or 'out'; `hidden` names patches expected absent whatever the phase (a window not shown).
    const bad = [];
    const shares = env.list.map((p, i) => {
      const s = share(picture, toPicture(p.rect, display, picture), p.rgb);
      const expected = hidden.includes(i) ? 'out' : want;
      const ok = expected === 'in' ? s >= 0.9 : s <= 0.02;
      if (!ok) bad.push(`${p.name} ${Math.round(s * 100)}% (wanted ${expected === 'in' ? 'present' : 'absent'})`);
      return Math.round(s * 1000) / 1000;
    });
    results.push({ phase, what, ok: bad.length === 0, shares, bad });
    console.log(`${bad.length === 0 ? 'PASS' : 'FAIL'}  ${phase}  ${what}${bad.length ? `\n        ${bad.join('\n        ')}` : ''}`);
    if (picture.png.length && (bad.length || phase === 'A' || phase === 'B')) frames.push([`${phase}${bad.length ? '-FAILED' : ''}`, picture.png]);
    return bad.length === 0;
  };
  const through = (sd = shield) => sd.around((settled) => env.capture(settled));

  await env.show();
  const late = 3; // the window shown only during a capture is not up in the other phases
  judge('A', 'an ordinary capture has every patch', await env.capture(Promise.resolve()), 'in', [late]);
  judge('B', 'a capture through the shield has no patch', await through(), 'out');
  await sleep(300);
  judge('C', 'an ordinary capture right after has every patch again', await env.capture(Promise.resolve()), 'in', [late]);
  const [d1, d2] = await Promise.all([through(), through()]);
  judge('D', 'two captures asked for together: the first has no patch', d1, 'out');
  judge('D', 'two captures asked for together: the second has no patch', d2, 'out');
  await sleep(300);
  judge('D', 'and after both, every patch is back', await env.capture(Promise.resolve()), 'in', [late]);
  const visibleOnly = createCaptureShield({ enabled: false });
  judge('E', 'a shield that is not enabled (--visible-to-capture) leaves the patches in', await through(visibleOnly), 'in', [late]);
  const g = await shield.around(async (settled) => { env.showLate(); return env.capture(settled); });
  judge('G', 'an overlay window shown during a capture through the shield is not in it', g, 'out');
  env.hideLate();
  await sleep(300);

  // F: how long to wait.
  console.log(`F  ${trials} captures for each wait, from a clean start each time (the built-in wait is ${SETTLE_MS} ms)`);
  const failures = {};
  const timing = {};
  for (const settleMs of SWEEP) {
    sweepWait = settleMs;
    failures[settleMs] = 0;
    timing[settleMs] = [];
    for (let k = 0; k < trials; k++) {
      await sleep(250); // the windows are back in the picture and the screen has settled
      const t0 = Date.now();
      const picture = await through();
      timing[settleMs].push(Date.now() - t0);
      const bad = env.list.some((p, i) => i !== late && share(picture, toPicture(p.rect, display, picture), p.rgb) > 0.02);
      if (bad) {
        failures[settleMs]++;
        if (picture.png.length && failures[settleMs] === 1) frames.push([`F-wait-${settleMs}ms-trial-${k}`, picture.png]);
      }
    }
    console.log(`     wait ${String(settleMs).padStart(3)} ms: ${failures[settleMs]} of ${trials} captures showed a window`);
  }
  sweepWait = null;
  const least = leastSafeWait(failures);
  const builtIn = failures[SETTLE_MS];
  console.log(`     least wait after which no capture showed a window: ${least === null ? 'none of those tried' : `${least} ms`}; the built-in ${SETTLE_MS} ms ${builtIn === 0 ? 'passes' : builtIn === undefined ? 'was not in the list' : `lost ${builtIn} of ${trials}`}`);
  results.push({ phase: 'F', what: `least safe wait ${least} ms, built-in ${SETTLE_MS} ms`, ok: least !== null && (builtIn === 0 || builtIn === undefined), failures, least, builtIn: SETTLE_MS });

  for (const [name, png] of frames) fs.writeFileSync(path.join(out, `${name}.png`), png);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ when: new Date().toISOString(), dry, display: { size: display.size, scaleFactor: display.scaleFactor }, results }, null, 2));
  env.close();
  fs.rmSync(built.dir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? 'ALL PASSED' : `${failed.length} FAILED: ${failed.map((r) => r.phase).join(', ')}`}   (result.json${frames.length ? ' and frames' : ''} in ${out})`);
  return failed.length === 0 ? 0 : 1;
}

// Chromium still holds files in its profile until the process ends, so a small helper takes the folder away just after.
const finish = (code) => {
  try {
    const helper = require('node:child_process').spawn(process.execPath, ['-e', `setTimeout(() => require('node:fs').rmSync(${JSON.stringify(profile)}, { recursive: true, force: true }), 4000)`], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    helper.unref();
  } catch { /* the folder stays in the temporary folder */ }
  app.exit(code);
};
app.whenReady().then(main).then(finish, (error) => { console.error(error); finish(2); });
