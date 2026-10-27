import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const installer = path.join(root, 'release', 'desktop', 'Repoctopus-Desktop-0.1.0-x64-Setup.exe');
const evidenceFile = path.resolve(
  process.env.REPOCTOPUS_DESKTOP_E2E_EVIDENCE ??
    path.join(root, 'verification', 'add-windows-desktop-dashboard', 'windows-package-e2e.json'),
);
const runtimeRunId =
  process.env.REPOCTOPUS_WORKFLOW_RUN_ID ??
  'change-repoctopus-add-windows-desktop-dashboard-f5ddf312046dbfbb';
const selfHostWorkspace = process.env.REPOCTOPUS_SELF_HOST_WORKSPACE?.trim() || null;
const checks = [];
const nodeFetch = globalThis.fetch;
const NodeWebSocket = globalThis.WebSocket;
const startedAt = new Date().toISOString();
let sandbox;
let trayProcess;
let quitProcess;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  const checkStarted = Date.now();
  try {
    const details = (await operation()) ?? {};
    checks.push({ id, status: 'passed', durationMs: Date.now() - checkStarted, ...details });
    process.stdout.write(`PASS ${id}\n`);
    return details;
  } catch (error) {
    checks.push({
      id,
      status: 'failed',
      durationMs: Date.now() - checkStarted,
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

function encodedContext(changeId, runId) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'workspace-installed-e2e',
      changeId,
      runId,
    }),
    'utf8',
  ).toString('base64url');
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
      '--repoctopus-launch-context',
      encodedContext(options.changeId, options.runId),
    ],
    {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: options.discoveryRoot,
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

async function readDiscovery(discoveryRoot, child) {
  const file = path.join(discoveryRoot, 'desktop-receiver.json');
  return waitFor(async () => {
    if (child && !isAlive(child)) {
      throw new Error(
        `Repoctopus exited before Receiver discovery (code ${child.exitCode}): ${child.repoctopusOutput.trim()}`,
      );
    }
    const value = JSON.parse(await readFile(file, 'utf8'));
    return typeof value.endpoint === 'string' && typeof value.sessionToken === 'string'
      ? value
      : null;
  }, 'Desktop Receiver discovery');
}

async function postOtlp(connection, changeId, sequence) {
  const attribute = (key, value) => ({
    key,
    value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
  });
  const response = await nodeFetch(`${connection.endpoint}/v1/logs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-repoctopus-session': connection.sessionToken,
    },
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [attribute('repoctopus.workspace.id', 'workspace-installed-e2e')],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                  body: { stringValue: 'change.phase.entered' },
                  attributes: [
                    attribute('repoctopus.event.id', `installed-e2e-${sequence}`),
                    attribute('repoctopus.event.sequence', sequence),
                    attribute('repoctopus.change.id', changeId),
                    attribute('repoctopus.run.id', 'run-installed-e2e'),
                    attribute('repoctopus.workflow.name', 'repoctopus-change'),
                    attribute('repoctopus.execution.phase', 'open'),
                  ],
                },
              ],
            },
          ],
        },
      ],
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
        this.events.push(message);
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
      const response = await nodeFetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      const targets = await response.json();
      const target = targets.find(
        (candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl,
      );
      if (!target) return null;
      const socket = new NodeWebSocket(target.webSocketDebuggerUrl);
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
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? 'Renderer evaluation failed');
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }

  eventsByMethod(method) {
    return this.events.filter((event) => event.method === method);
  }
}

async function waitForText(page, text) {
  return waitFor(async () => {
    const body = await page.evaluate('document.body.innerText');
    return typeof body === 'string' && body.includes(text) ? body : null;
  }, `Renderer text ${text}`);
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
    10_000,
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
    } else if (/^Uninstall Repoctopus\.exe$/iu.test(entry.name)) {
      return candidate;
    }
  }
  return null;
}

async function writeEvidence(status, diagnostic) {
  const installerBytes = (await stat(installer).catch(() => null))?.size ?? null;
  const digest = await readFile(installer)
    .then((bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    .catch(() => null);
  const evidence = {
    schemaVersion: 1,
    kind: selfHostWorkspace ? 'WindowsDesktopSelfHostE2E' : 'WindowsDesktopPackageE2E',
    taskId: selfHostWorkspace ? '8.2' : '7.2',
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
      bytes: installerBytes,
      digest,
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
  const installRoot = path.join(sandbox, 'install');
  const trayUserData = path.join(sandbox, 'tray-user-data');
  const trayDiscovery = path.join(sandbox, 'tray-discovery');

  await runCheck('install-candidate', async () => {
    await execute(installer, ['/S', `/D=${installRoot}`]);
    const executable = path.join(installRoot, 'Repoctopus.exe');
    assert(await exists(executable), 'Installed Repoctopus.exe is missing');
    return { executable: 'Repoctopus.exe' };
  });
  const executable = path.join(installRoot, 'Repoctopus.exe');

  await writePreference(trayUserData, 'tray');
  const debugPort = await freePort();
  trayProcess = startInstalled(executable, {
    userData: trayUserData,
    discoveryRoot: trayDiscovery,
    debugPort,
    changeId: 'installed-e2e-initial',
    runId: 'run-installed-e2e-initial',
  });
  trayProcess.once('error', (error) => {
    process.stderr.write(`Repoctopus process error: ${error.message}\n`);
  });
  const page = await CdpPage.connect(debugPort);
  const discovery = await readDiscovery(trayDiscovery, trayProcess).catch(async (error) => {
    const body = await page.evaluate('document.body.innerText').catch(() => 'renderer unavailable');
    throw new Error(
      `${error.message}; renderer: ${body}; process: ${trayProcess.repoctopusOutput}`,
    );
  });

  await runCheck('run-activation', async () => {
    await waitForText(page, 'installed-e2e-initial');
    return { initialContextRendered: true };
  });

  await runCheck('otlp-receiver', async () => {
    await postOtlp(discovery, 'installed-e2e-initial', 1);
    const body = await waitForText(page, 'Open');
    assert(
      body.includes('installed-e2e-initial'),
      'OTLP projection did not retain change identity',
    );
    return { receiverAcceptedCanonicalOtlp: true };
  });

  if (selfHostWorkspace) {
    await runCheck('self-hosted-run-projection', async () => {
      const source = path.join(root, 'scripts', 'self-host-run-export.ts');
      const bundledExporter = path.join(sandbox, 'self-host-run-export.mjs');
      await build({
        entryPoints: [source],
        outfile: bundledExporter,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        sourcemap: false,
      });
      await page.command('Network.enable');
      const exported = await execute(
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
      const summary = JSON.parse(exported.stdout.trim());
      assert(summary.runId === runtimeRunId, 'Self-host exporter returned another Run');
      assert(summary.trajectoryEvents > 0, 'Self-host exporter observed no Trajectory events');
      await waitFor(async () => {
        const selected = await page.evaluate(`(() => {
          const button = document.querySelector('[data-change-choice="repoctopus/add-windows-desktop-dashboard"]');
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click();
          return true;
        })()`);
        return selected ? true : null;
      }, 'self-hosted change navigation');
      const body = await waitForText(page, runtimeRunId);
      assert(body.includes('build:8.2:'), 'Current self-hosted Work was not rendered');
      assert(body.includes('repoctopus-build-task'), 'Action Skill was not rendered');
      assert(body.includes('tdd'), 'Augmentation Skill was not rendered');
      const phases = await page.evaluate(
        `Object.fromEntries([...document.querySelectorAll('[data-phase-status]')].map((node) => [node.querySelector('strong')?.textContent, node.getAttribute('data-phase-status')]))`,
      );
      assert(phases.Open === 'completed', 'Open phase was not reconstructed as completed');
      assert(phases.Design === 'completed', 'Design phase was not reconstructed as completed');
      assert(
        phases.Build === 'running' || phases.Build === 'rework',
        'Build phase was not reconstructed as active',
      );
      assert(phases.Verify === 'not-started', 'Verify was incorrectly presented as observed');
      assert(phases.Archive === 'not-started', 'Archive was incorrectly presented as observed');
      const rendererRequests = page
        .eventsByMethod('Network.requestWillBeSent')
        .map((event) => event.params?.request?.url)
        .filter((url) => typeof url === 'string' && /^https?:/u.test(url));
      assert(rendererRequests.length === 0, 'Renderer made an HTTP query during OTLP projection');
      return {
        runId: summary.runId,
        trajectoryEvents: summary.trajectoryEvents,
        lastSequence: summary.lastSequence,
        observedPhases: phases,
        actionSkill: 'repoctopus-build-task',
        augmentationSkill: 'tdd',
        rendererHttpRequests: rendererRequests,
        futurePhaseClaim: 'not-observed',
      };
    });
  }

  await runCheck('single-instance', async () => {
    const second = startInstalled(executable, {
      userData: trayUserData,
      discoveryRoot: trayDiscovery,
      debugPort,
      changeId: 'installed-e2e-secondary',
      runId: 'run-installed-e2e-secondary',
    });
    await waitForExit(second, 'secondary Repoctopus instance');
    await waitForText(page, 'installed-e2e-secondary');
    const after = await readDiscovery(trayDiscovery, trayProcess);
    assert(after.pid === discovery.pid, 'Second activation replaced the Desktop Host');
    return { oneHostPid: true, contextForwarded: true };
  });

  await runCheck('tray-hide-and-restore', async () => {
    await closeMainWindow(trayProcess.pid);
    await delay(500);
    assert(isAlive(trayProcess), 'Tray preference exited the Shell');
    const whileHidden = await readDiscovery(trayDiscovery, trayProcess);
    assert(whileHidden.pid === discovery.pid, 'Tray preference stopped or replaced the Receiver');
    const restore = startInstalled(executable, {
      userData: trayUserData,
      discoveryRoot: trayDiscovery,
      debugPort,
      changeId: 'installed-e2e-restored',
      runId: 'run-installed-e2e-restored',
    });
    await waitForExit(restore, 'tray restore activation');
    await waitForText(page, 'installed-e2e-restored');
    return { shellStayedAlive: true, receiverStayedAlive: true, restoredByActivation: true };
  });
  page.close();
  await forceStop(trayProcess);

  await runCheck('direct-exit', async () => {
    const quitUserData = path.join(sandbox, 'quit-user-data');
    const quitDiscovery = path.join(sandbox, 'quit-discovery');
    const quitDebugPort = await freePort();
    await writePreference(quitUserData, 'quit');
    quitProcess = startInstalled(executable, {
      userData: quitUserData,
      discoveryRoot: quitDiscovery,
      debugPort: quitDebugPort,
      changeId: 'installed-e2e-quit',
      runId: 'run-installed-e2e-quit',
    });
    await readDiscovery(quitDiscovery, quitProcess);
    const quitPage = await CdpPage.connect(quitDebugPort);
    await waitForText(quitPage, 'installed-e2e-quit');
    await quitPage.evaluate('window.close(); true');
    await waitForExit(quitProcess, 'direct-exit Repoctopus process');
    await waitFor(
      async () => !(await exists(path.join(quitDiscovery, 'desktop-receiver.json'))),
      'Receiver discovery removal',
    );
    return { shellExited: true, receiverDiscoveryRemoved: true };
  });

  await runCheck('uninstall-candidate', async () => {
    const uninstaller = await findUninstaller(installRoot);
    assert(uninstaller, 'Repoctopus uninstaller is missing');
    await execute(uninstaller, ['/S']);
    await waitFor(async () => !(await exists(executable)), 'Installed executable removal');
    assert(await exists(trayUserData), 'Uninstall unexpectedly deleted user data');
    return { executableRemoved: true, userDataRetained: true };
  });
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
  if (sandbox) {
    await waitFor(async () => {
      await rm(sandbox, { recursive: true, force: true });
      return !(await exists(sandbox));
    }, 'package E2E sandbox cleanup').catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
