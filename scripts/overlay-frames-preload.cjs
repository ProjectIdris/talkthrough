// Preload for scripts/overlay-frames.cjs: the same window.talkthrough surface the real preload
// gives the overlay page (see src/shared/ipc.ts), wired to the frame tool.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('talkthrough', {
  ready: () => ipcRenderer.send('tt:ready'),
  onDisplay: (listener) => ipcRenderer.on('tt:display', (_e, info) => listener(info)),
  onScene: (listener) => ipcRenderer.on('tt:scene', (_e, message) => listener(message)),
  setInteractive: (over) => ipcRenderer.send('tt:interactive', over),
  rendered: (token) => ipcRenderer.send('tt:rendered', token),
  done: () => ipcRenderer.send('tt:done'),
});
