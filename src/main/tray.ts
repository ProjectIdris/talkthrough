import { Menu, nativeImage, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';


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

/** The tray's part of guide navigation: Yes to the question (only while it is asked), and a pause for everything the app does for the person. */
function guideItems(g: NonNullable<Parameters<typeof createTray>[0]['guideActions']>): MenuItemConstructorOptions[] {
  return [
    { type: 'separator' },
    ...(g.asking() ? [{ label: 'Yes, let it open that for me', click: () => g.answer(true) }, { label: 'No, I will do it myself', click: () => g.answer(false) }] : []),
    { label: 'Pause everything it does for me', type: 'checkbox' as const, checked: g.paused(), click: (item) => g.setPaused(item.checked) },
    { type: 'separator' },
  ];
}

export function createTray(handlers: {
  onQuit(): void;
  onPlaySample(): void;
  onClear(): void;
  /** Opens the settings window. */
  onSettings(): void;
  /** The keys held to ask, in words ("Right Ctrl + Right Shift"). */
  hotkeyLabel: string;
  onPin(): void;
  onOpenPins(): void;
  /** Whether a picture of the screen is kept with pins; the tray shows it as a ticked item. */
  pinScreenshot(): boolean;
  onPinScreenshot(on: boolean): void;
  /** Guide mode may act for the person (open a tab, a menu, scroll): a pause for all of it, and the Yes it asks for the first time. */
  guideActions?: { paused(): boolean; setPaused(on: boolean): void; asking(): boolean; answer(yes: boolean): void };
}): Tray & { refresh(): void } {
  const tray = new Tray(trayIcon());
  tray.setToolTip('Talkthrough');
  const build = () => Menu.buildFromTemplate([
      { label: 'Talkthrough', enabled: false },
      { label: `Hold ${handlers.hotkeyLabel} to ask`, enabled: false },
      { type: 'separator' },
      { label: 'Pin this answer', click: handlers.onPin },
      { label: 'Include the screenshot in pins', type: 'checkbox', checked: handlers.pinScreenshot(), click: (item) => { handlers.onPinScreenshot(item.checked); tray.setContextMenu(build()); } },
      { label: 'Open the pins folder', click: handlers.onOpenPins },
      { type: 'separator' },
      ...(handlers.guideActions ? guideItems(handlers.guideActions) : []),
      { label: 'Play a sample scene', click: handlers.onPlaySample },
      { label: 'Clear the overlay', click: handlers.onClear },
      { label: 'Settings…', click: handlers.onSettings },
      { label: 'Quit', click: handlers.onQuit },
    ]);
  tray.setContextMenu(build());
  return Object.assign(tray, { refresh: () => tray.setContextMenu(build()) });
}
