import { contextBridge, ipcRenderer } from 'electron';
import { TOUR_CHANNEL } from '../shared/visual-tour.ts';
import type { TourApi } from '../shared/visual-tour.ts';

const api: TourApi = {
  state: () => ipcRenderer.invoke(TOUR_CHANNEL.get),
  command: command => ipcRenderer.send(TOUR_CHANNEL.command, command),
  onState: listener => { ipcRenderer.on(TOUR_CHANNEL.state, (_event, state) => listener(state)); },
};
contextBridge.exposeInMainWorld('talkthroughTour', api);
