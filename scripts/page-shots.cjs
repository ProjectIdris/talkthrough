// Development tool: screenshots of real web pages with the exact box of each target element, for
// checking where a model points. Loads each page in a hidden window (nothing appears on any
// screen) and writes <name>.png plus <name>.json (targets on the 0..1000 scale).
//
//   electron scripts/page-shots.cjs <out folder> <targets.json>
//
// targets.json: [{ "name": "wiki-search", "url": "https://...", "question": "Where do I search?",
//                  "selector": "#searchInput", "waitMs": 2500, "hideSelectors": ["#banner"] }]
// A page whose target has no stable selector gives "rect": [x, y, w, h] in pixels instead.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const WIDTH = 1280;
const HEIGHT = 720;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => undefined); // stay alive between pages
// A private profile, so a running copy of the app (or another tool) never shares its caches with this.
app.setPath('userData', require('node:fs').mkdtempSync(join(require('node:os').tmpdir(), 'page-shots-')));
app.whenReady().then(async () => {
  const [out, listPath] = process.argv.slice(process.argv.indexOf('--') >= 0 ? process.argv.indexOf('--') + 1 : 2);
  const list = JSON.parse(readFileSync(listPath, 'utf8'));
  mkdirSync(out, { recursive: true });
  for (const item of list) {
    const window = new BrowserWindow({ show: false, width: WIDTH, height: HEIGHT, useContentSize: true, webPreferences: { sandbox: true, backgroundThrottling: false } });
    try {
      await Promise.race([window.loadURL(item.url), new Promise((_, no) => setTimeout(() => no(new Error('load timeout')), 30000))]);
    } catch (error) {
      console.log(`${item.name}: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, item.waitMs ?? 2500));
    let rect = await window.webContents.executeJavaScript(`(() => {
      for (const s of ${JSON.stringify(item.hideSelectors ?? [])}) for (const e of document.querySelectorAll(s)) e.style.display = 'none';
      const e = ${item.selector ? `document.querySelector(${JSON.stringify(item.selector)})` : 'null'};
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`).catch(() => null);
    await new Promise((r) => setTimeout(r, 300));
    const image = await window.webContents.capturePage();
    writeFileSync(join(out, `${item.name}.png`), image.toPNG());
    const size = image.getSize();
    // A target read off the screenshot by hand: "rect": [x, y, w, h] in pixels.
    if (!rect && item.rect) rect = { x: item.rect[0], y: item.rect[1], w: item.rect[2], h: item.rect[3] };
    const target = rect && rect.w > 0 && rect.h > 0
      ? { x: (rect.x / size.width) * 1000, y: (rect.y / size.height) * 1000, w: (rect.w / size.width) * 1000, h: (rect.h / size.height) * 1000 }
      : null;
    writeFileSync(join(out, `${item.name}.json`), JSON.stringify({ name: item.name, url: item.url, question: item.question, width: size.width, height: size.height, target }, null, 1));
    console.log(`${item.name}: ${size.width}x${size.height} target ${target ? JSON.stringify(target, (k, v) => (typeof v === 'number' ? Math.round(v) : v)) : 'NOT FOUND'}`);
    window.destroy();
  }
  app.exit(0);
});
