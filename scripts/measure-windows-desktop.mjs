import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { releaseAssetNames } from './release-policy.mjs';

const root = path.resolve(import.meta.dirname, '..');
const { version: packageVersion } = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const [, installerName] = releaseAssetNames(packageVersion);
const installer = path.join(root, 'dist', 'desktop-release', installerName);
const evidenceFile = path.resolve(
  process.env.REPOCTOPUS_DESKTOP_PERFORMANCE_EVIDENCE ??
    path.join(root, 'verification', 'add-windows-desktop-dashboard', 'desktop-performance.json'),
);
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
    'Sum of WorkingSetSize for the installed Shell, Renderer and Host process tree after a one-second idle settle.',
  activeWorkingSetBytes:
    'Sum of WorkingSetSize for the same process tree after 300 authenticated canonical OTLP requests.',
  receiverRequestsPerSecond:
    '300 accepted one-record canonical OTLP/HTTP requests at concurrency 16 divided by wall time.',
};

let sandbox;
let desktop;

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

function launchArgument() {
  const context = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'workspace-performance',
      changeId: 'desktop-performance',
      runId: 'change-desktop-performance-1234',
    }),
  ).toString('base64url');
  return `--repoctopus-launch=${context}`;
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
    '[pscustomobject]@{bytes=[int64]$sum;processCount=$members.Count}|ConvertTo-Json -Compress',
  ].join(';');
  const result = await execute(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { env: { ...process.env, REPOCTOPUS_PERF_PID: String(rootPid) } },
  );
  return JSON.parse(result.stdout.trim());
}

function observation(sequence) {
  const eventId = `desktop-performance-${sequence}`;
  const runId = 'change-desktop-performance-1234';
  const envelopeId = `sha256:${createHash('sha256').update(`${eventId}\0${runId}\0${sequence}`).digest('hex')}`;
  return {
    schemaVersion: 1,
    envelopeId,
    digest: `sha256:${createHash('sha256').update(`digest\0${envelopeId}`).digest('hex')}`,
    observedAt: new Date().toISOString(),
    eventType: 'work.created',
    identity: { eventId, runId, sequence },
    correlation: {
      workspaceId: 'workspace-performance',
      changeId: 'desktop-performance',
      phase: 'build',
      buildAction: 'execute',
      workId: 'build.execute:performance',
    },
    attributes: { stateVersion: sequence },
  };
}

function otlpBody(sequence) {
  const envelope = observation(sequence);
  return JSON.stringify({
    resourceLogs: [
      {
        scopeLogs: [
          {
            scope: { name: 'repoctopus-runtime', version: packageVersion },
            logRecords: [
              {
                eventName: 'repoctopus.work.created',
                attributes: [
                  {
                    key: 'repoctopus.observation.envelope',
                    value: { stringValue: JSON.stringify(envelope) },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

async function measureThroughput(connection, count = 300, concurrency = 8) {
  let next = 1;
  const startedAt = performance.now();
  async function worker() {
    while (next <= count) {
      const sequence = next++;
      const response = await globalThis.fetch(`${connection.endpoint}/v1/logs`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${connection.sessionToken}`,
          'content-type': 'application/json',
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
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'repoctopus-desktop-performance-'));
  const installRoot = path.join(sandbox, 'install');
  const userData = path.join(sandbox, 'user-data');
  await mkdir(path.join(userData, 'desktop'), { recursive: true });
  await writeFile(
    path.join(userData, 'desktop', 'settings.json'),
    `${JSON.stringify({ schemaVersion: 1, closePreference: 'quit' })}\n`,
  );
  await execute(installer, ['/S', `/D=${installRoot}`]);
  const executable = path.join(installRoot, 'Repoctopus.exe');
  assert(await exists(executable), 'Installed executable is missing');

  const startedAt = performance.now();
  desktop = spawn(executable, [`--user-data-dir=${userData}`, launchArgument()], {
    cwd: installRoot,
    windowsHide: true,
    stdio: 'ignore',
  });
  const discoveryFile = path.join(userData, 'discovery', 'desktop-receiver.json');
  const connection = await waitFor(async () => {
    const parsed = JSON.parse(await readFile(discoveryFile, 'utf8'));
    return parsed.endpoint && parsed.sessionToken ? parsed : null;
  }, 'Receiver discovery');
  const coldStartMs = performance.now() - startedAt;
  await delay(1_000);
  const idle = await processTreeWorkingSet(desktop.pid);
  const throughput = await measureThroughput(connection);
  await delay(500);
  const active = await processTreeWorkingSet(desktop.pid);
  const candidate = await readFile(installer);
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
    taskId: '7.5',
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
    candidate: {
      artifact: path.relative(root, installer).replaceAll('\\', '/'),
      bytes: candidate.length,
      digest: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    },
    measurements,
  };
  await mkdir(path.dirname(evidenceFile), { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  for (const [name, value] of Object.entries(measurements)) {
    process.stdout.write(`${value.passed ? 'PASS' : 'FAIL'} ${name}: ${value.value}\n`);
  }
  assert(passed, `Desktop performance budget exceeded; see ${evidenceFile}`);
}

try {
  await main();
} finally {
  await stopDesktop();
  if (sandbox) await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
