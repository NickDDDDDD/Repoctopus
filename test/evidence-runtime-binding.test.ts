import { readFile, unlink, writeFile } from 'node:fs/promises';
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
        id: 'verify-alt',
        nodes: [
          {
            id: 'check-alt',
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
  return { app: path.join(root, 'app'), evidence, runtime, runId, store, waiting, workspace };
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

  it('rejects duplicate attempt creation and repairs the completed-attempt context gap', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-context-gap';
    const completed = await evidence.run('verify', attemptId, runId);

    await expect(evidence.run('verify', attemptId, runId)).rejects.toThrow(
      /Evidence attempt already exists/u,
    );

    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const context = JSON.parse(await readFile(contextFile, 'utf8')) as Record<string, unknown>;
    await writeFile(
      contextFile,
      JSON.stringify({ ...context, status: 'running', bundleId: null }),
      'utf8',
    );

    const recovered = await evidence.resume(attemptId);
    expect(recovered.context.status).toBe('recovered');
    expect(recovered.bundle?.bundleId).toBe(completed.bundle.bundleId);
    expect(recovered.attempt.status).toBe('completed');
  });

  it('auto-recovers a journaled running attempt instead of executing it again', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-running-recovery';
    const completed = await evidence.run('verify', attemptId, runId);
    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const attemptFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'attempts',
      `${attemptId}.json`,
    );
    const bundleFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'bundles',
      `${completed.bundle.bundleId}.json`,
    );
    const context = JSON.parse(await readFile(contextFile, 'utf8')) as Record<string, unknown>;
    const attempt = JSON.parse(await readFile(attemptFile, 'utf8')) as Record<string, unknown>;
    const runningAttempt = { ...attempt };
    delete runningAttempt.completedAt;
    await Promise.all([
      writeFile(
        contextFile,
        JSON.stringify({ ...context, status: 'running', bundleId: null }),
        'utf8',
      ),
      writeFile(
        attemptFile,
        JSON.stringify({ ...runningAttempt, status: 'running', receiptIds: [] }),
        'utf8',
      ),
      unlink(bundleFile),
    ]);

    const recovered = await evidence.runOrResume('verify', attemptId, runId);
    expect(recovered.context.status).toBe('recovered');
    expect(recovered.bundle?.outcome).toBe('passed');
    expect(recovered.attempt.status).toBe('completed');
  });

  it('rebuilds a missing bundle from a terminal attempt and its journal', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-terminal-bundle-gap';
    const completed = await evidence.run('verify', attemptId, runId);
    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const bundleFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'bundles',
      `${completed.bundle.bundleId}.json`,
    );
    const context = JSON.parse(await readFile(contextFile, 'utf8')) as Record<string, unknown>;
    await Promise.all([
      writeFile(
        contextFile,
        JSON.stringify({ ...context, status: 'running', bundleId: null }),
        'utf8',
      ),
      unlink(bundleFile),
    ]);

    const recovered = await evidence.runOrResume('verify', attemptId, runId);
    expect(recovered.context.status).toBe('recovered');
    expect(recovered.bundle?.outcome).toBe('passed');
    expect(recovered.attempt.status).toBe('completed');
  });

  it('preserves terminal superseded status while rebuilding a missing bundle', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-superseded-bundle-gap';
    const completed = await evidence.run('verify', attemptId, runId);
    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const attemptFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'attempts',
      `${attemptId}.json`,
    );
    const bundleFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'bundles',
      `${completed.bundle.bundleId}.json`,
    );
    const [context, attempt] = await Promise.all([
      readFile(contextFile, 'utf8').then((source) => JSON.parse(source) as Record<string, unknown>),
      readFile(attemptFile, 'utf8').then((source) => JSON.parse(source) as Record<string, unknown>),
    ]);
    await Promise.all([
      writeFile(
        contextFile,
        JSON.stringify({ ...context, status: 'running', bundleId: null }),
        'utf8',
      ),
      writeFile(attemptFile, JSON.stringify({ ...attempt, status: 'superseded' }), 'utf8'),
      unlink(bundleFile),
    ]);

    const recovered = await evidence.runOrResume('verify', attemptId, runId);
    expect(recovered.context.status).toBe('recovered');
    expect(recovered.attempt.status).toBe('superseded');
    expect(recovered.bundle?.outcome).toBe('incomplete');
    expect(recovered.bundle?.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'input-drift' })]),
    );
  });

  it('continues a prepared context that has no Attempt yet', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-prepared-context';
    const completed = await evidence.run('verify', attemptId, runId);
    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const attemptFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'attempts',
      `${attemptId}.json`,
    );
    const bundleFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'bundles',
      `${completed.bundle.bundleId}.json`,
    );
    const journalFile = path.join(
      workspace,
      '.repoctopus',
      'runtime',
      'attempts',
      attemptId,
      'journal.jsonl',
    );
    const context = JSON.parse(await readFile(contextFile, 'utf8')) as Record<string, unknown>;
    await Promise.all([
      writeFile(
        contextFile,
        JSON.stringify({ ...context, status: 'running', bundleId: null }),
        'utf8',
      ),
      unlink(attemptFile),
      unlink(bundleFile),
      unlink(journalFile),
      ...completed.receipts.map((receipt) =>
        unlink(
          path.join(
            workspace,
            '.repoctopus',
            'evidence',
            'receipts',
            `${receipt.receiptId}.json`,
          ),
        ),
      ),
    ]);

    const recovered = await evidence.runOrResume('verify', attemptId, runId);
    expect(recovered.context.status).toBe('recovered');
    expect(recovered.bundle?.outcome).toBe('passed');
    expect(recovered.attempt.status).toBe('completed');
  });

  it('fails closed when an Attempt is missing but its journal proves execution started', async () => {
    const { evidence, runId, workspace } = await fixture();
    const attemptId = 'attempt-orphaned-journal';
    const completed = await evidence.run('verify', attemptId, runId);
    const contextFile = path.join(workspace, '.repoctopus', 'evidence', 'runs', `${attemptId}.json`);
    const attemptFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'attempts',
      `${attemptId}.json`,
    );
    const bundleFile = path.join(
      workspace,
      '.repoctopus',
      'evidence',
      'bundles',
      `${completed.bundle.bundleId}.json`,
    );
    const context = JSON.parse(await readFile(contextFile, 'utf8')) as Record<string, unknown>;
    await Promise.all([
      writeFile(
        contextFile,
        JSON.stringify({ ...context, status: 'running', bundleId: null }),
        'utf8',
      ),
      unlink(attemptFile),
      unlink(bundleFile),
    ]);

    await expect(evidence.runOrResume('verify', attemptId, runId)).rejects.toThrow(
      `Evidence attempt is missing but durable execution facts exist: ${attemptId}`,
    );
  });

  it('rejects serial attempt takeover by another profile or workflow Run', async () => {
    const { evidence, runId } = await fixture();
    const attemptId = 'attempt-owner-fencing';
    await evidence.run('verify', attemptId, runId);

    await expect(evidence.runOrResume('verify-alt', attemptId, runId)).rejects.toThrow(
      `Evidence attempt ownership mismatch: ${attemptId}`,
    );
    await expect(evidence.runOrResume('verify', attemptId, 'another-run')).rejects.toThrow(
      `Evidence attempt ownership mismatch: ${attemptId}`,
    );
  });

  it('serializes the same attempt identity across different profiles', async () => {
    const { evidence } = await fixture();
    const attemptId = 'attempt-cross-profile';
    const results = await Promise.allSettled([
      evidence.run('verify', attemptId),
      evidence.run('verify-alt', attemptId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(String(rejection?.reason)).toMatch(/Evidence attempt already exists/u);
    expect((await evidence.status(attemptId)).attempt.attemptId).toBe(attemptId);
  });
});
