import { describe, expect, it } from 'vitest';

import {
  createBuildStrategy,
  createExecutionBinding,
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
    ...(isolation === 'branch' ? { targetBranch: 'codex/strategy-binding' } : {}),
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
      hostId: 'runner-1',
      hostCapabilities: [
        'build.autonomous',
        'process.execute',
        'repository.read',
        'repository.write',
        'specification.read',
      ],
      workspaceBinding: firstWorkspace.binding,
      workspaceOwnerId: firstWorkspace.intent.workspaceId,
      localOverlayRef: 'local-overlay:runner-1',
    });
    const second = createExecutionBinding({
      strategy,
      revision: 2,
      hostId: 'runner-2',
      hostCapabilities: [
        'repository.write',
        'process.execute',
        'build.autonomous',
        'repository.read',
        'specification.read',
      ],
      workspaceBinding: secondWorkspace.binding,
      workspaceOwnerId: secondWorkspace.intent.workspaceId,
      localOverlayRef: 'local-overlay:runner-2',
    });

    expect(first.strategyDigest).toBe(strategy.semanticDigest);
    expect(second.strategyDigest).toBe(strategy.semanticDigest);
    expect(second.semanticDigest).toBe(first.semanticDigest);
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

  it('fails closed when the Host cannot execute the approved Strategy', () => {
    const strategy = createBuildStrategy({
      runId: 'run-strategy-binding',
      revision: 1,
      executionMode: 'subagent-driven-development',
      tddMode: 'direct',
      reviewMode: 'standard',
      isolationIntent: 'current',
    });
    const workspace = workspaceBinding({ isolation: 'current' });

    expect(() =>
      createExecutionBinding({
        strategy,
        revision: 1,
        hostId: 'runner-without-dispatch',
        hostCapabilities: [
          'process.execute',
          'repository.read',
          'repository.write',
          'specification.read',
        ],
        workspaceBinding: workspace.binding,
        workspaceOwnerId: workspace.intent.workspaceId,
        localOverlayRef: 'local-overlay:runner-without-dispatch',
      }),
    ).toThrow(/subagent\.dispatch\.attested/iu);
  });
});
