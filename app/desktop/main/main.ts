import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  DESKTOP_PROJECTION_DELTA_CHANNEL,
  DESKTOP_RENDERER_PROTOCOL_VERSION,
  type DesktopShellState,
} from '../shared/renderer-contract.js';
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.js';
import { DesktopHostProcess, type DesktopHostReady } from './host-process.js';
import { resolveDesktopProductRoot } from './product-root.js';
import { claimDesktopSingleInstance } from './single-instance.js';
import { scheduleDesktopStartup } from './startup.js';
import {
  desktopLaunchContextFromArguments,
  type DesktopLaunchContext,
} from '../shared/launch-context.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostEntry = path.join(moduleDirectory, 'host.mjs');
const preloadEntry = path.join(moduleDirectory, 'preload.cjs');
const rendererEntry = path.join(moduleDirectory, 'renderer', 'index.html');
const productRoot = resolveDesktopProductRoot({
  appPath: app.getAppPath(),
  isPackaged: app.isPackaged,
  moduleDirectory,
});

let mainWindow: BrowserWindow | undefined;
let hostReady: DesktopHostReady | undefined;
let quitting = false;
let pendingContext: DesktopLaunchContext | null = (() => {
  try {
    return desktopLaunchContextFromArguments(process.argv);
  } catch {
    return null;
  }
})();

app.setName('Repoctopus');
app.setAppUserModelId('com.repoctopus.desktop');

function publicState(state: DesktopBackendState): DesktopShellState {
  if (state.phase === 'ready' && hostReady !== undefined) {
    return {
      protocolVersion: DESKTOP_RENDERER_PROTOCOL_VERSION,
      phase: 'ready',
      snapshot: hostReady.snapshot,
      projection: hostReady.projection,
    };
  }
  if (state.phase === 'error')
    return {
      protocolVersion: DESKTOP_RENDERER_PROTOCOL_VERSION,
      phase: 'error',
      message: state.message,
    };
  return { protocolVersion: DESKTOP_RENDERER_PROTOCOL_VERSION, phase: 'starting' };
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
      onSnapshot: (ready) => {
        hostReady = ready;
        publish(controller.state);
      },
      onProjection: (update) => {
        if (hostReady !== undefined) hostReady = { ...hostReady, projection: update.snapshot };
        const window = mainWindow;
        if (window !== undefined && !window.isDestroyed()) {
          window.webContents.send(DESKTOP_PROJECTION_DELTA_CHANNEL, update);
        }
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
    if (pendingContext !== null) controller.host?.activate(pendingContext);
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

function activateOwner(context: DesktopLaunchContext | null): void {
  if (context !== null) {
    pendingContext = context;
    controller.host?.activate(context);
  }
  const window = mainWindow;
  if (window === undefined) {
    void createWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

const ownsInstance = claimDesktopSingleInstance(app, pendingContext, activateOwner);

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
  scheduleDesktopStartup(app, createWindow, (error) => {
    console.error('desktop shell startup failed', error);
  });
}
