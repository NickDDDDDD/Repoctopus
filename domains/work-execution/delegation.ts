import type {
  DelegationReceipt,
  WorkExecutionHostIdentity,
  WorkExecutionHostOutcome,
  WorkExecutionPacket,
} from './types.js';

export function assertManagedDelegation(
  packet: WorkExecutionPacket,
  host: WorkExecutionHostIdentity,
  outcome: WorkExecutionHostOutcome,
): void {
  if (packet.work.kind !== 'build.execute') return;
  const layer = packet.context.layers.find((candidate) => candidate.kind === 'change-inputs');
  if (!layer) throw new Error('Build Execute packet has no frozen Change inputs');
  let executionMode: unknown;
  try {
    executionMode = (
      JSON.parse(layer.content) as { build?: { configuration?: { executionMode?: unknown } } }
    ).build?.configuration?.executionMode;
  } catch {
    throw new Error('Build Execute packet has malformed Change inputs');
  }
  const receipts = outcome.delegationReceipts ?? [];
  if (executionMode === 'autonomous') {
    if (receipts.length > 0) {
      throw new Error('Autonomous Build Execute cannot report undeclared subagent delegation');
    }
    return;
  }
  if (executionMode !== 'subagent-driven-development') {
    throw new Error('Build Execute packet has no supported frozen execution mode');
  }
  if (!host.capabilities.includes('subagent.dispatch.attested')) {
    throw new Error('Subagent Build Execute requires an attested coordinator Host');
  }
  if (!packet.work.packageId || receipts.length === 0) {
    throw new Error('Subagent Build Execute requires bounded delegation receipts');
  }
  const identities = new Map<string, DelegationReceipt['role']>();
  for (const receipt of receipts) {
    if (receipt.packageId !== packet.work.packageId) {
      throw new Error('Delegation receipt escaped the current Work Package');
    }
    const priorRole = identities.get(receipt.executionId);
    if (priorRole && priorRole !== receipt.role) {
      throw new Error('One delegated execution identity cannot claim multiple roles');
    }
    if (priorRole) throw new Error('Delegated execution identity is duplicated');
    identities.set(receipt.executionId, receipt.role);
  }
  if (!receipts.some((receipt) => receipt.role === 'implementer' && receipt.status === 'succeeded')) {
    throw new Error('Subagent Build Execute has no succeeded implementer receipt');
  }
}
