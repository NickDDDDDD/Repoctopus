import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout } from 'node:timers';

const root = path.resolve(import.meta.dirname, '..');
const installer = path.join(root, 'release', 'desktop', 'Repoctopus-Desktop-0.1.0-x64-Setup.exe');
const verificationRoot = path.join(root, 'verification', 'add-windows-desktop-dashboard');
const evidenceFile = path.join(verificationRoot, 'desktop-performance.json');
const reportFile = path.join(verificationRoot, 'validation-report.md');
const nodeFetch = globalThis.fetch;
const powershell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

const budgets = {
  installerBytes: { budget: 150 * 1024 * 1024, unit: 'bytes', comparison: 'at-most' },
  coldStartMs: { budget: 15_000, unit: 'milliseconds', comparison: 'at-most' },
  idleWorkingSetBytes: { budget: 700 * 1024 * 1024, unit: 'bytes', comparison: 'at-most' },
  activeWorkingSetBytes: { budget: 850 * 1024 * 1024, unit: 'bytes', comparison: 'at-most' },
  receiverRequestsPerSecond: {
    budget: 75,
    unit: 'requests/second',
    comparison: 'at-least',
  },
};

const methods = {
  installerBytes: 'Byte size of the versioned NSIS x64 setup candidate.',
  coldStartMs:
    'Wall time from CreateProcess for an isolated installed candidate to authenticated Receiver discovery.',
  idleWorkingSetBytes:
    'Sum of WorkingSetSize for the installed Electron Shell process tree after Receiver ready and a 1 second idle settle.',
  activeWorkingSetBytes:
    'Sum of WorkingSetSize for the same process tree after 300 authenticated OTLP log requests and projection settle.',
  receiverRequestsPerSecond:
    '300 authenticated one-record OTLP/HTTP requests at concurrency 16, divided by wall time; every response must be accepted.',
};

let sandbox;
let desktop;
const sandboxPrefix = 'repoctopus-desktop-performance-';

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

async function cleanupStaleSandboxes() {
  const temporaryRoot = path.resolve(os.tmpdir());
  for (const entry of await readdir(temporaryRoot)) {
    if (!entry.startsWith(sandboxPrefix)) continue;
    const target = path.resolve(temporaryRoot, entry);
    if (path.dirname(target) !== temporaryRoot) {
      throw new Error(`Refusing to clean an unbounded performance path: ${target}`);
    }
    await rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
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
    await delay(50);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
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

function launchContext() {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'workspace-performance',
      changeId: 'desktop-performance',
      runId: 'change-desktop-performance-1234',
    }),
    'utf8',
  ).toString('base64url');
}

async function processTreeWorkingSet(rootPid) {
  const script = [
    '$rootPid=[int]$env:REPOCTOPUS_PERF_PID',
    '$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize)',
    '$ids=New-Object System.Collections.Generic.HashSet[int]',
    '[void]$ids.Add($rootPid)',
    'do{$changed=$false;foreach($process in $all){if($ids.Contains([int]$process.ParentProcessId)-and-not $ids.Contains([int]$process.ProcessId)){[void]$ids.Add([int]$process.ProcessId);$changed=$true}}}while($changed)',
    '$members=@($all|Where-Object{$ids.Contains([int]$_.ProcessId)})',
    '$sum=($members|Measure-Object -Property WorkingSetSize -Sum).Sum',
    '[pscustomobject]@{bytes=[int64]$sum;processCount=$members.Count;processIds=@($members.ProcessId)}|ConvertTo-Json -Compress',
  ].join(';');
  const result = await execute(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, REPOCTOPUS_PERF_PID: String(rootPid) } },
  );
  return JSON.parse(result.stdout.trim());
}

function otlpBody(sequence) {
  const attribute = (key, value) => ({
    key,
    value: typeof value === 'number' ? { intValue: String(value) } : { stringValue: value },
  });
  return JSON.stringify({
    resourceLogs: [
      {
        resource: { attributes: [attribute('repoctopus.workspace.id', 'workspace-performance')] },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: (BigInt(Date.now()) * 1_000_000n).toString(),
                body: { stringValue: 'change.phase.entered' },
                attributes: [
                  attribute('repoctopus.event.id', `desktop-performance-${sequence}`),
                  attribute('repoctopus.event.sequence', sequence),
                  attribute('repoctopus.change.id', 'desktop-performance'),
                  attribute('repoctopus.run.id', 'change-desktop-performance-1234'),
                  attribute('repoctopus.workflow.name', 'repoctopus-change'),
                  attribute('repoctopus.execution.phase', 'build'),
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

async function measureThroughput(connection, count = 300, concurrency = 16) {
  let next = 1;
  const startedAt = performance.now();
  async function worker() {
    while (next <= count) {
      const sequence = next++;
      const response = await nodeFetch(`${connection.endpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-repoctopus-session': connection.sessionToken,
        },
        body: otlpBody(sequence),
      });
      assert(response.ok, `OTLP request ${sequence} failed with ${response.status}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - startedAt;
  return { requestsPerSecond: count / (elapsedMs / 1_000), requestCount: count, elapsedMs };
}

function measurement(name, value, details = {}) {
  const budget = budgets[name];
  const passed = budget.comparison === 'at-most' ? value <= budget.budget : value >= budget.budget;
  return { value, ...budget, passed, method: methods[name], ...details };
}

function formatValue(value, unit) {
  if (unit === 'bytes') return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  if (unit === 'milliseconds') return `${value.toFixed(0)} ms`;
  return `${value.toFixed(1)} req/s`;
}

async function writeOutputs(evidence) {
  await mkdir(verificationRoot, { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const rows = Object.entries(evidence.measurements)
    .map(
      ([name, value]) =>
        `| ${name} | ${formatValue(value.value, value.unit)} | ${value.comparison} ${formatValue(value.budget, value.unit)} | ${value.passed ? 'PASS' : 'FAIL'} | ${value.method} |`,
    )
    .join('\n');
  const report = `# Windows Desktop validation report\n\n## Resource budgets\n\nMeasured at ${evidence.completedAt} on Windows ${evidence.environment.windowsRelease}, Node ${evidence.environment.nodeVersion}, ${evidence.environment.architecture}. Results are machine-local release-candidate evidence; the fixed method and budget make later runs comparable.\n\n| Metric | Measured | Budget | Result | Fixed method |\n| --- | ---: | ---: | --- | --- |\n${rows}\n\nThe measurement fails the task when any budget is exceeded. Installer size is the NSIS candidate; memory is the complete installed Shell/Renderer/Desktop Host process tree rather than one convenient process.\n`;
  await writeFile(reportFile, report);
}

async function stopDesktop() {
  if (!desktop || desktop.exitCode !== null) return;
  await execute('taskkill.exe', ['/pid', String(desktop.pid), '/t', '/f']).catch(() => undefined);
  await waitFor(
    () => (desktop.exitCode !== null ? true : false),
    'Desktop process exit',
    5_000,
  ).catch(() => undefined);
}

async function main() {
  assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 is required');
  assert(await exists(installer), `Packaged installer is missing: ${installer}`);
  await cleanupStaleSandboxes();
  sandbox = await mkdtemp(path.join(os.tmpdir(), sandboxPrefix));
  const installRoot = path.join(sandbox, 'install');
  const userData = path.join(sandbox, 'user-data');
  const discoveryRoot = path.join(sandbox, 'discovery');
  await mkdir(path.join(userData, 'desktop'), { recursive: true });
  await writeFile(
    path.join(userData, 'desktop', 'settings.json'),
    `${JSON.stringify({ schemaVersion: 1, closePreference: 'quit' })}\n`,
  );
  await execute(installer, ['/S', `/D=${installRoot}`]);
  const executable = path.join(installRoot, 'Repoctopus.exe');
  assert(await exists(executable), 'Installed Repoctopus.exe is missing');

  const coldStartedAt = performance.now();
  desktop = spawn(
    executable,
    [`--user-data-dir=${userData}`, '--repoctopus-launch-context', launchContext()],
    {
      cwd: path.dirname(executable),
      env: { ...process.env, REPOCTOPUS_DESKTOP_DISCOVERY_ROOT: discoveryRoot },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  const discoveryFile = path.join(discoveryRoot, 'desktop-receiver.json');
  const connection = await waitFor(async () => {
    const parsed = JSON.parse(await readFile(discoveryFile, 'utf8'));
    return parsed.endpoint && parsed.sessionToken ? parsed : null;
  }, 'Receiver discovery');
  const coldStartMs = performance.now() - coldStartedAt;
  await delay(1_000);
  const idle = await processTreeWorkingSet(desktop.pid);
  const throughput = await measureThroughput(connection);
  await delay(500);
  const active = await processTreeWorkingSet(desktop.pid);

  const measurements = {
    installerBytes: measurement('installerBytes', (await stat(installer)).size),
    coldStartMs: measurement('coldStartMs', coldStartMs),
    idleWorkingSetBytes: measurement('idleWorkingSetBytes', idle.bytes, {
      processCount: idle.processCount,
    }),
    activeWorkingSetBytes: measurement('activeWorkingSetBytes', active.bytes, {
      processCount: active.processCount,
    }),
    receiverRequestsPerSecond: measurement(
      'receiverRequestsPerSecond',
      throughput.requestsPerSecond,
      { requestCount: throughput.requestCount, elapsedMs: throughput.elapsedMs },
    ),
  };
  const passed = Object.values(measurements).every((entry) => entry.passed);
  const evidence = {
    schemaVersion: 1,
    kind: 'WindowsDesktopPerformance',
    taskId: '7.4',
    runtimeRunId: 'change-repoctopus-add-windows-desktop-dashboard-f5ddf312046dbfbb',
    status: passed ? 'passed' : 'failed',
    completedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      windowsRelease: os.release(),
      nodeVersion: process.version,
      isolatedInstall: true,
      isolatedUserData: true,
    },
    measurements,
  };
  await writeOutputs(evidence);
  for (const [name, value] of Object.entries(measurements)) {
    process.stdout.write(
      `${value.passed ? 'PASS' : 'FAIL'} ${name}: ${formatValue(value.value, value.unit)} (budget ${value.comparison} ${formatValue(value.budget, value.unit)})\n`,
    );
  }
  assert(passed, `Desktop performance budget exceeded; see ${reportFile}`);
}

try {
  await main();
} finally {
  await stopDesktop();
  if (sandbox) {
    await waitFor(
      async () => {
        await rm(sandbox, { recursive: true, force: true }).catch(() => undefined);
        return !(await exists(sandbox));
      },
      'performance sandbox cleanup',
      10_000,
    );
  }
}
