import { Menu, nativeImage, Tray } from 'electron';

/** A 32x32 filled disc, drawn in code so the app needs no icon file yet. */
function trayIcon() {
  const size = 32;
  const buffer = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const o = (y * size + x) * 4;
      const inside = d <= 14;
      // BGRA, a teal disc with a soft edge
      buffer[o] = 200; buffer[o + 1] = 170; buffer[o + 2] = 20;
      buffer[o + 3] = inside ? 255 : d <= 15 ? Math.round(255 * (15 - d)) : 0;
    }
  }
  return nativeImage.createFromBitmap(buffer, { width: size, height: size });
}

export function createTray(handlers: { onQuit(): void; onPlaySample(): void }): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Talkthrough');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Talkthrough', enabled: false },
      { label: 'Hold Right Ctrl + Right Shift to ask', enabled: false },
      { type: 'separator' },
      { label: 'Play a sample scene', click: handlers.onPlaySample },
      { label: 'Quit', click: handlers.onQuit },
    ]),
  );
  return tray;
}
