import { describe, expect, it, vi } from 'vitest';

import type {
  WorkExecutionHost,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
  WorkExecutionResult,
  WorkExecutionSessionIdentity,
} from '../domains/work-execution/types.js';
import { ManagedWorkExecutor } from '../services/managed-work-executor.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function frozenPacket(): WorkExecutionPacket {
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
      kind: 'build.execute',
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
            build: { configuration: { executionMode: 'subagent-driven-development' } },
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
) {
  const packet = frozenPacket();
  const intent = {
    runId: 'run-1',
    workId: 'work-1',
    attempt: 1,
    checkEpoch: 4,
  };
  const authority = {
    markHostStarted: vi.fn(),
    markHostUnknown: vi.fn(),
    markHostCompleted: vi.fn(),
    recordDelegationFacts: vi.fn(),
    recordSkillFacts: vi.fn(),
  };
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
    invoke: vi.fn((_packet: WorkExecutionPacket, session: WorkExecutionSessionIdentity) => {
      if (invokeError) return Promise.reject(invokeError);
      return Promise.resolve({
      schemaVersion: 1 as const,
      invocationId: session.invocationId,
      hostId: 'coordinator-1',
      packetDigest: packet.identity.packetDigest,
      status: 'succeeded' as const,
      summary: 'delegated package completed',
      consumedLayerDigests: [digest('1'), digest('2')],
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
    }),
  };
  const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
  Object.defineProperty(service, 'ctx', {
    value: {
      workDispatcher: {
        claim: vi.fn().mockResolvedValue({ packet, intent }),
        outcome: vi.fn().mockReturnValue({}),
        acceptOutcome: vi.fn().mockResolvedValue({ accepted: true }),
      },
      workExecutionHosts: { select: vi.fn().mockReturnValue(host) },
      workExecutionSessions: {
        open: vi.fn(
          (input: Omit<WorkExecutionSessionIdentity, 'schemaVersion' | 'sessionId'>) => ({
            ...input,
            schemaVersion: 2,
            sessionId: 'session-1',
          }),
        ),
        close: vi.fn(),
      },
      workExecutionAuthority: authority,
    },
  });
  return { service, authority };
}

describe('Managed Work Executor Build contract', () => {
  it('persists external Runner capabilities beyond the current Work requirement', async () => {
    const packet = frozenPacket();
    const service = Object.create(ManagedWorkExecutor.prototype) as ManagedWorkExecutor;
    const markHostStarted = vi.fn();
    Object.defineProperty(service, 'ctx', {
      value: {
        workDispatcher: {
          claim: vi.fn().mockResolvedValue({
            packet,
            intent: { runId: 'run-1', workId: 'work-1', attempt: 1, checkEpoch: 4 },
          }),
        },
        workExecutionAuthority: { markHostStarted },
        runStore: { loadRun: vi.fn().mockResolvedValue({ changeLifecycle: null }) },
      },
    });

    const claimed = await service.claimExternal({
      runId: 'run-1',
      adapter: 'manual',
      hostCapabilities: ['build.autonomous'],
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
                configuration: {
                  hostId: 'external:cli:codex-root',
                  hostCapabilities: ['build.autonomous', 'repository.read', 'repository.write'],
                  executionMode: 'autonomous',
                },
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
        hostCapabilities: ['build.autonomous', 'repository.read', 'repository.write'],
        executor: {
          actorId: 'user-1',
          runnerId: 'cli:ephemeral-pid',
          source: 'cli',
          authenticated: true,
        },
      }),
    ).rejects.toThrow(/Host approved by the Build Configuration/u);
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
    );
    expect(authority.markHostUnknown).not.toHaveBeenCalled();
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
