const { contextBridge, ipcRenderer } = require('electron');
const send = (ch) => (...a) => ipcRenderer.send(ch, ...a);
contextBridge.exposeInMainWorld('talkthrough', {
  ready: send('tt:ready'),
  onDisplay: (l) => ipcRenderer.on('tt:display', (_e, i) => l(i)),
  onScene: (l) => ipcRenderer.on('tt:scene', (_e, m) => l(m)),
  setInteractive: (over) => ipcRenderer.send('tt:interactive', over),
  pointerHeld: (on) => ipcRenderer.send('tt:pointer-held', on === true),
  modelHit: () => undefined, guideReady: () => undefined,
  visibleRegions: (s) => ipcRenderer.send('tt:visible-regions', s),
  followup: (c) => ipcRenderer.send('tt:followup', c),
  rendered: (t) => ipcRenderer.send('tt:rendered', t),
  done: () => ipcRenderer.send('tt:done'), offer: () => undefined, buttons: () => undefined,
  engage: (on) => ipcRenderer.send('tt:engage', on === true),
  showing: (on) => ipcRenderer.send('tt:showing', on === true),
  detail: () => undefined, milestone: () => undefined,
  stroke: (s) => ipcRenderer.send('tt:stroke', s),
  penFlushed: (id) => ipcRenderer.send('tt:pen-flushed', id),
  cancel: (r) => ipcRenderer.send('tt:cancel', r === true),
});
