import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';

import {
  DESKTOP_ACTIVATION_CONTEXT_CHANNEL,
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_PROJECTION_DELTA_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  type DesktopShellState,
} from '../shared/renderer-contract.js';
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.js';
import { DesktopHostProcess, type DesktopHostReady } from './host-process.js';
import { resolveDesktopProductRoot } from './product-root.js';
import { claimDesktopSingleInstance } from './single-instance.js';
import { scheduleDesktopStartup } from './startup.js';
import { activationArgument } from '../shared/activation-protocol.js';
import {
  readDesktopActivationRequest,
  writeDesktopActivationResponse,
} from '../../../platform/desktop/activation-files.js';

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
let resolveFirstHostReady!: (ready: DesktopHostReady) => void;
const firstHostReady = new Promise<DesktopHostReady>((resolve) => {
  resolveFirstHostReady = resolve;
});

/** Main-process inspection hook used by the packaged-candidate smoke test. */
export function waitForDesktopHostReady(): Promise<DesktopHostReady> {
  return firstHostReady;
}

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
      dataRoot: app.getPath('userData'),
      onReady: (ready) => {
        hostReady = ready;
        resolveFirstHostReady(ready);
      },
      onProjectionDelta: (delta) => {
        if (
          hostReady === undefined ||
          delta.baseVersion !== hostReady.snapshot.projection.version
        ) {
          return;
        }
        hostReady = {
          ...hostReady,
          snapshot: { ...hostReady.snapshot, projection: delta.projection },
        };
        const window = mainWindow;
        if (window !== undefined && !window.isDestroyed()) {
          window.webContents.send(DESKTOP_PROJECTION_DELTA_CHANNEL, delta);
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
  } catch {
    // The controller has already published a bounded error state.
  }
}

async function respondToActivation(requestFile: string): Promise<void> {
  const request = await readDesktopActivationRequest(requestFile);
  if (mainWindow === undefined) await createWindow();
  await controller.start(() => Promise.resolve());
  const ready = hostReady;
  const host = controller.host;
  if (ready === undefined || host === undefined) {
    throw new Error('Desktop Host did not become ready for activation');
  }
  host.activate(request.context);
  const window = mainWindow;
  if (window !== undefined && !window.isDestroyed()) {
    window.webContents.send(DESKTOP_ACTIVATION_CONTEXT_CHANNEL, request.context);
  }
  await writeDesktopActivationResponse(requestFile, {
    apiVersion: 'repoctopus.desktop.activation/v1alpha1',
    requestId: request.requestId,
    status: 'ready',
    shellPid: process.pid,
    receiver: ready.receiver,
  });
}

function acceptActivation(commandLine: readonly string[]): void {
  const requestFile = activationArgument(commandLine);
  if (requestFile === null) return;
  void respondToActivation(requestFile).catch((error: unknown) => {
    console.error('desktop activation failed', error);
  });
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

const ownsInstance = claimDesktopSingleInstance(app, (commandLine) => {
  const window = mainWindow;
  if (window === undefined) {
    void createWindow();
  } else {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  acceptActivation(commandLine);
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
  scheduleDesktopStartup(app, createWindow, (error) => {
    console.error('desktop shell startup failed', error);
  });
  const initialActivation = activationArgument(process.argv);
  if (initialActivation !== null) {
    void app.whenReady().then(() => respondToActivation(initialActivation));
  }
}
