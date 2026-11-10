import { createHash } from 'node:crypto';
import { canonicalJson } from '../workflow-contract/canonical.js';
import type { EvidenceBundle, EvidenceReceipt } from '../evidence/types.js';
import type { VerificationInput } from './verification-input.js';
import {
  createBuildInvalidation,
  type BuildPlan,
  type PackageCompletionEvidence,
} from './build-protocol.js';

type Digest = `sha256:${string}`;
export interface VerifyRepairRetention {
  completionId: string;
  packageId: string;
  packageDigest: Digest;
  receiptIds: readonly string[];
}
export interface VerifyRepair {
  schemaVersion: 1;
  source: {
    attemptId: string;
    bundleId: string;
    verificationInputDigest: Digest;
    checkEpoch: number;
    planDigest: Digest;
  };
  scope: {
    failedNodeIds: readonly string[];
    failedAcceptanceIds: readonly string[];
    affectedPackageIds: readonly string[];
    invalidationDigest: Digest;
  };
  retained: readonly VerifyRepairRetention[];
  digest: Digest;
}

export class VerifyRepairUnavailableError extends Error {
  readonly code = 'verify-repair-scope-unavailable';
  constructor(reason: string) {
    super(`Verify repair scope unavailable: ${reason}`);
  }
}
const hash = (value: unknown): Digest =>
  `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
const unavailable = (reason: string): never => {
  throw new VerifyRepairUnavailableError(reason);
};

/** Inputs are authenticated machine facts; neither Host outcome nor error prose defines scope. */
export function deriveVerifyRepairScope(input: {
  bundle: EvidenceBundle;
  verification: VerificationInput;
  plan: BuildPlan;
  completions: readonly PackageCompletionEvidence[];
  receipts: readonly EvidenceReceipt[];
}) {
  const { bundle, verification, plan, completions, receipts } = input;
  const trace = bundle.acceptanceTrace;
  if (
    !trace ||
    trace.verificationInputDigest !== verification.digest ||
    trace.acceptanceSetHash !== verification.acceptanceSetHash
  )
    return unavailable('Bundle does not match frozen Acceptance authority');
  const checks = new Map(bundle.checks.map((c) => [c.nodeId, c]));
  if (checks.size !== bundle.checks.length) return unavailable('duplicate machine nodes');
  const coverage = new Map<string, readonly string[]>(
    verification.acceptanceCoverage.map((c) => [c.acceptanceId, c.nodeIds]),
  );
  const failedNodes = bundle.checks.filter((c) => c.required && c.status !== 'passed');
  if (!failedNodes.length) return unavailable('no attributable required failure');
  // Bundle-level errors must be attributable to a machine receipt, not guessed from text.
  for (const finding of bundle.findings.filter((f) => f.severity === 'error')) {
    if (!receipts.some((r) => r.findings.some((f) => canonicalJson(f) === canonicalJson(finding))))
      return unavailable('unattributed blocking finding');
  }
  const failedNodeIds = failedNodes.map((c) => c.nodeId).sort();
  for (const check of failedNodes) {
    if (![...coverage.values()].some((ids) => ids.includes(check.nodeId)))
      return unavailable('unmapped failed node');
    if (check.status === 'blocked') {
      if (!check.blockedBy?.length || check.blockedBy.some((id) => !failedNodeIds.includes(id)))
        return unavailable('unexplained blocked node');
    } else if (
      check.status !== 'failed' ||
      !check.receiptId ||
      !receipts.some(
        (r) =>
          r.receiptId === check.receiptId &&
          r.nodeId === check.nodeId &&
          r.trust === 'verified' &&
          r.status === 'failed',
      )
    )
      return unavailable('missing failed machine receipt');
  }
  const failedAcceptanceIds = [...coverage]
    .filter(([, ids]) => ids.some((id) => failedNodeIds.includes(id)))
    .map(([id]) => id)
    .sort();
  if (failedAcceptanceIds.some((id) => !plan.packages.some((p) => p.acceptanceRefs.includes(id))))
    return unavailable('failed Acceptance is outside the accepted Plan');
  const affectedPackageIds = plan.packages
    .filter((p) => p.acceptanceRefs.some((id) => failedAcceptanceIds.includes(id)))
    .map((p) => p.packageId);
  const invalidation = createBuildInvalidation({
    source: 'verify',
    plan,
    classification: 'implementation',
    affectedPackageIds,
    packageCompletions: completions,
    reason: 'Required machine evidence rejected the implementation',
  });
  const retained: VerifyRepairRetention[] = [];
  for (const completion of completions.filter(
    (c) => !invalidation.affectedPackageIds.includes(c.packageId),
  )) {
    const workPackage = plan.packages.find(
      (p) => p.packageId === completion.packageId && p.digest === completion.packageDigest,
    );
    if (!workPackage) return unavailable('completion contract is not in current Plan');
    const receiptIds = new Set<string>();
    for (const acceptanceId of workPackage.acceptanceRefs) {
      const entry = trace.entries.find((e) => e.acceptanceId === acceptanceId);
      const nodeIds = coverage.get(acceptanceId);
      if (
        !entry ||
        entry.status !== 'passed' ||
        !nodeIds?.length ||
        canonicalJson([...entry.nodeIds].sort()) !== canonicalJson([...nodeIds].sort())
      )
        return unavailable('retained Acceptance lacks passed machine coverage');
      for (const nodeId of nodeIds) {
        const check = checks.get(nodeId);
        const receipt = receipts.find(
          (r) => r.receiptId === check?.receiptId && r.nodeId === nodeId,
        );
        if (
          !check?.required ||
          check.status !== 'passed' ||
          !receipt ||
          receipt.status !== 'passed' ||
          receipt.trust !== 'verified' ||
          !['fresh', 'reused'].includes(receipt.freshness) ||
          !entry.receiptIds.includes(receipt.receiptId)
        )
          return unavailable('retained machine receipt is missing or untrusted');
        receiptIds.add(receipt.receiptId);
      }
    }
    retained.push({
      completionId: completion.completionId,
      packageId: completion.packageId,
      packageDigest: completion.packageDigest,
      receiptIds: [...receiptIds].sort(),
    });
  }
  return {
    failedNodeIds,
    failedAcceptanceIds,
    affectedPackageIds: invalidation.affectedPackageIds,
    retained,
  };
}

export function createVerifyRepair(
  facts: Omit<VerifyRepair, 'schemaVersion' | 'digest'>,
): VerifyRepair {
  const body = { schemaVersion: 1 as const, ...facts };
  const value = { ...body, digest: hash(body) };
  assertVerifyRepair(value);
  return value;
}
export function assertVerifyRepair(value: unknown): asserts value is VerifyRepair {
  if (!value || typeof value !== 'object') throw new Error('Invalid Verify repair facts');
  const repair = value as VerifyRepair;
  const { digest, ...body } = repair;
  const ids = (value: unknown, nonempty = true): value is string[] =>
    Array.isArray(value) &&
    (!nonempty || value.length > 0) &&
    value.every((id) => typeof id === 'string' && id.trim().length > 0 && id.length <= 256) &&
    new Set(value).size === value.length;
  if (
    repair.schemaVersion !== 1 ||
    !repair.source?.attemptId ||
    !repair.source.bundleId ||
    !/^sha256:[a-f0-9]{64}$/u.test(repair.source.verificationInputDigest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(repair.source.planDigest) ||
    !Number.isSafeInteger(repair.source.checkEpoch) ||
    repair.source.checkEpoch < 0 ||
    !ids(repair.scope?.failedNodeIds) ||
    !ids(repair.scope.failedAcceptanceIds) ||
    !ids(repair.scope.affectedPackageIds) ||
    !/^sha256:[a-f0-9]{64}$/u.test(repair.scope.invalidationDigest) ||
    !Array.isArray(repair.retained) ||
    repair.retained.some(
      (r: VerifyRepairRetention) =>
        !r ||
        !r.completionId ||
        !r.packageId ||
        !/^sha256:[a-f0-9]{64}$/u.test(r.packageDigest) ||
        !ids(r.receiptIds) ||
        repair.scope.affectedPackageIds.includes(r.packageId),
    ) ||
    new Set(repair.retained.map((r: VerifyRepairRetention) => r.packageId)).size !==
      repair.retained.length ||
    digest !== hash(body)
  )
    throw new Error('Invalid Verify repair shape or digest');
}
