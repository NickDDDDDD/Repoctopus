import { describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../domains/evidence/gate.js';
import { createEvidenceReceipt } from '../domains/evidence/receipt.js';
import type { EvidenceBundle, EvidenceReceipt } from '../domains/evidence/types.js';
import type { VerificationInput } from '../domains/change-lifecycle/verification-input.js';
import {
  deriveVerifyRepairScope,
  createVerifyRepair,
  assertVerifyRepair,
} from '../domains/change-lifecycle/verify-repair.js';
import {
  advanceBuildProtocol,
  advanceBuildWorkspaceCheckpoint,
  createBuildInvalidation,
  createBuildPlan,
  reuseEquivalentBuildPlan,
  assertBuildProtocolState,
  createPackageCompletionEvidence,
} from '../domains/change-lifecycle/build-protocol.js';
import { classifyRecoveryObservation } from '../domains/runtime/recovery.js';
import { verifyRepairFixture, repairDigest as sha } from './helpers/verify-repair-fixture.js';

function evidence(dependencies: readonly string[] = []) {
  const f = verifyRepairFixture(dependencies);
  const coverage = f.plan.packages.map((p, i) => ({
    acceptanceId: p.acceptanceRefs[0] as `acceptance-${string}`,
    nodeIds: [`check-${i}`],
  }));
  const verification = {
    digest: sha('verify'),
    acceptanceSetHash: sha('acceptance'),
    acceptanceCoverage: coverage,
  } as unknown as VerificationInput;
  const receipts = coverage.map((_, i) =>
    createEvidenceReceipt({
      compositionDigest: sha('composition'),
      attemptId: 'attempt',
      nodeId: `check-${i}`,
      adapter: 'command',
      trust: 'verified',
      freshness: 'fresh',
      status: i === 0 ? 'failed' : 'passed',
      inputFingerprint: sha(`inputs-${i}`).slice(7),
      startedAt: '2026-11-09T00:00:00Z',
      completedAt: '2026-11-09T00:00:01Z',
      artifacts: [],
      findings: [],
    }),
  );
  const bundle = createEvidenceBundle({
    attemptId: 'attempt',
    compositionDigest: sha('composition'),
    profileId: 'verify',
    inputFingerprint: sha('all').slice(7),
    createdAt: '2026-11-09T00:00:02Z',
    artifactDigests: [],
    receiptIds: receipts.map((r) => r.receiptId),
    findings: [],
    checks: receipts.map((r) => ({
      nodeId: r.nodeId,
      required: true,
      status: r.status,
      trust: r.trust,
      freshness: r.freshness,
      receiptId: r.receiptId,
    })),
    acceptanceTrace: {
      schemaVersion: 1,
      verificationInputDigest: verification.digest,
      acceptanceSetHash: verification.acceptanceSetHash,
      total: 4,
      passed: 3,
      failed: 1,
      missing: 0,
      digest: sha('trace'),
      entries: coverage.map((c, i) => ({
        ...c,
        nodeIds: [...c.nodeIds],
        status: i === 0 ? 'failed' : 'passed',
        receiptIds: [receipts[i]!.receiptId],
      })),
    },
  });
  const derive = (b: EvidenceBundle = bundle, rs: EvidenceReceipt[] = receipts) =>
    deriveVerifyRepairScope({
      bundle: b,
      receipts: rs,
      verification,
      plan: f.plan,
      completions: f.protocol.packageCompletions,
    });
  return { ...f, verification, receipts, bundle, derive };
}

describe('Verify implementation repair scope', () => {
  it('does not retain the newly submitted completion when repair invalidates its prerequisite', () => {
    const f = evidence(['a']);
    const initial = createBuildInvalidation({
      source: 'verify',
      plan: f.plan,
      classification: 'implementation',
      affectedPackageIds: [f.plan.packages[1]!.packageId],
      packageCompletions: f.protocol.packageCompletions,
      reason: 'B failed',
    });
    let state = advanceBuildProtocol(f.protocol, {
      kind: 'revision-required',
      invalidation: initial,
    });
    const next = () =>
      advanceBuildWorkspaceCheckpoint({
        current: state.workspaceCheckpoint!,
        observed: state.workspaceCheckpoint!.repositories,
        writableRepositoryIds: ['workspace'],
        relations: { workspace: 'unchanged' },
      });
    state = advanceBuildProtocol(state, {
      kind: 'plan-accepted',
      plan: f.plan,
      workspaceCheckpoint: next(),
    });
    state = advanceBuildProtocol(state, {
      kind: 'plan-evidence-accepted',
      evidence: f.protocol.planEvidence!,
    });
    const checkpoint = next();
    const completion = createPackageCompletionEvidence({
      workPackage: f.plan.packages[1]!,
      executionId: 'repair-B',
      acceptanceEvidenceIds: ['repair-B-green'],
      testEvidenceIds: ['repair-B-regression'],
      tddMode: 'direct',
      workspaceCheckpointDigest: checkpoint.digest,
      implementationDigest: sha('repair-B'),
    });
    const retentionInvalidation = createBuildInvalidation({
      source: 'verify',
      plan: f.plan,
      classification: 'implementation',
      affectedPackageIds: [f.plan.packages[0]!.packageId],
      packageCompletions: state.packageCompletions,
      reason: 'B repair changed an input of A',
    });
    state = advanceBuildProtocol(state, {
      kind: 'package-completed',
      completion,
      workspaceCheckpoint: checkpoint,
      retentionInvalidation,
    });
    expect(state.packageCompletions).toEqual(f.protocol.packageCompletions.slice(2));
    expect(state.currentAction).toBe('execute');
  });
  it('retains the exact three independently proved completion identities', () => {
    const f = evidence();
    const facts = f.derive();
    expect(facts.affectedPackageIds).toEqual([f.plan.packages[0]!.packageId]);
    expect(facts.retained.map((r) => r.completionId)).toEqual(
      f.protocol.packageCompletions.slice(1).map((c) => c.completionId),
    );
  });
  it('expands through package dependents even if their earlier machine check passed', () => {
    const f = evidence(['a']);
    const facts = f.derive();
    expect(facts.affectedPackageIds).toEqual(
      f.plan.packages
        .slice(0, 2)
        .map((p) => p.packageId)
        .sort(),
    );
    expect(facts.retained).toHaveLength(2);
  });
  it.each([
    'finding',
    'unknown-node',
    'missing-receipt',
    'missing-trace',
    'untrusted-receipt',
  ] as const)('blocks %s instead of guessing global scope', (kind) => {
    const f = evidence();
    const b = structuredClone(f.bundle);
    const rs = structuredClone(f.receipts);
    if (kind === 'finding')
      b.findings.push({ severity: 'error', code: 'unmapped-review', summary: 'No ownership' });
    if (kind === 'unknown-node') b.checks[0]!.nodeId = 'unknown';
    if (kind === 'missing-receipt') b.checks[0]!.receiptId = 'missing';
    if (kind === 'missing-trace') b.acceptanceTrace!.entries[1]!.status = 'missing';
    if (kind === 'untrusted-receipt') rs[1]!.trust = 'observed';
    expect(() => f.derive(b, rs)).toThrow(/scope unavailable/u);
  });
  it('permits proven global coverage to invalidate every package', () => {
    const f = evidence();
    const coverage = f.verification.acceptanceCoverage.map((c) => ({ ...c, nodeIds: ['check-0'] }));
    const v = { ...f.verification, acceptanceCoverage: coverage };
    const b = {
      ...f.bundle,
      acceptanceTrace: {
        ...f.bundle.acceptanceTrace!,
        passed: 0,
        failed: 4,
        entries: coverage.map((c) => ({
          ...c,
          status: 'failed' as const,
          receiptIds: [f.receipts[0]!.receiptId],
        })),
      },
    };
    const facts = deriveVerifyRepairScope({
      bundle: b,
      verification: v,
      plan: f.plan,
      completions: f.protocol.packageCompletions,
      receipts: f.receipts,
    });
    expect(facts.affectedPackageIds).toHaveLength(4);
    expect(facts.retained).toEqual([]);
  });
  it('does not authorize implementation repair from an infrastructure timeout', () => {
    const f = evidence();
    const b = structuredClone(f.bundle);
    const rs = structuredClone(f.receipts);
    b.checks[0]!.status = 'incomplete';
    rs[0]!.status = 'incomplete';
    expect(() => f.derive(b, rs)).toThrow(/scope unavailable/u);
  });
  it('rejects string-shaped and duplicate scope collections at the creation boundary', () => {
    const f = evidence();
    const facts = f.derive();
    const source = {
      attemptId: 'attempt',
      bundleId: f.bundle.bundleId,
      verificationInputDigest: f.verification.digest,
      checkEpoch: 9,
      planDigest: f.plan.digest,
    };
    const scope = { ...facts, invalidationDigest: sha('invalidation') };
    expect(() =>
      createVerifyRepair({
        source,
        scope: { ...scope, failedNodeIds: 'check-a' as unknown as string[] },
        retained: facts.retained,
      }),
    ).toThrow(/shape/u);
    expect(() =>
      createVerifyRepair({
        source,
        scope: { ...scope, failedNodeIds: ['a', 'a'] },
        retained: facts.retained,
      }),
    ).toThrow(/shape/u);
  });
  it('reuses all semantic Plan facts but gives actual candidate changes a new identity', () => {
    const f = evidence();
    const candidate = createBuildPlan({
      runId: f.runId,
      revision: 2,
      strategy: f.strategy,
      binding: f.binding,
      planningDigest: f.tasks.digest,
      tasks: f.tasks,
      candidate: f.candidate,
    });
    expect(reuseEquivalentBuildPlan(f.plan, candidate)).toBe(f.plan);
    const changed = createBuildPlan({
      runId: f.runId,
      revision: 2,
      strategy: f.strategy,
      binding: f.binding,
      planningDigest: f.tasks.digest,
      tasks: f.tasks,
      candidate: {
        packages: f.candidate.packages.map((p, i) =>
          i === 0 ? { ...p, expectedOutcomes: ['changed'] } : p,
        ),
      },
    });
    expect(reuseEquivalentBuildPlan(f.plan, changed)).toBe(changed);
  });
  it('cold serialization keeps repair facts and original completions, rejects old schema and tampering', () => {
    const f = evidence();
    const facts = f.derive();
    const invalidation = createBuildInvalidation({
      source: 'verify',
      plan: f.plan,
      classification: 'implementation',
      affectedPackageIds: facts.affectedPackageIds,
      packageCompletions: f.protocol.packageCompletions,
      reason: 'failure',
    });
    const repair = createVerifyRepair({
      source: {
        attemptId: 'attempt',
        bundleId: f.bundle.bundleId,
        verificationInputDigest: f.verification.digest,
        checkEpoch: 9,
        planDigest: f.plan.digest,
      },
      scope: {
        failedNodeIds: facts.failedNodeIds,
        failedAcceptanceIds: facts.failedAcceptanceIds,
        affectedPackageIds: invalidation.affectedPackageIds,
        invalidationDigest: invalidation.digest,
      },
      retained: facts.retained,
    });
    let state = advanceBuildProtocol(f.protocol, {
      kind: 'revision-required',
      invalidation,
      verifyRepair: repair,
    });
    state = JSON.parse(JSON.stringify(state)) as typeof state;
    assertBuildProtocolState(state);
    const damaged = structuredClone(state);
    damaged.packageCompletions[0]!.completionId = 'damaged-completion-id';
    expect(() => assertBuildProtocolState(damaged)).toThrow(/completion/u);
    expect(state.packageCompletions).toEqual(f.protocol.packageCompletions.slice(1));
    const checkpoint = advanceBuildWorkspaceCheckpoint({
      current: state.workspaceCheckpoint!,
      observed: state.workspaceCheckpoint!.repositories,
      writableRepositoryIds: ['workspace'],
      relations: { workspace: 'unchanged' },
    });
    state = advanceBuildProtocol(state, {
      kind: 'plan-accepted',
      plan: f.plan,
      workspaceCheckpoint: checkpoint,
    });
    expect(state.plans).toHaveLength(1);
    expect(state.plan).toBe(f.plan);
    expect(() => assertBuildProtocolState({ ...state, schemaVersion: 2 })).toThrow(
      /Unsupported Build Protocol/u,
    );
    expect(() => assertVerifyRepair({ ...repair, retained: [] })).toThrow(/digest/u);
  });
  it('classifies a failed implementation as Work authority while retaining Plan identity', () => {
    const decision = classifyRecoveryObservation({
      schemaVersion: 1,
      runId: 'run',
      expectedRevision: 9,
      checkEpoch: 9,
      observationId: 'verify-failure',
      planning: { status: 'current', changedIdentities: [] },
      plan: { status: 'current', changedIdentities: [] },
      evidence: { status: 'current', changedIdentities: [] },
      work: {
        status: 'implementation-failed',
        reasonCode: 'implementation-failed',
        changedIdentities: ['package-completion'],
      },
    })!;
    expect(decision.action).toBe('revise-implementation');
    expect(decision.authority).toBe('work');
    expect(decision.retainedIdentities).toContain('build-plan');
  });
});
