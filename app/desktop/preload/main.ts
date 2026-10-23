import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_ACTIVATION_CONTEXT_CHANNEL,
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_PROJECTION_DELTA_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  type DesktopShellState,
  type RepoctopusDesktopBridge,
} from '../shared/renderer-contract.js';

const bridge: RepoctopusDesktopBridge = {
  currentState: () => ipcRenderer.invoke(DESKTOP_BACKEND_STATE_CHANNEL),
  retry: () => {
    ipcRenderer.send(DESKTOP_RETRY_CHANNEL);
  },
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopShellState) => {
      listener(state);
    };
    ipcRenderer.on(DESKTOP_BACKEND_STATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_BACKEND_STATE_CHANNEL, handler);
    };
  },
  onProjectionDelta: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, delta: Parameters<typeof listener>[0]) => {
      listener(delta);
    };
    ipcRenderer.on(DESKTOP_PROJECTION_DELTA_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_PROJECTION_DELTA_CHANNEL, handler);
    };
  },
  onActivation: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      context: Parameters<typeof listener>[0],
    ) => {
      listener(context);
    };
    ipcRenderer.on(DESKTOP_ACTIVATION_CONTEXT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(DESKTOP_ACTIVATION_CONTEXT_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('repoctopusDesktop', bridge);
