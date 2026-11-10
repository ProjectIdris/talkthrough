// Check, in a hidden off-screen window (nothing on a display, software drawn, no input sent) made with the overlay's window options, that the window's input child (the Chromium window that takes the mouse for the page)
// is shown, and is what the system hands a press at the window's centre, after the window is hidden and shown again. Hiding then showing the old way (showInactive and the same bounds) leaves it hidden: the control
// below must show that, or this check cannot tell right from wrong. Windows only. Run:  node scripts/overlay-reshow-input.cjs   (it starts Electron itself, once for the control and once for the overlay show; exit 0 when the control shows the fault and the shown-again overlay window does not have it).
// Capped at 90 s.
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const OFF = { x: -20000, y: -20000, width: 400, height: 300 };
const probe = (handle) => {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'overlay-reshow-input.ps1'), String(handle), String(OFF.x + OFF.width / 2 + 30000), String(OFF.y + OFF.height / 2 + 30000)], { encoding: 'utf8' });
  const m = /child visible=(\S+) os gives=(\S+)/.exec(r.stdout);
  return m ? { child: m[1], gives: m[2] } : { child: '?', gives: r.stdout.trim() + r.stderr.trim() };
};

if (!process.versions.electron) {
  // The parent: one electron process for each way of showing (a second window in a process fails to load its page here), and the verdict.
  const results = {};
  for (const mode of ['old', 'new']) {
    const r = spawnSync(process.argv0 && /electron/i.test(process.argv0) ? process.argv0 : require('electron'), [__filename, mode], { encoding: 'utf8', timeout: 90000, env: ((e) => { delete e.ELECTRON_RUN_AS_NODE; return e; })({ ...process.env }) });
    const m = /RESULT (\S+) (\S+)/.exec(r.stdout);
    results[mode] = m ? { child: m[1], gives: m[2] } : { child: '?', gives: 'no result' };
    console.log(`${mode === 'old' ? 'control (hide, then showInactive and the same bounds)' : 'overlay show (hide, then showOverlayWindow)'}: input child visible ${results[mode].child}, the system gives ${results[mode].gives} at the centre`);
  }
  const fault = results.old.child === 'n' && results.old.gives === 'TOP-LEVEL';
  const fixed = results.new.child === 'Y' && results.new.gives === 'child';
  console.log(fault ? 'ok: the control shows the fault (the check can tell)' : 'FAIL: the control did not show the fault; this check cannot tell right from wrong here');
  console.log(fixed ? 'ok: the overlay show leaves the input child up and the system gives it the press' : 'FAIL: after the overlay show the input child is not the window that gets the press');
  process.exit(fault && fixed ? 0 : 1);
} else {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  const mode = process.argv[2];
  setTimeout(() => { console.log('RESULT ? cap'); app.exit(2); }, 45000).unref();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The overlay's window options (src/main/overlay-windows.ts), kept off every display.
  app.whenReady().then(async () => {
    const out = path.join(os.tmpdir(), `tt-reshow-${process.pid}.cjs`);
    require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'main', 'overlay-show.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' });
    const { showOverlayWindow } = require(out);
    const w = new BrowserWindow({ ...OFF, show: false, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: true, title: 'reshow check', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true, { forward: true });
    await w.loadURL('data:text/html,<body style="background:red;margin:0">x</body>');
    const handle = () => { const b = w.getNativeWindowHandle(); return b.length === 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)); };
    const show = mode === 'old' ? () => { w.showInactive(); w.setBounds(OFF); } : () => showOverlayWindow(w, OFF);
    show(); w.setIgnoreMouseEvents(false); await sleep(400);
    w.hide(); await sleep(400);
    show(); w.setIgnoreMouseEvents(false); await sleep(600);
    const r = probe(handle());
    console.log(`RESULT ${r.child} ${r.gives}`);
    try { require('fs').rmSync(out, { force: true }); } catch {}
    w.destroy();
    app.exit(0);
  });
}
