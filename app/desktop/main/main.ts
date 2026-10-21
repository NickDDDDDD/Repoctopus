import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  type DesktopShellState,
} from '../shared/renderer-contract.js';
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.js';
import { DesktopHostProcess, type DesktopHostReady } from './host-process.js';
import { claimDesktopSingleInstance } from './single-instance.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostEntry = path.join(moduleDirectory, 'host.mjs');
const preloadEntry = path.join(moduleDirectory, 'preload.cjs');
const rendererEntry = path.join(moduleDirectory, 'renderer', 'index.html');
const productRoot = app.isPackaged ? app.getAppPath() : path.resolve(moduleDirectory, '..', '..');

let mainWindow: BrowserWindow | undefined;
let hostReady: DesktopHostReady | undefined;
let quitting = false;

app.setName('Repoctopus');
app.setAppUserModelId('com.repoctopus.desktop');

function publicState(state: DesktopBackendState): DesktopShellState {
  if (state.phase === 'ready' && hostReady !== undefined) {
    return { phase: 'ready', snapshot: hostReady.snapshot };
  }
  if (state.phase === 'error') return { phase: 'error', message: state.message };
  return { phase: 'starting' };
}

function publish(state: DesktopBackendState): void {
  const window = mainWindow;
  if (window === undefined || window.isDestroyed()) return;
  window.webContents.send(DESKTOP_BACKEND_STATE_CHANNEL, publicState(state));
}

const controller = new DesktopBackendController(
  (onFailure) =>
    new DesktopHostProcess({
      executable: process.execPath,
      entry: hostEntry,
      productRoot,
      onReady: (ready) => {
        hostReady = ready;
      },
      onFailure,
    }),
  publish,
);

function ownsSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const window = mainWindow;
  if (
    window === undefined ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  ) {
    return false;
  }
  try {
    const sender = new URL(event.senderFrame.url);
    return sender.protocol === 'file:' && path.resolve(fileURLToPath(sender)) === rendererEntry;
  } catch {
    return false;
  }
}

async function startBackend(): Promise<void> {
  hostReady = undefined;
  try {
    await controller.start(() => Promise.resolve());
  } catch {
    // The controller has already published a bounded error state.
  }
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 680,
    minHeight: 480,
    show: false,
    backgroundColor: '#f6f7f8',
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => {
    window.show();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  await window.loadFile(rendererEntry);
  publish(controller.state);
  void startBackend();
}

async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    await controller.close();
  } finally {
    app.quit();
  }
}

const ownsInstance = claimDesktopSingleInstance(app, () => {
  const window = mainWindow;
  if (window === undefined) {
    void createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});

if (ownsInstance) {
  ipcMain.handle(DESKTOP_BACKEND_STATE_CHANNEL, (event) => {
    if (!ownsSender(event)) throw new Error('Untrusted desktop IPC sender');
    return publicState(controller.state);
  });
  ipcMain.on(DESKTOP_RETRY_CHANNEL, (event) => {
    if (!ownsSender(event)) return;
    void controller.stop().then(startBackend);
  });
  app.on('window-all-closed', () => {
    void quit();
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    void quit();
  });
  void app
    .whenReady()
    .then(createWindow)
    .catch((error: unknown) => {
      console.error('desktop shell startup failed', error);
      app.exit(1);
    });
}
