import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const installer = path.join(
  root,
  'dist',
  'desktop-release',
  'Repoctopus-Desktop-0.1.0-x64-Setup.exe',
);
const evidenceFile = path.resolve(
  process.env.REPOCTOPUS_DESKTOP_E2E_EVIDENCE ??
    path.join(root, 'dist', 'desktop-release', 'windows-package-e2e.json'),
);
const selfHostWorkspace = process.env.REPOCTOPUS_SELF_HOST_WORKSPACE?.trim() || null;
const runtimeRunId =
  process.env.REPOCTOPUS_WORKFLOW_RUN_ID ??
  'change-repoctopus-add-windows-desktop-dashboard-f5ddf312046dbfbb';
const checks = [];
const startedAt = new Date().toISOString();
const protocolKey = 'HKCU\\Software\\Classes\\repoctopus';
const systemRoot = process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim() || null;
const explorer = systemRoot ? path.join(systemRoot, 'explorer.exe') : null;
let sandbox;
let installRoot;
let protocolSnapshot;
let protocolExisted = false;
let protocolMutationStarted = false;
let protocolRestored = false;
let trayProcess;
let quitProcess;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(target) {
  return access(target).then(
    () => true,
    () => false,
  );
}

async function waitFor(probe, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
}

async function runCheck(id, operation) {
  const began = Date.now();
  try {
    const details = (await operation()) ?? {};
    checks.push({ id, status: 'passed', durationMs: Date.now() - began, ...details });
    process.stdout.write(`PASS ${id}\n`);
    return details;
  } catch (error) {
    checks.push({
      id,
      status: 'failed',
      durationMs: Date.now() - began,
      diagnostic: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function execute(file, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, arguments_, {
      ...options,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(file)} exited ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'Unable to reserve a debugging port');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

function launchArgument(changeId, runId) {
  const encoded = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'workspace-installed-e2e',
      changeId,
      runId,
    }),
  ).toString('base64url');
  return `--repoctopus-launch=${encoded}`;
}

function launchUrl(changeId, runId) {
  return `repoctopus://activate/${launchArgument(changeId, runId).slice('--repoctopus-launch='.length)}`;
}

async function writePreference(userData, closePreference) {
  const directory = path.join(userData, 'desktop');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'settings.json'),
    `${JSON.stringify({ schemaVersion: 1, closePreference }, null, 2)}\n`,
  );
}

function startInstalled(executable, options) {
  const child = spawn(
    executable,
    [
      `--user-data-dir=${options.userData}`,
      `--remote-debugging-port=${options.debugPort}`,
      '--enable-logging=stderr',
      launchArgument(options.changeId, options.runId),
    ],
    {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: path.join(options.userData, 'discovery'),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.repoctopusOutput = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => {
      child.repoctopusOutput = `${child.repoctopusOutput}${chunk}`.slice(-64 * 1024);
    });
  }
  return child;
}

async function protocolRegistrationExists() {
  return execute('reg.exe', ['query', protocolKey]).then(
    () => true,
    () => false,
  );
}

async function snapshotProtocolRegistration() {
  protocolSnapshot = path.join(sandbox, 'repoctopus-protocol-before.reg');
  protocolExisted = await protocolRegistrationExists();
  if (protocolExisted) {
    await execute('reg.exe', ['export', protocolKey, protocolSnapshot, '/y']);
  }
  protocolMutationStarted = true;
  await execute('reg.exe', ['delete', protocolKey, '/f']).catch(() => undefined);
}

async function restoreProtocolRegistration() {
  if (!protocolMutationStarted || protocolRestored) {
    return { previousProtocolHandler: protocolExisted ? 'restored' : 'absent' };
  }
  await execute('reg.exe', ['delete', protocolKey, '/f']).catch(() => undefined);
  if (protocolExisted) {
    await execute('reg.exe', ['import', protocolSnapshot]);
    const verification = path.join(sandbox, 'repoctopus-protocol-restored.reg');
    await execute('reg.exe', ['export', protocolKey, verification, '/y']);
    const [before, after] = await Promise.all([readFile(protocolSnapshot), readFile(verification)]);
    assert(
      before.equals(after),
      'Previous Repoctopus protocol registration was not restored exactly',
    );
  } else {
    assert(!(await protocolRegistrationExists()), 'Test Repoctopus protocol registration remained');
  }
  protocolRestored = true;
  protocolMutationStarted = false;
  return { previousProtocolHandler: protocolExisted ? 'restored' : 'absent' };
}

async function configureIsolatedProtocolHandler(executable, userData, debugPort) {
  const command = `"${executable}" "--user-data-dir=${userData}" "--remote-debugging-port=${debugPort}" "--enable-logging=stderr" "%1"`;
  await execute('reg.exe', [
    'add',
    `${protocolKey}\\shell\\open\\command`,
    '/ve',
    '/d',
    command,
    '/f',
  ]);
  const registration = await execute('reg.exe', [
    'query',
    'HKCR\\repoctopus\\shell\\open\\command',
    '/ve',
  ]);
  assert(
    registration.stdout.includes(executable),
    'Protocol handler does not target the candidate',
  );
  assert(registration.stdout.includes(userData), 'Protocol handler does not preserve isolation');
  assert(registration.stdout.includes('%1'), 'Protocol handler does not forward the URL');
}

async function launchExplorer(url) {
  assert(explorer && path.win32.isAbsolute(explorer), 'Absolute SystemRoot Explorer is required');
  assert(await exists(explorer), 'SystemRoot Explorer is unavailable');
  await new Promise((resolve, reject) => {
    const child = spawn(explorer, [url], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    const ignoreError = () => undefined;
    const onError = (error) => reject(error);
    child.on('error', ignoreError);
    child.once('error', onError);
    child.once('spawn', () => {
      child.removeListener('error', onError);
      child.unref();
      resolve();
    });
  });
}

async function activateInstalledProtocol(changeId, runId) {
  await launchExplorer(launchUrl(changeId, runId));
}

async function readDiscovery(userData, child) {
  const file = path.join(userData, 'discovery', 'desktop-receiver.json');
  return waitFor(async () => {
    if (child && !isAlive(child)) {
      throw new Error(
        `Repoctopus exited before discovery (${child.exitCode}): ${child.repoctopusOutput.trim()}`,
      );
    }
    const value = JSON.parse(await readFile(file, 'utf8'));
    return typeof value.endpoint === 'string' && typeof value.sessionToken === 'string'
      ? value
      : null;
  }, 'Desktop Receiver discovery');
}

function envelope(changeId, runId) {
  const identity = createHash('sha256').update(`${changeId}\0${runId}`).digest('hex');
  return {
    schemaVersion: 1,
    envelopeId: `sha256:${identity}`,
    digest: `sha256:${createHash('sha256').update(`digest\0${identity}`).digest('hex')}`,
    observedAt: new Date().toISOString(),
    eventType: 'change.lifecycle.transitioned',
    identity: { eventId: 'installed-e2e-event', runId, sequence: 1 },
    correlation: {
      workspaceId: 'workspace-installed-e2e',
      changeId,
      phase: 'open',
    },
    attributes: { fromPhase: 'open', toPhase: 'open', lifecycleStatus: 'running' },
  };
}

async function postOtlp(connection, changeId, runId) {
  const observation = envelope(changeId, runId);
  const attribute = {
    key: 'repoctopus.observation.envelope',
    value: { stringValue: JSON.stringify(observation) },
  };
  const response = await globalThis.fetch(`${connection.endpoint}/v1/logs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${connection.sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [attribute] }] }] }],
    }),
  });
  assert(response.ok, `OTLP export failed with ${response.status}`);
}

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (typeof message.method === 'string') this.events.push(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(port) {
    return waitFor(async () => {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      const target = targets.find((candidate) => candidate.type === 'page');
      if (!target?.webSocketDebuggerUrl) return null;
      const socket = new globalThis.WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
      return new CdpPage(socket);
    }, 'Renderer DevTools endpoint');
  }

  command(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error('Renderer evaluation failed');
    return response.result.value;
  }

  eventsByMethod(method) {
    return this.events.filter((event) => event.method === method);
  }

  close() {
    this.socket.close();
  }
}

async function waitForText(page, text) {
  return waitFor(async () => {
    const body = await page.evaluate('document.body.innerText');
    return typeof body === 'string' && body.includes(text) ? body : null;
  }, `Renderer text ${text}`);
}

async function waitForSelectedChange(page, changeId) {
  return waitFor(
    async () =>
      (await page.evaluate("document.querySelector('main h1')?.textContent")) === changeId,
    `selected change ${changeId}`,
  );
}

async function closeMainWindow(pid) {
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const script = [
    '$source=\'[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);\'',
    'Add-Type -MemberDefinition $source -Name RepoctopusWindow -Namespace Native',
    '$process=Get-Process -Id ([int]$env:REPOCTOPUS_E2E_PID)',
    '$handle=$process.MainWindowHandle',
    "if($handle -eq 0){throw 'Repoctopus main window is unavailable'}",
    "if(-not [Native.RepoctopusWindow]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'WM_CLOSE failed'}",
  ].join('; ');
  await waitFor(
    () =>
      execute(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, REPOCTOPUS_E2E_PID: String(pid) },
      }).then(() => true),
    'Repoctopus main window',
  );
}

function isAlive(child) {
  return child && child.exitCode === null && child.signalCode === null;
}

async function waitForExit(child, label, timeout = 15_000) {
  if (!isAlive(child)) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeout).then(() => {
      throw new Error(`${label} did not exit`);
    }),
  ]);
}

async function forceStop(child) {
  if (!isAlive(child)) return;
  await execute('taskkill.exe', ['/pid', String(child.pid), '/t', '/f']).catch(() => undefined);
  await waitForExit(child, 'forced Repoctopus process', 5_000).catch(() => undefined);
}

async function findUninstaller(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findUninstaller(candidate);
      if (nested) return nested;
    } else if (/^Uninstall Repoctopus\.exe$/iu.test(entry.name)) return candidate;
  }
  return null;
}

async function writeEvidence(status, diagnostic) {
  const bytes = await readFile(installer).catch(() => null);
  const evidence = {
    schemaVersion: 1,
    kind: selfHostWorkspace ? 'WindowsDesktopSelfHostE2E' : 'WindowsDesktopPackageE2E',
    taskId: selfHostWorkspace ? '7.4' : '7.2',
    runtimeRunId,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      windowsRelease: os.release(),
      isolatedUserData: true,
      isolatedDiscovery: true,
    },
    candidate: {
      artifact: path.relative(root, installer).replaceAll('\\', '/'),
      bytes: bytes?.length ?? null,
      digest: bytes ? `sha256:${createHash('sha256').update(bytes).digest('hex')}` : null,
    },
    checks,
    diagnostic,
  };
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 is required');
  assert(await exists(installer), `Packaged installer is missing: ${installer}`);
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-installed-e2e-'));
  await snapshotProtocolRegistration();
  installRoot = path.join(sandbox, 'install');
  const trayUserData = path.join(sandbox, 'tray-user-data');
  await writePreference(trayUserData, 'tray');
  const debugPort = await freePort();

  await runCheck('install-candidate', async () => {
    await execute(installer, ['/S', `/D=${installRoot}`]);
    const candidate = path.join(installRoot, 'Repoctopus.exe');
    assert(await exists(candidate), 'Installed executable missing');
    await configureIsolatedProtocolHandler(candidate, trayUserData, debugPort);
    return { protocolHandler: 'repoctopus' };
  });
  const executable = path.join(installRoot, 'Repoctopus.exe');

  trayProcess = startInstalled(executable, {
    userData: trayUserData,
    debugPort,
    changeId: 'installed-e2e-initial',
    runId: 'run-installed-e2e-initial',
  });
  const page = await CdpPage.connect(debugPort);
  const discovery = await readDiscovery(trayUserData, trayProcess).catch(async (error) => {
    const body = await page.evaluate('document.body.innerText').catch(() => 'renderer unavailable');
    throw new Error(
      `${error.message}; renderer: ${body}; process: ${trayProcess.repoctopusOutput.trim()}`,
    );
  });

  await runCheck('run-activation', async () => {
    const body = await waitForText(page, '等待启动来源的首个观测');
    assert(body.includes('Repoctopus'), 'Installed Renderer did not load');
  });

  await runCheck('otlp-receiver', async () => {
    await postOtlp(discovery, 'installed-e2e-initial', 'run-installed-e2e-initial');
    const body = await waitForText(page, 'installed-e2e-initial');
    assert(body.includes('Open'), 'OTLP projection did not render the Open phase');
  });

  if (selfHostWorkspace) {
    await runCheck('self-hosted-run-projection', async () => {
      const bundledExporter = path.join(sandbox, 'self-host-run-export.mjs');
      await build({
        entryPoints: [path.join(root, 'scripts', 'self-host-run-export.ts')],
        outfile: bundledExporter,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        sourcemap: false,
      });
      await page.command('Network.enable');
      let exported;
      try {
        exported = await execute(
          process.execPath,
          [
            bundledExporter,
            '--workspace',
            selfHostWorkspace,
            '--run',
            runtimeRunId,
            '--endpoint',
            discovery.endpoint,
            '--token',
            discovery.sessionToken,
          ],
          { cwd: root },
        );
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; installed process: ${trayProcess.repoctopusOutput.trim()}`,
          { cause: error },
        );
      }
      const summary = JSON.parse(exported.stdout.trim());
      assert(summary.runId === runtimeRunId, 'Self-host exporter returned another Run');
      assert(summary.trajectoryEvents > 0, 'Self-host exporter observed no Trajectory events');
      await waitFor(async () => {
        const selected = await page.evaluate(`(() => {
            const button = [...document.querySelectorAll('button')].find((candidate) =>
              candidate.textContent?.includes('add-windows-desktop-dashboard'));
            if (!(button instanceof HTMLButtonElement)) return false;
            button.click();
            return true;
          })()`);
        return selected ? true : null;
      }, 'self-hosted change navigation').catch(async (error) => {
        const body = await page.evaluate('document.body.innerText');
        const state = await page.evaluate('window.repoctopusDesktop.currentState()');
        throw new Error(`${error.message}; body: ${body}; state: ${JSON.stringify(state)}`);
      });
      const body = await waitForText(page, runtimeRunId);
      await waitForSelectedChange(page, 'add-windows-desktop-dashboard');
      assert(
        body.includes('build.execute:417ed2ee777f'),
        'Current self-hosted Work was not rendered',
      );
      assert(body.includes('repoctopus-build-execute'), 'Action Skill was not rendered');
      assert(body.includes('tdd'), 'Augmentation Skill was not rendered');
      const phases = await page.evaluate(`Object.fromEntries(
        [...document.querySelectorAll('.phase-step')].map((node) => [
          node.querySelector('h3')?.textContent,
          node.getAttribute('data-state'),
        ]),
      )`);
      assert(phases.Open === 'completed', 'Open phase was not reconstructed as completed');
      assert(phases.Design === 'completed', 'Design phase was not reconstructed as completed');
      assert(
        phases.Build === 'running' || phases.Build === 'rework',
        'Build phase was not reconstructed as active',
      );
      assert(phases.Verify === 'not-reported', 'Verify was incorrectly presented as observed');
      assert(phases.Archive === 'not-reported', 'Archive was incorrectly presented as observed');
      const actions = await page.evaluate(`Object.fromEntries(
        [...document.querySelectorAll('.build-actions > li')].map((node) => [
          node.querySelector('span:nth-of-type(2)')?.textContent,
          node.getAttribute('data-state'),
        ]),
      )`);
      assert(actions.Execute === 'running', 'Execute action was not reconstructed as active');
      const healthDimensions = await page.evaluate(
        "[...document.querySelectorAll('.health-item h3')].map((node) => node.textContent)",
      );
      assert(healthDimensions.length === 4, 'Four explainable health dimensions were not rendered');
      const rendererRequests = page
        .eventsByMethod('Network.requestWillBeSent')
        .map((event) => event.params?.request?.url)
        .filter((url) => typeof url === 'string' && /^https?:/u.test(url));
      assert(rendererRequests.length === 0, 'Renderer made an HTTP query during OTLP projection');
      return {
        runId: summary.runId,
        workspaceId: summary.workspaceId,
        changeId: summary.changeId,
        trajectoryEvents: summary.trajectoryEvents,
        lastSequence: summary.lastSequence,
        otlpRequestCount: summary.requestCount,
        observedPhases: phases,
        observedBuildActions: actions,
        actionSkill: 'repoctopus-build-execute',
        augmentationSkill: 'tdd',
        healthDimensions,
        rendererHttpRequests: rendererRequests,
        futurePhaseClaim: 'not-observed',
      };
    });
  }

  await runCheck('single-instance', async () => {
    await activateInstalledProtocol('installed-e2e-secondary', 'run-installed-e2e-secondary');
    await postOtlp(discovery, 'installed-e2e-secondary', 'run-installed-e2e-secondary');
    await waitForSelectedChange(page, 'installed-e2e-secondary').catch(async (error) => {
      const state = await page.evaluate('window.repoctopusDesktop.currentState()');
      throw new Error(`${error.message}; state: ${JSON.stringify(state)}`);
    });
    const after = await readDiscovery(trayUserData, trayProcess);
    assert(after.pid === discovery.pid, 'Second activation replaced the Desktop Host');
  });

  await runCheck('tray-hide-and-restore', async () => {
    await closeMainWindow(trayProcess.pid);
    await delay(500);
    assert(isAlive(trayProcess), 'Tray preference exited the Shell');
    await activateInstalledProtocol('installed-e2e-restored', 'run-installed-e2e-restored');
    await postOtlp(discovery, 'installed-e2e-restored', 'run-installed-e2e-restored');
    await waitForSelectedChange(page, 'installed-e2e-restored');
    const after = await readDiscovery(trayUserData, trayProcess);
    assert(after.pid === discovery.pid, 'Tray restore replaced the Receiver');
  });
  page.close();
  await forceStop(trayProcess);

  await runCheck('direct-exit', async () => {
    const userData = path.join(sandbox, 'quit-user-data');
    await writePreference(userData, 'quit');
    const port = await freePort();
    quitProcess = startInstalled(executable, {
      userData,
      debugPort: port,
      changeId: 'installed-e2e-quit',
      runId: 'run-installed-e2e-quit',
    });
    await readDiscovery(userData, quitProcess);
    const quitPage = await CdpPage.connect(port);
    await waitForText(quitPage, '等待启动来源的首个观测');
    await quitPage.evaluate('window.close(); true');
    await waitForExit(quitProcess, 'direct-exit Repoctopus process');
    assert(
      !(await exists(path.join(userData, 'discovery', 'desktop-receiver.json'))),
      'Receiver discovery remained after direct exit',
    );
    quitPage.close();
  });

  await runCheck('uninstall-candidate', async () => {
    const uninstaller = await findUninstaller(installRoot);
    assert(uninstaller, 'Repoctopus uninstaller is missing');
    await execute(uninstaller, ['/S']);
    await waitFor(async () => !(await exists(executable)), 'Installed executable removal');
    await waitFor(async () =>
      execute('reg.exe', ['query', protocolKey]).then(
        () => null,
        () => true,
      ),
    );
    assert(await exists(trayUserData), 'Uninstall unexpectedly deleted user data');
  });
  await runCheck('restore-protocol-registration', restoreProtocolRegistration);
}

try {
  await main();
  await writeEvidence('passed', null);
  process.stdout.write(`Windows Desktop package E2E passed; Evidence: ${evidenceFile}\n`);
} catch (error) {
  const diagnostic = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await writeEvidence('failed', diagnostic).catch(() => undefined);
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
} finally {
  await forceStop(trayProcess);
  await forceStop(quitProcess);
  if (protocolMutationStarted) {
    const uninstaller = installRoot ? await findUninstaller(installRoot).catch(() => null) : null;
    if (uninstaller) await execute(uninstaller, ['/S']).catch(() => undefined);
    await restoreProtocolRegistration().catch(() => undefined);
  }
  if (sandbox) await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
