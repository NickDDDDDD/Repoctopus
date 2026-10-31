import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
} from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  DESKTOP_PROJECTION_DELTA_CHANNEL,
  DESKTOP_RENDERER_PROTOCOL_VERSION,
  DESKTOP_SELECT_CHANGE_CHANNEL,
  type DesktopShellState,
} from '../shared/renderer-contract.js';
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.js';
import { DesktopHostProcess, type DesktopHostReady } from './host-process.js';
import { resolveDesktopProductRoot } from './product-root.js';
import { claimDesktopSingleInstance } from './single-instance.js';
import { DesktopShellLifecycle, type DesktopCloseDecision } from './shell-lifecycle.js';
import { DesktopShellSettingsStore } from './shell-settings.js';
import { scheduleDesktopStartup } from './startup.js';
import { DesktopTray } from './tray.js';
import {
  desktopLaunchContextFromArguments,
  parseDesktopLaunchContext,
  type DesktopLaunchContext,
} from '../shared/launch-context.js';
import { resolveDesktopReceiverDiscoveryRoot } from '../host/receiver-discovery.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostEntry = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'desktop', 'host.mjs')
  : path.join(moduleDirectory, 'host.mjs');
const preloadEntry = path.join(moduleDirectory, 'preload.cjs');
const rendererEntry = path.join(moduleDirectory, 'renderer', 'index.html');
const productRoot = resolveDesktopProductRoot({
  appPath: app.getAppPath(),
  isPackaged: app.isPackaged,
  moduleDirectory,
});
const hostProductRoot = app.isPackaged ? path.join(process.resourcesPath, 'product') : productRoot;

let mainWindow: BrowserWindow | undefined;
let hostReady: DesktopHostReady | undefined;
let windowCreation: Promise<void> | undefined;
let tray: DesktopTray | undefined;
let pendingContext: DesktopLaunchContext | null = (() => {
  try {
    return desktopLaunchContextFromArguments(process.argv);
  } catch {
    return null;
  }
})();

app.setName('Repoctopus');
app.setAppUserModelId('com.repoctopus.desktop');

const userDataRoot = app.getPath('userData');
const settingsStore = new DesktopShellSettingsStore(userDataRoot);
let closePreference = settingsStore.read().closePreference;

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
      productRoot: hostProductRoot,
      environment: {
        ...process.env,
        REPOCTOPUS_DESKTOP_DATA_ROOT: path.join(userDataRoot, 'desktop'),
        REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: resolveDesktopReceiverDiscoveryRoot(process.env),
      },
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
  window.on('close', (event) => {
    if (shellLifecycle.isQuitting) return;
    event.preventDefault();
    void shellLifecycle.requestWindowClose();
  });
  window.on('session-end', () => {
    void shellLifecycle.requestFullQuit('session');
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
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

function ensureWindow(): Promise<void> {
  const window = mainWindow;
  if (window !== undefined && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return Promise.resolve();
  }
  if (windowCreation !== undefined) return windowCreation;
  const pending = createWindow().finally(() => {
    if (windowCreation === pending) windowCreation = undefined;
  });
  windowCreation = pending;
  return pending;
}

async function askCloseDecision(): Promise<DesktopCloseDecision> {
  const options: MessageBoxOptions = {
    type: 'question',
    title: '关闭 Repoctopus Dashboard',
    message: '关闭窗口后要完全退出，还是最小化到系统托盘？',
    detail: '最小化到托盘时，本地遥测接收器会继续运行。',
    buttons: ['完全退出', '最小化到托盘', '取消'],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
    checkboxLabel: '记住我的选择',
    checkboxChecked: false,
  };
  const window = mainWindow;
  const result =
    window === undefined || window.isDestroyed()
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);
  return {
    action: result.response === 0 ? 'quit' : result.response === 1 ? 'tray' : 'cancel',
    remember: result.checkboxChecked,
  };
}

const shellLifecycle = new DesktopShellLifecycle({
  readPreference: () => closePreference,
  writePreference: (preference) => {
    settingsStore.writeClosePreference(preference);
    closePreference = preference;
  },
  ask: askCloseDecision,
  hideWindow: () => mainWindow?.hide(),
  showWindow: () => {
    void ensureWindow();
  },
  stopBackend: () => controller.close(),
  quitApplication: () => app.quit(),
  disposeTray: () => {
    tray?.dispose();
    tray = undefined;
  },
});

function ensureTray(): void {
  if (tray !== undefined) return;
  const icon = nativeImage.createFromPath(
    app.isPackaged
      ? path.join(process.resourcesPath, 'desktop-icon.ico')
      : path.join(productRoot, 'app', 'desktop', 'resources', 'icon.ico'),
  );
  if (icon.isEmpty()) throw new Error('Repoctopus Desktop icon is unavailable');
  tray = new DesktopTray({
    handle: new Tray(icon),
    buildMenu: (items) => Menu.buildFromTemplate(items),
    open: () => shellLifecycle.activateWindow(),
    quit: () => {
      void shellLifecycle.requestFullQuit('tray');
    },
  });
}

function activateOwner(context: DesktopLaunchContext | null): void {
  if (context !== null) {
    pendingContext = context;
    controller.host?.activate(context);
  }
  const window = mainWindow;
  if (window === undefined) {
    void ensureWindow();
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
  ipcMain.on(DESKTOP_SELECT_CHANGE_CHANNEL, (event, selection: unknown) => {
    if (!ownsSender(event)) return;
    try {
      controller.host?.select(parseDesktopLaunchContext(selection));
    } catch {
      // Invalid renderer selection fails closed.
    }
  });
  app.on('window-all-closed', () => {
    if (!shellLifecycle.isQuitting) void shellLifecycle.requestFullQuit('application');
  });
  app.on('before-quit', (event) => {
    if (shellLifecycle.isQuitting) return;
    event.preventDefault();
    void shellLifecycle.requestFullQuit('application');
  });
  scheduleDesktopStartup(
    app,
    async () => {
      ensureTray();
      await ensureWindow();
    },
    (error) => {
      console.error('desktop shell startup failed', error);
    },
  );
}
