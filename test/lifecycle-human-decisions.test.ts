import { describe, expect, it, vi } from 'vitest';

import {
  LifecycleHumanDecisions,
  type ApplyLifecycleDecisionInput,
} from '../services/lifecycle-human-decisions.js';
import { createChangeLifecycleSnapshot } from '../domains/change-lifecycle/definition.js';
import { startRun } from '../domains/engine/loop.js';
import {
  createPlanningSnapshot,
  recordSpecificationApprovalDecision,
  requestSpecificationApproval,
} from '../domains/specification/planning-approval.js';
import type { SpecificationApprovalState } from '../domains/specification/types.js';
import type { TrajectoryEvent } from '../domains/trajectory/types.js';
import {
  compositionFixture,
  specificationSchemaFixture,
  workflowFixture,
} from './helpers/fixtures.js';

const hash = (s: string): `sha256:${string}` => `sha256:${s.repeat(64)}`;
const actor = { actorId: 'operator', source: 'cli', authenticated: true } as const;

function fixture(
  phase: 'open' | 'design' | 'build' = 'open',
  kind = phase === 'build' ? 'build-plan' : `${phase}-approval`,
) {
  const provider = {
    id: 'test',
    version: '1',
    protocolVersion: 'repoctopus.specification/v1alpha1',
  } as const;
  const change = {
    apiVersion: 'repoctopus.specification/v1alpha1',
    kind: 'SpecificationChange',
    changeId: 'sample',
    title: 'Sample',
    provider,
    changeDigest: hash('a'),
    planningComplete: true,
    affectedCapabilities: ['demo'],
    retiredCapabilities: [],
    artifacts: [
      { id: 'proposal', kind: 'proposal', status: 'ready', digest: hash('1') },
      { id: 'design', kind: 'design', status: 'ready', digest: hash('2') },
      { id: 'specs', kind: 'delta-specs', status: 'ready', digest: hash('3') },
      { id: 'tasks', kind: 'tasks', status: 'ready', digest: hash('4') },
    ],
  } as const;
  const root = {
    schemaVersion: 1,
    kind: 'SpecificationRoot',
    storeId: 'team',
    repositoryId: 'workspace',
  } as const;
  const snapshot = createPlanningSnapshot({
    change: structuredClone({
      ...change,
      artifacts: [...change.artifacts],
      affectedCapabilities: [...change.affectedCapabilities],
      retiredCapabilities: [],
    }),
    validation: {
      apiVersion: 'repoctopus.specification/v1alpha1',
      kind: 'SpecificationValidation',
      changeId: 'sample',
      provider,
      strict: true,
      valid: true,
      validationDigest: hash('b'),
      diagnostics: [],
    },
    schema: specificationSchemaFixture(provider),
    specificationRoot: root,
    approvalPhase: phase === 'design' ? 'design' : 'open',
    changeBranch: {
      repositoryId: 'workspace',
      remoteIdentity: 'github.com/team/workspace',
      sourceBranch: 'change/sample',
      targetBranch: 'main',
      remoteOid: '1'.repeat(40),
    },
    ...(phase === 'design' ? { buildStrategyDigest: hash('c') } : {}),
  });
  let approval: SpecificationApprovalState = requestSpecificationApproval({
    current: null,
    snapshot,
    requestId: 'request',
    timestamp: '2026-11-11T00:00:00.000Z',
  });
  const state = startRun({
    workflow: workflowFixture(),
    runId: 'run-b',
    projectSnapshotDigest: hash('d'),
    composition: compositionFixture(),
    timestamp: '2026-11-11T00:00:00.000Z',
  });
  state.status = 'waiting';
  state.trigger = {
    schemaVersion: 1,
    kind: 'test',
    identityDigest: hash('f'),
    facts: { specificationRoot: root },
  };
  state.changeLifecycle = {
    ...createChangeLifecycleSnapshot({
      identity: { runId: 'run-b', workspaceId: 'team', changeId: 'sample' },
    }),
    phase,
    currentWork: null,
    waitCondition: {
      schemaVersion: 1,
      kind: 'human-decision',
      waitId: `${kind}:request`,
      requestId: 'request',
      proposalDigest: approval.decisionRequest.proposalHash,
      inputDigest: hash('e'),
      reason: 'review',
    },
  };
  const events: TrajectoryEvent[] = [];
  const apply = vi.fn((input: ApplyLifecycleDecisionInput) => {
    approval = recordSpecificationApprovalDecision({
      state: approval,
      response: input.response,
      actor,
      timestamp: '2026-11-11T00:00:01.000Z',
      recordedViaRunId: 'run-b',
      isolation: 'branch',
    });
    return Promise.resolve();
  });
  const status = vi.fn(() => Promise.resolve(approval));
  const assertCurrentProposal = vi.fn(async () => {});
  const service = new LifecycleHumanDecisions({
    store: {
      recover: () => Promise.resolve(false),
      loadRun: () => Promise.resolve(state),
      loadTrajectory: () => Promise.resolve(events),
    },
    planning: { status, assertCurrentProposal },
    apply,
  });
  const response = () => ({
    apiVersion: 'repoctopus/v1alpha1',
    kind: 'LifecycleHumanDecisionResponse',
    runId: 'run-b',
    phase,
    decisionKind:
      kind === 'workspace-intent'
        ? 'workspace-intent-revision'
        : phase === 'build'
          ? 'build-plan-risk'
          : `specification-${phase}`,
    requestId: 'request',
    proposalHash: approval.decisionRequest.proposalHash,
    decision: 'approve',
    ...(phase === 'open' ? { isolation: 'branch' } : {}),
    interaction: {
      channel: 'native',
      authorization: 'user-response',
      reference: 'test-private-reference',
    },
  });
  return {
    state,
    events,
    apply,
    status,
    assertCurrentProposal,
    service,
    response,
    approveShared: () => {
      approval = recordSpecificationApprovalDecision({
        state: approval,
        response: {
          apiVersion: 'repoctopus/v1alpha1',
          kind: 'HumanDecisionResponse',
          requestId: 'request',
          proposalHash: approval.decisionRequest.proposalHash,
          decision: 'approve',
        },
        actor,
        timestamp: '2026-11-11T00:00:01.000Z',
        recordedViaRunId: 'run-a',
        isolation: 'worktree',
      });
    },
    approval: () => approval,
  };
}

describe('Lifecycle Human Decision authority facade', () => {
  it.each(['approve', 'revise', 'reject'] as const)(
    'preserves the original Build Plan %s choice across recovery and rejects conflicting replay',
    async (choice) => {
      const f = fixture('build');
      const request = f.response();
      const event = (observation: Record<string, unknown>): TrajectoryEvent => ({
        schemaVersion: 1,
        sequence: f.events.length + 1,
        eventId: `event-${f.events.length}`,
        timestamp: '2026-11-11T00:00:00.000Z',
        type: 'change.lifecycle.transitioned',
        runId: 'run-b',
        stateVersion: 1,
        compositionDigest: f.state.composition.compositionDigest,
        data: { observation },
      });
      f.events.push(
        event({
          kind: 'build-plan-approval-required',
          requestId: request.requestId,
          evidence: { validationDigest: request.proposalHash },
        }),
      );
      f.apply.mockImplementationOnce((input) => {
        f.events.push(
          event({
            kind: 'build-plan-decision',
            requestId: input.response.requestId,
            proposalDigest: input.response.proposalHash,
            decision: choice === 'approve' ? 'approve' : 'reject',
            humanDecision: {
              decision: input.response.decision,
              actorId: input.actor.actorId,
              source: input.actor.source,
              interaction: input.interaction,
            },
          }),
        );
        f.state.changeLifecycle!.waitCondition = null;
        return Promise.resolve();
      });
      const response = { ...request, decision: choice };
      expect((await f.service.submit({ runId: 'run-b', response, actor })).decision?.decision).toBe(
        choice,
      );
      expect((await f.service.submit({ runId: 'run-b', response, actor })).decision?.decision).toBe(
        choice,
      );
      expect(f.apply).toHaveBeenCalledOnce();
      await expect(
        f.service.submit({
          runId: 'run-b',
          response: { ...response, decision: choice === 'approve' ? 'reject' : 'approve' },
          actor,
        }),
      ).rejects.toThrow(/conflicts/);
    },
  );

  it('recovers an Open intent selected before the approval write without asking for a new isolation', async () => {
    const f = fixture();
    const { createExecutionWorkspaceIntent } =
      await import('../domains/change-lifecycle/build-protocol.js');
    f.state.changeLifecycle!.workspaceIntent = createExecutionWorkspaceIntent({
      workspaceId: 'team',
      changeId: 'sample',
      isolation: 'branch',
    });
    const view = await f.service.read({ runId: 'run-b' });
    expect(view).toMatchObject({
      status: 'pending',
      selectedIsolation: 'branch',
      requiresSubmission: true,
    });
    await expect(
      f.service.submit({
        runId: 'run-b',
        response: { ...f.response(), isolation: 'worktree' },
        actor,
      }),
    ).rejects.toThrow(/already selected/);
    expect(f.apply).not.toHaveBeenCalled();
    expect((await f.service.submit({ runId: 'run-b', response: f.response(), actor })).status).toBe(
      'accepted',
    );
    expect(f.apply).toHaveBeenCalledOnce();
  });
  it('rejects another CLI Run before consulting shared approval or writing anything', async () => {
    const f = fixture();
    await expect(
      f.service.submit({ runId: 'run-other', response: f.response(), actor }),
    ).rejects.toThrow(/different Run/);
    expect(f.status).not.toHaveBeenCalled();
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('does not let a Run without participation borrow a shared approved proposal', async () => {
    const f = fixture();
    f.approveShared();
    f.state.changeLifecycle!.waitCondition = null;
    const view = await f.service.read({
      runId: 'run-b',
      requestId: 'request',
      proposalHash: f.response().proposalHash,
    });
    expect(view.status).toBe('not-found');
    expect(f.status).not.toHaveBeenCalled();
    await expect(
      f.service.submit({ runId: 'run-b', response: f.response(), actor }),
    ).rejects.toThrow(/not attributable|original phase/);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('reuses shared approval provenance while still validating this Run isolation', async () => {
    const f = fixture();
    f.approveShared();
    f.apply.mockImplementationOnce(async () => {});
    const view = await f.service.submit({ runId: 'run-b', response: f.response(), actor });
    expect(f.apply).toHaveBeenCalledOnce();
    expect(view).toMatchObject({
      status: 'accepted',
      authorityScope: 'planning-change',
      recordedViaRunId: 'run-a',
    });
    expect(view.decision?.decision).toBe('approve');
  });
  it('gives the Host a response template when a shared approved proposal still needs this Run isolation', async () => {
    const f = fixture();
    f.approveShared();
    const view = await f.service.read({ runId: 'run-b' });
    expect(view).toMatchObject({
      status: 'accepted',
      requiresSubmission: true,
      runParticipation: 'waiting',
      requiredInputs: { approve: ['isolation'] },
    });
    expect(view.responseTemplate).toMatchObject({ runId: 'run-b', requestId: 'request' });
  });
  it('does not turn Open approval into Design authorization', async () => {
    const f = fixture('design');
    await expect(
      f.service.submit({
        runId: 'run-b',
        response: {
          ...f.response(),
          phase: 'open',
          decisionKind: 'specification-open',
          isolation: 'branch',
        },
        actor,
      }),
    ).rejects.toThrow(/original phase/);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('leaves an intent revision waiting when the user requests revision', async () => {
    const f = fixture('open', 'workspace-intent');
    f.apply.mockImplementationOnce(async () => {});
    const response: Record<string, unknown> = f.response();
    delete response.isolation;
    const view = await f.service.submit({
      runId: 'run-b',
      response: { ...response, decision: 'revise' },
      actor,
    });
    expect(view.status).toBe('not-applied');
    expect(f.state.status).toBe('waiting');
    expect(f.status).not.toHaveBeenCalled();
  });
  it('refuses pending planning drift before writing any decision', async () => {
    const f = fixture();
    f.assertCurrentProposal.mockRejectedValueOnce(new Error('Provider drift'));
    await expect(
      f.service.submit({ runId: 'run-b', response: f.response(), actor }),
    ).rejects.toThrow(/Provider drift/);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.approval().decision).toBeNull();
  });
  it('requires request selectors together and never creates a request on read', async () => {
    const f = fixture();
    await expect(f.service.read({ runId: 'run-b', requestId: 'request' })).rejects.toThrow(
      /together/,
    );
    f.state.changeLifecycle!.waitCondition = null;
    expect((await f.service.read({ runId: 'run-b' })).status).toBe('none');
    expect(f.apply).not.toHaveBeenCalled();
  });
  it('rejects untrusted execution actors even with a filled response file', async () => {
    const f = fixture();
    await expect(
      f.service.submit({
        runId: 'run-b',
        response: f.response(),
        actor: { ...actor, authenticated: false },
      }),
    ).rejects.toThrow(/trusted/);
    expect(f.apply).not.toHaveBeenCalled();
  });
});
