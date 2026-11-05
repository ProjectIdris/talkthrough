// Preload for scripts/overlay-frames.cjs: the same window.talkthrough surface the real preload
// gives the overlay page (see src/shared/ipc.ts), wired to the frame tool.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('talkthrough', {
  ready: () => ipcRenderer.send('tt:ready'),
  onDisplay: (listener) => ipcRenderer.on('tt:display', (_e, info) => listener(info)),
  onScene: (listener) => ipcRenderer.on('tt:scene', (_e, message) => listener(message)),
  setInteractive: (over) => ipcRenderer.send('tt:interactive', over),
  pointerHeld: () => undefined,
  modelHit: () => undefined,
  guideReady: () => undefined,
  visibleRegions: () => undefined,
  followup: () => undefined,
  rendered: (token) => ipcRenderer.send('tt:rendered', token),
  done: () => ipcRenderer.send('tt:done'),
  offer: () => ipcRenderer.send('tt:offer'),
  // Where the page's buttons are: only the real app lays windows over them, so the frame tool has nothing to do with it.
  buttons: () => undefined,
  engage: () => undefined,
  showing: (on) => ipcRenderer.send('tt:showing', on === true),
  detail: () => undefined,
  milestone: (m) => ipcRenderer.send('tt:milestone', m),
  stroke: (stroke) => ipcRenderer.send('tt:stroke', stroke),
  cancel: (released) => ipcRenderer.send('tt:cancel', released === true),
});
