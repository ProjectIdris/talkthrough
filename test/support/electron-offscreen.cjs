// The `electron` module as the desktop test fixtures see it: the same module, except that every BrowserWindow is made where nobody works.
// A window made here starts off every display, is never given focus, has no taskbar entry, and is shown without being activated (so it still
// paints, which is what the checks need; it needs the occlusion switch the fixture sets). Every sample of its place is kept, so a fixture can prove afterwards that no window was ever on a
// display or took focus. Only test fixtures are built against this file (the check is at the end of test/support/visual-tour-window.ts).
const real = require('electron');

const AWAY = -30000;
const seen = new Set();
const log = { windows: 0, samples: 0, onDisplay: 0, focused: 0, worst: [] };

class OffscreenWindow extends real.BrowserWindow {
  constructor(options = {}) {
    const wantsShown = options.show !== false;
    super({ ...options, x: AWAY, y: AWAY, show: false, focusable: false, skipTaskbar: true, center: false });
    seen.add(this);
    log.windows++;
    if (wantsShown) this.showInactive();
  }

  // The real list is of the windows the module itself made; these are subclass instances, so keep the list here.
  static getAllWindows() { return [...seen].filter((w) => !w.isDestroyed()); }
}

/** Looks at every live window once: records it if it touches a display, has focus, or is in the taskbar. */
function sample() {
  const displays = real.screen.getAllDisplays().map((d) => d.bounds);
  for (const w of seen) {
    if (w.isDestroyed()) { seen.delete(w); continue; }
    const b = w.getBounds();
    log.samples++;
    const touches = displays.some((d) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
    if (touches) { log.onDisplay++; if (log.worst.length < 5) log.worst.push({ bounds: b }); }
    if (w.isFocused()) log.focused++;
  }
}
let timer;
real.app.whenReady().then(() => { sample(); timer = setInterval(sample, 10); timer.unref?.(); });

const exported = {};
for (const key of Object.keys(real).filter((k) => k !== 'BrowserWindow')) Object.defineProperty(exported, key, { enumerable: true, get: () => real[key] });
Object.defineProperty(exported, 'BrowserWindow', { enumerable: true, value: OffscreenWindow });
Object.defineProperty(exported, 'windowWatch', { enumerable: false, value: () => { sample(); return { ...log }; } });
module.exports = exported;
