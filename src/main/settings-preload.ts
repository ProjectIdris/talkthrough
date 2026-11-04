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
};

contextBridge.exposeInMainWorld('talkthroughSettings', api);
