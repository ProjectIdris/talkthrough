// The window behind the consent card (see consent-card.ts). It is an ordinary small window that is never click-through,
// so a click or a tap lands on it with or without a mouse move before it. It never takes focus, shows nothing the page
// could script (no preload, no node), and cannot navigate anywhere: a click on Yes or No is a navigation that main reads
// and stops.

import { BrowserWindow } from 'electron';
import { ANSWER_SCHEME, answerOf, CARD_WINDOW_OPTIONS } from './consent-card.ts';
import type { CardWindow } from './consent-card.ts';

export function electronCardWindow(options: { hideFromCapture: boolean }): CardWindow {
  const window = new BrowserWindow({
    ...CARD_WINDOW_OPTIONS,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  if (options.hideFromCapture) window.setContentProtection(true);
  // No click-through setting here, on purpose: this window must take the click.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let listener: ((yes: boolean) => void) | null = null;
  let wanted = false; // hidden again before the page had loaded: it must not appear then
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    const yes = url.startsWith(ANSWER_SCHEME) ? answerOf(url) : null;
    if (yes !== null) listener?.(yes);
  });
  return {
    show(html, bounds) {
      wanted = true;
      window.setBounds(bounds);
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
        if (wanted && !window.isDestroyed()) window.showInactive();
      });
    },
    hide: () => {
      wanted = false;
      if (!window.isDestroyed()) window.hide();
    },
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
    onAnswer: (l) => void (listener = l),
  };
}
