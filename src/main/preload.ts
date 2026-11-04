import { contextBridge, ipcRenderer } from 'electron';
import { CHANNEL } from '../shared/ipc.ts';
import type { DisplayInfo, SceneMessage, TalkthroughApi } from '../shared/ipc.ts';

// The overlay page gets exactly these functions; it never sees ipcRenderer or the event objects.
const api: TalkthroughApi = {
  ready: () => ipcRenderer.send(CHANNEL.ready),
  onDisplay: (listener) => void ipcRenderer.on(CHANNEL.display, (_event, display: DisplayInfo) => listener(display)),
  onScene: (listener) => void ipcRenderer.on(CHANNEL.scene, (_event, message: SceneMessage) => listener(message)),
  setInteractive: (over) => ipcRenderer.send(CHANNEL.interactive, over === true),
  engage: (on) => ipcRenderer.send(CHANNEL.engage, on === true),
  rendered: (token) => ipcRenderer.send(CHANNEL.rendered, token),
  done: () => ipcRenderer.send(CHANNEL.done),
  offer: () => ipcRenderer.send(CHANNEL.offer),
  consent: (yes) => ipcRenderer.send(CHANNEL.consent, yes === true),
  detail: () => ipcRenderer.send(CHANNEL.detail),
  stroke: (stroke) => ipcRenderer.send(CHANNEL.stroke, stroke),
  milestone: (milestone) => ipcRenderer.send(CHANNEL.milestone, milestone),
};

contextBridge.exposeInMainWorld('talkthrough', api);
