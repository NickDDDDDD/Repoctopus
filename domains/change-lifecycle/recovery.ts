import {
  assertRecoveryDecision,
  type RecoveryDecision,
} from '../runtime/recovery.js';
import { advanceBuildProtocol, type BuildInvalidation } from './build-protocol.js';
import type { VerificationInput } from './verification-input.js';
import {
  applyChangeLifecycleTransition,
  evolveChangeLifecycle,
  type ChangeLifecycleDefinition,
  type ChangeLifecycleReduction,
  type ChangeLifecycleSnapshot,
  type ChangeLifecycleTransitionFact,
  type WorkDescriptor,
} from './transition.js';

export interface LifecycleRecoveryMaterialization {
  work: WorkDescriptor;
  inputDigest?: `sha256:${string}`;
  evidenceIds: readonly string[];
  invalidation?: BuildInvalidation;
  verificationInput?: VerificationInput;
}

function assertDecisionCheckpoint(
  current: ChangeLifecycleSnapshot,
  decision: RecoveryDecision,
): void {
  assertRecoveryDecision(decision);
  if (
    decision.runId !== current.identity.runId ||
    decision.expectedRevision !== current.revision ||
    decision.checkEpoch !== current.checkEpoch
  ) {
    throw new Error('Recovery decision belongs to a stale lifecycle checkpoint');
  }
}

function attachRecovery(
  reduction: { snapshot: ChangeLifecycleSnapshot; fact: ChangeLifecycleTransitionFact },
  decision: RecoveryDecision,
): ChangeLifecycleReduction {
  return {
    snapshot: reduction.snapshot,
    fact: {
      ...reduction.fact,
      recovery: {
        decisionId: decision.decisionId,
        observationId: decision.observationId,
        action: decision.action,
        authority: decision.authority,
        reasonCode: decision.reasonCode,
        retainedIdentities: [...decision.retainedIdentities],
        invalidatedIdentities: [...decision.invalidatedIdentities],
      },
    },
  };
}

function reviseDesign(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  if (decision.authority !== 'planning') {
    throw new Error('revise-design requires a planning recovery decision');
  }
  if (!materialization.inputDigest || !/^sha256:[a-f0-9]{64}$/u.test(materialization.inputDigest)) {
    throw new Error('revise-design requires the observed planning input digest');
  }
  const invalidationKind = decision.changedIdentities.includes('approval-authority')
    ? 'approval-authority'
    : 'semantic';
  const reduction = evolveChangeLifecycle({
    definition: input.definition,
    current,
    observation: {
      kind: 'planning-authority-invalidated',
      expectedRevision: decision.expectedRevision,
      fromPhase: current.phase as 'build' | 'verify' | 'archive',
      invalidationKind,
      reason: decision.reasonCode,
      evidenceIds: [...materialization.evidenceIds],
      inputDigest: materialization.inputDigest,
      work: materialization.work,
    },
  });
  if (!reduction.fact) throw new Error('revise-design did not materialize a lifecycle transition');
  return attachRecovery({ snapshot: reduction.snapshot, fact: reduction.fact }, decision);
}

function revisePlan(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  if (decision.authority !== 'plan') {
    throw new Error('revise-plan requires a Plan recovery decision');
  }
  if (
    !['build', 'verify'].includes(current.phase) ||
    !['running', 'blocked'].includes(current.status) ||
    !current.buildProtocol ||
    !materialization.invalidation ||
    materialization.work.phase !== 'build' ||
    materialization.work.kind !== 'build.plan' ||
    materialization.work.checkEpoch !== current.checkEpoch + 1
  ) {
    throw new Error('revise-plan does not match the active Build checkpoint');
  }
  const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
    kind: 'revision-required',
    invalidation: materialization.invalidation,
  });
  return attachRecovery(
    applyChangeLifecycleTransition({
      definition: input.definition,
      current,
      transitionId: current.phase === 'verify' ? 'verify.failed' : 'build.check-rejected',
      next: {
        currentWork: materialization.work,
        waitCondition: null,
        blocker: null,
        buildProtocol,
        verificationInput: null,
        verificationInvalidation: null,
        archiveDeliveryInput: null,
        specificationClosure: null,
        publicationReceipt: null,
      },
    }),
    decision,
  );
}

function continueBuild(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  if (decision.authority !== 'work') {
    throw new Error('continue-build requires a Work recovery decision');
  }
  if (
    current.phase !== 'build' ||
    current.status !== 'running' ||
    !current.currentWork ||
    !current.buildProtocol?.currentAction ||
    materialization.work.workId !== current.currentWork.workId ||
    materialization.work.checkEpoch !== current.checkEpoch
  ) {
    throw new Error('continue-build does not match the active Work checkpoint');
  }
  const buildProtocol = advanceBuildProtocol(current.buildProtocol, {
    kind: 'retry',
    action: current.buildProtocol.currentAction,
  });
  return attachRecovery(
    applyChangeLifecycleTransition({
      definition: input.definition,
      current,
      transitionId: 'build.work-continued',
      preserveCheckEpoch: true,
      next: {
        currentWork: current.currentWork,
        waitCondition: null,
        blocker: null,
        buildProtocol,
      },
    }),
    decision,
  );
}

function invalidateEvidence(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  const { current, decision, materialization } = input;
  const verificationInput = materialization.verificationInput;
  if (decision.authority !== 'evidence') {
    throw new Error('invalidate-evidence requires an Evidence recovery decision');
  }
  if (
    current.phase !== 'verify' ||
    !['running', 'blocked'].includes(current.status) ||
    !current.buildProtocol ||
    current.buildProtocol.status !== 'ready-for-verify' ||
    materialization.work.phase !== 'verify' ||
    materialization.work.kind !== 'evidence.verify' ||
    materialization.work.checkEpoch !== current.checkEpoch + 1 ||
    !verificationInput ||
    verificationInput.checkEpoch !== materialization.work.checkEpoch ||
    verificationInput.digest !== materialization.work.inputDigest
  ) {
    throw new Error('invalidate-evidence does not match the nearest Verify producer');
  }
  return attachRecovery(
    applyChangeLifecycleTransition({
      definition: input.definition,
      current,
      transitionId: 'verify.retry',
      next: {
        currentWork: materialization.work,
        waitCondition: null,
        blocker: null,
        buildProtocol: current.buildProtocol,
        verificationInput,
        verificationInvalidation: null,
        archiveDeliveryInput: null,
        specificationClosure: null,
        publicationReceipt: null,
      },
    }),
    decision,
  );
}

export function applyLifecycleRecoveryDecision(input: {
  definition: ChangeLifecycleDefinition;
  current: ChangeLifecycleSnapshot;
  decision: RecoveryDecision;
  materialization: LifecycleRecoveryMaterialization;
}): ChangeLifecycleReduction {
  assertDecisionCheckpoint(input.current, input.decision);
  if (input.decision.action === 'revise-design') return reviseDesign(input);
  if (input.decision.action === 'revise-plan') return revisePlan(input);
  if (input.decision.action === 'continue-build') return continueBuild(input);
  if (input.decision.action === 'invalidate-evidence') return invalidateEvidence(input);
  if (input.decision.action === 'retry-infrastructure') return invalidateEvidence(input);
  throw new Error(`Lifecycle recovery action is not materialized: ${input.decision.action}`);
}
