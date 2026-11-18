import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';
import { runProcess, stopProcessTree } from './package-e2e-process.mjs';

import { describeFile, assertWorkflowAcceptance } from './release-policy.mjs';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const started = Date.now();
const evidenceFile = path.resolve(
  process.env.REPOCTOPUS_WORKFLOW_E2E_EVIDENCE ??
    path.join(
      scriptRoot,
      '..',
      'dist',
      'windows-multirepo-evidence',
      String(started),
      'receipt.json',
    ),
);
const evidenceDirectory = path.dirname(evidenceFile);
const receipt = {
  kind: 'WindowsMultirepoPackageE2E',
  status: 'running',
  startedAt: new Date(started).toISOString(),
  checks: [],
};
await mkdir(evidenceDirectory, { recursive: true });
const output = createWriteStream(path.join(evidenceDirectory, 'driver.log'));
let root;
let server;
let stage = 'candidate-input';
let active;

function execute(file, args, options = {}) {
  const remaining = 900_000 - (Date.now() - started);
  if (remaining <= 0) throw new Error('Acceptance exceeded its 15 minute budget');
  return runProcess(file, args, {
    ...options,
    timeout: Math.min(options.timeout ?? 120_000, remaining),
    label: stage,
    onSpawn: (child) => {
      active = child;
    },
    onOutput: (chunk) => {
      output.write(chunk);
    },
  })
    .then((result) => result.stdout)
    .finally(() => {
      active = null;
    });
}
async function openssl() {
  const paths = (await execute('where.exe', ['git'])).trim().split(/\r?\n/u);
  for (const git of paths) {
    const executable = path.resolve(path.dirname(git), '..', 'usr', 'bin', 'openssl.exe');
    if (
      await access(executable).then(
        () => true,
        () => false,
      )
    )
      return executable;
  }
  throw new Error('Git for Windows OpenSSL is required for the local HTTPS fixture');
}

try {
  await writeFile(evidenceFile, JSON.stringify(receipt, null, 2) + '\n');
  const input = process.argv[2];
  assert(
    input && input.endsWith('.tgz'),
    'Usage: npm run test:windows-multirepo-package-e2e -- <candidate.tgz>',
  );
  assert.equal(process.platform, 'win32', 'Run this acceptance on Windows');
  const archive = path.resolve(input);
  receipt.candidate = await describeFile(path.dirname(archive), path.basename(archive));
  const npm = process.env.npm_execpath;
  assert(npm, 'Start this test through npm run');
  root = await mkdtemp(path.join(os.tmpdir(), 'rpwm-'));
  await mkdir(path.join(root, 'evidence'));
  const installation = path.join(root, 'installation');
  stage = 'install-candidate';
  await execute(
    process.execPath,
    [
      npm,
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--prefix',
      installation,
      archive,
    ],
    { cwd: root, timeout: 180_000 },
  );
  const packageRoot = path.join(installation, 'node_modules', 'repoctopus');
  await access(path.join(packageRoot, 'bin', 'repoctopus.js'));
  stage = 'start-fixture';
  await execute(await openssl(), [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    path.join(root, 'key.pem'),
    '-out',
    path.join(root, 'cert.pem'),
    '-days',
    '2',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  server = spawn(process.execPath, [path.join(scriptRoot, 'multirepo-package-server.mjs'), root], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  server.stdout.pipe(output, { end: false });
  server.stderr.pipe(output, { end: false });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 20_000);
    server.once('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Fixture exited ' + code));
    });
  });
  const manifest = path.join(root, 'manifest.json');
  await writeFile(
    manifest,
    JSON.stringify({ root, evidence: path.join(root, 'evidence'), packageRoot, ...ready }),
  );
  stage = 'init-and-first-package';
  await execute(
    process.execPath,
    [path.join(scriptRoot, 'multirepo-package-host.mjs'), manifest, 'first'],
    { cwd: root, timeout: 900_000 },
  );
  stage = 'cold-recovery-and-archive';
  await execute(
    process.execPath,
    [path.join(scriptRoot, 'multirepo-package-host.mjs'), manifest, 'finish'],
    { cwd: root, timeout: 900_000 },
  );
  stage = 'verify-receipt';
  for (const file of ['cold-recovery.json', 'publication-recovery.json', 'terminal.json']) {
    await access(path.join(root, 'evidence', file));
  }
  const terminal = JSON.parse(await readFile(path.join(root, 'evidence', 'terminal.json'), 'utf8'));
  receipt.runId = terminal.runId;
  receipt.finalStatus = terminal.status;
  receipt.checks = [
    'init-to-archive',
    'build-cold-recovery',
    'publication-response-loss',
    'terminal-recovery',
  ].map((id) => ({ id, status: 'passed' }));
  assert.deepEqual(
    await describeFile(path.dirname(archive), path.basename(archive)),
    receipt.candidate,
    'Candidate changed during acceptance',
  );
  receipt.status = 'passed';
  assertWorkflowAcceptance(receipt, receipt.candidate);
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = { stage, message: error instanceof Error ? error.stack : String(error) };
  process.stderr.write(receipt.failure.message + '\n');
  process.exitCode = 1;
} finally {
  await stopProcessTree(active);
  if (server?.connected) {
    const exited = once(server, 'exit');
    server.send('stop');
    const timer = setTimeout(() => {
      void stopProcessTree(server);
    }, 5_000);
    await exited;
    clearTimeout(timer);
  } else {
    await stopProcessTree(server);
  }
  if (root) {
    await cp(path.join(root, 'evidence'), evidenceDirectory, { recursive: true });
    const temporaryBase = path.resolve(os.tmpdir());
    assert(path.dirname(root) === temporaryBase && path.basename(root).startsWith('rpwm-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  receipt.durationMs = Date.now() - started;
  await writeFile(evidenceFile, JSON.stringify(receipt, null, 2) + '\n');
  output.end();
  process.stdout.write(
    receipt.status.toUpperCase() +
      ' Windows multirepo package acceptance\n' +
      'Evidence: ' +
      evidenceFile +
      '\n',
  );
}
