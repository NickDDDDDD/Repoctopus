import { describe, expect, it } from 'vitest';

import { assertManagedDelegation } from '../domains/work-execution/delegation.js';
import type {
  DelegationReceipt,
  WorkExecutionHostIdentity,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
} from '../domains/work-execution/types.js';

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function packet(mode: 'autonomous' | 'subagent-driven-development'): WorkExecutionPacket {
  return {
    work: { kind: 'build.execute', packageId: 'package-1' },
    context: {
      layers: [
        {
          kind: 'change-inputs',
          content: JSON.stringify({ build: { strategy: { executionMode: mode } } }),
        },
      ],
    },
  } as unknown as WorkExecutionPacket;
}

function host(attested = true): WorkExecutionHostIdentity {
  return {
    schemaVersion: 1,
    id: 'coordinator-1',
    version: '1',
    codeDigest: digest('a'),
    capabilities: attested ? ['subagent.dispatch.attested'] : ['build.autonomous'],
    actionKinds: ['agent'],
    reconcile: true,
  };
}

function receipt(overrides: Partial<DelegationReceipt> = {}): DelegationReceipt {
  return {
    schemaVersion: 1,
    receiptId: 'receipt-1',
    parentInvocationId: 'invocation-1',
    coordinatorHostId: 'coordinator-1',
    executionId: 'implementation-1',
    role: 'implementer',
    packageId: 'package-1',
    status: 'succeeded',
    outcomeDigest: digest('b'),
    ...overrides,
  };
}

function outcome(receipts: readonly DelegationReceipt[] = []): WorkExecutionHostOutcome {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    hostId: 'coordinator-1',
    packetDigest: digest('c'),
    status: 'succeeded',
    summary: 'completed',
    consumedLayerDigests: [],
    delegationReceipts: receipts,
    completedAt: '2026-10-28T00:00:00.000Z',
  };
}

describe('managed Build delegation', () => {
  it('forbids undeclared delegation in autonomous mode', () => {
    expect(() => assertManagedDelegation(packet('autonomous'), host(false), outcome())).not.toThrow();
    expect(() =>
      assertManagedDelegation(packet('autonomous'), host(false), outcome([receipt()])),
    ).toThrow(/Autonomous Build Execute/u);
  });

  it('requires an attested coordinator, current-package receipts, and a succeeded implementer', () => {
    const subagentPacket = packet('subagent-driven-development');
    expect(() => assertManagedDelegation(subagentPacket, host(false), outcome([receipt()]))).toThrow(
      /attested coordinator/u,
    );
    expect(() => assertManagedDelegation(subagentPacket, host(), outcome())).toThrow(
      /bounded delegation receipts/u,
    );
    expect(() =>
      assertManagedDelegation(
        subagentPacket,
        host(),
        outcome([receipt({ packageId: 'package-2' })]),
      ),
    ).toThrow(/escaped the current Work Package/u);
    expect(() =>
      assertManagedDelegation(
        subagentPacket,
        host(),
        outcome([
          receipt(),
          receipt({ receiptId: 'receipt-2', role: 'reviewer' }),
        ]),
      ),
    ).toThrow(/multiple roles/u);
    expect(() =>
      assertManagedDelegation(
        subagentPacket,
        host(),
        outcome([receipt({ status: 'failed' })]),
      ),
    ).toThrow(/no succeeded implementer/u);
    expect(() =>
      assertManagedDelegation(
        subagentPacket,
        host(),
        outcome([
          receipt(),
          receipt({
            receiptId: 'receipt-2',
            executionId: 'review-1',
            role: 'reviewer',
          }),
        ]),
      ),
    ).not.toThrow();
  });
});
