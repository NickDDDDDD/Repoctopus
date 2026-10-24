import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';

import { EvidenceCoordinator } from '../services/evidence-coordinator.js';
import { CompositionIdentity } from '../services/composition-identity.js';
import { FileRunStoreProvider } from '../plugins/run/file-run-store-provider.js';
import { EvidenceAdapters } from '../services/evidence-adapters.js';
import {
  localBrowserContributor,
  localCommandContributor,
  localServiceContributor,
} from '../plugins/evidence/local-adapter-contributors.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
import type { RunState } from '../domains/engine/types.js';
import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  commitGitRepository,
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
const contexts: Context[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.fiber.dispose()));
  await Promise.all(cleanup.splice(0).map(removeTemporaryDirectory));
});

async function fixture() {
  const root = await temporaryDirectory('repoctopus-evidence-binding-');
  cleanup.push(root);
  await createGitRepository(root, 'app');
  const workspace = await createGitRepository(root, 'workspace');
  const config: SharedProjectConfig = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusWorkspace',
    workspace: { id: 'binding', repositoryId: 'workspace' },
    repositories: [
      { id: 'workspace', path: '.' },
      { id: 'app', path: '../app' },
    ],
    profiles: [
      {
        id: 'verify',
        nodes: [
          {
            id: 'check',
            type: 'command',
            repository: 'app',
            dependsOn: [],
            required: true,
            executable: process.execPath,
            args: ['-e', 'process.exit(0)'],
            timeoutMs: 5_000,
            cache: false,
          },
        ],
      },
      {
        id: 'post-merge',
        nodes: [
          {
            id: 'check-merged-code',
            type: 'command',
            repository: 'app',
            dependsOn: [],
            required: true,
            executable: process.execPath,
            args: ['-e', 'process.exit(0)'],
            timeoutMs: 5_000,
            cache: false,
          },
        ],
      },
    ],
  };
  await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
  await writeFile(path.join(workspace, '.gitignore'), '.repoctopus/\n');
  await commitGitRepository(workspace, 'configure workspace');
  const definition = structuredClone(workflowFixture().definition);
  definition.steps[0]!.action.evidenceProfile = 'verify';
  const workflow = createWorkflowPackage(definition);
  const store = new FileRuntimeStore(workspace);
  const context = new Context();
  contexts.push(context);
  new CompositionIdentity(context, compositionFixture());
  new FileRunStoreProvider(context, { workspaceRoot: workspace });
  new EvidenceAdapters(context);
  await context.plugin(localCommandContributor);
  await context.plugin(localServiceContributor, { workspaceRoot: workspace });
  await context.plugin(localBrowserContributor, { workspaceRoot: workspace });
  await context.plugin(EvidenceCoordinator, {
    workspaceRoot: workspace,
    postMergeEvidenceProfile: 'post-merge',
  });
  const evidence = context.evidenceCoordinator;
  const runtime = new WorkflowRunCoordinator(
    store,
    { async export() {} },
    compositionFixture(),
    undefined,
    undefined,
    undefined,
    evidence,
  );
  const runId = 'run-evidence-binding';
  await runtime.start({ workflow, projectSnapshot: projectFixture(), runId });
  const waiting = await runtime.next(runId);
  return { app: path.join(root, 'app'), evidence, runtime, runId, store, waiting };
}

describe('EvidenceCoordinator workflow binding', () => {
  it('binds an attempt to the exact pending action and commits its bundle with the transition', async () => {
    const { evidence, runtime, runId, waiting } = await fixture();
    const result = await evidence.run('verify', 'attempt-action-bound', runId);
    expect(result.gate).toMatchObject({
      workflowRunId: runId,
      workflowActionId: waiting.value.state.pendingActionId,
      workflowStepId: waiting.value.state.currentStep,
      workflowStateVersion: waiting.value.state.stateVersion,
      status: 'satisfied',
    });

    const completed = await runtime.record({
      runId,
      actionId: waiting.value.state.pendingActionId!,
      status: 'succeeded',
      summary: 'verified',
      evidenceAttemptId: 'attempt-action-bound',
    });
    expect(completed.value.state.acceptedEvidenceBundleIds).toEqual([result.bundle.bundleId]);
  });

  it('rejects evidence after the workflow state version changes', async () => {
    const { evidence, runtime, runId, waiting } = await fixture();
    await evidence.run('verify', 'attempt-stale-state', runId);
    await runtime.resume({ runId, currentProjectSnapshot: projectFixture() });

    await expect(
      runtime.record({
        runId,
        actionId: waiting.value.state.pendingActionId!,
        status: 'succeeded',
        summary: 'stale verification',
        evidenceAttemptId: 'attempt-stale-state',
      }),
    ).rejects.toThrow(/stale workflow state/i);
  });

  it('binds Archive Evidence to the configured post-merge profile', async () => {
    const { app, evidence, runId, store } = await fixture();
    const state = await store.loadRun(runId);
    state.status = 'running';
    state.changeLifecycle = {
      phase: 'archive',
      status: 'running',
      currentWork: {
        workId: 'archive:verify-merged:test',
        kind: 'delivery.verify-merged',
        inputDigest: `sha256:${'a'.repeat(64)}`,
      },
    } as unknown as NonNullable<RunState['changeLifecycle']>;
    await writeFile(store.paths(runId).run, JSON.stringify(state));

    const result = await evidence.runForRepositories(
      'post-merge',
      [{ repositoryId: 'app', root: app }],
      'attempt-post-merge-bound',
      runId,
    );
    expect(result.gate).toMatchObject({
      workflowRunId: runId,
      workflowActionId: 'archive:verify-merged:test',
      workflowStepId: 'archive.verify-merged',
      workflowStateVersion: state.stateVersion,
      status: 'satisfied',
    });

    await expect(
      evidence.runForRepositories(
        'verify',
        [{ repositoryId: 'app', root: app }],
        'attempt-wrong-post-merge-profile',
        runId,
      ),
    ).rejects.toThrow(/no active post-merge Verify Work/i);
  });
});
