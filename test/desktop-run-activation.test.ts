import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import type { RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
import { createObservationEnvelope } from '../domains/trajectory/observation.js';
import type { StartChangeRunInput } from '../services/workflow-runs.js';
import {
  createGitRepository,
  createOpenSpecStoreEnvironment,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const executeFile = promisify(execFile);
const productRoot = path.resolve(import.meta.dirname, '..');
const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('Change Run Desktop activation production slice', () => {
  it('activates exactly once after authoritative Run creation and persists a bounded observation', async () => {
    const root = await temporaryDirectory('repoctopus-desktop-run-');
    cleanup.push(root);
    const remote = path.join(root, 'workspace.git');
    await mkdir(remote);
    await executeFile('git', ['init', '--bare', '--initial-branch=main'], { cwd: remote });
    const workspace = await createGitRepository(root, 'workspace', remote);
    await executeFile('git', ['push', '--set-upstream', 'origin', 'main'], { cwd: workspace });
    const environment = await createOpenSpecStoreEnvironment(root, workspace, 'desktop-run');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusWorkspace',
        workspace: { id: 'desktop-run', repositoryId: 'workspace' },
        repositories: [{ id: 'workspace', path: '.' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'workspace',
                covers: ['*'],
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
        specificationProvider: {
          id: 'specification-openspec',
          store: { id: 'desktop-run', repositoryId: 'workspace' },
        },
      }),
    );
    await executeFile('git', ['add', '.'], { cwd: workspace });
    await executeFile('git', ['commit', '-m', 'chore: configure desktop run'], { cwd: workspace });
    await executeFile('git', ['push'], { cwd: workspace });

    const environmentKeys = [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'OPENSPEC_NO_UPDATE_CHECK',
      'OPENSPEC_TELEMETRY',
    ] as const;
    const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
    for (const key of environmentKeys) process.env[key] = environment[key];
    const app = await bootProjectComposition(productRoot, workspace);
    try {
      const projectSnapshot = await app.context.commandRouter.execute<
        {
          workspaceId: string;
          workspaceRoot: string;
          workspaceRepositoryId: string;
          repositories: Array<{ id: string; path: string }>;
        },
        ProjectSnapshot
      >('workspace.snapshot', {
        workspaceId: 'desktop-run',
        workspaceRoot: workspace,
        workspaceRepositoryId: 'workspace',
        repositories: [{ id: 'workspace', path: workspace }],
      });
      const activate = vi.spyOn(app.context.desktopLauncher, 'activate').mockResolvedValue({
        status: 'started',
        targetKind: 'source',
        reason: 'new-instance',
      });
      let persistedBeforeExport = false;
      const exportTelemetry = app.context.workflowTelemetry.export.bind(
        app.context.workflowTelemetry,
      );
      vi.spyOn(app.context.workflowTelemetry, 'export').mockImplementation(async (batch) => {
        const activation = batch.events.find((event) => event.type === 'desktop.activation');
        if (activation) {
          persistedBeforeExport =
            (await app.context.runStore.findEvent(batch.run.runId, activation.eventId)) !== null;
        }
        await exportTelemetry(batch);
      });
      const input: StartChangeRunInput = {
        workspaceId: 'desktop-run',
        workspaceRepositoryId: 'workspace',
        repositoryIds: ['workspace'],
        changeId: 'activation-slice',
        targetBranch: 'main',
        remote: 'origin',
        projectSnapshot,
        projectConfigDigest: `sha256:${'a'.repeat(64)}`,
        verificationProfileId: 'verify',
        executionCheckouts: [{ repositoryId: 'workspace', checkoutPath: workspace }],
      };

      const started = await app.context.commandRouter.execute<
        StartChangeRunInput,
        RuntimeResult<RunStatusView>
      >('run.change.start', input);
      const runId = started.value.state.runId;
      expect(activate).toHaveBeenCalledOnce();
      expect(activate).toHaveBeenCalledWith({
        schemaVersion: 1,
        workspaceId: 'desktop-run',
        changeId: 'activation-slice',
        runId,
      });
      expect(started.diagnostics).toContainEqual({
        level: 'info',
        code: 'desktop.activation.started',
        message: 'Repoctopus Desktop start request was accepted',
      });

      const trajectory = await app.context.runStore.loadTrajectory(runId);
      const activationEvents = trajectory.filter((event) => event.type === 'desktop.activation');
      expect(activationEvents).toHaveLength(1);
      expect(activationEvents[0]?.data).toEqual({
        result: 'started',
        targetKind: 'source',
        reason: 'new-instance',
      });
      const envelope = createObservationEnvelope(activationEvents[0]!, {
        workspaceId: 'desktop-run',
        changeId: 'activation-slice',
      });
      expect(envelope).toMatchObject({
        eventType: 'desktop.activation',
        correlation: { workspaceId: 'desktop-run', changeId: 'activation-slice' },
        attributes: {
          result: 'started',
          targetKind: 'source',
          reason: 'new-instance',
        },
      });
      expect(JSON.stringify(envelope)).not.toContain(workspace);
      expect(persistedBeforeExport).toBe(true);

      await app.context.workflowRuns.status(runId);
      await app.context.workflowRuns.start({
        workflow: workflowFixture(),
        projectSnapshot,
        runId: 'generic-run',
      });
      await expect(
        app.context.workflowRuns.startChange({ ...input, changeId: ' ' }),
      ).rejects.toThrow(/change id/u);
      expect(activate).toHaveBeenCalledOnce();

      const otherResults = [
        {
          changeId: 'activation-existing',
          result: {
            status: 'activated' as const,
            targetKind: 'installed-protocol' as const,
            reason: 'existing-instance' as const,
          },
          diagnostic: { level: 'info', code: 'desktop.activation.activated' },
        },
        {
          changeId: 'activation-unavailable',
          result: {
            status: 'unavailable' as const,
            targetKind: 'none' as const,
            reason: 'target-unavailable' as const,
          },
          diagnostic: { level: 'warning', code: 'desktop.activation.unavailable' },
        },
        {
          changeId: 'activation-unsupported',
          result: {
            status: 'unsupported' as const,
            targetKind: 'none' as const,
            reason: 'platform-unsupported' as const,
          },
          diagnostic: { level: 'warning', code: 'desktop.activation.unsupported' },
        },
      ] as const;
      for (const scenario of otherResults) {
        activate.mockResolvedValueOnce(scenario.result);
        const result = await app.context.workflowRuns.startChange({
          ...input,
          changeId: scenario.changeId,
        });
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([expect.objectContaining(scenario.diagnostic)]),
        );
        expect(result.value.changeLifecycle).toMatchObject({
          identity: { changeId: scenario.changeId },
          phase: 'open',
          currentWork: { kind: 'change.intake' },
        });
        const events = await app.context.runStore.loadTrajectory(result.value.state.runId);
        expect(events.filter((event) => event.type === 'desktop.activation')).toHaveLength(1);
      }
    } finally {
      await app.close();
      for (const key of environmentKeys) {
        const value = previous[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
