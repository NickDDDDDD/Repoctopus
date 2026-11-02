import { describe, expect, it, vi } from 'vitest';

import type {
  ExternalWorkExecutionOutcome,
  WorkExecutionHost,
  WorkExecutionHostInvocation,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
  WorkExecutionResult,
  WorkExecutionSessionIdentity,
} from '../domains/work-execution/types.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function frozenPacket(kind = 'build.execute'): WorkExecutionPacket {
  const packet = {
    schemaVersion: 2,
    identity: {
      schemaVersion: 1,
      packetId: digest('a'),
      packetDigest: digest('b'),
      contextDigest: digest('c'),
    },
    claim: {
      intentId: 'intent-1',
      runId: 'run-1',
      workId: 'work-1',
      attempt: 1,
      checkEpoch: 4,
      claimToken: digest('d'),
      inputDigest: digest('e'),
      compositionDigest: digest('f'),
    },
    work: {
      kind,
      packageId: 'package-1',
    },
    context: {
      layers: [
        { kind: 'action-skill', digest: digest('1'), content: 'Execute action protocol' },
        { kind: 'augmentation-skill', digest: digest('2'), content: 'TDD protocol' },
        {
          kind: 'change-inputs',
          digest: digest('3'),
          content: JSON.stringify({
            build: { strategy: { executionMode: 'subagent-driven-development' } },
          }),
        },
      ],
    },
    hostRequirement: {
      schemaVersion: 1,
      actionKind: 'agent',
      capabilities: ['subagent.dispatch.attested'],
      sideEffectClass: 'repository-write',
    },
  } as unknown as WorkExecutionPacket;
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(packet);
  return packet;
}

function executor(
  resultOverride?: Record<string, unknown>,
  delegationReceiptsOverride?: WorkExecutionHostOutcome['delegationReceipts'],
  invokeError?: Error,
  workKind = 'build.execute',
  consumedLayerDigests: readonly `sha256:${string}`[] = [digest('1'), digest('2')],
) {
  const packet = frozenPacket(workKind);
  const intent = {
    runId: 'run-1',
    workId: 'work-1',
    attempt: 1,
    checkEpoch: 4,
  };
  const authority = {
    markHostStarted: vi
      .fn()
      .mockImplementation((_intent: unknown, invocation: WorkExecutionHostInvocation) =>
        Promise.resolve({
          acquired: true,
          checkpoint: { hostInvocation: invocation },
        }),
      ),
    markHostUnknown: vi.fn(),
    markHostCompleted: vi.fn().mockResolvedValue({ status: 'submitted' }),
    recordDelegationFacts: vi.fn(),
    recordSkillFacts: vi.fn(),
    recordSkillConsumptionRejected: vi.fn(),
  };
  const invoke = vi.fn((_packet: WorkExecutionPacket, session: WorkExecutionSessionIdentity) => {
    if (invokeError) return Promise.reject(invokeError);
    return Promise.resolve({
      schemaVersion: 1 as const,
      invocationId: session.invocationId,
      hostId: 'coordinator-1',
      packetDigest: packet.identity.packetDigest,
      status: 'succeeded' as const,
      summary: 'delegated package completed',
      consumedLayerDigests,
      result: (resultOverride ?? {
        schemaVersion: 1,
        kind: 'build-package-completion',
        packageId: 'package-1',
        acceptanceEvidenceIds: ['acceptance-1'],
        testEvidenceIds: ['test-1'],
        tddEvidence: {
          redEvidenceId: 'red-1',
          greenEvidenceId: 'green-1',
          regressionEvidenceId: 'regression-1',
        },
        repositoryDigest: digest('5'),
        implementationDigest: digest('6'),
      }) as WorkExecutionResult,
      delegationReceipts: delegationReceiptsOverride ?? [
        {
          schemaVersion: 1 as const,
          receiptId: 'receipt-1',
          parentInvocationId: session.invocationId,
          coordinatorHostId: 'coordinator-1',
          executionId: 'subagent-implementation-1',
          role: 'implementer' as const,
          packageId: 'package-1',
          status: 'succeeded' as const,
          outcomeDigest: digest('7'),
        },
      ],
      completedAt: '2026-10-28T00:00:00.000Z',
    } satisfies WorkExecutionHostOutcome);
  });
  const host: WorkExecutionHost = {
    identity: {
      schemaVersion: 1 as const,
      id: 'coordinator-1',
      version: '1',
      codeDigest: digest('4'),
      capabilities: ['subagent.dispatch.attested'],
      actionKinds: ['agent' as const],
      reconcile: true,
    },
    preflight: vi.fn().mockResolvedValue({ accepted: true }),
    invoke,
  };
  const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
  const workDispatcher = {
    claim: vi.fn().mockResolvedValue({ packet, intent }),
    outcome: vi.fn().mockReturnValue({}),
    acceptOutcome: vi.fn().mockResolvedValue({ accepted: true }),
  };
  Object.defineProperty(service, 'ctx', {
    value: {
      workDispatcher,
      workExecutionHosts: { select: vi.fn().mockReturnValue(host) },
      workExecutionSessions: {
        open: vi.fn((input: Omit<WorkExecutionSessionIdentity, 'schemaVersion' | 'sessionId'>) => ({
          ...input,
          schemaVersion: 2,
          sessionId: 'session-1',
        })),
        close: vi.fn(),
      },
      workExecutionAuthority: authority,
    },
  });
  return { service, authority, host, invoke, workDispatcher };
}

function externalReplayHarness() {
  const packet = frozenPacket();
  const persistedOutcome: WorkExecutionHostOutcome = {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    hostId: 'external:cli:codex-root',
    packetDigest: packet.identity.packetDigest,
    status: 'succeeded',
    summary: 'package completed',
    consumedLayerDigests: [digest('1'), digest('2')],
    findings: [
      {
        kind: 'implementation_failure',
        summary: 'A bounded finding remains stable across transport retries.',
        taskIds: ['6.1'],
      },
    ],
    result: {
      schemaVersion: 1,
      kind: 'build-package-completion',
      packageId: 'package-1',
      acceptanceEvidenceIds: ['acceptance-1'],
      testEvidenceIds: ['test-1'],
      repositoryDigest: digest('5'),
      implementationDigest: digest('6'),
    },
    delegationReceipts: [
      {
        schemaVersion: 1,
        receiptId: 'receipt-1',
        parentInvocationId: 'invocation-1',
        coordinatorHostId: 'external:cli:codex-root',
        executionId: 'subagent-1',
        role: 'implementer',
        packageId: 'package-1',
        status: 'succeeded',
        outcomeDigest: digest('7'),
      },
    ],
    completedAt: '2026-10-28T00:00:00.000Z',
  };
  const markHostCompleted = vi.fn();
  const acceptOutcome = vi.fn().mockResolvedValue({ accepted: true });
  const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
  Object.defineProperty(service, 'ctx', {
    value: {
      runStore: {
        loadRun: vi.fn().mockResolvedValue({
          workExecution: {
            hostInvocation: {
              invocationId: persistedOutcome.invocationId,
              host: {
                schemaVersion: 1,
                id: persistedOutcome.hostId,
                version: '1',
                codeDigest: digest('8'),
                capabilities: ['subagent.dispatch.attested'],
                actionKinds: ['agent'],
                reconcile: false,
              },
              packet: { packetDigest: persistedOutcome.packetDigest },
            },
            packet: { packetDigest: persistedOutcome.packetDigest },
            hostOutcome: persistedOutcome,
          },
        }),
      },
      workExecutionAuthority: {
        loadIntent: vi.fn().mockResolvedValue({}),
        markHostCompleted,
        recordDelegationFacts: vi.fn(),
        recordSkillFacts: vi.fn(),
      },
      workDispatcher: {
        resumeClaim: vi.fn().mockResolvedValue({ packet }),
        outcome: vi.fn().mockReturnValue({}),
        acceptOutcome,
      },
    },
  });
  const input: ExternalWorkExecutionOutcome = {
    schemaVersion: 3,
    runId: 'run-1',
    submissionId: 'submission-1',
    invocationId: persistedOutcome.invocationId,
    hostId: persistedOutcome.hostId,
    packetDigest: persistedOutcome.packetDigest,
    status: persistedOutcome.status,
    summary: persistedOutcome.summary,
    consumedLayerDigests: persistedOutcome.consumedLayerDigests,
    findings: persistedOutcome.findings!,
    result: persistedOutcome.result!,
    delegationReceipts: persistedOutcome.delegationReceipts!,
  };
  return { acceptOutcome, input, markHostCompleted, persistedOutcome, service };
}

describe('Managed Work Executor Build contract', () => {
  it('does not invoke the Host when another Runner owns the durable invocation', async () => {
    const { service, authority, invoke } = executor();
    authority.markHostStarted.mockImplementation(
      (_intent: unknown, invocation: WorkExecutionHostInvocation) =>
        Promise.resolve({
          acquired: false,
          checkpoint: { hostInvocation: invocation },
        }),
    );

    await expect(service.execute({} as never)).resolves.toMatchObject({
      executionAcquired: false,
      hostOutcome: null,
      acceptance: null,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(authority.markHostCompleted).not.toHaveBeenCalled();
  });

  it.each([
    ['status', (input: ExternalWorkExecutionOutcome) => ({ ...input, status: 'failed' as const })],
    ['summary', (input: ExternalWorkExecutionOutcome) => ({ ...input, summary: 'drifted' })],
    [
      'consumed layers',
      (input: ExternalWorkExecutionOutcome) => ({
        ...input,
        consumedLayerDigests: [digest('1')],
      }),
    ],
    [
      'result',
      (input: ExternalWorkExecutionOutcome) => ({
        ...input,
        result: {
          ...(input.result as Extract<WorkExecutionResult, { kind: 'build-package-completion' }>),
          implementationDigest: digest('9'),
        },
      }),
    ],
    [
      'findings',
      (input: ExternalWorkExecutionOutcome) => ({
        ...input,
        findings: [{ ...input.findings![0]!, summary: 'drifted finding' }],
      }),
    ],
    [
      'delegation receipts',
      (input: ExternalWorkExecutionOutcome) => ({
        ...input,
        delegationReceipts: [{ ...input.delegationReceipts![0]!, outcomeDigest: digest('9') }],
      }),
    ],
  ] as const)('fails closed when replayed Host Outcome %s drift', async (_field, mutate) => {
    const { input, service } = externalReplayHarness();

    await expect(service.acceptExternalOutcome(mutate(input))).rejects.toThrow(
      /conflicts with the persisted invocation result/u,
    );
  });

  it('reuses the persisted Host completion timestamp without emitting another completion', async () => {
    const { acceptOutcome, input, markHostCompleted, persistedOutcome, service } =
      externalReplayHarness();

    const result = await service.acceptExternalOutcome(input);

    expect(result.executionAcquired).toBe(true);
    if (!result.executionAcquired) throw new Error('Expected replay acceptance to be acquired');
    expect(result.hostOutcome).toBe(persistedOutcome);
    expect(result.hostOutcome.completedAt).toBe('2026-10-28T00:00:00.000Z');
    expect(markHostCompleted).not.toHaveBeenCalled();
    expect(acceptOutcome).toHaveBeenCalledOnce();
  });

  it('persists exactly the external Runner capabilities declared independently of one Work', async () => {
    const packet = frozenPacket();
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    const markHostStarted = vi
      .fn()
      .mockImplementation((_intent: unknown, invocation: WorkExecutionHostInvocation) =>
        Promise.resolve({
          acquired: true,
          checkpoint: { hostInvocation: invocation },
        }),
      );
    Object.defineProperty(service, 'ctx', {
      value: {
        workDispatcher: {
          claim: vi.fn().mockResolvedValue({
            packet,
            intent: { runId: 'run-1', workId: 'work-1', attempt: 1, checkEpoch: 4 },
          }),
        },
        workExecutionAuthority: { markHostStarted },
        runStore: {
          loadRun: vi.fn().mockResolvedValue({
            changeLifecycle: {
              phase: 'build',
              currentWork: {
                kind: 'build.configure',
                capabilities: ['subagent.dispatch.attested'],
              },
              buildProtocol: { binding: null },
            },
          }),
        },
      },
    });

    const claimed = await service.claimExternal({
      runId: 'run-1',
      adapter: 'manual',
      hostCapabilities: ['subagent.dispatch.attested', 'build.autonomous'],
      executor: {
        actorId: 'user-1',
        runnerId: 'codex-root',
        source: 'cli',
        authenticated: true,
      },
    });

    expect(claimed.invocation.host.capabilities).toEqual([
      'build.autonomous',
      'subagent.dispatch.attested',
    ]);
    expect(markHostStarted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ host: claimed.invocation.host }),
    );
  });

  it('rejects an under-capable external Runner before persisting the Work claim', async () => {
    const claim = vi.fn();
    const markHostStarted = vi.fn();
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    Object.defineProperty(service, 'ctx', {
      value: {
        workDispatcher: { claim },
        workExecutionAuthority: { markHostStarted },
        runStore: {
          loadRun: vi.fn().mockResolvedValue({
            changeLifecycle: {
              phase: 'build',
              currentWork: {
                kind: 'build.plan',
                capabilities: ['build.autonomous', 'repository.read', 'specification.read'],
              },
              buildProtocol: {
                binding: { host: { hostId: 'external:cli:codex-root' } },
              },
            },
          }),
        },
      },
    });

    await expect(
      service.claimExternal({
        runId: 'run-1',
        adapter: 'manual',
        hostCapabilities: ['build.autonomous', 'repository.read'],
        executor: {
          actorId: 'user-1',
          runnerId: 'codex-root',
          source: 'cli',
          authenticated: true,
        },
      }),
    ).rejects.toThrow(/missing specification\.read/u);
    expect(claim).not.toHaveBeenCalled();
    expect(markHostStarted).not.toHaveBeenCalled();
  });

  it('rejects Build claims from a Runner outside the approved Host before persisting a claim', async () => {
    const packet = frozenPacket();
    const claim = vi.fn().mockResolvedValue({
      packet,
      intent: { runId: 'run-1', workId: 'work-plan', attempt: 1, checkEpoch: 4 },
    });
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    Object.defineProperty(service, 'ctx', {
      value: {
        workDispatcher: { claim },
        workExecutionAuthority: { markHostStarted: vi.fn() },
        runStore: {
          loadRun: vi.fn().mockResolvedValue({
            changeLifecycle: {
              phase: 'build',
              currentWork: {
                kind: 'build.plan',
                capabilities: ['repository.read', 'specification.read'],
              },
              buildProtocol: {
                binding: { host: { hostId: 'external:cli:codex-root' } },
              },
            },
          }),
        },
      },
    });

    await expect(
      service.claimExternal({
        runId: 'run-1',
        adapter: 'manual',
        hostCapabilities: [
          'build.autonomous',
          'repository.read',
          'repository.write',
          'specification.read',
        ],
        executor: {
          actorId: 'user-1',
          runnerId: 'cli:ephemeral-pid',
          source: 'cli',
          authenticated: true,
        },
      }),
    ).rejects.toThrow(/Execution Binding Host/u);
    expect(claim).not.toHaveBeenCalled();
  });

  it('accepts attested subagent delegation only after Skill consumption and durable Host completion', async () => {
    const { service, authority } = executor();
    await expect(service.execute({} as never)).resolves.toMatchObject({
      hostOutcome: { status: 'succeeded' },
      acceptance: { accepted: true },
    });
    expect(authority.markHostCompleted).toHaveBeenCalledOnce();
    expect(authority.recordDelegationFacts).toHaveBeenCalledOnce();
    expect(authority.recordSkillFacts).toHaveBeenCalledWith(
      expect.anything(),
      'consumed',
      [digest('1'), digest('2')],
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    );
    expect(authority.markHostUnknown).not.toHaveBeenCalled();
  });

  it.each([
    ['an old or unknown layer', [digest('1'), digest('2'), digest('9')]],
    ['a missing team layer', [digest('1')]],
  ] as const)('rejects successful completion that claims %s', async (_label, consumed) => {
    const { service, authority } = executor(
      undefined,
      undefined,
      undefined,
      'build.execute',
      consumed,
    );

    await expect(service.execute({} as never)).rejects.toThrow(/consumption of every delivered/u);
    expect(authority.markHostCompleted).not.toHaveBeenCalled();
    expect(authority.recordSkillConsumptionRejected).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reasonCode: consumed.length === 1 ? 'missing-layer' : 'unknown-layer',
      }),
    );
  });

  it('records a Build Plan submission without accepting a terminal Action Outcome', async () => {
    const { service, authority, workDispatcher } = executor(
      { schemaVersion: 1, kind: 'build-plan-candidate', packages: [] },
      undefined,
      undefined,
      'build.plan',
    );

    await expect(service.execute({} as never)).resolves.toMatchObject({
      hostOutcome: { status: 'succeeded' },
      acceptance: null,
    });
    expect(authority.markHostCompleted).toHaveBeenCalledOnce();
    expect(workDispatcher.acceptOutcome).not.toHaveBeenCalled();
  });

  it('records a Build Check submission without accepting a terminal Action Outcome', async () => {
    const { service, authority, workDispatcher } = executor(
      {
        schemaVersion: 1,
        kind: 'build-check-candidate',
        completedPackageIds: ['package-1'],
        acceptedTaskIds: ['1.1'],
        testEvidenceIds: ['test-1'],
        repositoryDigest: digest('5'),
        implementationDigest: digest('6'),
        reviewerExecutionId: 'reviewer-1',
      },
      undefined,
      undefined,
      'build.check',
    );

    await expect(service.execute({} as never)).resolves.toMatchObject({
      hostOutcome: { status: 'succeeded' },
      acceptance: null,
    });
    expect(authority.markHostCompleted).toHaveBeenCalledOnce();
    expect(workDispatcher.acceptOutcome).not.toHaveBeenCalled();
  });

  it('rejects a Host-selected next Action as an unsupported result field', async () => {
    const { service, authority } = executor({
      schemaVersion: 1,
      kind: 'build-package-completion',
      packageId: 'package-1',
      acceptanceEvidenceIds: ['acceptance-1'],
      testEvidenceIds: ['test-1'],
      repositoryDigest: digest('5'),
      implementationDigest: digest('6'),
      requestedNextAction: 'check',
    });
    await expect(service.execute({} as never)).rejects.toThrow(/managed Build result schema/u);
    expect(authority.markHostCompleted).not.toHaveBeenCalled();
  });

  it('fails closed when a subagent response is lost before an attested receipt exists', async () => {
    const missingReceipt = executor(undefined, []);
    await expect(missingReceipt.service.execute({} as never)).rejects.toThrow(
      /bounded delegation receipts/u,
    );
    expect(missingReceipt.authority.markHostCompleted).not.toHaveBeenCalled();

    const lostResponse = executor(
      undefined,
      undefined,
      new Error('subagent response lost after dispatch'),
    );
    await expect(lostResponse.service.execute({} as never)).rejects.toThrow(/response lost/u);
    expect(lostResponse.authority.markHostUnknown).toHaveBeenCalledWith(
      expect.anything(),
      'subagent response lost after dispatch',
    );
    expect(lostResponse.authority.markHostCompleted).not.toHaveBeenCalled();
  });
});
