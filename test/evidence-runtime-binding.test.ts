import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceRuntime } from '../app/evidence-runtime.js';
import { RepoctopusRuntime } from '../domains/runtime/runtime.js';
import { createWorkflowPackage } from '../domains/workflow-contract/package.js';
import type { SharedProjectConfig } from '../domains/project-configuration/types.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
  workflowFixture,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

async function fixture() {
  const root = await temporaryDirectory('repoctopus-evidence-binding-');
  cleanup.push(root);
  await createGitRepository(root, 'app');
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace);
  const config: SharedProjectConfig = {
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'RepoctopusProject',
    project: { id: 'binding' },
    repositories: [{ id: 'app', path: '../app' }],
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
    ],
  };
  await writeFile(path.join(workspace, 'repoctopus.yaml'), JSON.stringify(config));
  const definition = structuredClone(workflowFixture().definition);
  definition.steps[0]!.action.evidenceProfile = 'verify';
  const workflow = createWorkflowPackage(definition);
  const store = new FileRuntimeStore(workspace);
  const evidence = new EvidenceRuntime(workspace);
  const runtime = new RepoctopusRuntime(
    store,
    { async export() {} },
    undefined,
    undefined,
    undefined,
    evidence,
  );
  const runId = 'run-evidence-binding';
  await runtime.start({ workflow, projectSnapshot: projectFixture(), runId });
  const waiting = await runtime.next(runId);
  return { evidence, runtime, runId, waiting };
}

describe('Evidence Runtime workflow binding', () => {
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
});
