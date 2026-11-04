// A web page of our own for the navigation tests (never anyone else's): a navigation bar with links, a link in the
// text, a Save button, tabs and a scroll area, served from this process. Each request it receives is reported as
// `EVENT GET <path>`, so a test can require that Save was never pressed. Run with Electron; it quits by itself.
const { app, BrowserWindow, screen } = require('electron');
const http = require('node:http');
app.disableHardwareAcceleration();
if (process.env.TT_TEST_PROFILE) app.setPath('userData', process.env.TT_TEST_PROFILE); // its own profile, so two pages can run at once

const html = `<!doctype html><title>tt-nav-page</title><body style="margin:0;font:14px sans-serif">
<nav aria-label="Main" style="padding:10px"><a data-t="nav-docs" href="/docs">Docs</a> &nbsp; <a data-t="nav-pricing" href="/pricing">Pricing</a> &nbsp; <a data-t="nav-offsite" href="https://other.example/x">Partner</a> &nbsp; <a data-t="nav-logout" href="/logout">Log out</a></nav>
<p style="padding:0 10px"><a data-t="body-link" href="/body">In the text</a></p>
<div style="padding:0 10px"><button data-t="save" onclick="fetch('/saved')">Save</button> <button data-t="plain" onclick="fetch('/plain')">Plain</button></div>
<div role="tablist" style="padding:10px"><div role="tab" aria-selected="true" tabindex="0" data-t="tab-a" style="display:inline-block;padding:6px 14px;border:1px solid #888">A</div><div role="tab" aria-selected="false" tabindex="0" data-t="tab-b" onclick="fetch('/tab-b')" style="display:inline-block;padding:6px 14px;border:1px solid #888">B</div></div>
<div style="padding:0 10px"><div data-t="tall" style="width:300px;height:60px;border:1px solid #888">some text</div></div>
<div style="height:1800px"></div>
</body>`;

const server = http.createServer((req, res) => {
  console.log('EVENT GET ' + req.url);
  res.setHeader('content-type', 'text/html');
  res.end(req.url === '/' ? html : '<!doctype html><title>other</title><body>another page</body>');
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ x: 160, y: 160, width: 700, height: 520, show: false, skipTaskbar: true, title: 'tt-nav-page', alwaysOnTop: true });
    await win.loadURL(`http://127.0.0.1:${port}/`);
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
    setTimeout(() => { server.close(); app.quit(); }, 40000);
  });
});
