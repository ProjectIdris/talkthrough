import { contextBridge, ipcRenderer } from 'electron';
import { SETTINGS_CHANNEL } from '../shared/ipc.ts';
import type { TalkthroughSettingsApi } from '../shared/ipc.ts';

// The settings page gets exactly these functions; none of them can read the key back.
const api: TalkthroughSettingsApi = {
  status: () => ipcRenderer.invoke(SETTINGS_CHANNEL.status),
  save: (key) => ipcRenderer.invoke(SETTINGS_CHANNEL.save, key),
  clear: () => ipcRenderer.invoke(SETTINGS_CHANNEL.clear),
  load: () => ipcRenderer.invoke(SETTINGS_CHANNEL.get),
  store: (form) => ipcRenderer.invoke(SETTINGS_CHANNEL.put, form),
  restart: () => ipcRenderer.send(SETTINGS_CHANNEL.restart),
  speech: () => ipcRenderer.invoke(SETTINGS_CHANNEL.speechStatus),
  installSpeech: (model) => ipcRenderer.invoke(SETTINGS_CHANNEL.speechInstall, model),
  cancelSpeech: () => ipcRenderer.send(SETTINGS_CHANNEL.speechCancel),
  removeSpeech: () => ipcRenderer.invoke(SETTINGS_CHANNEL.speechRemove),
  onSpeechProgress: (listener) => void ipcRenderer.on(SETTINGS_CHANNEL.speechProgress, (_event, progress) => listener(progress)),
  testLocal: (baseUrl, model) => ipcRenderer.invoke(SETTINGS_CHANNEL.testLocal, { baseUrl, model }),
  devices: () => ipcRenderer.invoke(SETTINGS_CHANNEL.devices),
  firstRun: () => ipcRenderer.invoke(SETTINGS_CHANNEL.firstRun),
  micTest: () => ipcRenderer.invoke(SETTINGS_CHANNEL.micTest),
  tools: () => ipcRenderer.invoke(SETTINGS_CHANNEL.tools),
  firstRunDone: (restart) => ipcRenderer.send(SETTINGS_CHANNEL.firstRunDone, restart === true),
  onFocus: (listener) => void ipcRenderer.on(SETTINGS_CHANNEL.focus, (_event, section) => listener(String(section))),
};

contextBridge.exposeInMainWorld('talkthroughSettings', api);
