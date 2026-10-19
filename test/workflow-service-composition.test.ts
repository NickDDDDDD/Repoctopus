import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import type { ProjectSnapshot } from '../domains/project/types.js';
import type { RunStatusView, RuntimeResult } from '../domains/runtime/types.js';
import { parseWorkflowPackage } from '../domains/workflow-contract/package.js';
import {
  createGitRepository,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

describe('WorkflowRuns Cordis composition', () => {
  it('persists action Intent and Receipt outside the protected Run transition', async () => {
    const projectRoot = await temporaryDirectory('repoctopus-workflow-service-');
    cleanup.push(projectRoot);
    const workspace = await createGitRepository(projectRoot, 'workspace');
    await createGitRepository(projectRoot, 'front');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusProject',
        project: { id: 'workflow-service' },
        repositories: [{ id: 'front', path: '../front' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'front',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    const productRoot = path.resolve(import.meta.dirname, '..');
    const workflowPath = path.join(productRoot, 'workflows', 'foundation.yaml');
    const workflow = parseWorkflowPackage(await readFile(workflowPath, 'utf8'));
    const app = await bootProjectComposition(productRoot, workspace);

    try {
      const projectSnapshot = await app.context.commandRouter.execute<
        { root: string; workspaceRoot: string },
        ProjectSnapshot
      >('project.probe', { root: projectRoot, workspaceRoot: workspace });
      const started = await app.context.commandRouter.execute<
        {
          workflow: typeof workflow;
          projectSnapshot: ProjectSnapshot;
          runId: string;
          workflowSource: string;
        },
        RuntimeResult<RunStatusView>
      >('run.start', {
        workflow,
        projectSnapshot,
        runId: 'manual-action-run',
        workflowSource: workflowPath,
      });
      expect(started.value.state.pendingActionId).toBeNull();

      const proposed = await app.context.commandRouter.execute<
        { runId: string },
        RuntimeResult<RunStatusView>
      >('run.next', { runId: 'manual-action-run' });
      const action = proposed.value.nextAction;
      expect(action).not.toBeNull();
      const intent = await app.context.actionStore.loadIntent('manual-action-run', action!.id);
      expect(intent).toMatchObject({
        runId: 'manual-action-run',
        compositionDigest: app.composition.compositionDigest,
        action: { id: action!.id },
        adapter: 'manual',
      });

      const completed = await app.context.commandRouter.execute<
        {
          runId: string;
          actionId: string;
          status: 'succeeded';
          summary: string;
          eventId: string;
        },
        RuntimeResult<RunStatusView>
      >('run.record', {
        runId: 'manual-action-run',
        actionId: action!.id,
        status: 'succeeded',
        summary: 'manual checkpoint accepted',
        eventId: 'manual-event-001',
      });
      expect(completed.value.state.pendingActionId).toBeNull();
      expect(completed.value.state.currentStep).toBe('execute');

      const trajectory = await app.context.runStore.loadTrajectory('manual-action-run');
      const completedEvent = trajectory.find((event) => event.type === 'action.completed');
      expect(completedEvent?.data.actionReceiptId).toMatch(/^[a-f0-9]{64}$/);
      const receipt = await app.context.actionStore.loadReceipt(
        'manual-action-run',
        completedEvent!.data.actionReceiptId as string,
      );
      expect(receipt).toMatchObject({
        intentId: intent.intentId,
        compositionDigest: app.composition.compositionDigest,
        actionId: action!.id,
        outcome: 'succeeded',
      });
    } finally {
      await app.close();
    }
  });
});
