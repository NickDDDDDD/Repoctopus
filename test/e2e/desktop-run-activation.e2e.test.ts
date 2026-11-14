import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { access, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { desktopLaunchContextArgument } from '../../app/desktop/shared/launch-context.js';
import { DesktopReceiverDiscovery } from '../../app/desktop/host/receiver-discovery.js';
import type { RunStatusView } from '../../domains/runtime/types.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
} from '../helpers/fixtures.js';
import { runCli } from './cli.js';

const executeFile = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..', '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Desktop activation E2E condition timed out');
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function terminateProcessTree(processId: number): Promise<void> {
  let terminationError: unknown;
  await executeFile('taskkill.exe', ['/pid', String(processId), '/t', '/f'], {
    windowsHide: true,
  }).catch((error: unknown) => {
    terminationError = error;
  });
  const stopped = await waitFor(
    () => Promise.resolve(processIsAlive(processId) ? null : true),
    5_000,
  ).catch(() => false);
  if (!stopped) {
    if (terminationError instanceof Error) throw terminationError;
    if (terminationError) throw new Error('Desktop process termination failed');
    throw new Error(`Desktop process ${processId} did not terminate`);
  }
}

async function shellProcessForContext(
  contextArgument: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ processId: number; executablePath: string }> {
  const powershell = path.join(
    environment.SystemRoot ?? environment.SYSTEMROOT ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return waitFor(async () => {
    const script =
      '$p=Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($env:REPOCTOPUS_CONTEXT) -and $_.CommandLine -notmatch "(?:^|\\s)--type="} | Select-Object -First 1 ProcessId,ExecutablePath; if($p){$p|ConvertTo-Json -Compress}';
    const { stdout } = await executeFile(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...environment, REPOCTOPUS_CONTEXT: contextArgument }, windowsHide: true },
    );
    if (!stdout.trim()) return null;
    const value = JSON.parse(stdout) as { ProcessId: number; ExecutablePath: string };
    return { processId: value.ProcessId, executablePath: value.ExecutablePath };
  });
}

async function createCliOnlyProduct(root: string): Promise<string> {
  const isolated = path.join(root, 'cli-only-product');
  await Promise.all([
    mkdir(path.join(isolated, 'bin'), { recursive: true }),
    mkdir(path.join(isolated, 'dist', 'workflows'), { recursive: true }),
    mkdir(path.join(isolated, 'node_modules'), { recursive: true }),
  ]);
  await Promise.all([
    cp(path.join(productRoot, 'bin', 'repoctopus.js'), path.join(isolated, 'bin', 'repoctopus.js')),
    cp(
      path.join(productRoot, 'dist', 'repoctopus.mjs'),
      path.join(isolated, 'dist', 'repoctopus.mjs'),
    ),
    cp(
      path.join(productRoot, 'dist', 'manifest.json'),
      path.join(isolated, 'dist', 'manifest.json'),
    ),
    cp(path.join(productRoot, 'package.json'), path.join(isolated, 'package.json')),
    cp(path.join(productRoot, 'dist', 'workflows'), path.join(isolated, 'dist', 'workflows'), {
      recursive: true,
    }),
  ]);
  for (const directory of [
    'app',
    'domains',
    'platform',
    'plugins',
    'services',
    'skills',
    'third_party',
    'workflows',
  ]) {
    await symlink(path.join(productRoot, directory), path.join(isolated, directory), 'junction');
  }
  const metadata = JSON.parse(await readFile(path.join(productRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const dependency of Object.keys(metadata.dependencies)) {
    const segments = dependency.split('/');
    const source = path.join(productRoot, 'node_modules', ...segments);
    const target = path.join(isolated, 'node_modules', ...segments);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(source, target, 'junction');
  }
  return isolated;
}

async function isolateInstalledDesktopRegistry(root: string): Promise<() => Promise<void>> {
  const systemRoot = process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim();
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error('Windows SystemRoot is unavailable');
  }
  const registryExecutable = path.win32.join(systemRoot, 'System32', 'reg.exe');
  const entries = [
    { id: 'protocol', key: 'HKCU\\Software\\Classes\\repoctopus', existed: false, file: '' },
    {
      id: 'app-path',
      key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Repoctopus.exe',
      existed: false,
      file: '',
    },
  ];
  for (const entry of entries) {
    entry.file = path.join(root, `${entry.id}-before.reg`);
    entry.existed = await executeFile(registryExecutable, ['query', entry.key], {
      windowsHide: true,
    }).then(
      () => true,
      () => false,
    );
    if (entry.existed) {
      await executeFile(registryExecutable, ['export', entry.key, entry.file, '/y'], {
        windowsHide: true,
      });
    }
  }
  let active = true;
  const restore = async (): Promise<void> => {
    if (!active) return;
    for (const entry of entries) {
      await executeFile(registryExecutable, ['delete', entry.key, '/f'], {
        windowsHide: true,
      }).catch(() => undefined);
      if (entry.existed) {
        await executeFile(registryExecutable, ['import', entry.file], { windowsHide: true });
        const verification = path.join(root, `${entry.id}-restored.reg`);
        await executeFile(registryExecutable, ['export', entry.key, verification, '/y'], {
          windowsHide: true,
        });
        const [before, after] = await Promise.all([readFile(entry.file), readFile(verification)]);
        if (!before.equals(after)) {
          throw new Error(`Repoctopus ${entry.id} registry state was not restored exactly`);
        }
      }
    }
    active = false;
  };
  try {
    for (const entry of entries) {
      await executeFile(registryExecutable, ['delete', entry.key, '/f'], {
        windowsHide: true,
      }).catch(() => undefined);
    }
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

describe('public Change Run Desktop activation', () => {
  it.runIf(process.platform === 'win32')(
    'persists the Run and exports remote OTLP when no Desktop target or handler exists',
    async () => {
      const paths: string[] = [];
      const collector = createServer((request, response) => {
        paths.push(request.url ?? '');
        request.resume();
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'application/x-protobuf' });
          response.end();
        });
      });
      await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('OTLP collector did not bind');

      const root = await temporaryDirectory('repoctopus-desktop-unavailable-e2e-');
      cleanup.push(root);
      const remote = path.join(root, 'workspace.git');
      await mkdir(remote);
      await executeFile('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
      const workspace = await createGitRepository(root, 'workspace', remote);
      await executeFile('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
      const storeEnvironment = await createOpenSpecStoreEnvironment(
        root,
        workspace,
        'desktop-unavailable-e2e',
      );
      const isolatedProduct = await createCliOnlyProduct(root);
      const restoreRegistry = await isolateInstalledDesktopRegistry(root);
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        ...storeEnvironment,
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        REPOCTOPUS_ENVIRONMENT: 'desktop-unavailable-e2e',
      };
      delete environment.REPOCTOPUS_DESKTOP_EXECUTABLE;
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        `${JSON.stringify(
          {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'RepoctopusWorkspace',
            workspace: { id: 'desktop-unavailable-e2e', repositoryId: 'workspace' },
            repositories: [{ id: 'workspace', path: '.' }],
            profiles: [
              {
                id: 'verify',
                nodes: [
                  {
                    id: 'check',
                    type: 'command',
                    repository: 'workspace',
                    executable: process.execPath,
                    args: ['-e', 'process.exit(0)'],
                  },
                ],
              },
            ],
            specificationProvider: {
              id: 'specification-openspec',
              store: { id: 'desktop-unavailable-e2e', repositoryId: 'workspace' },
            },
          },
          null,
          2,
        )}\n`,
      );
      await executeFile('git', ['add', '.'], { cwd: workspace });
      await executeFile('git', ['commit', '-m', 'chore: configure unavailable desktop E2E'], {
        cwd: workspace,
      });
      await executeFile('git', ['push'], { cwd: workspace });
      await executeFile('git', ['switch', '-c', 'spec/desktop-unavailable-e2e'], {
        cwd: workspace,
      });
      await executeFile(
        'git',
        ['push', '--set-upstream', 'origin', 'spec/desktop-unavailable-e2e'],
        { cwd: workspace },
      );

      try {
        const started = await runCli<RunStatusView>({
          packageRoot: isolatedProduct,
          cwd: workspace,
          environment,
          realDesktop: true,
          args: [
            'run',
            'start',
            '--workspace',
            workspace,
            '--change',
            'desktop-unavailable-e2e',
            '--target',
            'main',
          ],
        });
        expect(started.ok).toBe(true);
        expect(started.diagnostics).toContainEqual(
          expect.objectContaining({
            level: 'warning',
            code: 'desktop.activation.unavailable',
          }),
        );
        const runFile = path.join(workspace, '.repoctopus', 'runs', started.runId!, 'run.json');
        await expect(readFile(runFile, 'utf8')).resolves.toContain(started.runId!);
        expect(paths).toEqual(['/v1/logs']);
      } finally {
        try {
          await restoreRegistry();
        } finally {
          await new Promise<void>((resolve, reject) =>
            collector.close((error) => (error ? reject(error) : resolve())),
          );
        }
      }
    },
    120_000,
  );

  it.runIf(process.platform === 'win32')(
    'starts the real source Desktop, forwards Run context, and keeps remote OTLP alive after close',
    async () => {
      const paths: string[] = [];
      const collector = createServer((request, response) => {
        paths.push(request.url ?? '');
        request.resume();
        request.on('end', () => {
          response.writeHead(200, { 'content-type': 'application/x-protobuf' });
          response.end();
        });
      });
      await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('OTLP collector did not bind');

      const root = await temporaryDirectory('repoctopus-desktop-run-e2e-');
      cleanup.push(root);
      const remote = path.join(root, 'workspace.git');
      await mkdir(remote);
      await executeFile('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
      const workspace = await createGitRepository(root, 'workspace', remote);
      await executeFile('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
      const storeEnvironment = await createOpenSpecStoreEnvironment(root, workspace, 'desktop-e2e');
      const profile = path.join(root, 'profile');
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        ...storeEnvironment,
        APPDATA: profile,
        LOCALAPPDATA: profile,
        REPOCTOPUS_OTLP_DIAGNOSTICS: 'full',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}`,
        REPOCTOPUS_ENVIRONMENT: 'desktop-e2e',
      };
      delete environment.ELECTRON_RUN_AS_NODE;
      delete environment.REPOCTOPUS_DESKTOP_EXECUTABLE;
      await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
      await writeFile(
        path.join(workspace, 'repoctopus.yaml'),
        `${JSON.stringify(
          {
            apiVersion: 'repoctopus/v1alpha1',
            kind: 'RepoctopusWorkspace',
            workspace: { id: 'desktop-e2e', repositoryId: 'workspace' },
            repositories: [{ id: 'workspace', path: '.' }],
            profiles: [
              {
                id: 'verify',
                nodes: [
                  {
                    id: 'check',
                    type: 'command',
                    repository: 'workspace',
                    executable: process.execPath,
                    args: ['-e', 'process.exit(0)'],
                  },
                ],
              },
            ],
            specificationProvider: {
              id: 'specification-openspec',
              store: { id: 'desktop-e2e', repositoryId: 'workspace' },
            },
          },
          null,
          2,
        )}\n`,
      );
      await executeFile('git', ['add', '.'], { cwd: workspace });
      await executeFile('git', ['commit', '-m', 'chore: configure desktop E2E'], {
        cwd: workspace,
      });
      await executeFile('git', ['push'], { cwd: workspace });
      await executeFile('git', ['switch', '-c', 'spec/desktop-activation-e2e'], {
        cwd: workspace,
      });
      await executeFile(
        'git',
        ['push', '--set-upstream', 'origin', 'spec/desktop-activation-e2e'],
        { cwd: workspace },
      );

      const context = {
        schemaVersion: 1 as const,
        workspaceId: 'desktop-e2e',
        changeId: 'desktop-activation-e2e',
        runId: '',
      };
      let shell: { processId: number; executablePath: string } | undefined;
      try {
        const started = await runCli<RunStatusView>({
          packageRoot: productRoot,
          cwd: workspace,
          environment,
          realDesktop: true,
          args: [
            'run',
            'start',
            '--workspace',
            workspace,
            '--change',
            context.changeId,
            '--target',
            'main',
          ],
        });
        if (!started.diagnostics.some(({ code }) => code === 'desktop.activation.started')) {
          const trajectory = await readFile(
            path.join(workspace, '.repoctopus', 'runs', started.runId!, 'trajectory.jsonl'),
            'utf8',
          ).catch((error: unknown) => String(error));
          const sourceArtifacts = await Promise.all(
            ['node_modules/electron/dist/electron.exe', 'dist/desktop/main.js'].map(
              async (relativePath) => ({
                relativePath,
                available: await access(path.join(productRoot, relativePath)).then(
                  () => true,
                  () => false,
                ),
              }),
            ),
          );
          process.stderr.write(
            `${JSON.stringify({
              desktopActivationFailure: {
                workspace,
                runId: started.runId,
                sourceArtifacts,
                parentDesktopOverridePresent: Boolean(process.env.REPOCTOPUS_DESKTOP_EXECUTABLE),
                parentElectronNodeModePresent: Boolean(process.env.ELECTRON_RUN_AS_NODE),
                fixtureDesktopOverridePresent: Boolean(environment.REPOCTOPUS_DESKTOP_EXECUTABLE),
                fixtureElectronNodeModePresent: Boolean(environment.ELECTRON_RUN_AS_NODE),
                activationEvents: trajectory
                  .split('\n')
                  .filter((line) => line.includes('desktop.activation')),
              },
            })}\n`,
          );
        }
        expect(started.diagnostics).toContainEqual(
          expect.objectContaining({ code: 'desktop.activation.started' }),
        );
        context.runId = started.runId!;
        const contextArgument = desktopLaunchContextArgument(context);
        shell = await shellProcessForContext(contextArgument, environment);
        expect(path.resolve(shell.executablePath)).toBe(
          path.join(productRoot, 'node_modules', 'electron', 'dist', 'electron.exe'),
        );
        const discoveryFile = path.join(
          profile,
          'Repoctopus',
          'discovery',
          'desktop-receiver.json',
        );
        const discovery = await waitFor(async () => {
          try {
            return JSON.parse(await readFile(discoveryFile, 'utf8')) as { pid: number };
          } catch {
            return null;
          }
        });
        expect(discovery.pid).toBeGreaterThan(0);

        const beforeClose = paths.length;
        await terminateProcessTree(shell.processId);
        await waitFor(async () => {
          const result = await new DesktopReceiverDiscovery({ environment }).discover();
          return result.status === 'unavailable' && result.reason === 'process-mismatch'
            ? result
            : null;
        });
        await rm(discoveryFile, { force: true });
        const next = await runCli<RunStatusView>({
          packageRoot: productRoot,
          cwd: workspace,
          environment,
          args: ['run', 'next', '--workspace', workspace, '--run', started.runId!],
        });
        expect(next.result?.state.status).toBe('running');
        await waitFor(() => Promise.resolve(paths.length > beforeClose ? paths.length : null));
        expect(new Set(paths)).toEqual(new Set(['/v1/traces', '/v1/logs', '/v1/metrics']));
      } finally {
        if (shell) {
          await terminateProcessTree(shell.processId).catch(() => undefined);
        }
        await new Promise<void>((resolve, reject) =>
          collector.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    90_000,
  );
});
