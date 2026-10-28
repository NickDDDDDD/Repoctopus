import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  DESKTOP_PROJECTION_DELTA_CHANNEL,
  DESKTOP_SELECT_CHANGE_CHANNEL,
  isDesktopShellState,
  type DesktopShellState,
  type RepoctopusDesktopBridge,
  isDesktopProjectionUpdate,
} from '../shared/renderer-contract.js';

const bridge: RepoctopusDesktopBridge = {
  currentState: async () => {
    const state: unknown = await ipcRenderer.invoke(DESKTOP_BACKEND_STATE_CHANNEL);
    if (!isDesktopShellState(state)) throw new Error('Desktop Main returned an invalid state');
    return state;
  },
  retry: () => {
    ipcRenderer.send(DESKTOP_RETRY_CHANNEL);
  },
  selectChange: (selection) => {
    ipcRenderer.send(DESKTOP_SELECT_CHANGE_CHANNEL, selection);
  },
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopShellState) => {
      if (isDesktopShellState(state)) listener(state);
    };
    ipcRenderer.on(DESKTOP_BACKEND_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_BACKEND_STATE_CHANNEL, handler);
    };
  },
  onProjection: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: unknown) => {
      if (isDesktopProjectionUpdate(update)) listener(update);
    };
    ipcRenderer.on(DESKTOP_PROJECTION_DELTA_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_PROJECTION_DELTA_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('repoctopusDesktop', bridge);
