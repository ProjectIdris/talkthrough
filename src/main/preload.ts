import { contextBridge, ipcRenderer } from 'electron';
import { CHANNEL } from '../shared/ipc.ts';
import type { VoiceEvent } from '../adapters/http-voice.ts';
import type { DisplayInfo, SceneMessage, TalkthroughApi } from '../shared/ipc.ts';

// The overlay page gets exactly these functions; it never sees ipcRenderer or the event objects.
const api: TalkthroughApi = {
  voice: {
    speak: (id, text) => ipcRenderer.send(CHANNEL.voiceSpeak, { id, text }),
    cancel: (id) => ipcRenderer.send(CHANNEL.voiceCancel, id),
    onEvent: (listener) => void ipcRenderer.on(CHANNEL.voiceEvent, (_event, id: number, event: VoiceEvent) => listener(id, event)),
  },
  ready: () => ipcRenderer.send(CHANNEL.ready),
  onDisplay: (listener) => void ipcRenderer.on(CHANNEL.display, (_event, display: DisplayInfo) => listener(display)),
  onScene: (listener) => void ipcRenderer.on(CHANNEL.scene, (_event, message: SceneMessage) => listener(message)),
  setInteractive: (over, region) => ipcRenderer.send(CHANNEL.interactive, over === true, region),
  engage: (on) => ipcRenderer.send(CHANNEL.engage, on === true),
  rendered: (token) => ipcRenderer.send(CHANNEL.rendered, token),
  done: () => ipcRenderer.send(CHANNEL.done),
  offer: () => ipcRenderer.send(CHANNEL.offer),
  buttons: (list) => ipcRenderer.send(CHANNEL.buttons, Array.isArray(list) ? list : []),
  detail: () => ipcRenderer.send(CHANNEL.detail),
  stroke: (stroke) => ipcRenderer.send(CHANNEL.stroke, stroke),
  cancel: (released) => ipcRenderer.send(CHANNEL.cancel, released === true),
  milestone: (milestone) => ipcRenderer.send(CHANNEL.milestone, milestone),
};

contextBridge.exposeInMainWorld('talkthrough', api);
