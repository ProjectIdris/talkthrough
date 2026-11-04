import { contextBridge, ipcRenderer } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { ComposeRequest, ComposeResult, FrameResult, GrabRequest, MicResult, TalkthroughAudioApi, UseImageRequest } from '../shared/ipc.ts';

const api: TalkthroughAudioApi = {
  onStart: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.start, () => listener()),
  onStop: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.stop, () => listener()),
  onAbort: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.abort, () => listener()),
  onGrab: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.grab, (_event, request: GrabRequest) => listener(request)),
  onCompose: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.compose, (_event, request: ComposeRequest) => listener(request)),
  composed: (result: ComposeResult) => ipcRenderer.send(AUDIO_CHANNEL.composed, result),
  composeError: (id: number, message: string) => ipcRenderer.send(AUDIO_CHANNEL.composeError, id, message),
  onUseImage: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.useImage, (_event, request: UseImageRequest) => listener(request)),
  result: (result: MicResult) => ipcRenderer.send(AUDIO_CHANNEL.result, result),
  error: (message: string) => ipcRenderer.send(AUDIO_CHANNEL.error, message),
  started: () => ipcRenderer.send(AUDIO_CHANNEL.started),
  frame: (result: FrameResult) => ipcRenderer.send(AUDIO_CHANNEL.frame, result),
  frameError: (id: number, message: string) => ipcRenderer.send(AUDIO_CHANNEL.frameError, id, message),
};

contextBridge.exposeInMainWorld('talkthroughAudio', api);
