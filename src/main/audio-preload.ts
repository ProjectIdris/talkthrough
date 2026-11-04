import { contextBridge, ipcRenderer } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { FrameResult, GrabRequest, MicResult, TalkthroughAudioApi } from '../shared/ipc.ts';

const api: TalkthroughAudioApi = {
  onStart: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.start, () => listener()),
  onStop: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.stop, () => listener()),
  onAbort: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.abort, () => listener()),
  onGrab: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.grab, (_event, request: GrabRequest) => listener(request)),
  result: (result: MicResult) => ipcRenderer.send(AUDIO_CHANNEL.result, result),
  error: (message: string) => ipcRenderer.send(AUDIO_CHANNEL.error, message),
  started: () => ipcRenderer.send(AUDIO_CHANNEL.started),
  frame: (result: FrameResult) => ipcRenderer.send(AUDIO_CHANNEL.frame, result),
  frameError: (message: string) => ipcRenderer.send(AUDIO_CHANNEL.frameError, message),
};

contextBridge.exposeInMainWorld('talkthroughAudio', api);
