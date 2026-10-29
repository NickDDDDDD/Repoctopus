import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
      '$p=Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($env:REPOCTOPUS_CONTEXT)} | Select-Object -First 1 ProcessId,ExecutablePath; if($p){$p|ConvertTo-Json -Compress}';
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

describe('public Change Run Desktop activation', () => {
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
        await executeFile('taskkill.exe', ['/pid', String(shell.processId), '/t', '/f'], {
          windowsHide: true,
        });
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
          await executeFile('taskkill.exe', ['/pid', String(shell.processId), '/t', '/f'], {
            windowsHide: true,
          }).catch(() => undefined);
        }
        await new Promise<void>((resolve, reject) =>
          collector.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    90_000,
  );
});
