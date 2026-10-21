import { contextBridge, ipcRenderer } from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
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
};

contextBridge.exposeInMainWorld('repoctopusDesktop', bridge);
