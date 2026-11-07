import { afterEach, describe, expect, it } from 'vitest';

import {
  advanceBuildProtocol,
  advanceBuildWorkspaceCheckpoint,
  createBuildProtocolState,
  createBuildStrategy,
  createExecutionBinding,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';
import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import { classifyBuildWorkspaceRecovery } from '../domains/runtime/build-workspace-recovery.js';
import { WorkflowRunCoordinator } from '../domains/runtime/workflow-runs.js';
import { classifyRecoveryObservation } from '../domains/runtime/recovery.js';
import { FileRuntimeStore } from '../platform/runtime/file-runtime-store.js';
import {
  compositionFixture,
  projectFixture,
  workflowFixture,
  temporaryDirectory,
  removeTemporaryDirectory,
} from './helpers/fixtures.js';
import { hostAbsolutePath } from './helpers/host-path.js';

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map(removeTemporaryDirectory)));

function fixture() {
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'project-1',
    changeId: 'recovery',
    isolation: 'branch',
  });
  const observed = createExecutionWorkspaceBinding({
    intent,
    repositories: ['app', 'worker'].map((repositoryId) => ({
      repositoryId,
      checkoutPath: hostAbsolutePath('recovery', repositoryId),
      branch: 'feature/recovery',
      head: 'a'.repeat(40),
      worktreeId: null,
      workspaceOwned: true,
    })),
  });
  const strategy = createBuildStrategy({
    runId: 'run-recovery',
    revision: 1,
    executionMode: 'autonomous',
    tddMode: 'tdd',
    reviewMode: 'standard',
    isolationIntent: 'branch',
  });
  const binding = createExecutionBinding({
    strategy,
    revision: 1,
    coordinatorHostId: 'host-1',
    workspaceBinding: observed,
    workspaceOwnerId: intent.workspaceId,
    localOverlayRef: `execution-workspace:${observed.localDigest.slice(-24)}`,
  });
  const protocol = advanceBuildProtocol(
    createBuildProtocolState({
      runId: 'run-recovery',
      planningDigest: `sha256:${'a'.repeat(64)}`,
      strategy,
    }),
    { kind: 'binding-accepted', binding },
  );
  const previous = projectFixture({
    root: hostAbsolutePath('recovery'),
    repositories: observed.repositories.map((repository) => ({
      id: repository.repositoryId,
      name: repository.repositoryId,
      path: repository.checkoutPath,
      remoteIdentity: `remote-${repository.repositoryId}`,
      branch: 'main',
      head: 'a'.repeat(40),
      worktree: { dirty: false, digest: 'clean', staged: 0, unstaged: 0, untracked: 0 },
    })),
  });
  const current = projectFixture({
    ...previous,
    repositories: previous.repositories.map((repository) => ({
      ...repository,
      branch: 'feature/recovery',
      head: 'b'.repeat(40),
    })),
  });
  const progress = createExecutionWorkspaceBinding({
    intent,
    repositories: observed.repositories.map((repository) => ({
      ...repository,
      head: 'b'.repeat(40),
    })),
  });
  const checkpoint = advanceBuildWorkspaceCheckpoint({
    current: protocol.workspaceCheckpoint!,
    observed: progress.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      branchRef: repository.branch,
      headRevision: repository.head,
    })),
    writableRepositoryIds: ['app', 'worker'],
    relations: { app: 'fast-forward', worker: 'fast-forward' },
  });
  const snapshot = createChangeLifecycleSnapshot({
    identity: { workspaceId: intent.workspaceId, changeId: intent.changeId, runId: 'run-recovery' },
  });
  const state = startRun({
    workflow: workflowFixture(),
    runId: 'run-recovery',
    projectSnapshotDigest: previous.digest,
    composition: compositionFixture(),
    timestamp: '2026-11-07T00:00:00Z',
  });
  state.changeLifecycle = {
    ...snapshot,
    phase: 'build',
    workspaceIntent: intent,
    buildProtocol: { ...protocol, workspaceCheckpoint: checkpoint },
  };
  return { state, previous, current, observed: progress, intent };
}

describe('Build workspace recovery', () => {
  async function persistedFixture() {
    const input = fixture();
    const root = await temporaryDirectory('repoctopus-build-recovery-');
    cleanup.push(root);
    const store = new FileRuntimeStore(root);
    const runtime = new WorkflowRunCoordinator(store, { async export() {} }, compositionFixture());
    await runtime.start({
      runId: input.state.runId,
      workflow: workflowFixture(),
      projectSnapshot: input.previous,
      changeLifecycle: { ...input.state.changeLifecycle!, status: 'running' },
    });
    const observe = async () =>
      classifyBuildWorkspaceRecovery({ ...input, state: await store.loadRun(input.state.runId) });
    return { input, runtime, store, observe };
  }

  it('preserves an unrelated reconciliation through repeated workspace observations', async () => {
    const f = await persistedFixture();
    await f.runtime.resume({
      runId: f.input.state.runId,
      currentProjectSnapshot: projectFixture({
        ...f.input.current,
        root: hostAbsolutePath('unrelated-root'),
      }),
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await f.runtime.reconcileBuildWorkspace(
        f.input.state.runId,
        await f.observe(),
      );
      expect(result.value.state.reconciliationRequired).toBe(true);
      expect(result.value.continuation?.continuation).toBe('reconcile');
    }
  });

  it('clears its own checkout conflict after restoration and rejects the stale observation', async () => {
    const f = await persistedFixture();
    const accepted = f.input.observed;
    f.input.observed = createExecutionWorkspaceBinding({
      intent: f.input.intent,
      repositories: accepted.repositories.map((repository) => ({
        ...repository,
        branch: 'unrelated/branch',
      })),
    });
    const conflict = await f.observe();
    const blocked = await f.runtime.reconcileBuildWorkspace(f.input.state.runId, conflict);
    expect(blocked.value.state.reconciliationRequired).toBe(true);
    f.input.observed = accepted;
    const restored = await f.runtime.reconcileBuildWorkspace(
      f.input.state.runId,
      await f.observe(),
    );
    expect(restored.value.state.reconciliationRequired).toBe(false);
    await expect(f.runtime.reconcileBuildWorkspace(f.input.state.runId, conflict)).rejects.toThrow(
      /stale/u,
    );
    expect((await f.store.loadRun(f.input.state.runId)).reconciliationRequired).toBe(false);
  });

  it('keeps a newer conflict authoritative after an older successful observation', async () => {
    const f = await persistedFixture();
    const accepted = await f.observe();
    await f.runtime.reconcileBuildWorkspace(f.input.state.runId, accepted);
    f.input.observed = createExecutionWorkspaceBinding({
      intent: f.input.intent,
      repositories: f.input.observed.repositories.map((repository) => ({
        ...repository,
        branch: 'unrelated/newer-conflict',
      })),
    });
    await f.runtime.reconcileBuildWorkspace(f.input.state.runId, await f.observe());
    await expect(f.runtime.reconcileBuildWorkspace(f.input.state.runId, accepted)).rejects.toThrow(
      /stale/u,
    );
    const status = await f.runtime.status(f.input.state.runId);
    expect(status.state.reconciliationRequired).toBe(true);
    expect(status.continuation?.continuation).toBe('reconcile');
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: f.input.state.runId,
      expectedRevision: status.state.changeLifecycle!.revision,
      checkEpoch: status.state.changeLifecycle!.checkEpoch,
      observationId: 'stale-planning-observation',
      planning: {
        status: 'drift',
        reasonCode: 'requirements-changed',
        changedIdentities: ['planning-semantic'],
      },
      plan: { status: 'current', changedIdentities: [] },
      work: { status: 'current', changedIdentities: [] },
      evidence: { status: 'current', changedIdentities: [] },
    });
    if (!decision) throw new Error('Expected a planning recovery decision');
    await expect(
      f.runtime.acceptRecoveryDecision(f.input.state.runId, decision, {
        work: status.state.changeLifecycle!.currentWork!,
        evidenceIds: [],
      }),
    ).rejects.toThrow(/reconciliation/u);
    expect((await f.store.loadRun(f.input.state.runId)).changeLifecycle?.buildProtocol).toEqual(
      status.state.changeLifecycle?.buildProtocol,
    );
  });

  it('uses the accepted binding and progress instead of startup branches and heads', () => {
    const input = fixture();
    const result = classifyBuildWorkspaceRecovery(input);
    expect(result.reconciliation.changeClass).toBe('identity');
    expect(result.conflicts).toEqual([]);
    expect(input.state.changeLifecycle?.buildProtocol?.binding?.repositories[0]?.headRevision).toBe(
      'a'.repeat(40),
    );
    expect(input.observed.repositories[0]?.head).toBe('b'.repeat(40));
  });

  it('rejects an unauthorized branch without changing the accepted checkpoint', () => {
    const input = fixture();
    const before = structuredClone(input.state);
    input.observed = createExecutionWorkspaceBinding({
      intent: input.intent,
      repositories: input.observed.repositories.map((repository) =>
        repository.repositoryId === 'worker'
          ? { ...repository, branch: 'unrelated/branch' }
          : repository,
      ),
    });
    expect(classifyBuildWorkspaceRecovery(input).conflicts).toContain(
      'checkout-identity-changed:worker',
    );
    expect(input.state).toEqual(before);
  });

  it('rejects unaccepted progress even on the bound branch', () => {
    const input = fixture();
    input.observed = createExecutionWorkspaceBinding({
      intent: input.intent,
      repositories: input.observed.repositories.map((repository) =>
        repository.repositoryId === 'worker' ? { ...repository, head: 'c'.repeat(40) } : repository,
      ),
    });
    expect(classifyBuildWorkspaceRecovery(input).conflicts).toContain('unaccepted-head:worker');
  });

  it.each(['path', 'remoteIdentity', 'name'] as const)('rejects changed repository %s', (field) => {
    const input = fixture();
    input.current = projectFixture({
      ...input.current,
      repositories: input.current.repositories.map((repository) => ({
        ...repository,
        [field]: `changed-${repository[field]}`,
      })),
    });
    expect(classifyBuildWorkspaceRecovery(input).conflicts).toContain(
      'repository-identity-changed:app',
    );
  });

  it('rejects a missing repository and failed checkout inspection', () => {
    const input = fixture();
    const current = projectFixture({
      ...input.current,
      repositories: input.current.repositories.slice(1),
    });
    const result = classifyBuildWorkspaceRecovery({ ...input, current, observed: null });
    expect(result.conflicts).toContain('project-identity-changed');
    expect(result.conflicts).toContain('checkout-observation-failed');
  });

  it('returns the same observation identity for repeated reads', () => {
    const input = fixture();
    expect(classifyBuildWorkspaceRecovery(input)).toEqual(
      classifyBuildWorkspaceRecovery(structuredClone(input)),
    );
  });
});
