import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootProjectComposition } from '../app/boot/bootstrap.js';
import { postMergeRunId, postMergeRunOptions } from '../domains/post-merge/run.js';
import {
  RunIdentityConflictError,
  WorkflowRunCoordinator,
} from '../domains/runtime/workflow-runs.js';
import { parseWorkflowPackage } from '../domains/workflow-contract/package.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  createGitRepository,
  projectFixture,
  removeTemporaryDirectory,
  temporaryDirectory,
} from './helpers/fixtures.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

const mergeFactsDigest = `sha256:${'a'.repeat(64)}` as const;

function readyCoordination() {
  return {
    status: 'ready' as const,
    diagnostic: 'post-merge-ready' as const,
    changeId: 'finish-self-hosting',
    mergeFactsDigest,
    mergeEvidence: [
      {
        repositoryId: 'app',
        mergeRequest: {
          provider: 'github',
          repositoryId: 'app',
          number: 41,
          url: 'https://github.com/team/app/pull/41',
        },
        mergeCommit: 'a'.repeat(40),
        mergedAt: '2026-10-21T01:00:00.000Z',
        observedAt: '2026-10-21T01:00:01.000Z',
      },
    ],
  };
}

async function postMergeWorkflow() {
  const workflowPath = path.resolve(import.meta.dirname, '..', 'workflows', 'post-merge.yaml');
  return {
    workflowPath,
    workflow: parseWorkflowPackage(await readFile(workflowPath, 'utf8')),
  };
}

function runtime(store: FileRuntimeStore) {
  return new WorkflowRunCoordinator(
    store,
    { async export() {} },
    compositionFixture(),
    () => new Date('2026-10-21T01:00:02.000Z'),
  );
}

describe('post-merge workflow', () => {
  it('derives one Run identity from the change and authoritative merge facts', async () => {
    const { workflow, workflowPath } = await postMergeWorkflow();
    const first = postMergeRunOptions({
      coordination: readyCoordination(),
      workflow,
      projectSnapshot: projectFixture(),
      workflowSource: workflowPath,
    });
    const replay = postMergeRunOptions({
      coordination: readyCoordination(),
      workflow,
      projectSnapshot: projectFixture(),
      workflowSource: workflowPath,
    });

    expect(first.runId).toBe(postMergeRunId('finish-self-hosting', mergeFactsDigest));
    expect(replay.runId).toBe(first.runId);
    expect(first.trigger).toEqual(replay.trigger);
    expect(first.trigger).toMatchObject({
      kind: 'post-merge',
      identityDigest: mergeFactsDigest,
      facts: { changeId: 'finish-self-hosting' },
    });
  });

  it('coalesces concurrent starts into one durable logical Run', async () => {
    const workspace = await temporaryDirectory('repoctopus-post-merge-start-');
    cleanup.push(workspace);
    const { workflow, workflowPath } = await postMergeWorkflow();
    const options = postMergeRunOptions({
      coordination: readyCoordination(),
      workflow,
      projectSnapshot: projectFixture(),
      workflowSource: workflowPath,
    });

    const results = await Promise.all([
      runtime(new FileRuntimeStore(workspace)).startOrResume(options),
      runtime(new FileRuntimeStore(workspace)).startOrResume(options),
    ]);

    expect(new Set(results.map((result) => result.value.state.runId))).toEqual(
      new Set([options.runId]),
    );
    expect(results.flatMap((result) => result.diagnostics).map((item) => item.code)).toContain(
      'runtime.idempotent-start',
    );
    const store = new FileRuntimeStore(workspace);
    expect(await store.loadTrajectory(options.runId)).toHaveLength(1);
    expect((await store.loadRun(options.runId)).trigger).toEqual(options.trigger);
  });

  it('recovers an interrupted initial transition without creating another Run', async () => {
    const workspace = await temporaryDirectory('repoctopus-post-merge-interrupt-');
    cleanup.push(workspace);
    const { workflow, workflowPath } = await postMergeWorkflow();
    const options = postMergeRunOptions({
      coordination: readyCoordination(),
      workflow,
      projectSnapshot: projectFixture(),
      workflowSource: workflowPath,
    });
    const crashingStore = new FileRuntimeStore(workspace, {
      afterJournalWritten() {
        throw new Error('simulated-process-interruption');
      },
    });

    await expect(runtime(crashingStore).start(options)).rejects.toThrow(
      'simulated-process-interruption',
    );

    const recoveredStore = new FileRuntimeStore(workspace);
    const resumed = await runtime(recoveredStore).startOrResume(options);
    expect(resumed.value.state.runId).toBe(options.runId);
    expect(resumed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'runtime.idempotent-start' }),
    );
    expect(await recoveredStore.loadTrajectory(options.runId)).toHaveLength(1);
    expect((await recoveredStore.inspect(options.runId)).pendingTransition).toBe(false);
  });

  it('fails closed when the same Run id is presented with different trigger facts', async () => {
    const workspace = await temporaryDirectory('repoctopus-post-merge-conflict-');
    cleanup.push(workspace);
    const { workflow, workflowPath } = await postMergeWorkflow();
    const options = postMergeRunOptions({
      coordination: readyCoordination(),
      workflow,
      projectSnapshot: projectFixture(),
      workflowSource: workflowPath,
    });
    const coordinator = runtime(new FileRuntimeStore(workspace));
    await coordinator.startOrResume(options);

    await expect(
      coordinator.startOrResume({
        ...options,
        trigger: {
          ...options.trigger!,
          facts: { ...options.trigger!.facts, changeId: 'different-change' },
        },
      }),
    ).rejects.toBeInstanceOf(RunIdentityConflictError);
  });

  it('persists an Intent and Receipt for every post-merge action', async () => {
    const projectRoot = await temporaryDirectory('repoctopus-post-merge-actions-');
    cleanup.push(projectRoot);
    const workspace = await createGitRepository(projectRoot, 'workspace');
    await createGitRepository(projectRoot, 'app');
    await writeFile(
      path.join(workspace, 'repoctopus.yaml'),
      JSON.stringify({
        apiVersion: 'repoctopus/v1alpha1',
        kind: 'RepoctopusProject',
        project: { id: 'post-merge-actions' },
        repositories: [{ id: 'app', path: '../app' }],
        profiles: [
          {
            id: 'verify',
            nodes: [
              {
                id: 'check',
                type: 'command',
                repository: 'app',
                executable: process.execPath,
                args: ['-e', 'process.exit(0)'],
              },
            ],
          },
        ],
      }),
    );
    const productRoot = path.resolve(import.meta.dirname, '..');
    const { workflow, workflowPath } = await postMergeWorkflow();
    const app = await bootProjectComposition(productRoot, workspace);

    try {
      const options = postMergeRunOptions({
        coordination: readyCoordination(),
        workflow,
        projectSnapshot: projectFixture({ root: projectRoot }),
        workflowSource: workflowPath,
      });
      let status = (await app.context.workflowRuns.startOrResume(options)).value;
      const refs: string[] = [];
      const receipts: string[] = [];

      while (status.state.status !== 'completed') {
        const proposed = await app.context.workflowRuns.next(options.runId);
        const action = proposed.value.nextAction!;
        refs.push(action.ref!);
        const intent = await app.context.actionStore.loadIntent(options.runId, action.id);
        const recorded = await app.context.workflowRuns.record({
          runId: options.runId,
          actionId: action.id,
          status: 'succeeded',
          summary: `completed ${action.ref}`,
          eventId: `run-${action.stepId}`,
        });
        status = recorded.value;
        const trajectory = await app.context.runStore.loadTrajectory(options.runId);
        const completion = trajectory.find((event) => event.eventId === `run-${action.stepId}`)!;
        const receiptId = completion.data.actionReceiptId as string;
        const receipt = await app.context.actionStore.loadReceipt(options.runId, receiptId);
        receipts.push(receipt.receiptId);
        expect(intent.runId).toBe(options.runId);
        expect(receipt.intentId).toBe(intent.intentId);
      }

      expect(refs).toEqual([
        'post-merge.checkout-exact-commits',
        'post-merge.collect-evidence',
        'post-merge.close-specification',
        'post-merge.audit-paths',
        'post-merge.publish-coordination',
      ]);
      expect(new Set(receipts)).toHaveLength(5);
      expect(
        (await app.context.runStore.loadTrajectory(options.runId)).filter(
          (event) => event.type === 'action.completed',
        ),
      ).toHaveLength(5);
    } finally {
      await app.close();
    }
  });
});
