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
} from 'electron';

import {
  DESKTOP_BACKEND_STATE_CHANNEL,
  DESKTOP_RETRY_CHANNEL,
  type DesktopShellState,
} from '../shared/renderer-contract.js';
import { DesktopBackendController, type DesktopBackendState } from './backend-controller.js';
import { DesktopHostProcess, type DesktopHostReady } from './host-process.js';
import { isTrustedDesktopIpcEvent, validateDesktopIpcRequest } from './ipc-security.js';
import type { ChangeProjectionDelta } from '../../../domains/telemetry/change-projection.js';
import { DesktopLaunchRegistry, desktopLaunchContextFromArguments } from './launch-context.js';
import { resolveDesktopProductRoot } from './product-root.js';
import { DesktopShellLifecycle, type DesktopCloseDecision } from './shell-lifecycle.js';
import { DesktopShellSettingsStore } from './shell-settings.js';
import { claimDesktopSingleInstance } from './single-instance.js';
import { scheduleDesktopStartup } from './startup.js';
import { DesktopTray } from './tray.js';

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
let windowCreation: Promise<void> | undefined;
let hostReady: DesktopHostReady | undefined;
let tray: DesktopTray | undefined;
const initialLaunchContext = desktopLaunchContextFromArguments(process.argv);
const launchRegistry = new DesktopLaunchRegistry(initialLaunchContext);

app.setName('Repoctopus');
app.setAppUserModelId('com.repoctopus.desktop');

const settingsStore = new DesktopShellSettingsStore(app.getPath('userData'));
let closePreference = settingsStore.read().closePreference;

function publicState(
  state: DesktopBackendState,
  delta: ChangeProjectionDelta | null = null,
): DesktopShellState {
  if (state.phase === 'ready' && hostReady !== undefined) {
    return {
      phase: 'ready',
      snapshot: hostReady.snapshot,
      projection: hostReady.projection,
      delta,
      launch: launchRegistry.snapshot(),
    };
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
      environment: {
        ...process.env,
        REPOCTOPUS_DESKTOP_DATA_DIR: path.join(app.getPath('userData'), 'projection'),
      },
      onReady: (ready) => {
        hostReady = ready;
      },
      onProjection: (projection, delta) => {
        if (hostReady === undefined) return;
        hostReady = { ...hostReady, projection };
        const window = mainWindow;
        if (window === undefined || window.isDestroyed()) return;
        window.webContents.send(
          DESKTOP_BACKEND_STATE_CHANNEL,
          publicState(controller.state, delta),
        );
      },
      onFailure,
    }),
  publish,
);

function ownsSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const window = mainWindow;
  return (
    window !== undefined &&
    !window.isDestroyed() &&
    isTrustedDesktopIpcEvent(event, window.webContents, rendererEntry)
  );
}

async function startBackend(): Promise<void> {
  hostReady = undefined;
  try {
    await controller.start(() => Promise.resolve());
  } catch {
    // The controller has already published a bounded error state.
  }
}

async function restartBackend(): Promise<void> {
  try {
    await controller.stop();
    await startBackend();
  } catch {
    // The controller owns and publishes the bounded failure state.
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
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    publish(controller.state);
    return Promise.resolve();
  }
  windowCreation ??= createWindow().finally(() => {
    windowCreation = undefined;
  });
  return windowCreation;
}

async function askCloseDecision(): Promise<DesktopCloseDecision> {
  const options = {
    type: 'question' as const,
    title: 'Repoctopus Dashboard',
    message: '关闭 Dashboard 时要做什么？',
    detail: '最小化到托盘会让本地 Receiver 继续接收工作流遥测。',
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
  hideWindow: () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.hide();
  },
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
  if (process.platform !== 'win32' || tray !== undefined) return;
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#18212f"/><path d="M8 9h16v4H8zm0 6h10v4H8zm0 6h16v4H8z" fill="#72d6bc"/></svg>',
    )}`,
  );
  tray = new DesktopTray({
    handle: new Tray(icon),
    buildMenu: (template) => Menu.buildFromTemplate(template),
    open: () => shellLifecycle.activateWindow(),
    quit: () => {
      void shellLifecycle.requestFullQuit('tray');
    },
  });
}

const ownsInstance = claimDesktopSingleInstance(
  {
    requestSingleInstanceLock: (additionalData) => app.requestSingleInstanceLock(additionalData),
    quit: () => app.quit(),
    on: (_event, listener) => app.on('second-instance', listener),
  },
  initialLaunchContext,
  (context) => {
    if (context !== null) launchRegistry.activate(context);
    shellLifecycle.activateWindow();
  },
);

if (ownsInstance) {
  ipcMain.handle(DESKTOP_BACKEND_STATE_CHANNEL, (event, request: unknown) => {
    if (!ownsSender(event)) throw new Error('Untrusted desktop IPC sender');
    validateDesktopIpcRequest(DESKTOP_BACKEND_STATE_CHANNEL, request);
    return publicState(controller.state);
  });
  ipcMain.on(DESKTOP_RETRY_CHANNEL, (event, request: unknown) => {
    if (!ownsSender(event)) return;
    try {
      validateDesktopIpcRequest(DESKTOP_RETRY_CHANNEL, request);
    } catch {
      return;
    }
    void restartBackend();
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
