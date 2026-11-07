const { contextBridge, ipcRenderer } = require('electron');

// The real renderer, with provider/desktop actions replaced by recorded IPC.
contextBridge.exposeInMainWorld('talkthrough', {
  onDisplay: listener => ipcRenderer.on('tt:display', (_e, info) => listener(info)),
  onScene: listener => ipcRenderer.on('tt:scene', (_e, message) => listener(message)),
  ...Object.fromEntries(['ready', 'rendered', 'visibleRegions', 'buttons', 'followup', 'done', 'showing', 'setInteractive', 'pointerHeld', 'engage', 'modelHit', 'guideReady', 'offer', 'detail', 'milestone', 'stroke', 'cancel', 'action'].map(name => [name, (...args) => ipcRenderer.send(`tt:${name}`, ...args)])),
});
