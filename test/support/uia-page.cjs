// A test window of our own for main-uia.test.ts: an Electron page with real HTML controls (the kind of window a web
// page is). Prints READY, its window handle and where each control is in screen pixels; quits by itself.
const { app, BrowserWindow, screen } = require('electron');
app.disableHardwareAcceleration();
const html = `<body style="margin:0;font:14px sans-serif">
<div style="padding:20px"><button data-t="button" style="width:110px;height:36px">One</button>
<button data-t="button" style="width:110px;height:36px;margin-left:20px">Two</button></div>
<div style="padding:0 20px"><input data-t="edit" style="width:300px;height:26px"></div>
<div role="tablist" style="padding:20px"><div role="tab" tabindex="0" data-t="tabitem" style="display:inline-block;padding:8px 18px;border:1px solid #888">Alpha</div><div role="tab" tabindex="0" data-t="tabitem" style="display:inline-block;padding:8px 18px;border:1px solid #888">Beta</div></div>
<div style="padding:0 20px"><a href="#x" data-t="hyperlink">a link</a></div></body>`;
app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: 160, y: 160, width: 700, height: 360, show: false, skipTaskbar: true, title: 'tt-uia-electron' });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  win.showInactive();
  setTimeout(async () => {
    const rects = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify([...document.querySelectorAll('[data-t]')].map(e => { const r = e.getBoundingClientRect(); return [e.dataset.t, r.x, r.y, r.width, r.height]; }))`));
    const cb = win.getContentBounds();
    const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
    const out = rects.map(([t, x, y, w, h]) => {
      const p = screen.dipToScreenPoint({ x: cb.x + x, y: cb.y + y });
      const q = screen.dipToScreenPoint({ x: cb.x + x + w, y: cb.y + y + h });
      return [t, p.x, p.y, q.x - p.x, q.y - p.y].join(',');
    });
    console.log('READY ' + hwnd + ' ' + out.join(';'));
  }, 1200);
  setTimeout(() => app.quit(), 30000);
});
