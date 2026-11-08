import { Menu, nativeImage, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { TRAY_LINES, trayDotPixels, trayIconPixels } from './tray-state.ts';
import type { TrayState } from './tray-state.ts';


/** The icon for a state, drawn in code (see tray-state.ts) so the app needs no icon file. */
function trayIcon(state: TrayState) {
  const { width, height, data } = trayIconPixels(state);
  return nativeImage.createFromBitmap(data, { width, height });
}

const dotIcon = (state: TrayState) => {
  const { width, height, data } = trayDotPixels(state);
  return nativeImage.createFromBitmap(data, { width, height });
};

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
  /** Browse the offline visual examples. */
  onVisualTour?(): void;
  /** Save the credits file for the 3D models (their licences and who made them) where the person chooses. */
  onCredits?(): void;
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
}): Tray & { refresh(): void; /** Shows what the app is doing: the icon, the first line of the menu and the tip. */ setState(state: TrayState): void } {
  let state: TrayState = 'ready';
  const tray = new Tray(trayIcon(state));
  tray.setToolTip(`Talkthrough: ${TRAY_LINES[state]}`);
  const build = () => Menu.buildFromTemplate([
      { label: TRAY_LINES[state], enabled: false, icon: dotIcon(state) },
      { label: `Hold ${handlers.hotkeyLabel} to ask`, enabled: false },
      { type: 'separator' },
      { label: 'Pin this answer', click: handlers.onPin },
      { label: 'Include the screenshot in pins', type: 'checkbox', checked: handlers.pinScreenshot(), click: (item) => { handlers.onPinScreenshot(item.checked); tray.setContextMenu(build()); } },
      { label: 'Open the pins folder', click: handlers.onOpenPins },
      { type: 'separator' },
      ...(handlers.guideActions ? guideItems(handlers.guideActions) : []),
      ...(handlers.onVisualTour ? [{ label: 'Explore visual examples…', click: handlers.onVisualTour }] : []),
      ...(handlers.onCredits ? [{ label: 'Save the 3D model credits…', click: handlers.onCredits }] : []),
      { label: 'Play a sample scene', click: handlers.onPlaySample },
      { label: 'Clear the overlay', click: handlers.onClear },
      { label: 'Settings…', click: handlers.onSettings },
      { label: 'Quit', click: handlers.onQuit },
    ]);
  tray.setContextMenu(build());
  return Object.assign(tray, {
    refresh: () => tray.setContextMenu(build()),
    setState: (next: TrayState) => {
      if (next === state) return;
      state = next;
      tray.setImage(trayIcon(state));
      tray.setToolTip(`Talkthrough: ${TRAY_LINES[state]}`);
      tray.setContextMenu(build());
    },
  });
}
