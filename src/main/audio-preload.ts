import { contextBridge, ipcRenderer } from 'electron';
import { AUDIO_CHANNEL } from '../shared/ipc.ts';
import type { MicResult, TalkthroughAudioApi } from '../shared/ipc.ts';

const api: TalkthroughAudioApi = {
  onStart: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.start, () => listener()),
  onStop: (listener) => void ipcRenderer.on(AUDIO_CHANNEL.stop, () => listener()),
  result: (result: MicResult) => ipcRenderer.send(AUDIO_CHANNEL.result, result),
  error: (message: string) => ipcRenderer.send(AUDIO_CHANNEL.error, message),
};

contextBridge.exposeInMainWorld('talkthroughAudio', api);
