import { describe, expect, it } from 'vitest';

import {
  createBuildStrategy,
  createExecutionBinding,
  executionBindingRequiresMigration,
  createExecutionWorkspaceBinding,
  createExecutionWorkspaceIntent,
} from '../domains/change-lifecycle/build-protocol.js';

function workspaceBinding(options: {
  head?: string;
  hostPath?: string;
  isolation?: 'current' | 'branch' | 'worktree';
}) {
  const isolation = options.isolation ?? 'worktree';
  const intent = createExecutionWorkspaceIntent({
    workspaceId: 'team-platform',
    changeId: 'strategy-binding',
    isolation,
  });
  return {
    intent,
    binding: createExecutionWorkspaceBinding({
      intent,
      repositories: [
        {
          repositoryId: 'workspace',
          checkoutPath: options.hostPath ?? 'C:\\work\\repoctopus-strategy-binding',
          branch: isolation === 'branch' ? 'codex/strategy-binding' : 'main',
          head: options.head ?? 'a'.repeat(40),
          worktreeId: isolation === 'worktree' ? 'wt-strategy-binding' : null,
          workspaceOwned: true,
        },
      ],
    }),
  };
}

describe('Build Strategy and Execution Binding', () => {
  it('keeps stable human strategy independent from Runner and checkout observations', () => {
    const strategy = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: 'worktree',
    });
    const firstWorkspace = workspaceBinding({});
    const secondWorkspace = workspaceBinding({
      head: 'b'.repeat(40),
      hostPath: 'D:\\runner-2\\repoctopus-strategy-binding',
    });
    const first = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'runner-1',
      workspaceBinding: firstWorkspace.binding,
      workspaceOwnerId: firstWorkspace.intent.workspaceId,
      localOverlayRef: 'local-overlay:runner-1',
    });
    const second = createExecutionBinding({
      strategy,
      revision: 2,
      coordinatorHostId: 'runner-2',
      workspaceBinding: secondWorkspace.binding,
      workspaceOwnerId: secondWorkspace.intent.workspaceId,
      localOverlayRef: 'local-overlay:runner-2',
    });

    expect(first.strategyDigest).toBe(strategy.semanticDigest);
    expect(second.strategyDigest).toBe(strategy.semanticDigest);
    expect(second.semanticDigest).not.toBe(first.semanticDigest);
    expect(second.stateDigest).not.toBe(first.stateDigest);
    expect(second.bindingId).not.toBe(first.bindingId);
    expect(JSON.stringify(first)).not.toContain('C:\\work');
    expect(JSON.stringify(second)).not.toContain('D:\\runner-2');
  });

  it('changes Strategy identity only for a human semantic choice', () => {
    const base = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: 'worktree',
    });
    const retry = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 1,
      executionMode: 'autonomous',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: 'worktree',
    });
    const changed = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 2,
      executionMode: 'subagent-driven-development',
      tddMode: 'tdd',
      reviewMode: 'standard',
      isolationIntent: 'worktree',
    });

    expect(retry).toEqual(base);
    expect(changed.semanticDigest).not.toBe(base.semanticDigest);
    expect(changed.strategyId).not.toBe(base.strategyId);
  });

  it('keeps capability attestation in Work claims instead of Execution Binding', () => {
    const strategy = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 1,
      executionMode: 'subagent-driven-development',
      tddMode: 'direct',
      reviewMode: 'standard',
      isolationIntent: 'current',
    });
    const workspace = workspaceBinding({ isolation: 'current' });

    const binding = createExecutionBinding({
      strategy,
      revision: 1,
      coordinatorHostId: 'runner-without-dispatch',
      workspaceBinding: workspace.binding,
      workspaceOwnerId: workspace.intent.workspaceId,
      localOverlayRef: 'local-overlay:runner-without-dispatch',
    });
    expect(binding).toMatchObject({
      schemaVersion: 3,
      coordinatorHostId: 'runner-without-dispatch',
    });
    expect(JSON.stringify(binding)).not.toContain('capabilit');
    expect(executionBindingRequiresMigration(binding)).toBe(false);
    expect(
      executionBindingRequiresMigration({
        ...binding,
        schemaVersion: 1,
        host: {
          hostId: binding.coordinatorHostId,
          capabilityDigest: `sha256:${'a'.repeat(64)}`,
        },
      }),
    ).toBe(true);
  });
});
